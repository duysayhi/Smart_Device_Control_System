import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

// Standalone native loader: no Next server, environment file, worker or service.
const root = fileURLToPath(new URL('../', import.meta.url));
const load = createRequire(import.meta.url);
const originalTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => {
  const original = module.require.bind(module);
  module.require = id => original(id.startsWith('@/') ? path.join(root, id.slice(2)) : id);
  module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText, file);
};

const { PostgresHistoryRepository } = load('../lib/history/postgres-history-repository.ts');
const { HistoryQuerySchema, historyDevice, mapHistoryTask, hashHistory } = load('../lib/history/history-model.ts');
const { PgTeachDatabase } = load('../lib/skills/db/pg-database.ts');
const { verifyHistoryDatabase } = load('../lib/history/history-database.ts');
const AT = Date.UTC(2026, 0, 2, 3, 4, 5);
const PHYSICAL = 'a'.repeat(64);
const DIGEST = 'b'.repeat(64);
const FIXTURE_SHA256 = 'd33c407007202c279f01394a4ccd2db02d2d01a7d1166b9f7ad39f3aa4fa3365';
const executionId = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const proofId = '20000000-0000-4000-8000-000000000001';
const SECRET = 'synthetic-SECRET-otp-654321'; // gitleaks:allow -- synthetic privacy test input
const COMMAND = `Mở Máy tính — tiếng Việt 日本語 🔒 ${SECRET}`;
const trace = [];
let memory, driver, repository, originalFetch;
const result = value => ({ rows: value.rows, rowCount: value.affectedRows ?? value.rows.length });
const query = input => HistoryQuerySchema.parse(input);
const read = input => repository.read(query(input));
const dbError = error => error?.code === 'HISTORY_DATABASE_UNAVAILABLE' && !error.message.includes(SECRET);

function android(overrides = {}) {
  return { serial: 'offline-fixture-usb', physicalId: `android:${PHYSICAL}`, identityVerified: true,
    model: 'Điện thoại 日本語', status: 'device', connectionType: 'USB', osVersion: '15', ...overrides };
}

function task(number = 1, overrides = {}) {
  const id = executionId(number);
  const outcome = { id: 'launch-node', kind: 'LAUNCH', span: { start: 0, end: COMMAND.length, text: COMMAND },
    app: 'Calculator', value: 'Calculator', negated: false, effect: 'READ', ambiguity: [] };
  const graph = { version: 2, id: `graph-${number}`, deviceId: android().serial, executionId: id,
    original: { version: 2, request: COMMAND, outcomes: [outcome] }, coverage: 'COMPLETE',
    nodes: [{ id: outcome.id, outcome, dependencies: [], app: 'Calculator', packageName: 'com.android.calculator2',
      capability: 'LAUNCH', preconditions: [], predicates: ['FOREGROUND_IS'], inputs: [], outputs: [],
      status: 'VERIFIED', evidenceIds: [proofId] }] };
  return { executionId: id, batchId: executionId(900), deviceId: android().serial, physicalId: android().physicalId,
    agentVersion: 2, request: COMMAND, status: 'COMPLETED', createdAt: AT, finishedAt: AT + 1000, events: [],
    latest: { type: 'complete', status: 'COMPLETED', reason: 'OUTCOME_VERIFIED', verifiedSubgoals: 1, totalSubgoals: 1,
      counters: { reasoning: 77 }, timings: { totalMs: 1000 }, profiling: { rpcCount: 3, adbCount: 2 },
      reasoningMeasurements: [{ provider: 'groq', model: 'fixture-model', elapsedMs: 12,
        promptTokens: 10, outputTokens: 4, httpStatus: 200, status: 'VALID' }],
      v2: { version: 2, graph, completion: 'ALL_VERIFIED' } }, ...overrides };
}

const snapshot = (number = 1, overrides = {}, source = 'LIVE_WORKER', at = AT + 2000) =>
  mapHistoryTask(task(number, overrides), source, at, DIGEST);
const register = async (raw = android(), at = AT) => {
  const mapped = historyDevice(raw, at);
  assert.ok(mapped, 'fixture must have verified physical identity');
  return repository.registerDevice(mapped);
};
const counts = async () => (await memory.query(`SELECT
  (SELECT count(*)::int FROM phone_commander.executions) AS executions,
  (SELECT count(*)::int FROM phone_commander.execution_steps) AS steps,
  (SELECT count(*)::int FROM phone_commander.evidence_index) AS evidence,
  (SELECT count(*)::int FROM phone_commander.provider_usage) AS providers,
  (SELECT count(*)::int FROM phone_commander.audit_events) AS audit`)).rows[0];
const latestMetadata = detail => JSON.parse(detail.audit.filter(row => row.event_type === 'HISTORY_SNAPSHOT')
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].reason);

before(async () => {
  const bytes = fs.readFileSync(new URL('./helpers/phone-history-schema.sql', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256, 'owner DDL must remain byte-identical');
  // No dataDir, URL, pg Pool or official SQL-suite runner: this database is memory-only.
  memory = new PGlite();
  await memory.exec(bytes.toString('utf8'));
  await memory.exec('SET search_path TO public');
  driver = {
    query: async (sql, values = []) => { trace.push({ sql, values }); return result(await memory.query(sql, values)); },
    transaction: work => memory.transaction(tx => work({ query: async (sql, values = []) => {
      trace.push({ sql, values }); return result(await tx.query(sql, values));
    } })),
    close: () => memory.close(),
  };
  originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('History tests prohibit network, model and worker calls'); };
});

beforeEach(async () => {
  await memory.exec(`TRUNCATE phone_commander.audit_events, phone_commander.provider_usage,
    phone_commander.evidence_index, phone_commander.execution_steps, phone_commander.executions,
    phone_commander.devices, phone_commander.command_corpus CASCADE`);
  trace.length = 0;
  repository = new PostgresHistoryRepository(driver);
});

after(async () => {
  try { if (driver) await driver.close(); else await memory?.close(); }
  finally {
    if (originalFetch) globalThis.fetch = originalFetch;
    if (originalTs) Module._extensions['.ts'] = originalTs;
    else delete Module._extensions['.ts'];
  }
});

test('history inserts, paginates, filters and reads actual persisted rows through a fresh repository', async () => {
  const deviceId = await register();
  assert.equal(await repository.putTask(snapshot()), 'PERSISTED');
  assert.equal(await repository.putTask(snapshot(2, { createdAt: AT + 10 })), 'PERSISTED');
  const fresh = new PostgresHistoryRepository(driver);
  const page = await fresh.read(query({ pageSize: 1 }));
  assert.equal(page.storageMode, 'POSTGRESQL_HISTORY');
  assert.equal(page.total, 2); assert.equal(page.page, 1); assert.equal(page.pageSize, 1);
  assert.deepEqual(page.items.map(row => row.id), [executionId(2)]);
  assert.deepEqual((await read({ page: 2, pageSize: 1 })).items.map(row => row.id), [executionId(1)]);
  const filtered = await read({ deviceId, status: 'COMPLETED', engine: 'GOAL_V2',
    from: new Date(AT).toISOString(), to: new Date(AT + 5).toISOString() });
  assert.deepEqual(filtered.items.map(row => row.id), [executionId(1)]);
  assert.equal((await read({ status: 'FAILED' })).total, 0);
  const detail = await fresh.read(query({ kind: 'detail', id: executionId(1) }));
  assert.equal(detail.execution.device_id, deviceId); assert.equal(detail.execution.status, 'COMPLETED');
  assert.equal(detail.execution.runtime_digest, DIGEST);
  assert.equal(detail.execution.rpc_count, 3); assert.equal(detail.execution.adb_count, 2);
  assert.equal(detail.execution.execute_ms, 1000); assert.equal(detail.execution.model_calls, null);
  assert.equal(detail.steps.length, 1); assert.equal(detail.steps[0].step_order, 1);
  assert.equal(detail.steps[0].status, 'VERIFIED'); assert.equal(detail.evidence.length, 1);
  assert.equal(detail.evidence[0].storage_ref, `worker-evidence:${proofId}`);
  assert.equal(detail.evidence[0].step_id, detail.steps[0].id);
  assert.equal(detail.evidence[0].content_hash, null); assert.equal(detail.evidence[0].redacted, true);
  assert.equal(detail.providers.length, 1); assert.equal(detail.providers[0].prompt_tokens, 10);
  assert.equal(detail.providers[0].completion_tokens, 4); assert.equal(detail.providers[0].latency_ms, 12);
  await assert.rejects(read({ kind: 'detail', id: executionId(999) }), { code: 'HISTORY_NOT_FOUND' });
});

test('history updates one execution and existing step from running to terminal', async () => {
  await register();
  const running = task(1, { status: 'RUNNING', finishedAt: undefined });
  running.latest.v2.graph.nodes[0].status = 'RUNNING';
  running.latest.v2.graph.nodes[0].evidenceIds = [];
  assert.equal(await repository.putTask(mapHistoryTask(running, 'LIVE_WORKER', AT + 100)), 'PERSISTED');
  assert.equal(await repository.putTask(snapshot()), 'PERSISTED');
  const detail = await read({ kind: 'detail', id: executionId(1) });
  assert.equal(detail.execution.status, 'COMPLETED');
  assert.equal(new Date(detail.execution.finished_at).getTime(), AT + 1000);
  assert.equal(detail.steps.length, 1); assert.equal(detail.steps[0].status, 'VERIFIED');
  assert.equal((await counts()).executions, 1); assert.equal((await counts()).evidence, 1);
});

test('sequential, duplicate-reference and concurrent ingestion is idempotent for all child rows', async () => {
  await register();
  const input = task(); input.latest.v2.graph.nodes[0].evidenceIds.push(proofId);
  const value = mapHistoryTask(input, 'LIVE_WORKER', AT + 2000, DIGEST);
  assert.equal(await repository.putTask(value), 'PERSISTED');
  const before = await counts();
  assert.deepEqual(before, { executions: 1, steps: 1, evidence: 1, providers: 1, audit: 1 });
  assert.equal(await repository.putTask(value), 'UNCHANGED');
  assert.deepEqual(await counts(), before);
  const replies = await Promise.all(Array.from({ length: 4 }, () => new PostgresHistoryRepository(driver).putTask(value)));
  assert.ok(replies.every(reply => reply === 'UNCHANGED')); assert.deepEqual(await counts(), before);
  const next = snapshot(2);
  const firstWrites = await Promise.all([repository.putTask(next), new PostgresHistoryRepository(driver).putTask(next)]);
  assert.deepEqual(firstWrites.sort(), ['PERSISTED', 'UNCHANGED']);
  assert.equal((await counts()).executions, 2); assert.equal((await counts()).audit, 2);
});

test('older snapshots, later legacy imports and unfinished snapshots cannot replace terminal live history', async () => {
  await register(); await repository.putTask(snapshot());
  const before = await read({ kind: 'detail', id: executionId(1) });
  for (const candidate of [
    snapshot(1, { status: 'FAILED' }, 'LIVE_WORKER', AT + 1500),
    snapshot(1, { status: 'FAILED', finishedAt: AT + 4000 }, 'LEGACY_IMPORT', AT + 5000),
    snapshot(1, { status: 'RUNNING', finishedAt: undefined }, 'LIVE_WORKER', AT + 6000),
  ]) assert.equal(await repository.putTask(candidate), 'STALE_IGNORED');
  assert.deepEqual(await read({ kind: 'detail', id: executionId(1) }), before);
});

test('unchanged live polling still prevents an intermediate older snapshot from overwriting current history', async () => {
  await register();
  const initial = snapshot(1, { status: 'RUNNING', finishedAt: undefined }, 'LIVE_WORKER', AT + 2000);
  await repository.putTask(initial);
  assert.equal(await repository.putTask({ ...initial, sourceAt: AT + 5000 }), 'UNCHANGED');
  // Regression contract: UNCHANGED must not leave the freshness watermark at +2000.
  const stale = { ...initial, sourceAt: AT + 3000, rpc: 99 };
  assert.equal(await repository.putTask(stale), 'STALE_IGNORED');
  assert.equal((await read({ kind: 'detail', id: initial.id })).execution.rpc_count, initial.rpc);
});

test('Unicode hardware metadata survives while command, UI, reasons and authorization secrets are omitted', async () => {
  const raw = android(); await register(raw);
  const input = task();
  input.latest.reason = `Private reason ${SECRET}`;
  input.latest.screen = SECRET; input.latest.cancellationToken = SECRET;
  input.latest.assistance = { token: SECRET, reason: SECRET };
  input.latest.v2.ownerAuthorizationId = SECRET;
  input.latest.v2.artifacts = [{ mediaUri: `content://private/${SECRET}`, recordIdentity: SECRET }];
  input.latest.reasoningMeasurements[0].proposedChoice = SECRET;
  input.latest.reasoningMeasurements.push({ provider: 'groq', model: SECRET, elapsedMs: 0, status: 'UNAVAILABLE' });
  const value = mapHistoryTask(input, 'LIVE_WORKER', AT + 2000, DIGEST);
  assert.equal(value.requestHash, hashHistory(COMMAND)); assert.equal(value.reason, 'REDACTED_REASON');
  assert.equal(value.providers.length, 1, 'pre-dispatch measurements are not model requests');
  await repository.putTask(value);
  const detail = await read({ kind: 'detail', id: value.id });
  const devices = await read({ kind: 'devices' });
  assert.equal(devices.items[0].model, raw.model);
  assert.equal(devices.items[0].physical_identity_hash, PHYSICAL);
  assert.equal(devices.items[0].serial_hash, hashHistory(raw.serial));
  const stored = JSON.stringify({ detail, devices, trace });
  assert.equal(stored.includes(SECRET), false); assert.equal(stored.includes(COMMAND), false);
  assert.equal(stored.includes(raw.serial), false); assert.notEqual(detail.execution.original_command, COMMAND);
  assert.equal(latestMetadata(detail).requestHash, hashHistory(COMMAND));
});

for (const kind of ['local-dispatch', 'reflection', 'replay']) test(`unknown effect (${kind}) uses CHECK-compatible UNVERIFIED and retains sourceStatus`, async () => {
  await register(); const input = task();
  if (kind === 'local-dispatch') input.latest.v2.localEffects = [{ dispatch: 'UNKNOWN' }];
  if (kind === 'reflection') input.latest.v2.reflections = [{ classification: 'UNKNOWN_EFFECT' }];
  if (kind === 'replay') input.skillReplay = { checkpoint: { status: 'UNKNOWN_EFFECT' }, events: [] };
  const value = mapHistoryTask(input, 'LIVE_WORKER', AT + 2000);
  assert.equal(value.status, 'UNVERIFIED'); assert.equal(value.sourceStatus, 'UNKNOWN_EFFECT');
  await repository.putTask(value);
  const detail = await read({ kind: 'detail', id: value.id });
  assert.equal(detail.execution.status, 'UNVERIFIED');
  assert.equal(latestMetadata(detail).sourceStatus, 'UNKNOWN_EFFECT');
});

test('missing identity or unresolved device is quarantined idempotently with zero executions', async () => {
  for (const value of [snapshot(1, { physicalId: undefined }), snapshot(2)]) {
    assert.equal(await repository.putTask(value), 'QUARANTINED');
    assert.equal(await repository.putTask(value), 'QUARANTINED');
  }
  const hash = hashHistory('synthetic-invalid-source');
  await repository.quarantine(hash, 'INVALID_HISTORY_TASK', AT);
  await repository.quarantine(hash, 'INVALID_HISTORY_TASK', AT + 1);
  const values = await counts();
  assert.deepEqual(values, { executions: 0, steps: 0, evidence: 0, providers: 0, audit: 3 });
  const audits = (await memory.query("SELECT * FROM phone_commander.audit_events WHERE event_type='HISTORY_QUARANTINED'")).rows;
  assert.deepEqual(audits.map(row => JSON.parse(row.reason).reason).sort(),
    ['DEVICE_FK_UNRESOLVED', 'INVALID_HISTORY_TASK', 'PHYSICAL_IDENTITY_MISSING']);
  await assert.rejects(repository.quarantine(SECRET, 'INVALID_HISTORY_TASK', AT), { code: 'INVALID_HISTORY_QUARANTINE' });
});

test('invalid device FK and an execution rebound to another physical device fail without corrupting history', async () => {
  const first = await register(); await repository.putTask(snapshot());
  const before = await counts();
  await assert.rejects(repository.connection(executionId(999), hashHistory('fixture-other'), 'USB', 'CONNECTED', AT), { code: 'DEVICE_FK_UNRESOLVED' });
  const other = await register(android({ serial: 'fixture-other', physicalId: `android:${'c'.repeat(64)}` }));
  assert.notEqual(other, first);
  await assert.rejects(repository.putTask({ ...snapshot(), physicalHash: 'c'.repeat(64) }), { code: 'HISTORY_EXECUTION_DEVICE_CONFLICT' });
  assert.deepEqual(await counts(), before);
  await assert.rejects(memory.query(`INSERT INTO phone_commander.evidence_index(execution_id,step_id,evidence_type)
    VALUES($1,$2,'OFFLINE_FK_PROBE')`, [executionId(1), executionId(998)]), error => error.code === '23503');
});

test('failure after a child write rolls back the complete execution transaction', async () => {
  await register(); const before = await counts(); let injected = 0;
  const faulty = { ...driver, transaction: work => driver.transaction(tx => work({ query: async (sql, values) => {
    const rows = await tx.query(sql, values);
    if (/INSERT\s+INTO\s+phone_commander\.evidence_index/i.test(sql)) {
      injected++; throw new Error(SECRET);
    }
    return rows;
  } })) };
  await assert.rejects(new PostgresHistoryRepository(faulty).putTask(snapshot()), dbError);
  assert.equal(injected, 1); assert.deepEqual(await counts(), before);
  assert.equal(await repository.putTask(snapshot()), 'PERSISTED', 'rollback leaves no partial parent/child records');
});

test('database outage rejects reads and writes with no empty-page or in-memory success fallback', async () => {
  await register(); await repository.putTask(snapshot()); const before = await counts();
  const fail = async () => { throw Object.assign(new Error(SECRET), { code: 'ECONNREFUSED' }); };
  const unavailable = new PostgresHistoryRepository({ query: fail, transaction: fail, close: async () => {} });
  for (const action of [
    () => unavailable.read(query({})), () => unavailable.read(query({ kind: 'detail', id: executionId(1) })),
    () => unavailable.registerDevice(historyDevice(android(), AT)), () => unavailable.putTask(snapshot(2)),
    () => unavailable.quarantine(hashHistory('outage'), 'INVALID_HISTORY_TASK', AT),
    () => unavailable.connection(executionId(1), hashHistory('outage'), 'USB', 'CONNECTED', AT),
    // The empty-device branch also performs database I/O and must sanitize an outage.
    () => unavailable.snapshotDevices([], AT),
  ]) await assert.rejects(action, dbError);
  assert.deepEqual(await counts(), before);
});

test('a failed ROLLBACK still rejects, sanitizes errors and releases the transaction connection', async () => {
  const calls = []; let released = false;
  const connection = { query: async sql => {
    calls.push(sql);
    if (sql === 'ROLLBACK' || /INSERT\s+INTO/i.test(sql)) throw Object.assign(new Error(SECRET), { code: 'ECONNRESET' });
    return { rows: [], rowCount: 0 };
  }, release: () => { released = true; } };
  // Only this structural Pool double is passed to PgTeachDatabase; no pg.Pool is constructed.
  const database = new PgTeachDatabase({ connect: async () => connection, end: async () => {} });
  try {
    await assert.rejects(new PostgresHistoryRepository(database).registerDevice(historyDevice(android(), AT)), dbError);
    assert.equal(calls[0], 'BEGIN'); assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(calls.includes('COMMIT'), false); assert.equal(released, true);
  } finally { await database.close(); }
});

test('client TLS evidence reports encrypted/authorized true then false and always releases without queries', async () => {
  let connects = 0, releases = 0, queries = 0, closes = 0;
  const streams = [
    { encrypted: true, authorized: true },
    { encrypted: false, authorized: false },
    { encrypted: true, authorized: false },
    { encrypted: false, authorized: true },
    undefined,
    { encrypted: 'true', authorized: 1 },
  ];
  const noQuery = async () => { queries++; assert.fail('TLS inspection must not issue SQL'); };
  const database = new PgTeachDatabase({
    connect: async () => {
      const stream = streams[connects++];
      return { connection: { stream }, query: noQuery, release: () => { releases++; } };
    },
    query: noQuery,
    end: async () => { closes++; },
  });
  try {
    for (const [index, expected] of [
      { encrypted: true, authorized: true },
      { encrypted: false, authorized: false },
      { encrypted: true, authorized: false },
      { encrypted: false, authorized: true },
      { encrypted: false, authorized: false },
      { encrypted: false, authorized: false },
    ].entries()) {
      assert.deepEqual(await database.connectionSecurity(), expected);
      assert.equal(connects, index + 1); assert.equal(releases, connects);
      assert.equal(queries, 0);
    }
  } finally { await database.close(); }
  assert.equal(closes, 1);
});

function preflightDouble({ branch = 'offline-fixture-branch', tables, security = { encrypted: true, authorized: true } } = {}) {
  const statements = []; let transactions = 0, checks = 0, closes = 0;
  const database = {
    query: async () => assert.fail('Preflight SQL must use its read-only transaction'),
    transaction: async work => {
      transactions++;
      return work({ query: async sql => {
        statements.push(sql);
        assert.match(sql.trim(), /^(?:SELECT\b|SET TRANSACTION READ ONLY$)/i, 'preflight may not mutate or repair schema');
        if (sql === 'SET TRANSACTION READ ONLY') return { rows: [], rowCount: 0 };
        if (/current_database\(\)/.test(sql)) return { rows: [{ database: 'neondb', role: 'offline-fixture-role', branch, tls: false }], rowCount: 1 };
        if (/information_schema\.tables/.test(sql)) return { rows: tables.map(table_name => ({ table_name })), rowCount: tables.length };
        assert.fail('A rejected preflight must not continue to later catalog checks');
      } });
    },
    close: async () => { closes++; },
  };
  if (security !== null) database.connectionSecurity = async () => { checks++; return security; };
  return { database, statements, get transactions() { return transactions; }, get checks() { return checks; }, get closes() { return closes; } };
}

test('preflight rejects a 16-table catalog read-only instead of installing or repairing schema', async () => {
  const tables = (await memory.query("SELECT table_name FROM information_schema.tables WHERE table_schema='phone_commander' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(row => row.table_name);
  assert.equal(tables.length, 15);
  const fixture = preflightDouble({ tables: [...tables, 'unexpected_fixture_table'] });
  try {
    await assert.rejects(verifyHistoryDatabase(fixture.database, hashHistory('offline-fixture-branch')), { code: 'HISTORY_SCHEMA_MISMATCH' });
    assert.equal(fixture.transactions, 1); assert.equal(fixture.checks, 1);
    assert.equal(fixture.statements.length, 3); assert.equal(fixture.statements[0], 'SET TRANSACTION READ ONLY');
  } finally { await fixture.database.close(); }
  assert.equal(fixture.closes, 1);
});

test('preflight rejects the wrong branch before catalog access and performs no writes', async () => {
  const fixture = preflightDouble({ branch: 'offline-wrong-branch' });
  try {
    await assert.rejects(verifyHistoryDatabase(fixture.database, hashHistory('offline-fixture-branch')), { code: 'HISTORY_BRANCH_FINGERPRINT_MISMATCH' });
    assert.equal(fixture.transactions, 1); assert.equal(fixture.checks, 1);
    assert.equal(fixture.statements.length, 2);
    assert.ok(fixture.statements.every(sql => !/information_schema/.test(sql)));
  } finally { await fixture.database.close(); }
});

for (const [label, security] of [
  ['missing client-security method', null],
  ['unencrypted client', { encrypted: false, authorized: true }],
  ['unauthorized client', { encrypted: true, authorized: false }],
]) test(`preflight rejects ${label} before any transaction, SQL or write`, async () => {
  const fixture = preflightDouble({ security });
  try {
    await assert.rejects(verifyHistoryDatabase(fixture.database, hashHistory('offline-fixture-branch')), { code: 'HISTORY_TLS_UNVERIFIED' });
    assert.equal(fixture.transactions, 0); assert.deepEqual(fixture.statements, []);
    assert.equal(fixture.checks, security === null ? 0 : 1);
  } finally { await fixture.database.close(); }
});

test('USB and Wi-Fi share one physical row; repeated polling adds no connection events', async () => {
  const usb = android(), wifi = android({ serial: '192.0.2.15:37123', connectionType: 'Wi-Fi' });
  await repository.snapshotDevices([usb, wifi], AT);
  const devices = await read({ kind: 'devices' }); assert.equal(devices.total, 1);
  const deviceId = devices.items[0].id;
  assert.equal(await register(wifi, AT + 1), deviceId);
  const initial = await read({ kind: 'connections', deviceId }); assert.equal(initial.total, 2);
  assert.deepEqual(initial.items.map(row => row.mode).sort(), ['USB', 'Wi-Fi']);
  await repository.snapshotDevices([usb, wifi], AT + 1000);
  await repository.snapshotDevices([usb, wifi], AT + 2000);
  assert.equal((await read({ kind: 'connections' })).total, 2);
  assert.equal((await read({ kind: 'connections', transport: 'Wi-Fi' })).total, 1);
  assert.equal((await read({ kind: 'devices' })).items[0].status, 'CONNECTED');
});

test('explicit disconnect, omitted transport and reconnect create transitions without polling duplicates', async () => {
  const usb = android(), wifi = android({ serial: '192.0.2.15:37123', connectionType: 'Wi-Fi' });
  await repository.snapshotDevices([usb, wifi], AT);
  const deviceId = (await read({ kind: 'devices' })).items[0].id;
  await repository.connection(deviceId, hashHistory(usb.serial), 'USB', 'DISCONNECTED', AT + 1000);
  await repository.connection(deviceId, hashHistory(usb.serial), 'USB', 'DISCONNECTED', AT + 2000);
  assert.equal((await read({ kind: 'connections', status: 'DISCONNECTED' })).total, 1);
  assert.equal((await read({ kind: 'devices' })).items[0].status, 'CONNECTED', 'Wi-Fi remains connected');
  await repository.snapshotDevices([], AT + 3000);
  await repository.snapshotDevices([], AT + 4000);
  assert.equal((await read({ kind: 'connections' })).total, 4);
  assert.equal((await read({ kind: 'devices' })).items[0].status, 'DISCONNECTED');
  await repository.snapshotDevices([usb], AT + 5000);
  assert.equal((await read({ kind: 'connections' })).total, 5);
  assert.equal((await read({ kind: 'devices' })).items[0].status, 'CONNECTED');
  await repository.connection(deviceId, hashHistory(usb.serial), 'USB', 'OFFLINE', AT + 2500);
  assert.equal((await read({ kind: 'connections' })).total, 5, 'older connection event is ignored');
});

test('execution reads ignore foreign HISTORY_SNAPSHOT audit rows with plain-text reasons', async () => {
  const deviceId = await register();
  await repository.putTask(snapshot());
  const foreignReason = 'External audit note: this is ordinary text, not JSON.';
  await memory.query(`INSERT INTO phone_commander.audit_events
    (id,device_id,execution_id,actor_ref,event_type,reason,created_at)
    VALUES($1,$2,$3,'foreign-auditor','HISTORY_SNAPSHOT',$4,$5)`,
  [executionId(700), deviceId, executionId(1), foreignReason, new Date(AT + 10000).toISOString()]);
  // A foreign record has the same event type and a later date. Its reason must
  // never be cast to JSON or used as the projector's freshness/status metadata.
  const page = await read({});
  assert.equal(page.total, 1); assert.equal(page.items[0].id, executionId(1));
  assert.equal(page.items[0].source_status, 'COMPLETED');
  const filtered = await read({ status: 'COMPLETED', deviceId });
  assert.equal(filtered.total, 1); assert.equal(filtered.items[0].source_status, 'COMPLETED');
  const detail = await read({ kind: 'detail', id: executionId(1) });
  assert.equal(detail.execution.status, 'COMPLETED');
  assert.equal(await repository.putTask({ ...snapshot(), sourceAt: AT + 3000 }), 'UNCHANGED');
  assert.equal((await memory.query('SELECT reason FROM phone_commander.audit_events WHERE id=$1',
    [executionId(700)])).rows[0].reason, foreignReason);
});

test('foreign plain-text DEVICE audit reasons do not break connection reads or device reconciliation', async () => {
  const usb = android();
  await repository.snapshotDevices([usb], AT);
  const deviceId = (await read({ kind: 'devices' })).items[0].id;
  const reason = 'External connection observation; intentionally not a JSON document.';
  await memory.query(`INSERT INTO phone_commander.audit_events
    (id,device_id,actor_ref,event_type,mode,reason,created_at)
    VALUES($1,$2,'foreign-auditor','DEVICE_CONNECTED','USB',$3,$4)`,
  [executionId(701), deviceId, reason, new Date(AT + 10000).toISOString()]);
  const page = await read({ kind: 'connections', deviceId });
  assert.equal(page.total, 1); assert.equal(page.items[0].event_type, 'DEVICE_CONNECTED');
  assert.notEqual(page.items[0].reason, reason);
  await repository.snapshotDevices([usb], AT + 1000);
  assert.equal((await read({ kind: 'connections' })).total, 1, 'foreign rows do not defeat repeated-poll deduplication');
  await repository.connection(deviceId, hashHistory(usb.serial), 'USB', 'OFFLINE', AT + 2000);
  assert.equal((await read({ kind: 'connections', status: 'OFFLINE' })).total, 1);
  // Exercise the known-transport lookup when the current observation cannot
  // supply verified identity, as well as the DISTINCT ON tracked-state query.
  await repository.snapshotDevices([android({ status: 'offline', identityVerified: false, physicalId: undefined })], AT + 3000);
  assert.equal((await read({ kind: 'connections' })).total, 2);
  await repository.snapshotDevices([], AT + 4000);
  assert.equal((await read({ kind: 'connections', status: 'DISCONNECTED' })).total, 1);
  assert.equal((await read({ kind: 'devices' })).items[0].status, 'DISCONNECTED');
  assert.equal((await memory.query('SELECT reason FROM phone_commander.audit_events WHERE id=$1',
    [executionId(701)])).rows[0].reason, reason);
});

test('schema-qualified repository works under public search_path without new tables or schema changes', async () => {
  await repository.snapshotDevices([android()], AT); await repository.putTask(snapshot());
  for (const input of [{}, { kind: 'devices' }, { kind: 'connections' }, { kind: 'detail', id: executionId(1) }]) await read(input);
  assert.equal((await memory.query('SHOW search_path')).rows[0].search_path, 'public');
  assert.equal(Number((await memory.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='phone_commander' AND table_type='BASE TABLE'")).rows[0].n), 15);
  assert.equal(Number((await memory.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n), 0);
  for (const { sql } of trace) {
    assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\b/i);
    assert.doesNotMatch(sql, /\bteach_mode\s*\./i);
    assert.doesNotMatch(sql, /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:devices|executions|execution_steps|evidence_index|provider_usage|audit_events)\b/i);
  }
  assert.ok(trace.some(({ sql }) => /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/.test(sql)));
  assert.ok(trace.some(({ sql }) => /FOR UPDATE/.test(sql)));
  assert.ok(trace.some(({ sql }) => /ON CONFLICT/.test(sql)));
});

test('exact command search sends only a digest to PostgreSQL and preserves Unicode matching', async () => {
  await register();const input=task();await repository.putTask(mapHistoryTask(input,'LIVE_WORKER',AT+2000));trace.length=0;
  const page=await read({q:input.request});assert.equal(page.total,1);
  assert.ok(trace.some(({values})=>values.includes(hashHistory(input.request))));
  assert.ok(trace.every(({values})=>!JSON.stringify(values).includes(input.request)));
});

test('existing uppercase physical hashes resolve to one physical device without schema changes', async () => {
  const existing=(await memory.query('INSERT INTO phone_commander.devices(serial_hash,physical_identity_hash,model) VALUES($1,$2,$3) RETURNING id',[hashHistory('old-transport'),PHYSICAL.toUpperCase(),'Synthetic existing phone'])).rows[0];
  assert.equal(await register(),existing.id);await repository.putTask(snapshot());
  assert.equal(Number((await memory.query('SELECT count(*) AS n FROM phone_commander.devices')).rows[0].n),1);
  assert.equal((await read({kind:'detail',id:executionId(1)})).execution.device_id,existing.id);
});

test('unchanged connection observations advance freshness without inventing another transition', async () => {
  const deviceId=await register(),serial=hashHistory(android().serial);
  await repository.connection(deviceId,serial,'USB','CONNECTED',AT);
  await repository.connection(deviceId,serial,'USB','CONNECTED',AT+5000);
  await repository.connection(deviceId,serial,'USB','OFFLINE',AT+3000);
  assert.equal((await read({kind:'connections'})).total,1);
  assert.equal((await read({kind:'devices'})).items[0].status,'CONNECTED');
});

test('a verified Wi-Fi endpoint rebound to another physical phone disconnects the old transport without merging devices',async()=>{
  const first=android({serial:'192.168.50.9:5555',connectionType:'Wi-Fi'});await repository.snapshotDevices([first],AT);
  const second=android({serial:first.serial,connectionType:'Wi-Fi',physicalId:'android:'+'c'.repeat(64),model:'Other synthetic phone'});await repository.snapshotDevices([second],AT+1000);
  const page=await read({kind:'devices'});assert.equal(page.total,2);
  assert.equal(page.items.find(row=>row.physical_identity_hash===PHYSICAL).status,'DISCONNECTED');
  assert.equal(page.items.find(row=>row.physical_identity_hash==='c'.repeat(64)).status,'CONNECTED');
  await repository.snapshotDevices([],AT+2000);
  const disconnected=await read({kind:'devices'});assert.ok(disconnected.items.every(row=>row.status==='DISCONNECTED'));
  assert.equal((await read({kind:'connections',status:'DISCONNECTED'})).total,2);
});
