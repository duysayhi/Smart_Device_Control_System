import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve('.'), load = createRequire(import.meta.url);
const environment = Object.fromEntries(['TEACH_STORAGE_MODE', 'DATABASE_URL', 'TEACH_DATABASE_SCHEMA'].map(k => [k, process.env[k]]));
let db, unavailable = false, pools = [], statements = [];
class FixturePool {
  constructor(options) { this.options = options; pools.push(this); }
  async query(sql, values = []) {
    if (unavailable) throw Object.assign(Error('synthetic-private-server-detail'), { code: 'ECONNREFUSED' });
    statements.push(sql);
    const r = await db.query(sql, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }
  async connect() { return { query: this.query.bind(this), release() {} }; }
  async end() {}
}
const originalLoad = Module._load;
Module._load = function(id, ...args) { return id === 'pg' ? { Pool: FixturePool } : originalLoad.call(this, id, ...args); };
Module._extensions['.ts'] = (m, f) => {
  const original = m.require.bind(m);
  m.require = id => original(id.startsWith('@/') ? path.join(root, id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
};
const api = load('../lib/skills/teach-api.ts');
Module._load = originalLoad;
const sessions = load('../app/api/teach-sessions/route.ts');
const operations = load('../app/api/teach-sessions/[id]/[operation]/route.ts');
const library = load('../app/api/skills/route.ts');
const versions = load('../app/api/skills/[id]/versions/[version]/route.ts');
const deviceId = '10000000-0000-4000-8000-000000000001';
const request = (url, body, headers) => new Request('http://localhost' + url, body === undefined ? {} : {
  method: 'POST', headers: headers ?? { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const post = (id, operation, body) => operations.POST(request(`/api/teach-sessions/${id}/${operation}`, body), { params: Promise.resolve({ id, operation }) });
const list = () => library.GET(request('/api/skills'));
const count = async () => Number((await db.query('SELECT count(*) AS n FROM teach_mode.skills')).rows[0].n);
async function reviewed() {
  let response = await sessions.POST(request('/api/teach-sessions', { deviceId, command: 'Open YouTube and search marine biology', name: 'G22B fixture', appAlias: 'youtube' }));
  assert.equal(response.status, 200); let session = await response.json();
  session = await (await post(session.id, 'start', { revision: session.revision })).json();
  for (const action of [
    { operation: 'OPEN_APPLICATION', appRef: 'youtube' },
    { operation: 'ACTIVATE_CONTROL', purpose: 'SEARCH', target: { semanticRole: 'search_action', label: 'Search', containerRole: 'toolbar' } },
    { operation: 'INPUT_TEXT', value: 'marine biology', target: { semanticRole: 'search_field', label: 'Search', containerRole: 'search' } },
    { operation: 'SUBMIT_SEARCH' },
  ]) {
    response = await post(session.id, 'actions', { revision: session.revision, action });
    assert.equal(response.status, 200); session = await response.json();
  }
  session = await (await post(session.id, 'finish', { revision: session.revision })).json();
  response = await post(session.id, 'compile', { revision: session.revision });
  assert.equal(response.status, 200); return response.json();
}
const saveBody = review => ({ reference: review.reference, confirmed: true, name: 'G22B persisted fixture', parameterNames: { query: 'topic' } });
before(async () => { db = new PGlite(); await db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql', import.meta.url), 'utf8')); await db.exec('SET search_path TO public'); });
beforeEach(async () => {
  delete globalThis.phoneCommanderTeachOfflineG1; delete globalThis.phoneCommanderTeachPostgres;
  pools = []; statements = []; unavailable = false;
  process.env.TEACH_STORAGE_MODE = 'POSTGRESQL'; process.env.DATABASE_URL = 'postgresql://fixture.invalid/offline'; process.env.TEACH_DATABASE_SCHEMA = 'teach_mode';
  await db.exec("DELETE FROM teach_mode.consents; INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
});
after(async () => { await db.close(); for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test('G22B production routes share one factory pool across declarations, Save, Library and version readback', async () => {
  const n = await count(), review = await reviewed();
  assert.equal(await count(), n, 'compile does not save');
  assert.ok(review.session.actions.every(a => a.declarationStatus === 'DECLARED' && a.dispatchStatus === 'NOT_DISPATCHED'));
  const response = await post(review.session.id, 'save-draft', saveBody(review)); assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.storageMode, 'POSTGRESQL_STORAGE'); assert.equal(saved.status, 'DRAFT');
  const listed = await (await list()).json(); assert.ok(listed.skills.some(s => s.id === saved.skillId));
  const reread = await versions.GET(request('/api/skills/x/versions/1'), { params: Promise.resolve({ id: saved.skillId, version: '1' }) });
  assert.deepEqual(await reread.json(), saved); assert.equal(await count(), n + 1);
  assert.equal(pools.length, 1); assert.deepEqual(pools[0].options, { connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000 });
  assert.equal(statements.filter(s => s === 'COMMIT').length, 1);
  const body = JSON.stringify(saved); assert.ok(!body.includes('fixture.invalid')); assert.ok(!body.includes('marine biology'));
  for (const table of ['teach_sessions', 'recorded_actions', 'ui_snapshots', 'executions', 'skill_tests', 'devices']) assert.equal(Number((await db.query(`SELECT count(*) AS n FROM teach_mode.${table}`)).rows[0].n), 0);
});

test('G22B new bootstrap instance preserves PostgreSQL DRAFT but loses unsaved declaration/reference', async () => {
  const review = await reviewed(), saved = await (await post(review.session.id, 'save-draft', saveBody(review))).json();
  const old = api.teachDashboard(); delete globalThis.phoneCommanderTeachPostgres;
  assert.notEqual(api.teachDashboard(), old);
  assert.ok((await (await list()).json()).skills.some(s => s.id === saved.skillId));
  assert.equal((await post(review.session.id, 'save-draft', saveBody(review))).status, 404);
  assert.equal(pools.length, 2);
});

test('G22B bootstrap survives module reload without another pool and rejects changed connection binding', async () => {
  const first = api.teachDashboard(); delete load.cache[load.resolve('../lib/skills/teach-api.ts')];
  assert.equal(load('../lib/skills/teach-api.ts').teachDashboard(), first); assert.equal(pools.length, 1);
  process.env.DATABASE_URL = 'postgresql://different.invalid/offline';
  const response = await list(); assert.equal(response.status, 500); assert.equal((await response.json()).code, 'DATABASE_ERROR');
  assert.equal(pools.length, 1); assert.equal(globalThis.phoneCommanderTeachOfflineG1, undefined);
});

test('G22B guards reject foreign origin before bootstrap; client cannot select mode, SQL or authority', async () => {
  const blocked = await sessions.POST(request('/api/teach-sessions', {}, { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }));
  assert.equal(blocked.status, 403); assert.equal(pools.length, 0);
  const review = await reviewed(), n = await count();
  for (const key of ['storageMode', 'DATABASE_URL', 'definition', 'grant', 'proof', 'verified']) {
    const response = await post(review.session.id, 'save-draft', { ...saveBody(review), [key]: 'untrusted' });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_PAYLOAD');
  }
  assert.equal((await post(review.session.id, 'save-draft', { ...saveBody(review), confirmed: false })).status, 400);
  assert.equal(await count(), n);
});

test('G22B missing URL or unknown server mode fails closed without allocating/falling back', async () => {
  delete process.env.DATABASE_URL;
  assert.equal((await list()).status, 500); assert.equal(pools.length, 0);
  process.env.TEACH_STORAGE_MODE = 'unrecognized'; assert.equal((await list()).status, 500);
  assert.equal(globalThis.phoneCommanderTeachOfflineG1, undefined);
});

test('G22B selected PostgreSQL unavailable produces sanitized HTTP 500, never memory success', async () => {
  unavailable = true;
  for (const response of [await list(), await versions.GET(request('/api/skills/x/versions/1'), { params: Promise.resolve({ id: deviceId, version: '1' }) })]) {
    assert.equal(response.status, 500); const body = await response.text();
    assert.match(body, /DATABASE_ERROR/); assert.doesNotMatch(body, /synthetic-private|fixture.invalid|ECONNREFUSED/);
  }
  assert.equal(pools.length, 1); assert.equal(globalThis.phoneCommanderTeachOfflineG1, undefined);
});

test('G22B revoked consent blocks API Save without changing Neon-like fixture records', async () => {
  const review = await reviewed(), n = await count(); await db.exec('UPDATE teach_mode.consents SET revoked_at=now()');
  const response = await post(review.session.id, 'save-draft', saveBody(review)); assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'NO_REMOTE_CONSENT'); assert.equal(await count(), n);
});

test('G22B concurrent and sequential API Save dispatch one transaction, preserve replay binding', async () => {
  const review = await reviewed(), n = await count(), body = saveBody(review);
  const replies = await Promise.all([post(review.session.id, 'save-draft', body), post(review.session.id, 'save-draft', body)]);
  assert.ok(replies.every(r => r.status === 200)); const [a, b] = await Promise.all(replies.map(r => r.json())); assert.deepEqual(a, b);
  assert.deepEqual(await (await post(review.session.id, 'save-draft', body)).json(), a);
  assert.equal((await post(review.session.id, 'save-draft', { ...body, name: 'changed binding' })).status, 409);
  assert.equal(await count(), n + 1); assert.equal(statements.filter(s => s === 'COMMIT').length, 1);
});

test('G22B lost COMMIT acknowledgement keeps UNKNOWN and never dispatches a second API Save', async () => {
  const review = await reviewed(), n = await count(), pool = pools[0], query = pool.query.bind(pool);
  pool.query = async (sql, values) => { const result = await query(sql, values); if (sql === 'COMMIT') throw Object.assign(Error('synthetic-private-commit-detail'), { code: 'ECONNRESET' }); return result; };
  for (let i = 0; i < 2; i++) { const response = await post(review.session.id, 'save-draft', saveBody(review)); assert.equal(response.status, 409); const body = await response.text(); assert.match(body, /SAVE_OUTCOME_UNKNOWN/); assert.doesNotMatch(body, /synthetic-private/); }
  assert.equal(await count(), n + 1); assert.equal(statements.filter(s => s === 'COMMIT').length, 1);
});

test('G22B stale revisions remain rejected and explicit offline mode stays independent of DATABASE_URL', async () => {
  const session = await (await sessions.POST(request('/api/teach-sessions', { deviceId, command: 'Search', name: 'Test', appAlias: 'youtube' }))).json();
  assert.equal((await post(session.id, 'start', { revision: session.revision + 1 })).status, 409);
  process.env.TEACH_STORAGE_MODE = 'OFFLINE_TEST'; unavailable = true;
  const response = await list(); assert.equal(response.status, 200); assert.equal((await response.json()).storageMode, 'OFFLINE_TEST_STORAGE');
  delete process.env.TEACH_STORAGE_MODE; assert.equal(api.teachDashboard().mode, 'OFFLINE_TEST_STORAGE');
});
