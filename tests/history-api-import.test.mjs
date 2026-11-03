import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';
import { createHash } from 'node:crypto';
import { load } from './helpers/react-skill-console.mjs';

// The existing helper installs the TS loader. Storage is replaced before loading
// either entry point, so this suite never creates a pool or reads environment config.
function withoutConfiguredStorage(relative) {
  const file = path.resolve(relative), original = Module._load;
  delete load.cache[file];
  Module._load = function (id, parent, main) {
    if (parent?.filename === file && id === './history-database') {
      return { historyStorage: () => assert.fail('Only explicitly injected history repositories are allowed') };
    }
    return original.call(this, id, parent, main);
  };
  try { return load(file); } finally { Module._load = original; }
}

const { historyResponse } = withoutConfiguredStorage(path.resolve('lib/history/history-api.ts'));
const { createHistorySink } = withoutConfiguredStorage(path.resolve('lib/history/history-service.ts'));
const { inspectHistorySource, importHistory } = load(path.resolve('lib/history/history-import.ts'));
const { HistoryError, historyId, hashHistory } = load(path.resolve('lib/history/history-model.ts'));
const { PostgresHistoryRepository } = load(path.resolve('lib/history/postgres-history-repository.ts'));
const AT = Date.UTC(2026, 0, 2, 3, 4, 5);
const PHYSICAL = 'a'.repeat(64);
const SECRET = 'postgresql://synthetic-user:synthetic-password@synthetic-host/fixture?token=synthetic-secret';
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bytesOf = rows => Buffer.from(JSON.stringify(rows), 'utf8');
const turn = () => new Promise(setImmediate);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function task(n = 1, overrides = {}) {
  return { executionId: id(n), batchId: id(999), deviceId: 'OFFLINE-HISTORY-FIXTURE', physicalId: `android:${PHYSICAL}`,
    request: `Synthetic command ${SECRET}`, status: 'COMPLETED', createdAt: AT, finishedAt: AT + 1000,
    events: [], ...overrides };
}
function device(overrides = {}) {
  return { serial: 'OFFLINE-HISTORY-FIXTURE', physicalId: `android:${PHYSICAL}`, identityVerified: true,
    model: 'Synthetic phone', status: 'device', connectionType: 'USB', ...overrides };
}
const request = (query = '', options = {}) => new Request(`http://localhost:3000/api/history${query ? '?' + query : ''}`, options);
const pageBody = (query = {}) => ({ storageMode: 'POSTGRESQL_HISTORY', items: [{ id: id(1), status: 'UNVERIFIED', source_status: 'UNKNOWN_EFFECT' }], total: 101, page: query.page ?? 1, pageSize: query.pageSize ?? 20 });
const errorBody = code => ({ code, error: 'Không đọc được lịch sử PostgreSQL. Không dùng dữ liệu JSON thay thế.' });
const noWrite = () => assert.fail('The history API must not write or dispatch');
function apiStore(read, verified = Promise.resolve()) {
  return { repository: { read, putTask: noWrite, snapshotDevices: noWrite, registerDevice: noWrite, connection: noWrite, quarantine: noWrite }, verified };
}
function noArrays(value) {
  assert.equal(Array.isArray(value), false, 'A failure must not masquerade as an empty result');
  if (value && typeof value === 'object') for (const child of Object.values(value)) noArrays(child);
}
let originalFetch;
before(() => { originalFetch = global.fetch; global.fetch = () => assert.fail('No network, model or Android dispatch in history tests'); });
after(() => { global.fetch = originalFetch; });

test('API accepts only local same-origin GETs and forwards default pagination once', async () => {
  for (const input of [request(), request('', { headers: { Origin: 'http://localhost:3000' } }),
    new Request('http://127.0.0.1:3000/api/history', { headers: { Origin: 'http://127.0.0.1:3000' } }),
    new Request('http://[::1]:3000/api/history', { headers: { Origin: 'http://[::1]:3000' } })]) {
    const calls = [], expected = pageBody();
    const response = await historyResponse(input, apiStore(async query => { calls.push(query); return expected; }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(calls, [{ kind: 'executions', page: 1, pageSize: 20 }]); assert.deepEqual(await response.json(), expected);
  }
});

test('API rejects foreign authorities/origins and mutations before preflight or repository reads', async () => {
  const inputs = [
    [new Request('https://remote.invalid/api/history'), 403, 'LOCAL_ORIGIN_REQUIRED'],
    [request('', { headers: { Host: 'remote.invalid' } }), 403, 'LOCAL_ORIGIN_REQUIRED'],
    [request('', { headers: { Host: 'localhost.evil.invalid' } }), 403, 'LOCAL_ORIGIN_REQUIRED'],
    [request('', { headers: { Origin: 'https://remote.invalid' } }), 403, 'LOCAL_ORIGIN_REQUIRED'],
    [request('', { headers: { Origin: 'http://localhost:3001' } }), 403, 'LOCAL_ORIGIN_REQUIRED'],
    [request('', { headers: { Origin: 'https://localhost:3000' } }), 403, 'LOCAL_ORIGIN_REQUIRED'],
    [request('', { headers: { Origin: 'not an origin' } }), 403, 'LOCAL_ORIGIN_REQUIRED'],
    ...['POST', 'PUT', 'DELETE', 'OPTIONS'].map(method => [request('', { method }), 405, 'METHOD_NOT_ALLOWED']),
  ];
  let reads = 0, preflights = 0;
  const store = apiStore(async () => { reads++; return pageBody(); });
  Object.defineProperty(store, 'verified', { get() { preflights++; throw Error('Preflight must not be accessed'); } });
  for (const [input, status, code] of inputs) {
    const response = await historyResponse(input, store);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { code });
  }
  assert.equal(reads, 0); assert.equal(preflights, 0);
});

test('API rejects duplicate, unknown, malformed and out-of-range queries before storage', async () => {
  const invalid = ['kind=invalid', 'kind=detail', 'kind=detail&id=invalid', 'id=invalid', 'deviceId=serial-instead-of-uuid',
    'page=0', 'page=-1', 'page=1.5', 'page=10001', 'page=NaN', 'page=Infinity', 'page=',
    'pageSize=0', 'pageSize=101', 'pageSize=1.5', 'pageSize=bad', 'pageSize=',
    'status=lowercase', 'status=' + 'A'.repeat(41), 'status=RUNNING%3BSELECT', 'engine=unsupported', 'transport=Bluetooth',
    'from=not-a-date', 'to=2026-01-02', 'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
    'q=' + 'x'.repeat(101), 'unknown=field', 'page=1&page=2', 'kind=devices&kind=executions', 'q=a&q=b'];
  let reads = 0, preflights = 0;
  const store = apiStore(async () => { reads++; return pageBody(); });
  Object.defineProperty(store, 'verified', { get() { preflights++; throw Error('Preflight must not be accessed'); } });
  for (const query of invalid) {
    const response = await historyResponse(request(query), store);
    assert.equal(response.status, 400, query); assert.deepEqual(await response.json(), { code: 'INVALID_HISTORY_QUERY' });
  }
  assert.equal(reads, 0); assert.equal(preflights, 0);
});

test('API forwards pagination, filters, Unicode search and detail id without changing repository results', async () => {
  const variants = [
    { kind: 'executions', page: 3, pageSize: 50, deviceId: id(9), status: 'UNVERIFIED', engine: 'GOAL_V2',
      from: '2026-01-01T00:00:00Z', to: '2026-01-03T00:00:00Z', q: 'văn bản đã ẩn %_\\' },
    { kind: 'devices', page: 10000, pageSize: 100, deviceId: id(9), status: 'CONNECTED', q: 'Synthetic phone' },
    { kind: 'connections', page: 2, pageSize: 1, deviceId: id(9), status: 'DISCONNECTED', transport: 'Wi-Fi', q: 'DEVICE_' },
    { kind: 'connections', page: 1, pageSize: 20, transport: 'USB' },
    { kind: 'detail', id: id(1), page: 1, pageSize: 20 },
  ];
  for (const expectedQuery of variants) {
    const calls = [], params = new URLSearchParams(Object.entries(expectedQuery).map(([key, value]) => [key, String(value)]));
    const expected = expectedQuery.kind === 'detail'
      ? { execution: { id: id(1), status: 'UNVERIFIED' }, steps: [], evidence: [], providers: [], audit: [{ reason: '{"sourceStatus":"UNKNOWN_EFFECT"}' }] }
      : pageBody(expectedQuery);
    const response = await historyResponse(request(params.toString()), apiStore(async query => { calls.push(query); return expected; }));
    assert.equal(response.status, 200); assert.deepEqual(calls, [expectedQuery]); assert.deepEqual(await response.json(), expected);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('API waits for preflight; rejected preflight never calls repository.read', async () => {
  const gate = deferred(); let reads = 0;
  const store = apiStore(async () => { reads++; return pageBody(); }, gate.promise);
  const pending = historyResponse(request(), store);
  await turn(); assert.equal(reads, 0);
  gate.reject(new HistoryError('HISTORY_DATABASE_BINDING_MISMATCH'));
  const response = await pending;
  assert.equal(response.status, 503); assert.equal(reads, 0);
  assert.deepEqual(await response.json(), errorBody('HISTORY_DATABASE_BINDING_MISMATCH'));
  const repeated = await historyResponse(request(), store);
  assert.equal(repeated.status, 503); assert.equal(reads, 0, 'A rejected preflight cannot resume a read');
  const ready = deferred();
  const waiting = historyResponse(request(), apiStore(async () => { reads++; return pageBody(); }, ready.promise));
  await turn(); assert.equal(reads, 0); ready.resolve(); assert.equal((await waiting).status, 200); assert.equal(reads, 1);
});

test('API database failures are 503 with no result arrays or vendor/credential text', async () => {
  for (const kind of ['executions', 'devices', 'connections', 'detail']) {
    for (const preflightFailure of [false, true]) {
      const vendor = Object.assign(new Error(SECRET), { code: '08006', detail: `SQL ${SECRET}`, connectionString: SECRET });
      const verified = preflightFailure ? Promise.reject(vendor) : Promise.resolve(); let reads = 0;
      const store = apiStore(async () => { reads++; throw vendor; }, verified);
      const response = await historyResponse(request(new URLSearchParams({ kind, ...(kind === 'detail' ? { id: id(1) } : {}) }).toString()), store);
      assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const body = await response.json(); assert.deepEqual(body, errorBody('HISTORY_DATABASE_UNAVAILABLE')); noArrays(body);
      assert.doesNotMatch(JSON.stringify(body), /synthetic-user|synthetic-password|synthetic-host|synthetic-secret|08006|connectionString|\bSQL\b/);
      assert.equal(reads, preflightFailure ? 0 : 1);
    }
  }
});

test('API preserves safe domain failure codes and missing detail is a 404', async () => {
  for (const [code, status] of [['HISTORY_SCHEMA_MISMATCH', 503], ['HISTORY_NOT_FOUND', 404]]) {
    const response = await historyResponse(request(`kind=detail&id=${id(1)}`), apiStore(async () => { throw new HistoryError(code); }));
    assert.equal(response.status, status); const body = await response.json(); assert.deepEqual(body, errorBody(code)); noArrays(body);
  }
});

test('source inspection rejects corrupted JSON and non-array/oversized sources without echoing input', () => {
  for (const bytes of [Buffer.from(`[{${SECRET}`), Buffer.from('[{"executionId":')]) {
    const original = Buffer.from(bytes);
    assert.throws(() => inspectHistorySource(bytes), error => error.code === 'HISTORY_CORRUPTED_JSON' && !error.message.includes(SECRET));
    assert.deepEqual(bytes, original);
  }
  for (const source of [null, {}, 'private source', Array.from({ length: 10001 }, () => null)]) {
    assert.throws(() => inspectHistorySource(bytesOf(source)), { code: 'INVALID_HISTORY_SOURCE' });
  }
});

test('inspection checksum covers original bytes, rejects duplicates/invalid rows and leaves missing identity for quarantine', () => {
  const first = task(), missing = task(2, { physicalId: undefined }), invalid = { ...task(3), status: 'MAGIC_VERIFIED' };
  const bytes = bytesOf([first, { ...first, status: 'FAILED' }, invalid, missing, null]), original = Buffer.from(bytes);
  const plan = inspectHistorySource(bytes);
  assert.equal(plan.checksum, createHash('sha256').update(original).digest('hex'));
  assert.equal(plan.count, 5); assert.deepEqual(plan.valid, [JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(missing))]);
  assert.deepEqual(plan.rejected.map(row => row.reason), ['DUPLICATE_SOURCE_TASK', 'INVALID_HISTORY_TASK', 'INVALID_HISTORY_TASK']);
  assert.equal(plan.rejected[0].sourceHash, hashHistory(first.executionId));
  assert.equal(plan.rejected[1].sourceHash, hashHistory(JSON.stringify(invalid)));
  assert.ok(plan.rejected.every(row => /^[a-f0-9]{64}$/.test(row.sourceHash)));
  assert.equal(JSON.stringify(plan.rejected).includes(SECRET), false); assert.deepEqual(bytes, original);
  assert.notEqual(inspectHistorySource(Buffer.from(bytes.toString() + '\n')).checksum, plan.checksum, 'Whitespace still changes the source checksum');
});

// Repository contract double, not a replacement persistence implementation. Stable
// IDs, committed calls and failures are observable; no real DB or filesystem exists.
function fakeImportRepository() {
  const tasks = new Map(), quarantines = new Map(), devices = new Map(), connections = new Map(), calls = [];
  const repository = {
    async registerDevice(mapped) { calls.push(['registerDevice', structuredClone(mapped)]); const key = historyId('device:' + mapped.physicalHash); devices.set(key, structuredClone(mapped)); return key; },
    async connection(...args) { calls.push(['connection', ...args]); connections.set(JSON.stringify(args), args); },
    async quarantine(sourceHash, reason, at) { calls.push(['quarantine', sourceHash, reason, at]); quarantines.set(historyId('quarantine:' + sourceHash + ':' + reason), { sourceHash, reason }); },
    async putTask(snapshot) {
      calls.push(['putTask', structuredClone(snapshot)]);
      if (!snapshot.physicalHash) { await repository.quarantine(hashHistory(snapshot.id), 'PHYSICAL_IDENTITY_MISSING', snapshot.sourceAt); return 'QUARANTINED'; }
      const key = hashHistory(JSON.stringify({ ...snapshot, sourceAt: 0 }));
      if (tasks.get(snapshot.id)?.key === key) return 'UNCHANGED';
      tasks.set(snapshot.id, { key, snapshot: structuredClone(snapshot) }); return 'PERSISTED';
    },
  };
  return { repository, tasks, quarantines, devices, connections, calls };
}

test('explicit import is idempotent by stable execution/quarantine ids and leaves source bytes unchanged', async () => {
  const fixture = fakeImportRepository(), missing = task(2, { physicalId: undefined });
  const bytes = bytesOf([task(), task(), missing, { invalid: SECRET }]), original = Buffer.from(bytes);
  const first = await importHistory(fixture.repository, bytes, [], AT + 2000);
  assert.deepEqual(first, { checksum: hashHistory(bytes), sourceCount: 4, validCount: 2, rejectedCount: 2,
    counts: { PERSISTED: 1, UNCHANGED: 0, STALE_IGNORED: 0, QUARANTINED: 3 },
    wirelessCounts: { source: 0, imported: 0, unresolved: 0 } });
  assert.deepEqual([...fixture.tasks.keys()], [id(1)]); assert.equal(fixture.quarantines.size, 3);
  const stableQuarantines = [...fixture.quarantines.keys()].sort();
  const again = await importHistory(fixture.repository, bytes, [], AT + 3000);
  assert.deepEqual(again.counts, { PERSISTED: 0, UNCHANGED: 1, STALE_IGNORED: 0, QUARANTINED: 3 });
  assert.deepEqual(again.wirelessCounts, { source: 0, imported: 0, unresolved: 0 });
  assert.equal(fixture.tasks.size, 1); assert.deepEqual([...fixture.quarantines.keys()].sort(), stableQuarantines);
  assert.equal(again.checksum, first.checksum); assert.deepEqual(bytes, original);
  assert.equal(JSON.stringify({ first, again, tasks: [...fixture.tasks.values()], rejected: [...fixture.quarantines.values()] }).includes(SECRET), false);
});

test('missing identity reaches real repository quarantine without a transaction or invented physical device', async () => {
  const database = { query: noWrite, transaction: noWrite, close: noWrite };
  const repository = new PostgresHistoryRepository(database), quarantined = new Map();
  repository.quarantine = async (sourceHash, reason) => { quarantined.set(historyId('quarantine:' + sourceHash + ':' + reason), { sourceHash, reason }); };
  const bytes = bytesOf([task(1, { physicalId: undefined }), task(2, { physicalId: 'not-a-physical-identity' })]);
  const result = await importHistory(repository, bytes, [], AT + 2000);
  assert.equal(result.validCount, 2); assert.equal(result.counts.QUARANTINED, 2); assert.equal(result.counts.PERSISTED, 0);
  assert.deepEqual([...quarantined.values()], [1, 2].map(n => ({ sourceHash: hashHistory(id(n)), reason: 'PHYSICAL_IDENTITY_MISSING' })));
  await importHistory(repository, bytes, [], AT + 3000); assert.equal(quarantined.size, 2);
});

test('invalid task times are quarantined; legacy aggregate numbers never fabricate verified steps or model calls', async () => {
  const fixture = fakeImportRepository();
  const aggregateOnly = task(1, { latest: { verifiedSubgoals: 99, totalSubgoals: 99, counters: { reasoning: 123 } } });
  const unknown = task(2, { skillReplay: { checkpoint: { status: 'UNKNOWN_EFFECT' }, events: [] }, latest: { verifiedSubgoals: 9, totalSubgoals: 9 } });
  const badTime = task(3, { finishedAt: AT - 1 });
  const result = await importHistory(fixture.repository, bytesOf([aggregateOnly, unknown, badTime]), [], AT + 2000);
  assert.equal(result.counts.PERSISTED, 2); assert.equal(result.counts.QUARANTINED, 1);
  const aggregate = fixture.tasks.get(id(1)).snapshot, uncertain = fixture.tasks.get(id(2)).snapshot;
  assert.deepEqual(aggregate.aggregate, { verified: 99, total: 99 });
  assert.deepEqual(aggregate.steps, []); assert.deepEqual(aggregate.providers, []); assert.equal(aggregate.modelCalls, null);
  assert.equal(uncertain.status, 'UNVERIFIED'); assert.equal(uncertain.sourceStatus, 'UNKNOWN_EFFECT'); assert.deepEqual(uncertain.steps, []);
  assert.ok([...fixture.quarantines.values()].some(row => row.sourceHash === hashHistory(id(3)) && row.reason === 'INVALID_HISTORY_TASK'));
});

test('wireless import uses only supplied verified identities and labels timestamps as legacy approximations', async () => {
  const fixture = fakeImportRepository();
  const wireless = [{ serial: 'OFFLINE-WIFI', physicalId: `android:${PHYSICAL}`, model: 'Synthetic phone', state: 'CONNECTED', lastConnectedAt: AT },
    { serial: 'MISSING-IDENTITY', model: 'Synthetic phone', lastConnectedAt: AT, state: 'CONNECTED' },
    { serial: 'MISSING-MODEL', physicalId: `android:${PHYSICAL}`, lastConnectedAt: AT, state: 'CONNECTED' },
    { serial: 'MISSING-TIME', physicalId: `android:${PHYSICAL}`, model: 'Synthetic phone', state: 'CONNECTED' }];
  const before = structuredClone(wireless), bytes = bytesOf([]), original = Buffer.from(bytes);
  await importHistory(fixture.repository, bytes, wireless, AT + 2000);
  assert.equal(fixture.devices.size, 1); assert.equal(fixture.connections.size, 1);
  const connection = fixture.calls.find(call => call[0] === 'connection');
  assert.deepEqual(connection.slice(2), [hashHistory('OFFLINE-WIFI'), 'Wi-Fi', 'CONNECTED', AT + 2000, 'LEGACY_SNAPSHOT_NOT_EXACT_TRANSITION_TIME']);
  assert.deepEqual(wireless, before); assert.deepEqual(bytes, original); assert.equal(fixture.tasks.size, 0);
});

test('corrupted import stops before any repository method, including wireless registration', async () => {
  const repository = new Proxy({}, { get: () => noWrite });
  await assert.rejects(importHistory(repository, Buffer.from('{broken'), [{ serial: 'OFFLINE-WIFI', physicalId: `android:${PHYSICAL}`, model: 'Synthetic phone', lastConnectedAt: AT }], AT), { code: 'HISTORY_CORRUPTED_JSON' });
});

test('import stops on a transaction failure with no automatic retry; an explicit rerun dedupes committed stable ids', async () => {
  const fixture = fakeImportRepository(), putTask = fixture.repository.putTask;
  const attempted = [], failure = new HistoryError('HISTORY_DATABASE_UNAVAILABLE'); let fail = true;
  fixture.repository.putTask = async snapshot => {
    attempted.push(snapshot.id);
    if (fail && snapshot.id === id(2)) throw failure;
    return putTask(snapshot);
  };
  const bytes = bytesOf([task(1), task(2), task(3)]), original = Buffer.from(bytes);
  await assert.rejects(importHistory(fixture.repository, bytes, [], AT + 2000), error => error === failure);
  assert.deepEqual(attempted, [id(1), id(2)]); assert.deepEqual([...fixture.tasks.keys()], [id(1)]);
  await turn(); await turn(); assert.deepEqual(attempted, [id(1), id(2)], 'Failure must not schedule retries or resume task 3');
  fail = false;
  const resumed = await importHistory(fixture.repository, bytes, [], AT + 3000);
  assert.deepEqual(resumed.counts, { PERSISTED: 2, UNCHANGED: 1, STALE_IGNORED: 0, QUARANTINED: 0 });
  assert.deepEqual(attempted, [id(1), id(2), id(1), id(2), id(3)]); assert.equal(fixture.tasks.size, 3); assert.deepEqual(bytes, original);
});

test('real repository transaction failure stops importer after one attempt without retry or resume', async () => {
  let transactions = 0;
  const repository = new PostgresHistoryRepository({ query: noWrite, close: noWrite,
    transaction: async () => { transactions++; throw new Error(SECRET); } });
  const bytes = bytesOf([task(1), task(2)]), original = Buffer.from(bytes);
  await assert.rejects(importHistory(repository, bytes, [], AT + 2000), error => error.code === 'HISTORY_DATABASE_UNAVAILABLE' && !error.message.includes(SECRET));
  await turn(); await turn(); assert.equal(transactions, 1); assert.deepEqual(bytes, original);
});

test('quarantine failures stop import before task writes instead of reporting a successful summary', async () => {
  const fixture = fakeImportRepository(); let quarantines = 0;
  fixture.repository.quarantine = async () => { quarantines++; throw new HistoryError('HISTORY_DATABASE_UNAVAILABLE'); };
  await assert.rejects(importHistory(fixture.repository, bytesOf([{ invalid: true }, task()]), [], AT), { code: 'HISTORY_DATABASE_UNAVAILABLE' });
  await turn(); assert.equal(quarantines, 1); assert.equal(fixture.tasks.size, 0);
  assert.equal(fixture.calls.some(call => call[0] === 'putTask'), false);
});

test('sink offer is nonblocking, waits for readiness, copies input and performs projection only', async () => {
  const gate = deferred(), calls = [];
  const repository = { snapshotDevices: async (devices, at) => { calls.push(['devices', structuredClone(devices), at]); },
    putTask: async snapshot => { calls.push(['task', snapshot]); return 'PERSISTED'; }, quarantine: noWrite };
  const sink = createHistorySink(repository, gate.promise), input = task(1, { status: 'RUNNING', finishedAt: undefined }), observed = [device()];
  assert.equal(sink.status(), 'IDLE'); assert.equal(sink.offer([input], observed, AT), undefined); assert.equal(sink.status(), 'SYNCING');
  input.status = 'FAILED'; observed[0].model = 'Mutated after offer';
  await turn(); assert.deepEqual(calls, []); gate.resolve(); await sink.drain();
  assert.equal(sink.status(), 'SYNCED'); assert.equal(calls[0][0], 'devices'); assert.equal(calls[0][1][0].model, 'Synthetic phone');
  assert.equal(calls[1][1].status, 'RUNNING'); assert.equal(calls[1][1].source, 'LIVE_WORKER'); assert.equal(calls[1][1].sourceAt, AT);
  assert.equal(JSON.stringify(calls[1]).includes(SECRET), false); assert.equal('request' in calls[1][1], false);
  const count = calls.length; await sink.drain(); assert.equal(calls.length, count, 'Draining cannot dispatch or replay work');
});

test('sink failed readiness/write has explicit failure state and does not auto-retry', async () => {
  for (const phase of ['ready', 'write', 'devices']) {
    const gate = deferred(); let writes = 0, observations = 0;
    const sink = createHistorySink({
      putTask: async () => { writes++; throw Error(SECRET); },
      snapshotDevices: async () => { observations++; throw Error(SECRET); }, quarantine: noWrite,
    }, gate.promise);
    assert.doesNotThrow(() => sink.offer([task()], phase === 'devices' ? [device()] : undefined, AT));
    assert.equal(sink.status(), 'SYNCING');
    if (phase === 'ready') gate.reject(Error(SECRET)); else gate.resolve();
    await sink.drain(); assert.equal(sink.status(), 'HISTORY_SYNC_FAILED'); assert.equal(sink.status().includes(SECRET), false);
    assert.equal(writes, phase === 'write' ? 1 : 0); assert.equal(observations, phase === 'devices' ? 1 : 0);
    await turn(); await sink.drain(); assert.equal(writes, phase === 'write' ? 1 : 0);
  }
});

test('sink coalesces cumulative snapshots while a write is active and never replays intermediate updates', async () => {
  const writing = deferred(), entered = deferred(), snapshots = [], observations = [];
  const sink = createHistorySink({
    snapshotDevices: async (devices, at) => { observations.push({ devices, at }); }, quarantine: noWrite,
    putTask: async snapshot => { snapshots.push(snapshot); if (snapshots.length === 1) { entered.resolve(); await writing.promise; } return 'PERSISTED'; },
  });
  sink.offer([task(1, { status: 'RUNNING', finishedAt: undefined })], [device()], AT);
  await entered.promise;
  sink.offer([task(1, { status: 'WAITING_HUMAN', finishedAt: undefined })], [device()], AT + 100);
  sink.offer([task(1, { status: 'COMPLETED' }), task(2)], [device()], AT + 200);
  assert.equal(snapshots.length, 1); assert.equal(sink.status(), 'SYNCING'); writing.resolve(); await sink.drain();
  assert.equal(sink.status(), 'SYNCED');
  assert.deepEqual(snapshots.map(snapshot => [snapshot.id, snapshot.status, snapshot.sourceAt]), [[id(1), 'RUNNING', AT], [id(1), 'COMPLETED', AT + 200], [id(2), 'COMPLETED', AT + 200]]);
  assert.equal(observations.length, 1, 'Repeated identical device discovery is not a new transition');
  await turn(); await sink.drain(); assert.equal(snapshots.length, 3);
});

test('unchanged cumulative polling skips already acknowledged projections without treating a failure as cached success',async()=>{
  let writes=0;const sink=createHistorySink({putTask:async()=>{writes++;return 'PERSISTED';},quarantine:noWrite,snapshotDevices:async()=>undefined});
  sink.offer([task()],undefined,AT);await sink.drain();sink.offer([task()],undefined,AT+1000);await sink.drain();assert.equal(writes,1);
  sink.offer([task(1,{status:'BLOCKED'})],undefined,AT+2000);await sink.drain();assert.equal(writes,2);
});
