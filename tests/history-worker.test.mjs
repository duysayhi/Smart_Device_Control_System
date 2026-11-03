import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { load } from './helpers/react-skill-console.mjs';

const { startWorker } = load(path.resolve('lib/android/agent/worker-server.ts'));
const { createHistorySink } = load(path.resolve('lib/history/history-service.ts'));
const { HistoryError } = load(path.resolve('lib/history/history-model.ts'));
const { sharedReasoningScheduler } = load(path.resolve('lib/android/agent/reasoning-scheduler.ts'));
const { CatalogWarmup } = load(path.resolve('lib/android/agent/catalog-warmup.ts'));
const PREFIX = 'phone-history-worker-test-';
const AT = Date.UTC(2026, 0, 2, 3, 4, 5);
const SECRET = 'synthetic-private-history-worker-failure';
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let originalFetch, originalRun, originalSchedule;

before(() => {
  originalFetch = globalThis.fetch;
  originalRun = sharedReasoningScheduler.run;
  originalSchedule = CatalogWarmup.prototype.schedule;
  globalThis.fetch = () => assert.fail('History worker fixtures prohibit model and external fetch calls');
  sharedReasoningScheduler.run = () => assert.fail('History projection must not schedule reasoning');
  CatalogWarmup.prototype.schedule = () => assert.fail('An injected runtime adapter must not schedule native catalog warmup');
});
after(() => {
  globalThis.fetch = originalFetch;
  sharedReasoningScheduler.run = originalRun;
  CatalogWarmup.prototype.schedule = originalSchedule;
});

function syntheticTask(n = 1, overrides = {}) {
  return { executionId: id(n), batchId: id(900 + n), deviceId: 'OFFLINE-HISTORY-WORKER',
    physicalId: `android:${'a'.repeat(64)}`, agentVersion: 2, connectionMode: 'USB',
    connectionState: 'disconnected', request: 'Synthetic offline history command', status: 'COMPLETED',
    createdAt: AT, finishedAt: AT + 1000, events: [],
    latest: { type: 'complete', status: 'COMPLETED', reason: 'OUTCOME_VERIFIED',
      counters: { steps: 1 }, timings: { totalMs: 1000 }, profiling: { rpcCount: 2, adbCount: 1 } },
    ...overrides };
}

function fakeRuntime() {
  const effects = [];
  const forbidden = name => async () => { effects.push(name); assert.fail(`No ${name} in an offline history worker fixture`); };
  return { effects, adapter: { discover: async () => [], reserve: forbidden('reservation'),
    plan: forbidden('planning'), open: forbidden('native session'), v2: forbidden('V2 execution'),
    teachIdentity: forbidden('device identity'), teachFrame: { capture: forbidden('screenshot'), privacy: forbidden('native privacy observation') } } };
}

function failingRepository() {
  const calls = [];
  const fail = name => async () => { calls.push(name); throw new Error(SECRET); };
  return { calls, repository: { putTask: fail('putTask'), snapshotDevices: fail('snapshotDevices'),
    quarantine: fail('quarantine'), registerDevice: fail('registerDevice'), connection: fail('connection'), read: fail('read') } };
}

function rejectedReady() {
  const ready = Promise.reject(new Error(SECRET));
  // Starting a worker awaits filesystem I/O before its first offer. Observe the
  // rejection immediately without changing the rejected promise passed to the sink.
  void ready.catch(() => undefined);
  return ready;
}

async function fixture(t, seed) {
  const directory = await mkdtemp(path.join(tmpdir(), PREFIX));
  const runtime = fakeRuntime(); let worker;
  const stop = async () => {
    if (!worker) return;
    worker.server.closeAllConnections();
    await worker.shutdown();
    worker = undefined;
  };
  t.after(async () => {
    await stop();
    // Delete only the exact fresh fixture directory under the system temp root.
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith(PREFIX));
    await rm(resolved, { recursive: true, force: true });
  });
  const stateFile = path.join(directory, 'tasks.json');
  if (seed) await writeFile(stateFile, JSON.stringify(seed), { encoding: 'utf8', mode: 0o600 });
  return { directory, stateFile, runtime, stop, get worker() { return worker; },
    async start(history) {
      assert.equal(worker, undefined, 'stop the current fixture worker before restarting');
      worker = await startWorker({ directory, adapter: runtime.adapter, history });
      return worker;
    } };
}

async function tasks(f) {
  // This is the sole HTTP surface: the newly created in-process loopback worker.
  // Never use worker-client, which can spawn or attach to an actual local worker.
  const address = JSON.parse(await readFile(path.join(f.directory, 'address.json'), 'utf8'));
  const response = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path: '/tasks', method: 'GET',
      agent: false, headers: { Authorization: `Bearer ${address.token}`, Connection: 'close' } }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Fixture worker request timed out')));
    req.on('error', reject); req.end();
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body).includes(SECRET), false);
  assert.ok(['SYNCING', 'HISTORY_SYNC_FAILED', 'HISTORY_COMMIT_OUTCOME_UNKNOWN'].includes(response.body.historyProjection),
    'worker response must explicitly expose history projection state');
  return response.body;
}

async function closed(f, server) {
  assert.equal(server.listening, false);
  await assert.rejects(access(path.join(f.directory, 'address.json')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.directory, 'owner')), { code: 'ENOENT' });
  assert.deepEqual(f.runtime.effects, []);
}

test('rejected history preflight cannot change empty worker tasks, owners, shutdown or durable checkpoint', async t => {
  const failed = failingRepository();
  const history = createHistorySink(failed.repository, rejectedReady());
  const f = await fixture(t); const { server } = await f.start(history);
  const body = await tasks(f);
  assert.deepEqual(body.tasks, []); assert.deepEqual(body.devices, []);
  assert.deepEqual(body.ownerTestModes, []); assert.deepEqual(body.ownerPolicyAudit, []);
  await history.drain(); assert.equal(history.status(), 'HISTORY_SYNC_FAILED');
  assert.deepEqual(failed.calls, [], 'a rejected preflight must not touch the history repository');
  assert.deepEqual(f.worker.registry.list(), []);
  assert.deepEqual(f.worker.registry.ownerTestModes(), []);
  await f.stop();
  await closed(f, server);
  assert.deepEqual(JSON.parse(await readFile(f.stateFile, 'utf8')), []);
  assert.equal(history.status(), 'HISTORY_SYNC_FAILED');
});

test('raw history repository failure remains generic and cannot block worker polling or checkpoint shutdown', async t => {
  const failed = failingRepository(); const history = createHistorySink(failed.repository);
  const f = await fixture(t); const { server } = await f.start(history);
  const body = await tasks(f); await history.drain();
  assert.equal(history.status(), 'HISTORY_SYNC_FAILED');
  assert.deepEqual(failed.calls, ['snapshotDevices']);
  assert.deepEqual(body.tasks, []); assert.deepEqual(body.ownerTestModes, []);
  assert.deepEqual(f.worker.registry.list(), []);
  await f.stop(); await closed(f, server);
  assert.deepEqual(JSON.parse(await readFile(f.stateFile, 'utf8')), []);
});

test('synthetic persisted tasks restore without dispatch and remain durable through shutdown and restart', async t => {
  const terminal = syntheticTask();
  const running = syntheticTask(2, { status: 'RUNNING', finishedAt: undefined,
    latest: { type: 'progress', status: 'EXECUTING', reason: 'SYNTHETIC_IN_FLIGHT' } });
  const f = await fixture(t, [terminal, running]);
  const originalBytes = await readFile(f.stateFile);
  const failed = failingRepository();
  const history = createHistorySink(failed.repository, rejectedReady());
  const startedAt = Date.now(); const first = await f.start(history);
  const body = await tasks(f); await history.drain();
  assert.equal(history.status(), 'HISTORY_SYNC_FAILED');
  assert.equal(body.tasks.length, 2); assert.deepEqual(body.ownerTestModes, []);
  const restoredTerminal = body.tasks.find(task => task.executionId === terminal.executionId);
  const interrupted = body.tasks.find(task => task.executionId === running.executionId);
  assert.deepEqual(restoredTerminal, terminal);
  assert.equal(interrupted.status, 'BLOCKED'); assert.ok(interrupted.finishedAt >= startedAt);
  assert.equal(interrupted.latest.type, 'complete'); assert.equal(interrupted.latest.status, 'BLOCKED');
  assert.match(interrupted.latest.reason, /Worker restarted; no automatic resume/);
  assert.deepEqual(interrupted.events, []);
  assert.equal(interrupted.executionId, running.executionId); assert.equal(interrupted.batchId, running.batchId);
  assert.deepEqual(await readFile(f.stateFile), originalBytes, 'read-only polling must not rewrite the source checkpoint');
  const expected = f.worker.registry.persisted();
  await f.stop(); await closed(f, first.server);
  const durableBytes = await readFile(f.stateFile);
  const durable = JSON.parse(durableBytes.toString('utf8'));
  assert.deepEqual(durable, JSON.parse(JSON.stringify(expected)));
  assert.deepEqual(durable.find(task => task.executionId === terminal.executionId), terminal);
  assert.deepEqual(failed.calls, []);

  const nextHistory = createHistorySink(failed.repository, rejectedReady());
  const second = await f.start(nextHistory);
  const again = await tasks(f); await nextHistory.drain();
  assert.deepEqual(again.tasks, durable); assert.deepEqual(again.ownerTestModes, []);
  assert.deepEqual(again.ownerPolicyAudit, []); assert.equal(nextHistory.status(), 'HISTORY_SYNC_FAILED');
  await f.stop(); await closed(f, second.server);
  assert.deepEqual(await readFile(f.stateFile), durableBytes, 'a second restart preserves the terminal checkpoint');
  assert.deepEqual(failed.calls, []);
});

test('typed history commit uncertainty latches the sink and never automatically retries a write', async () => {
  let writes = 0;
  const repository = { snapshotDevices: async () => assert.fail('No device snapshot offered'),
    quarantine: async () => assert.fail('Valid synthetic tasks must not be quarantined'),
    putTask: async () => { writes++; throw new HistoryError('HISTORY_COMMIT_OUTCOME_UNKNOWN'); } };
  const history = createHistorySink(repository);
  history.offer([syntheticTask()], undefined, AT + 2000); await history.drain();
  assert.equal(history.status(), 'HISTORY_COMMIT_OUTCOME_UNKNOWN'); assert.equal(writes, 1);
  for (let n = 0; n < 3; n++) {
    history.offer([syntheticTask(), syntheticTask(2)], undefined, AT + 3000 + n);
    await history.drain();
  }
  assert.equal(writes, 1, 'lost commit acknowledgement must not trigger an implicit retry');
  assert.equal(history.status(), 'HISTORY_COMMIT_OUTCOME_UNKNOWN');
});

test('raw Error cannot claim the typed commit-unknown verdict', async () => {
  let writes = 0;
  const error = Object.assign(new Error(SECRET), { code: 'HISTORY_COMMIT_OUTCOME_UNKNOWN' });
  const history = createHistorySink({ putTask: async () => { writes++; throw error; },
    snapshotDevices: async () => assert.fail('No device snapshot offered'),
    quarantine: async () => assert.fail('Valid synthetic tasks must not be quarantined') });
  history.offer([syntheticTask()], undefined, AT + 2000); await history.drain();
  assert.equal(writes, 1); assert.equal(history.status(), 'HISTORY_SYNC_FAILED');
  assert.equal(history.status().includes(SECRET), false);
});
