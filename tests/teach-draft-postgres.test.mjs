import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const load = createRequire(import.meta.url), root = path.resolve('.');
Module._extensions['.ts'] = (m, file) => {
  const original = m.require.bind(m);
  m.require = id => original(id.startsWith('@/') ? path.join(root, id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file }).outputText, file);
};
const { OfflineTeachDashboard } = load('../lib/skills/teach-dashboard.ts');
const { TeachStorageService } = load('../lib/skills/teach-storage-service.ts');
const { PostgresTeachRepository } = load('../lib/skills/db/postgres-teach-repository.ts');
const { PgTeachDatabase } = load('../lib/skills/db/pg-database.ts');
const { TeachStorageError } = load('../lib/skills/db/teach-errors.ts');
const { teachResponse } = load('../lib/skills/teach-api.ts');
const deviceId = '10000000-0000-4000-8000-000000000001';
const config = () => ({ mode: 'OFFLINE_TEST', workspaceRoot: root, consentGranted: true, devices: [{ id: deviceId, label: 'Offline fixture only' }] });
let db, driver;
const queries = [];
const map = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql', import.meta.url), 'utf8'));
  await db.exec('SET search_path TO public');
  driver = {
    query: async (sql, values = []) => { queries.push(sql); return map(await db.query(sql, values)); },
    transaction: async work => db.transaction(tx => work({ query: async (sql, values = []) => { queries.push(sql); return map(await tx.query(sql, values)); } })),
    close: async () => db.close(),
  };
});
beforeEach(async () => {
  // Fixture-only consent in PGlite memory, never a production consent API.
  await db.exec('DELETE FROM teach_mode.consents');
  await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
});
after(async () => db?.close());
const repository = (database = driver) => new PostgresTeachRepository(database, 'teach_mode');
const dashboard = (database = driver, mode = 'PGLITE_TEST') => new OfflineTeachDashboard(config(), { mode, repository: repository(database) });
const count = async () => Number((await db.query('SELECT count(*) AS n FROM teach_mode.skills')).rows[0].n);
const actionList = () => [
  { operation: 'OPEN_APPLICATION', appRef: 'youtube' },
  { operation: 'ACTIVATE_CONTROL', purpose: 'SEARCH', target: { semanticRole: 'search_action', label: 'Search', containerRole: 'toolbar' } },
  { operation: 'INPUT_TEXT', value: 'OpenAI', target: { semanticRole: 'search_field', label: 'Search', containerRole: 'search' } },
  { operation: 'SUBMIT_SEARCH' },
];
function reviewed(service) {
  let s = service.create({ deviceId, name: 'Postgres search', command: 'Mở YouTube và tìm kiếm OpenAI', appAlias: 'youtube' });
  s = service.start(s.id, { revision: s.revision });
  for (const action of actionList()) s = service.add(s.id, { revision: s.revision, action });
  s = service.finish(s.id, { revision: s.revision });
  return service.compile(s.id, { revision: s.revision });
}
const body = review => ({ reference: review.reference, confirmed: true, name: 'Reviewed PG search', description: 'Metadata saved atomically', parameterNames: { query: 'topic' } });
function req(payload) {
  return new Request('http://localhost/api/teach-sessions', payload === undefined ? {} : {
    method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}
const save = (service, review, payload = body(review)) => teachResponse(req(payload), 'save-draft', { id: review.session.id }, service);

test('G2.1 PostgreSQL repository on PGlite: confirmed DRAFT, all metadata and schemas in one transaction', async () => {
  const originalFetch = global.fetch;
  global.fetch = () => assert.fail('No real database, Android or model network');
  try {
    const service = dashboard(), r = reviewed(service), n = await count();
    assert.ok(r.session.actions.every(a => a.declarationStatus === 'DECLARED' && a.dispatchStatus === 'NOT_DISPATCHED'));
    assert.equal(await count(), n, 'compile must not write a skill');
    const response = await save(service, r); assert.equal(response.status, 200);
    const saved = await response.json(); assert.equal(saved.storageMode, 'PGLITE_TEST_STORAGE'); assert.equal(saved.status, 'DRAFT');
    const skill = (await db.query('SELECT * FROM teach_mode.skills WHERE id=$1', [saved.skillId])).rows[0];
    const version = (await db.query('SELECT * FROM teach_mode.skill_versions WHERE skill_id=$1', [saved.skillId])).rows[0];
    assert.equal(skill.name, 'Reviewed PG search'); assert.equal(skill.description, 'Metadata saved atomically');
    assert.deepEqual(skill.app_scope, ['youtube']); assert.equal(skill.status, 'DRAFT');
    assert.equal(skill.current_version_id, version.id); assert.equal(version.version_no, 1); assert.equal(version.status, 'DRAFT');
    assert.deepEqual(version.workflow_json, saved.definition); assert.deepEqual(version.parameter_schema, saved.definition.parameters);
    assert.deepEqual(version.verification_schema, { steps: saved.definition.steps.map(s => ({ id: s.id, verify: s.verify })) });
    assert.deepEqual(saved.definition.steps[2].arguments.value, { param: 'topic' });
    assert.deepEqual(saved.definition.steps[3].verify.value, { param: 'topic' });
    assert.match(version.content_hash, /^[a-f0-9]{64}$/); assert.equal(version.evidence_level, 'COMPILED');
    assert.equal(version.source_session_id, null); assert.equal(JSON.stringify(saved).includes('OpenAI'), false);
    assert.doesNotMatch(JSON.stringify(saved), /"(?:receipt|snapshot|ownership|verified|evidenceLevel|contentHash)"/);
  } finally { global.fetch = originalFetch; }
});

test('G2.1 Library/readback survives a new repository and application service instance', async () => {
  const a = dashboard(), r = reviewed(a), saved = await (await save(a, r)).json();
  const fresh = dashboard();
  const response = await teachResponse(req(), 'skills', {}, fresh); assert.equal(response.status, 200);
  const list = await response.json(), row = list.skills.find(s => s.id === saved.skillId);
  assert.equal(row.name, saved.definition.name); assert.equal(row.description, saved.description);
  assert.equal(row.version, 1); assert.equal(row.status, 'DRAFT'); assert.deepEqual(row.appScope, { alias: 'youtube' });
  assert.ok(Number.isFinite(Date.parse(row.createdAt)));
  assert.deepEqual(await fresh.versionView(saved.skillId, 1), saved);
  const restarted = await save(fresh, r); assert.equal(restarted.status, 404, 'old declaration is not replayed after restart');
  assert.equal((await restarted.json()).code, 'NOT_FOUND');
});

for (const failAt of ['version', 'metadata']) test('G2.1 rollback is atomic when ' + failAt + ' write fails', async () => {
  const database = { ...driver, transaction: work => driver.transaction(tx => work({ query(sql, values) {
    if (failAt === 'version' ? /INSERT INTO .*"skill_versions"/.test(sql) : /UPDATE .*"skills"/.test(sql)) throw new TeachStorageError('CONSTRAINT_REJECTED');
    return tx.query(sql, values);
  } })) };
  const service = dashboard(database), r = reviewed(service), before = await count();
  const response = await save(service, r); assert.equal(response.status, 400); assert.equal((await response.json()).code, 'CONSTRAINT_REJECTED');
  assert.equal(await count(), before);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM teach_mode.skill_versions v LEFT JOIN teach_mode.skills s ON s.id=v.skill_id WHERE s.id IS NULL')).rows[0].n), 0);
});

for (const condition of ['missing', 'revoked', 'expired', 'newer-denial', 'device-only']) test('G2.1 ' + condition + ' consent rejects PostgreSQL writes despite declaration fixture approval', async () => {
  await db.exec('DELETE FROM teach_mode.consents');
  if (condition === 'revoked') await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted,revoked_at) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true,now())");
  if (condition === 'expired') await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted,expires_at) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true,now()-interval '1 hour')");
  if (condition === 'newer-denial') {
    await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted,created_at) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true,now()-interval '1 hour'),('local-owner','TEACH_REMOTE_STORAGE',false,now())");
  }
  if (condition === 'device-only') await db.query("INSERT INTO teach_mode.consents(subject_ref,device_id,consent_type,granted) VALUES ('local-owner',$1,'TEACH_REMOTE_STORAGE',true)", [deviceId]);
  const service = dashboard(), r = reviewed(service), n = await count(), response = await save(service, r);
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'NO_REMOTE_CONSENT'); assert.equal(await count(), n);
});

test('G2.1 concurrent/sequential Save uses one operation, altered binding never inserts another DRAFT', async () => {
  const service = dashboard(), r = reviewed(service), n = await count();
  const responses = await Promise.all([save(service, r), save(service, r)]);
  assert.ok(responses.every(r => r.status === 200));
  const [a, b] = await Promise.all(responses.map(r => r.json())); assert.deepEqual(a, b);
  assert.deepEqual(await (await save(service, r)).json(), a); assert.equal(await count(), n + 1);
  assert.equal((await save(service, r, { ...body(r), description: 'Different review' })).status, 409);
  assert.equal(await count(), n + 1);
});

test('G2.1 revision conflict preserves the current persisted metadata', async () => {
  const service = dashboard(), r = reviewed(service), saved = await (await save(service, r)).json();
  const repo = repository(), storage = new TeachStorageService(repo, { workspaceRoot: root }), skill = await repo.getSkill(saved.skillId);
  await storage.updateSkill({ skillId: skill.id, revision: skill.revision, name: 'Current name', description: 'Current description', currentVersionId: skill.currentVersionId });
  await assert.rejects(storage.updateSkill({ skillId: skill.id, revision: skill.revision, name: 'Stale name', description: null, currentVersionId: skill.currentVersionId }), e => e.code === 'CONFLICT');
  assert.equal((await repo.getSkill(skill.id)).name, 'Current name');
});

test('G2.1 connection failure is sanitized and does not fallback to memory', async () => {
  const unavailable = { query: async () => { throw { code: 'ECONNREFUSED', message: 'synthetic-private-vendor-detail' }; }, transaction: async () => { throw { code: 'ECONNREFUSED', message: 'synthetic-private-vendor-detail' }; } };
  const service = dashboard(unavailable, 'POSTGRESQL'), r = reviewed(service);
  assert.equal(service.fixtures().storageMode, 'POSTGRESQL_STORAGE');
  for (const response of [await save(service, r), await teachResponse(req(), 'skills', {}, service)]) {
    assert.equal(response.status, 500); const payload = await response.json(); assert.equal(payload.code, 'DATABASE_ERROR');
    assert.equal(JSON.stringify(payload).includes('synthetic-private'), false);
  }
  assert.throws(() => service.list(), e => e.code === 'INVALID_TRANSITION');
});

test('G2.1 lost COMMIT acknowledgement is UNKNOWN, never retried, and can be checked in a fresh Library', async () => {
  let transactions = 0;
  const lostAck = { ...driver, transaction: async work => { transactions++; await driver.transaction(work); throw new TeachStorageError('SAVE_OUTCOME_UNKNOWN'); } };
  const service = dashboard(lostAck), r = reviewed(service), n = await count();
  for (const response of [await save(service, r), await save(service, r)]) {
    assert.equal(response.status, 409); const payload = await response.json(); assert.equal(payload.code, 'SAVE_OUTCOME_UNKNOWN');
    assert.match(payload.error, /Skill Library/); assert.equal(payload.status, undefined);
  }
  assert.equal(transactions, 1); assert.equal(await count(), n + 1);
  const fresh = dashboard(), list = await fresh.listSkills();
  assert.ok(list.skills.some(s => s.description === 'Metadata saved atomically'));
});

test('G2.1 actual pg transaction adapter marks lost COMMIT as uncertain and discards the connection', async () => {
  const calls = []; let release;
  const connection = { query: async sql => { calls.push(sql); if (sql === 'COMMIT') throw Object.assign(Error('synthetic-private-server-message'), { code: 'ECONNRESET' }); return { rows: [], rowCount: 0 }; }, release: value => { release = value; } };
  const database = new PgTeachDatabase({ connect: async () => connection });
  await assert.rejects(database.transaction(async () => 'result'), error => error.code === 'SAVE_OUTCOME_UNKNOWN' && !error.message.includes('synthetic-private'));
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'ROLLBACK']); assert.equal(release, true);
});

test('G2.1 schema-qualified reads and writes work under public search_path; application never writes hash/evidence', async () => {
  const service = dashboard(), r = reviewed(service), saved = await (await save(service, r)).json();
  await service.listSkills(); await service.versionView(saved.skillId, 1);
  assert.ok(queries.some(q => /JOIN "teach_mode"\."skill_versions"/.test(q)));
  assert.ok(queries.some(q => /v\.skill_id=\$1 AND v\.version_no=\$2/.test(q)));
  for (const sql of queries) {
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|FROM|JOIN)\s+(?:skills|skill_versions|skill_tests)\b/i);
    assert.doesNotMatch(sql, /SET\s+(?:evidence_level|content_hash)\s*=|INSERT INTO[^\n]+\([^)]*\b(?:evidence_level|content_hash)\b/i);
    assert.doesNotMatch(sql, /INSERT INTO[^\n]+consents/i);
  }
});

test('G2.1 declarations never create devices, sessions, runtime receipts, snapshots, executions or tests', async () => {
  const service = dashboard(), r = reviewed(service); await save(service, r);
  for (const table of ['devices', 'teach_sessions', 'recorded_actions', 'ui_snapshots', 'executions', 'skill_tests']) {
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM teach_mode.${table}`)).rows[0].n), 0, table);
  }
});

test('G2.1 client authority flags/storage selection are rejected before PostgreSQL I/O', async () => {
  const service = dashboard(), r = reviewed(service), n = await count();
  for (const key of ['bounds', 'rawPoint', 'raw_point', 'tapPoint', 'point', 'coordinates', 'elementId', 'candidateId', 'grant', 'proof', 'verified', 'storageMode']) {
    const response = await save(service, r, { ...body(r), extra: [{ [key]: 'synthetic-input' }] });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_PAYLOAD');
  }
  assert.equal(await count(), n);
});

test('G2.1 existing explicit G1 memory mode remains usable without a PostgreSQL repository', async () => {
  const service = new OfflineTeachDashboard(config()), r = reviewed(service);
  const response = await save(service, r); assert.equal(response.status, 200);
  assert.equal((await response.json()).storageMode, 'OFFLINE_TEST_STORAGE');
  assert.equal(service.list().skills.length, 1); assert.equal((await service.listSkills()).skills.length, 1);
});
