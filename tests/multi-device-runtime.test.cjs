/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), path = require('node:path');
const { randomUUID } = require('node:crypto');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, f) => {
  const original = m.require.bind(m); m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const { ReasoningScheduler } = require('../lib/android/agent/reasoning-scheduler.ts');
const { RuntimeCommand, latestDeviceTasks } = require('../lib/android/agent/runtime-schema.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { buildGoal, planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { ManagedAppiumSession } = require('../lib/android/appium/session-manager.ts');
const { resolveLiveDeviceSelection } = require('../lib/android/device-selection.ts');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) { for (let i = 0; i < 100; i++) { if (condition()) return; await tick(); } assert.fail('Simulation did not reach expected state'); }
function snapshot(pkg, dialog = false) {
  const snapshotId = randomUUID(), nodes = dialog ? [{ packageName: pkg, className: 'android.app.Dialog', resourceId: 'android:id/alertTitle', text: 'Information', description: '',
    enabled: true, displayed: true, clickable: false, focused: false, bounds: [10, 100, 390, 400] }] : [];
  return { deviceSerial: '', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((node, i) => ({ ...node, elementId: snapshotId + ':' + i })) };
}
const devices = ['SIM-A', 'SIM-B'].map(serial => ({ serial, model: serial, status: 'device', connectionType: 'USB' }));
function adapterFor(options = {}) {
  const instances = new Map(), reached = new Map(); let currentDevices = devices;
  const adapter = {
    discover: async () => currentDevices,
    async plan(request, budget) { return buildGoal(request, { app: request.includes('Settings') ? 'settings' : 'chrome', operation: 'OPEN_APP', isSensitive: false }, budget); },
    async open(goal, budget, serial) {
      let stage = options.popup === serial ? 'dialog' : 'outside';
      const instance = { serial, actions: [], closed: 0, goal, budget };
      instances.set(serial, instance);
      return { backend: 'appium', discoveryMemory() { return {}; }, async observe(signal) {
        if (signal?.aborted) throw new AndroidExecutionError('CANCELLED', 'Cancelled');
        budget.recordSnapshot(); const s = snapshot(stage === 'outside' ? 'launcher' : goal.packageName, stage === 'dialog'); s.deviceSerial = serial; return s;
      }, async execute(action, signal) {
        instance.actions.push(action); reached.set(serial, true);
        if (options.gates?.[serial]) await new Promise((resolve, reject) => {
          const abort = () => reject(new AndroidExecutionError('CANCELLED', 'Cancelled'));
          signal?.addEventListener('abort', abort, { once: true });
          options.gates[serial].promise.then(() => { signal?.removeEventListener('abort', abort); resolve(); });
        });
        if (options.fail === serial) throw new AndroidExecutionError('DEVICE_ERROR', 'Device disconnected');
        stage = 'ready'; return { verification: 'VERIFIED', postcondition: 'Simulated state transition' };
      }, async close() { instance.closed++; } };
    },
  };
  return { adapter, instances, reached, disconnect: serial => { currentDevices = currentDevices.filter(d => d.serial !== serial); }, reconnect: () => { currentDevices = devices; } };
}
function start(registry, jobs, requestId = randomUUID()) { return registry.start(RuntimeCommand.parse({ type: 'START', requestId, jobs })); }

test('SIMULATION: two independent Agents dispatch concurrently; A recovery does not stop B', async () => {
  const gate = deferred(), fake = adapterFor({ popup: 'SIM-A', gates: { 'SIM-A': gate } }), registry = new DeviceRuntimeRegistry(fake.adapter);
  const created = await start(registry, [{ deviceId: 'SIM-A', goal: 'Open Chrome' }, { deviceId: 'SIM-B', goal: 'Open Settings' }]);
  await until(() => fake.reached.has('SIM-A'));
  await registry.settled(created[1].executionId);
  const b = registry.list().find(t => t.deviceId === 'SIM-B'); assert.equal(b.status, 'COMPLETED');
  assert.equal(registry.list().find(t => t.deviceId === 'SIM-A').finishedAt, undefined);
  assert.equal(fake.instances.get('SIM-A').actions[0].key, 'BACK');
  gate.resolve(); await registry.settled(created[0].executionId);
  const [a] = registry.list(); assert.equal(a.status, 'COMPLETED');
  assert.equal(a.latest.recovery.history[0].status, 'COMPLETED'); assert.equal(b.latest.recovery.history.length, 0);
  assert.notEqual(a.latest.goalId, b.latest.goalId);
  assert.notEqual(fake.instances.get('SIM-A').budget, fake.instances.get('SIM-B').budget);
  assert.equal(fake.instances.get('SIM-A').closed, 1); assert.equal(fake.instances.get('SIM-B').closed, 1);
  assert.notEqual(registry.entries.get(a.executionId).memory, registry.entries.get(b.executionId).memory);
});
test('SIMULATION: same batch goal produces separate executions; cancelling A does not cancel B', async () => {
  const gates = { 'SIM-A': deferred(), 'SIM-B': deferred() }, fake = adapterFor({ gates }), registry = new DeviceRuntimeRegistry(fake.adapter);
  const created = await start(registry, devices.map(d => ({ deviceId: d.serial, goal: 'Open Chrome' })));
  await until(() => fake.reached.size === 2);
  assert.equal(created[0].batchId, created[1].batchId); assert.notEqual(created[0].executionId, created[1].executionId);
  assert.equal(registry.cancel(created[0].executionId, 'SIM-B'), false);
  assert.equal(registry.cancel(created[0].executionId, 'SIM-A'), true);
  await registry.settled(created[0].executionId); assert.equal(registry.list()[0].status, 'CANCELLED');
  assert.equal(registry.list()[1].finishedAt, undefined);
  gates['SIM-B'].resolve(); await registry.settled(created[1].executionId); assert.equal(registry.list()[1].status, 'COMPLETED');
});
test('SIMULATION: batch cancel, same-device exclusion, duplicate serial and request idempotency', async () => {
  const gates = { 'SIM-A': deferred(), 'SIM-B': deferred() }, fake = adapterFor({ gates }), registry = new DeviceRuntimeRegistry(fake.adapter);
  const jobs = devices.map(d => ({ deviceId: d.serial, goal: 'Open Chrome' })), requestId = randomUUID();
  const [first, repeated] = await Promise.all([start(registry, jobs, requestId), start(registry, jobs, requestId)]);
  assert.equal(first[0].executionId, repeated[0].executionId); assert.equal(registry.list().length, 2);
  await assert.rejects(start(registry, [jobs[0]]), /already/);
  await assert.rejects(start(registry, [jobs[0], jobs[0]]), /same device/);
  await until(() => fake.reached.size === 2); assert.equal(registry.cancelBatch(requestId), 2);
  await registry.shutdown(); assert.ok(registry.list().every(t => t.status === 'CANCELLED'));
});
test('SIMULATION: device error and reconnect never restart an unverified action or affect B', async () => {
  const fake = adapterFor({ fail: 'SIM-A' }), registry = new DeviceRuntimeRegistry(fake.adapter);
  const created = await start(registry, devices.map(d => ({ deviceId: d.serial, goal: 'Open Chrome' })));
  await Promise.all(created.map(t => registry.settled(t.executionId)));
  assert.equal(registry.list()[0].status, 'DISCONNECTED'); assert.equal(registry.list()[1].status, 'COMPLETED');
  fake.reconnect(); await registry.refreshConnections(); assert.equal(registry.list()[0].status, 'DISCONNECTED');
  assert.equal(fake.instances.get('SIM-A').actions.length, 1);
});
test('SIMULATION: discovered disconnect aborts only its active runtime and restores no execution on reconnect', async () => {
  const gates = { 'SIM-A': deferred(), 'SIM-B': deferred() }, fake = adapterFor({ gates }), registry = new DeviceRuntimeRegistry(fake.adapter);
  const created = await start(registry, devices.map(d => ({ deviceId: d.serial, goal: 'Open Chrome' })));
  await until(() => fake.reached.size === 2); fake.disconnect('SIM-A'); await registry.refreshConnections();
  await registry.settled(created[0].executionId); assert.equal(registry.list()[0].status, 'DISCONNECTED');
  assert.equal(registry.list()[1].cancelRequested, undefined);
  gates['SIM-B'].resolve(); await registry.settled(created[1].executionId);
  fake.reconnect(); await registry.refreshConnections(); assert.equal(registry.list()[0].status, 'DISCONNECTED');
});
test('SIMULATION: detached viewers and restored journals do not own or auto-resume tasks', async () => {
  const gate = deferred(), fake = adapterFor({ gates: { 'SIM-A': gate } }), registry = new DeviceRuntimeRegistry(fake.adapter);
  const requestId = randomUUID(), jobs = [{ deviceId: 'SIM-A', goal: 'Open Chrome' }];
  const [task] = await start(registry, jobs, requestId); await until(() => fake.reached.has('SIM-A'));
  const view = registry.list(); view[0].status = 'FAILED'; assert.equal(registry.list()[0].status, 'RUNNING');
  const restored = new DeviceRuntimeRegistry(fake.adapter); restored.restore(registry.persisted());
  assert.equal(restored.list()[0].status, 'BLOCKED'); assert.equal(restored.list()[0].latest.assistance, undefined);
  assert.equal((await start(restored, jobs, requestId))[0].status, 'BLOCKED');
  gate.resolve(); await registry.settled(task.executionId); assert.equal(registry.list()[0].status, 'COMPLETED');
});
test('SIMULATION: reasoning fair queue is serial, bounded and recovers from request failure', async () => {
  const queue = new ReasoningScheduler(3), gate = deferred(), order = [];
  const a = queue.run('A', async () => { order.push('A0'); await gate.promise; });
  await tick();
  const a1 = queue.run('A', async () => { order.push('A1'); });
  const a2 = queue.run('A', async () => { order.push('A2'); throw Error('Model failure'); });
  const b = queue.run('B', async () => { order.push('B'); });
  const rejected = assert.rejects(a2, /Model failure/);
  await assert.rejects(queue.run('C', async () => {}), /full/);
  assert.deepEqual(queue.summary(), { running: 1, waiting: 3, concurrency: 1, capacity: 3 });
  gate.resolve(); await Promise.all([a, a1, b, rejected]); assert.deepEqual(order, ['A0', 'B', 'A1', 'A2']);
  assert.equal(await queue.run('C', async () => 'recovered'), 'recovered');
});
test('SIMULATION: queued cancel/timeout remove only their job; running lease is not released before I/O settles', async () => {
  const queue = new ReasoningScheduler(), gate = deferred(), cancel = new AbortController(); let bStarted = false;
  const active = queue.run('A', async () => { await gate.promise; }, cancel.signal);
  await tick(); const waitingCancel = new AbortController();
  const waiting = queue.run('B', async () => { bStarted = true; }, waitingCancel.signal);
  const waitingFailure = assert.rejects(waiting); waitingCancel.abort(); await waitingFailure;
  await assert.rejects(queue.run('C', async () => {}, undefined, 15));
  const activeFailure = assert.rejects(active); cancel.abort(); assert.equal(queue.summary().running, 1); assert.equal(bStarted, false);
  gate.resolve(); await activeFailure; assert.equal(queue.summary().running, 0);
});
test('SIMULATION: parallel Sessions bind unique ports/UDID; closing A leaves B intact', async () => {
  const calls = new Map();
  function session(serial) {
    const state = { closed: 0 }; calls.set(serial, state);
    return new ManagedAppiumSession({ async request(method, url, body) {
      if (method === 'POST' && url === '/session') { state.caps = body.capabilities.alwaysMatch; return { sessionId: serial }; }
      if (url.endsWith('/appium/capabilities')) return { udid: serial };
      if (method === 'DELETE') state.closed++;
      return null;
    } }, serial, async args => ({ stdout: args.includes('--list') ? '' : 'device' }), async () => {});
  }
  const a = session('SIM-A'), b = session('SIM-B');
  try {
    await Promise.all([a.open(), b.open()]);
    const ac = calls.get('SIM-A').caps, bc = calls.get('SIM-B').caps;
    assert.equal(ac['appium:udid'], 'SIM-A'); assert.equal(bc['appium:udid'], 'SIM-B');
    assert.notEqual(ac['appium:systemPort'], bc['appium:systemPort']); assert.notEqual(ac['appium:chromedriverPort'], bc['appium:chromedriverPort']);
    assert.equal(ac['appium:skipServerInstallation'], true); assert.equal(ac['appium:mjpegServerPort'], undefined);
    await a.close(); assert.equal(calls.get('SIM-B').closed, 0); await b.ensureActive();
  } finally { await a.close(); await b.close(); }
});
test('SIMULATION: Dashboard retains multi-selection, renders independent progress and keeps per-device cancel controls', () => {
  const selected = resolveLiveDeviceSelection(devices, 'SIM-A', ['SIM-A', 'SIM-B']);
  assert.deepEqual(selected.selectedDeviceIds, ['SIM-A', 'SIM-B']);
  assert.deepEqual(resolveLiveDeviceSelection(devices, 'SIM-A', []).selectedDeviceIds, []);
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { AgentGoalPanel } = require('../components/commands/AgentGoalPanel.tsx');
  const tasks = devices.map((d, i) => ({ executionId: randomUUID(), batchId: 'same-batch', deviceId: d.serial, createdAt: i, request: 'Open Chrome', status: i ? 'RUNNING' : 'WAITING_HUMAN', events: [],
    latest: { type: 'progress', status: 'EXECUTING', reason: i ? 'B keeps running' : 'A recovery' } }));
  const markup = renderToStaticMarkup(React.createElement(AgentGoalPanel, { text: 'Open Chrome', onText() {}, devices, serial: 'SIM-A', onSerial() {}, onRefresh() {}, selectedDeviceIds: selected.selectedDeviceIds, runtime: { tasks, command: async () => {} } }));
  assert.match(markup, /SIM-A/); assert.match(markup, /SIM-B/); assert.match(markup, /Hủy SIM-A/); assert.match(markup, /Hủy SIM-B/); assert.match(markup, /Chạy nhóm/);
  assert.equal(latestDeviceTasks(tasks).size, 2);
  const old = { ...tasks[0], executionId: randomUUID(), createdAt: -1, status: 'COMPLETED', finishedAt: 1, request: 'Historical verified goal' };
  const historical = renderToStaticMarkup(React.createElement(AgentGoalPanel, { text: 'Open Chrome', onText() {}, devices, serial: 'SIM-A', onSerial() {}, onRefresh() {},
    selectedDeviceIds: selected.selectedDeviceIds, runtime: { tasks: [old, ...tasks], command: async () => {} }, inspectedExecutionId: old.executionId }));
  assert.match(historical, /Historical verified goal/); assert.equal(latestDeviceTasks([old, ...tasks]).get('SIM-A').executionId, tasks[0].executionId);
  assert.equal(RuntimeCommand.safeParse({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'a; shell', goal: 'x' }] }).success, false);
  assert.equal(RuntimeCommand.safeParse({ type: 'CANCEL', deviceId: 'SIM-A', executionId: randomUUID(), bypass: true }).success, false);
});
function humanAdapter() {
  const instances = new Map();
  const adapter = { discover: async () => devices, async plan(request, budget) {
    const { goal } = await planGoal(request, budget); goal.currentSubgoal = 2; goal.subgoals[0].status = goal.subgoals[1].status = 'VERIFIED'; return goal;
  }, async open(goal, budget, serial) {
    const visual = { id: randomUUID(), status: 'HUMAN_REQUIRED', coherent: true, ordinalVerified: true, expiresAt: Date.now() + 10000,
      image: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII=', crop: [0, 0, 1, 1] } };
    const state = { taps: 0, closed: 0 }; instances.set(serial, state);
    const before = snapshot(goal.packageName); before.screen = 'SEARCH_RESULTS'; before.nodes = [{ ...snapshot(goal.packageName, true).nodes[0], className: 'android.view.View', resourceId: goal.packageName + ':id/search_query', text: goal.spec.query }];
    before.deviceSerial = serial;
    const after = snapshot(goal.packageName); after.screen = 'VIDEO_PLAYER';
    after.deviceSerial = serial;
    after.nodes = [{ ...before.nodes[0], resourceId: goal.packageName + ':id/video_title', text: 'Simulated podcast' }];
    return { backend: 'appium', observe: async () => ({ ...before, timestamp: Date.now(), snapshotId: randomUUID() }), discoveryMemory() {}, verificationSnapshot: () => ({ ...after, timestamp: Date.now() }),
      async execute() { const error = new AndroidExecutionError('AMBIGUOUS', 'Activation requires a human point'); error.visual = visual; throw error; },
      async confirmVisualTap(choice) { assert.equal(choice.evidenceId, visual.id); state.taps++; return { verification: 'VERIFIED', selection: { itemType: 'video', ordinal: 2, title: 'Simulated podcast', identity: serial } }; },
      async close() { state.closed++; } };
  } };
  return { adapter, instances };
}
test('SIMULATION: Human Assistance is bound to device/execution/token; confirming A never resumes B', async () => {
  const { adapter, instances } = humanAdapter();
  const registry = new DeviceRuntimeRegistry(adapter);
  const tasks = await start(registry, devices.map(d => ({ deviceId: d.serial, goal: 'Mở YouTube, tìm podcast và phát video thứ hai.' })));
  await until(() => registry.list().every(t => t.status === 'WAITING_HUMAN'));
  const [a, b] = registry.list(), assistance = a.latest.assistance;
  const input = { type: 'ASSIST', executionId: a.executionId, deviceId: a.deviceId, token: assistance.token, evidenceId: assistance.evidenceId, x: 120, y: 120, confirmed: true };
  assert.equal(registry.confirm({ ...input, deviceId: b.deviceId }), false);
  assert.equal(registry.confirm({ ...input, executionId: b.executionId }), false);
  assert.equal(registry.confirm(input), true); assert.equal(registry.confirm(input), false);
  await registry.settled(a.executionId); assert.equal(registry.list()[0].status, 'COMPLETED'); assert.equal(instances.get('SIM-B').taps, 0);
  registry.cancel(b.executionId, b.deviceId); await registry.settled(b.executionId); assert.equal(registry.list()[1].status, 'CANCELLED');
  assert.equal(instances.get('SIM-A').closed, 1); assert.equal(instances.get('SIM-B').closed, 1);
  assert.equal(registry.persisted().find(t => t.executionId === tasks[0].executionId).latest.visual, undefined);
});
test('SIMULATION HTTP integration: authenticated worker survives detached viewers; journal restart blocks interrupted work', async () => {
  const { startWorker } = require('../lib/android/agent/worker-server.ts');
  const os = require('node:os'), promises = require('node:fs/promises');
  const directory = await promises.mkdtemp(path.join(os.tmpdir(), 'phone-runtime-http-test-'));
  const gate = deferred(), fake = adapterFor({ gates: { 'SIM-A': gate } });
  let worker = await startWorker({ directory, adapter: fake.adapter });
  let interrupted;
  try {
    const address = JSON.parse(await promises.readFile(path.join(directory, 'address.json'), 'utf8'));
    const url = `http://127.0.0.1:${address.port}`, headers = { Authorization: 'Bearer ' + address.token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url + '/tasks')).status, 403);
    assert.equal((await fetch(url + '/tasks', { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
    const reply = await fetch(url + '/tasks', { method: 'POST', headers, body: JSON.stringify({ type: 'START', requestId: randomUUID(), jobs: devices.map(d => ({ deviceId: d.serial, goal: 'Open Chrome' })) }) });
    assert.equal(reply.status, 200); const created = (await reply.json()).tasks;
    await until(() => fake.reached.has('SIM-A')); await worker.registry.settled(created[1].executionId);
    const fetched = await (await fetch(url + '/tasks', { headers })).json();
    assert.equal(fetched.tasks[1].status, 'COMPLETED'); assert.equal(fetched.tasks[0].finishedAt, undefined);
    assert.equal((await fetch(url + '/shutdown', { method: 'POST', headers })).status, 409);
    interrupted = worker.registry.persisted(); gate.resolve(); await worker.registry.settled(created[0].executionId);
  } finally { gate.resolve(); await worker.shutdown(); }
  await promises.writeFile(path.join(directory, 'tasks.json'), JSON.stringify(interrupted));
  worker = await startWorker({ directory, adapter: fake.adapter });
  try { assert.equal(worker.registry.list()[0].status, 'BLOCKED'); assert.equal(worker.registry.list()[1].status, 'COMPLETED'); }
  finally {
    await worker.shutdown();
    // Only known files created by this fixture are removed; no recursive deletion.
    await promises.unlink(path.join(directory, 'tasks.json')); await promises.rmdir(directory);
  }
});
test('Origin validation uses real loopback authority and rejects foreign origin, port, protocol and rebinding', () => {
  const { isLocalSameOrigin } = require('../lib/android/agent/request-origin.ts');
  const request = (origin, host = '127.0.0.1:3000') => new Request('http://localhost:3000/api/agent/runtime', { headers: { Host: host, Origin: origin } });
  assert.equal(isLocalSameOrigin(request('http://127.0.0.1:3000')), true);
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000', 'https://untrusted.example', 'null']) assert.equal(isLocalSameOrigin(request(origin)), false);
  assert.equal(isLocalSameOrigin(request('http://untrusted.example:3000', 'untrusted.example:3000')), false);
});
test('SIMULATION: separate Ollama clients share one queue without mixing prompts or budgets', async () => {
  const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts'), { z } = require('zod');
  const gate = deferred(), received = []; let concurrent = 0, peak = 0;
  const fetcher = async (_url, options) => {
    concurrent++; peak = Math.max(peak, concurrent);
    const input = JSON.parse(JSON.parse(options.body).messages[1].content); received.push(input.device);
    if (input.device === 'A') await gate.promise;
    concurrent--; return new Response(JSON.stringify({ message: { content: JSON.stringify({ device: input.device }) } }));
  };
  const aBudget = new AgentBudget(), bBudget = new AgentBudget();
  const a = new OllamaAgentReasoner(fetcher).generate(z.object({ device: z.literal('A') }), 'Bound simulation', { device: 'A' }, aBudget);
  await tick();
  const b = new OllamaAgentReasoner(fetcher).generate(z.object({ device: z.literal('B') }), 'Bound simulation', { device: 'B' }, bBudget);
  await tick(); assert.deepEqual(received, ['A']); gate.resolve();
  assert.deepEqual(await Promise.all([a, b]), [{ device: 'A' }, { device: 'B' }]); assert.equal(peak, 1);
  assert.equal(aBudget.counters.reasoning, 1); assert.equal(bBudget.counters.reasoning, 1);
});
test('SIMULATION: cross-device hierarchy is rejected before dispatch or completion', async () => {
  const fake = adapterFor(), original = fake.adapter.open;
  fake.adapter.open = async (...args) => {
    const execution = await original(...args);
    execution.observe = async () => ({ ...snapshot(args[0].packageName), deviceSerial: 'SIM-B' }); return execution;
  };
  const registry = new DeviceRuntimeRegistry(fake.adapter);
  const [task] = await start(registry, [{ deviceId: 'SIM-A', goal: 'Open Chrome' }]); await registry.settled(task.executionId);
  assert.equal(registry.list()[0].status, 'FAILED'); assert.equal(registry.list()[0].latest.failure.code, 'SESSION_ERROR');
  assert.equal(fake.instances.get('SIM-A').actions.length, 0); assert.equal(fake.instances.get('SIM-A').closed, 1);
});
test('SIMULATION HTTP: polling excludes image bytes; evidence is fetched only for the matching waiting device', async () => {
  const { startWorker } = require('../lib/android/agent/worker-server.ts'), os = require('node:os'), promises = require('node:fs/promises');
  const directory = await promises.mkdtemp(path.join(os.tmpdir(), 'phone-runtime-image-test-'));
  const { adapter } = humanAdapter(), worker = await startWorker({ directory, adapter });
  try {
    const address = JSON.parse(await promises.readFile(path.join(directory, 'address.json'), 'utf8'));
    const base = `http://127.0.0.1:${address.port}`, headers = { Authorization: 'Bearer ' + address.token, 'Content-Type': 'application/json' };
    await start(worker.registry, devices.map(device => ({ deviceId: device.serial, goal: 'Mở YouTube, tìm podcast và phát video thứ hai.' })));
    await until(() => worker.registry.list().every(task => task.status === 'WAITING_HUMAN'));
    const text = await (await fetch(base + '/tasks', { headers })).text(); assert.doesNotMatch(text, /data:image/);
    const [a, b] = JSON.parse(text).tasks;
    const query = new URLSearchParams({ executionId: a.executionId, deviceId: a.deviceId, evidenceId: a.latest.visual.id });
    const image = await fetch(base + '/evidence?' + query, { headers }); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
    query.set('deviceId', b.deviceId); assert.equal((await fetch(base + '/evidence?' + query, { headers })).status, 410);
    worker.registry.cancel(a.executionId, a.deviceId); await worker.registry.settled(a.executionId);
    query.set('deviceId', a.deviceId); assert.equal((await fetch(base + '/evidence?' + query, { headers })).status, 410);
  } finally {
    await worker.shutdown(); await promises.unlink(path.join(directory, 'tasks.json')); await promises.rmdir(directory);
  }
});
test('SIMULATION: uncertain Session creation retains its port lease; known refusal releases only its own lease', async () => {
  for (const known of [false, true]) {
    let released = 0;
    const failure = new AndroidExecutionError('BACKEND_ERROR', 'Creation failed'); failure.requestOutcomeKnown = known;
    const session = new ManagedAppiumSession({ request: async () => { throw failure; } }, 'SIM-A', async args => ({ stdout: args.includes('--list') ? '' : 'device' }), async () => {},
      async () => ({ systemPort: 8201, chromedriverPort: 9516, mjpegServerPort: 9101, release: async () => { released++; } }));
    await assert.rejects(session.open());
    if (known) { await session.close(); assert.equal(released, 1); }
    else { await assert.rejects(session.close(), /uncertain/); assert.equal(released, 0); }
  }
});
test('SIMULATION: opening the same Session concurrently cannot create a second driver', async () => {
  const gate = deferred(); let created = 0, released = 0;
  const session = new ManagedAppiumSession({ request: async (method, url) => {
    if (method === 'POST' && url === '/session') { created++; await gate.promise; return { sessionId: 'only-one' }; }
    if (url.endsWith('/appium/capabilities')) return { udid: 'SIM-A' };
  } }, 'SIM-A', async args => ({ stdout: args.includes('--list') ? '' : 'device' }), async () => {},
  async () => ({ systemPort: 8201, chromedriverPort: 9516, mjpegServerPort: 9101, release: async () => { released++; } }));
  const first = session.open(); await until(() => created === 1); await assert.rejects(session.open(), /already/);
  gate.resolve(); await first; await session.close(); assert.equal(created, 1); assert.equal(released, 1);
});
test('SIMULATION: an Agent waiting for reasoning does not lock another device Android executor', async () => {
  const queue = new ReasoningScheduler(), gate = deferred(), blocker = queue.run('busy-model', async () => gate.promise);
  await tick();
  const fake = adapterFor(), original = fake.adapter.plan;
  fake.adapter.plan = async (request, budget, signal) => {
    if (request.includes('Chrome')) await queue.run('SIM-A', async () => true, signal);
    return original(request, budget, signal);
  };
  const registry = new DeviceRuntimeRegistry(fake.adapter);
  const tasks = await start(registry, [{ deviceId: 'SIM-A', goal: 'Open Chrome' }, { deviceId: 'SIM-B', goal: 'Open Settings' }]);
  await registry.settled(tasks[1].executionId);
  assert.equal(queue.summary().waiting, 1); assert.equal(fake.instances.has('SIM-A'), false);
  assert.equal(registry.list()[1].status, 'COMPLETED');
  gate.resolve(); await blocker; await registry.settled(tasks[0].executionId); assert.equal(registry.list()[0].status, 'COMPLETED');
});
