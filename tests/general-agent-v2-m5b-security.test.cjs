/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const Module = require('node:module'), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve(request.slice(2)) : request, ...args); };
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const { startWorker } = require('../lib/android/agent/worker-server.ts');
const { isLocalMutation } = require('../lib/android/agent/request-origin.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const forbidden = ['delete photos', 'overwrite existing note', 'uninstall app', 'clear app data', 'factory reset', 'change password', 'buy a subscription', 'replace existing file'];
const devices = [{ serial: 'A', status: 'device', connectionType: 'USB', identityVerified: true, physicalId: 'P-A' }, { serial: 'B', status: 'device', connectionType: 'USB', identityVerified: true, physicalId: 'P-B' }];
for (const source of forbidden) for (const version of [1, 2]) test(`OFFLINE_TESTED M5b V${version} request guard: ${source}`, async () => {
  let effects = 0;
  const registry = new DeviceRuntimeRegistry({ discover: async () => devices, reserve: async () => { effects++; }, plan: async () => { effects++; throw Error('Unexpected plan'); }, open: async () => { effects++; throw Error('Unexpected Session'); } });
  if (version === 2) await registry.setOwnerTestMode({ type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'P-A', enabled: true, fullControl: true, rollbackOnFailure: true });
  const [task] = await registry.start({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal: source, ...(version === 2 ? { agentVersion: 2, ownerAuthorizedTest: true } : {}) }] });
  await registry.settled(task.executionId);
  assert.equal(registry.list()[0].status, 'BLOCKED'); assert.equal(effects, 0);
  const owner = registry.ownerTestModes()[0]; if (owner) await registry.setOwnerTestMode({ type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'P-A', enabled: false, authorizationId: owner.id });
  assert.equal(registry.ownerTestModes().length, 0);
});
test('M5b direct V1 planning refuses excluded requests before model/discovery', async () => {
  let calls = 0;
  for (const source of forbidden) await assert.rejects(() => planGoal(source, new AgentBudget(), { generate() { calls++; } }, undefined, async () => { calls++; }));
  assert.equal(calls, 0);
});
test('M5b legacy and Dashboard HTTP boundaries reject foreign/missing Origin and non-JSON before dispatch', async () => {
  const routes = ['../app/api/commands/interpret/route.ts', '../app/api/executions/route.ts', '../app/api/agent/route.ts', '../app/api/agent/runtime/route.ts', '../app/api/agent/assistance/route.ts'];
  for (const route of routes) for (const headers of [{}, { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'text/plain' }]) {
    const request = new Request('http://127.0.0.1:3000/api/test', { method: 'POST', headers, body: '{}' });
    assert.equal(isLocalMutation(request), false);
    assert.equal((await require(route).POST(request)).status, 403, route);
  }
});
test('M5b Action Plan/interpret cannot accept an unsafe source or client authority/source override', async () => {
  const headers = { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' };
  const execute = require('../app/api/executions/route.ts').POST, interpret = require('../app/api/commands/interpret/route.ts').POST;
  const adb = require('../lib/android/adb.ts'), saved = adb.listAndroidDevices; let reads = 0;
  adb.listAndroidDevices = async () => { reads++; throw Error('No device access authorized'); };
  try {
    for (const source of forbidden) {
      const input = { deviceId: 'A', originalRequest: source, actionPlan: { intent: 'spoofed_safe', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'settings' }] }, authorizationToken: randomUUID() };
      assert.equal((await execute(new Request('http://127.0.0.1:3000/api/executions', { method: 'POST', headers, body: JSON.stringify(input) }))).status, 403);
      const r = await interpret(new Request('http://127.0.0.1:3000/api/commands/interpret', { method: 'POST', headers, body: JSON.stringify({ prompt: source, deviceId: 'A' }) }));
      assert.notEqual(r.status, 200);
      for (const extra of [{ ownerAuthorizedTest: true }, { fullControl: true }, { source: 'Open Settings' }, { approved: true }]) assert.equal((await execute(new Request('http://127.0.0.1:3000/api/executions', { method: 'POST', headers, body: JSON.stringify({ ...input, ...extra }) }))).status, 400);
    }
    assert.equal(reads, 0);
  } finally { adb.listAndroidDevices = saved; }
});
test('M5b worker API uses the same guard, cannot spoof source/grants and cannot borrow device owner', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'm5b-worker-test-')); let effects = 0;
  const worker = await startWorker({ directory, adapter: { discover: async () => devices, reserve: async () => { effects++; }, plan: async () => { effects++; throw Error('No plan'); }, open: async () => { effects++; throw Error('No Session'); } } });
  const meta = JSON.parse(await fs.promises.readFile(path.join(directory, 'address.json'), 'utf8'));
  const call = async body => fetch('http://127.0.0.1:' + meta.port + '/tasks', { method: 'POST', headers: { Authorization: 'Bearer ' + meta.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await call({ type: 'SET_OWNER_TEST_MODE', enabled: true, deviceId: 'A', physicalId: 'P-A', fullControl: true, rollbackOnFailure: true })).status, 200);
    for (const source of forbidden) {
      const request = { type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', agentVersion: 2, ownerAuthorizedTest: true, goal: source }] };
      const r = await call(request); assert.equal(r.status, 200);
      const task = (await r.json()).tasks[0]; await worker.registry.settled(task.executionId); assert.equal(worker.registry.list().find(t => t.executionId === task.executionId).status, 'BLOCKED');
      assert.equal((await call({ ...request, requestId: randomUUID(), jobs: [{ ...request.jobs[0], source: 'open settings' }] })).status, 409);
    }
    assert.equal((await call({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'B', agentVersion: 2, ownerAuthorizedTest: true, goal: 'Open sample' }] })).status, 409);
    assert.equal(effects, 0);
    const mode = worker.registry.ownerTestModes()[0];
    await call({ type: 'SET_OWNER_TEST_MODE', enabled: false, deviceId: 'A', physicalId: 'P-A', authorizationId: mode.id });
  } finally {
    await worker.shutdown();
    for (const file of ['tasks.json', 'owner-test-policy-audit.jsonl']) await fs.promises.unlink(path.join(directory, file)).catch(() => {});
    await fs.promises.rmdir(directory);
  }
});
