/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'), load = Module._load, tick = () => new Promise(setImmediate);
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file,
}).outputText, file);
Module._load = function(name, parent, main) { return load.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, main); };
const { UnifiedAgentService } = require('../lib/android/unified-agent/service.ts');
const { ClientRequestId, UnifiedCommand } = require('../lib/android/unified-agent/contracts.ts');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const device = id => ({ serial: id, physicalId: 'physical-' + id, status: 'device', identityVerified: true, model: 'OFFLINE', connectionType: 'USB' });
function serviceFixture(terminal = false) {
  let now = 1000000, contextGate, failContext = false, loseResponse = false;
  const calls = { context: 0, start: 0 }, prepared = new Map(), tasks = [];
  const adapters = {
    async context(deviceId) {
      calls.context++; if (contextGate) await contextGate.promise;
      if (failContext) throw Error('Offline context unavailable');
      return { deviceId, physicalId: 'physical-' + deviceId, backend: 'appium', runtimeHash: 'hash-a', policyMode: 'normal', busy: false };
    },
    async prepare(source, deviceId) {
      const reference = randomUUID(); prepared.set(reference, { source, deviceId });
      return { reference, expiresAt: now + 90000, summary: source, steps: [source], confirmations: [] };
    },
    async start(reference) {
      calls.start++; const row = prepared.get(reference); assert.ok(row);
      if (loseResponse) throw Error('Offline response lost after dispatch');
      const task = { executionId: randomUUID(), batchId: reference, deviceId: row.deviceId, physicalId: 'physical-' + row.deviceId,
        request: row.source, agentVersion: 2, createdAt: now, status: terminal ? 'COMPLETED' : 'RUNNING',
        ...(terminal ? { finishedAt: now } : {}), events: [] };
      tasks.push(task); return task;
    },
    tasks: async () => tasks, cancel: async () => {},
  };
  const service = new UnifiedAgentService(adapters, () => now);
  return { service, calls, tasks, adapters, advance(ms) { now += ms; }, holdContext() { contextGate = deferred(); return contextGate; },
    setFailContext(value) { failContext = value; }, loseResponse() { loseResponse = true; },
    plan: (deviceId = 'A') => service.analyze({ source: 'read battery', deviceId }) };
}
function routeFixture() {
  const calls = { context: 0, prepare: 0, start: 0 }, prepared = new Map(), tasks = [];
  let contextGate;
  const workerRequest = async (method, command) => {
    if (method === 'GET') {
      calls.context++; if (contextGate) await contextGate.promise;
      return Response.json({ devices: [device('A'), device('B')], tasks, ownerTestModes: [] });
    }
    if (command.type === 'PREPARE') {
      calls.prepare++; const reference = randomUUID(); prepared.set(reference, command);
      return Response.json({ reference, expiresAt: Date.now() + 90000, summary: command.source, steps: [command.source], confirmations: [] });
    }
    assert.equal(command.type, 'START_PREPARED'); calls.start++;
    const row = prepared.get(command.reference); assert.ok(row);
    const task = { executionId: randomUUID(), batchId: command.reference, deviceId: row.deviceId, physicalId: 'physical-' + row.deviceId,
      request: row.source, agentVersion: 2, createdAt: Date.now(), status: 'RUNNING', events: [] };
    tasks.push(task); return Response.json({ tasks: [task] });
  };
  const routeFile = path.join(root, 'app/api/unified-agent/route.ts'), previousLoad = Module._load;
  delete global.phoneCommanderUnifiedCatalog; delete require.cache[routeFile];
  Module._load = function(name, parent, main) {
    if (name === '@/lib/android/agent/worker-client') return { workerRequest };
    if (name === '@/lib/android/agent/runtime-storage') return { androidRuntimeDigest: () => 'a'.repeat(64) };
    return previousLoad.call(this, name, parent, main);
  };
  let route; try { route = require(routeFile); } finally { Module._load = previousLoad; }
  return { calls, holdContext() { contextGate = deferred(); return contextGate; },
    async post(body) {
      const response = await route.POST(new Request('http://localhost:3000/api/unified-agent', { method: 'POST',
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      const text = await response.text(); return { status: response.status, value: JSON.parse(text), text };
    },
    async plan(deviceId = 'A') { const reply = await this.post({ type: 'ANALYZE', input: { source: 'read battery', deviceId } }); assert.equal(reply.status, 200); return reply.value.plan; },
    close() { contextGate?.resolve(); delete global.phoneCommanderUnifiedCatalog; delete require.cache[routeFile]; },
  };
}
const execute = (reference, clientRequestId = randomUUID()) => ({ type: 'EXECUTE', reference, clientRequestId });

for (const [name, key] of [
  ['missing', undefined], ['null', null], ['empty', ''], ['short', 'a'], ['overlong', 'a'.repeat(129)],
  ['whitespace', ' ' + randomUUID()], ['newline', randomUUID() + '\n'], ['unicode', '\u0111'.repeat(36)],
  ['object', {}], ['array', [randomUUID()]], ['wrong characters', 'g'.repeat(36)],
]) test('C18 OFFLINE strict EXECUTE rejects ' + name + ' key before context or START', async () => {
  const f = routeFixture();
  try {
    const body = { type: 'EXECUTE', reference: randomUUID(), ...(key === undefined ? {} : { clientRequestId: key }) };
    assert.equal(UnifiedCommand.safeParse(body).success, false);
    const reply = await f.post(body); assert.equal(reply.status, 400); assert.deepEqual(f.calls, { context: 0, prepare: 0, start: 0 });
  } finally { f.close(); }
});
for (const extra of [{ deviceId: 'B' }, { source: 'read wifi' }, { engine: 'V1' }, { actionPlan: {} }, { grants: [] }, { ownerAuthorizedTest: true }])
  test('C18 OFFLINE strict keyed EXECUTE still rejects scope override ' + Object.keys(extra)[0], async () => {
    const f = routeFixture();
    try {
      assert.equal(ClientRequestId.safeParse(randomUUID()).success, true);
      const reply = await f.post({ ...execute(randomUUID()), ...extra }); assert.equal(reply.status, 400);
      assert.deepEqual(f.calls, { context: 0, prepare: 0, start: 0 });
    } finally { f.close(); }
  });

test('C18 OFFLINE production route sequential duplicate returns byte-identical initial reply and STARTs once', async () => {
  const f = routeFixture();
  try {
    const plan = await f.plan(), body = execute(plan.reference);
    const first = await f.post(body); await tick(); const second = await f.post(body);
    assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(second.text, first.text);
    assert.deepEqual(second.value, first.value); assert.equal(f.calls.start, 1);
    assert.equal(first.value.execution.plan.deviceId, 'A'); assert.equal(first.value.execution.plan.reference, plan.reference);
  } finally { f.close(); }
});
test('C18 OFFLINE production route concurrent duplicate shares admission while context is pending', async () => {
  const f = routeFixture();
  try {
    const plan = await f.plan(), body = execute(plan.reference), before = f.calls.context, gate = f.holdContext();
    const first = f.post(body), second = f.post(body); await tick();
    assert.equal(f.calls.start, 0); assert.equal(f.calls.context, before + 1);
    gate.resolve(); const replies = await Promise.all([first, second]); await tick();
    assert.deepEqual(replies.map(r => r.status), [200, 200]); assert.equal(replies[0].text, replies[1].text); assert.equal(f.calls.start, 1);
  } finally { f.close(); }
});
test('C18 OFFLINE different key cannot replay a consumed plan', async () => {
  const f = routeFixture();
  try {
    const plan = await f.plan(); assert.equal((await f.post(execute(plan.reference))).status, 200); await tick();
    const replay = await f.post(execute(plan.reference)); assert.equal(replay.status, 409); assert.equal(replay.value.code, 'PLAN_REPLAYED'); assert.equal(f.calls.start, 1);
  } finally { f.close(); }
});
for (const target of ['A', 'B']) test('C18 OFFLINE same key rejects a different reference for device ' + target, async () => {
  const f = routeFixture();
  try {
    const a = await f.plan(), b = await f.plan(target), key = randomUUID();
    assert.equal((await f.post(execute(a.reference, key))).status, 200); await tick(); const context = f.calls.context;
    const denied = await f.post(execute(b.reference, key)); assert.equal(denied.status, 409); assert.equal(denied.value.code, 'REQUEST_KEY_CONFLICT');
    assert.equal(f.calls.context, context); assert.equal(f.calls.start, 1);
  } finally { f.close(); }
});
test('C18 OFFLINE different keys with separately authorized device-bound plans execute independently', async () => {
  const f = routeFixture();
  try {
    const a = await f.plan(), b = await f.plan('B');
    const first = await f.post(execute(a.reference)), second = await f.post(execute(b.reference)); await tick();
    assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(f.calls.start, 2);
    assert.notEqual(first.value.execution.id, second.value.execution.id);
    assert.equal(first.value.execution.plan.deviceId, 'A'); assert.equal(second.value.execution.plan.deviceId, 'B');
  } finally { f.close(); }
});
test('C18 OFFLINE cached snapshot is isolated from caller mutation and later progress', async () => {
  const f = serviceFixture(), plan = await f.plan(), key = randomUUID();
  const first = await f.service.executeRequest(plan.reference, key), expected = structuredClone(first);
  first.plan.deviceId = 'foreign'; first.status = 'COMPLETED'; await tick();
  f.tasks[0].status = 'BLOCKED'; f.tasks[0].finishedAt = 1000001; await f.service.list();
  const duplicate = await f.service.executeRequest(plan.reference, key);
  assert.deepEqual(duplicate, expected); assert.notEqual(duplicate, first); assert.equal(f.calls.start, 1);
  assert.equal((await f.service.list())[0].status, 'BLOCKED'); assert.notEqual(duplicate.status, 'COMPLETED');
});
test('C18 OFFLINE duplicate key remains bound after original plan is pruned', async () => {
  const f = serviceFixture(true), plan = await f.plan(), key = randomUUID(), first = await f.service.executeRequest(plan.reference, key);
  await tick(); await f.service.list(); await f.plan('B');
  assert.equal(f.service.plans.has(plan.reference), false);
  assert.deepEqual(await f.service.executeRequest(plan.reference, key), first); assert.equal(f.calls.start, 1);
});
test('C18 OFFLINE context failure is cached, not silently retried when context recovers', async () => {
  const f = serviceFixture(), plan = await f.plan(), key = randomUUID(); f.setFailContext(true);
  await assert.rejects(() => f.service.executeRequest(plan.reference, key), /context unavailable/); const context = f.calls.context;
  f.setFailContext(false); await assert.rejects(() => f.service.executeRequest(plan.reference, key), /context unavailable/);
  assert.equal(f.calls.context, context); assert.equal(f.calls.start, 0);
});
test('C18 OFFLINE UNKNOWN_EFFECT remains unknown and neither duplicate nor new key replays START', async () => {
  const f = serviceFixture(), plan = await f.plan(), key = randomUUID(); f.loseResponse();
  const first = await f.service.executeRequest(plan.reference, key); await tick();
  assert.equal((await f.service.list())[0].status, 'UNKNOWN_EFFECT');
  assert.deepEqual(await f.service.executeRequest(plan.reference, key), first);
  await assert.rejects(async () => f.service.executeRequest(plan.reference, randomUUID()), e => e.code === 'PLAN_REPLAYED');
  assert.equal(f.calls.start, 1); assert.equal((await f.service.list())[0].status, 'UNKNOWN_EFFECT');
});
test('C18 OFFLINE settled key TTL does not remove plan anti-replay', async () => {
  const f = serviceFixture(true), plan = await f.plan(), key = randomUUID();
  await f.service.executeRequest(plan.reference, key); await tick(); await f.service.list();
  f.advance(300001); await assert.rejects(async () => f.service.executeRequest(plan.reference, key), e => e.code === 'PLAN_REPLAYED');
  assert.equal(f.calls.start, 1);
});
test('C18 OFFLINE cache capacity rejects new admission, retains duplicate, and releases expired settled entries', async () => {
  const f = serviceFixture(true); let firstPlan, firstKey, firstReply;
  for (let i = 0; i < 100; i++) {
    const plan = await f.plan(), key = randomUUID(), reply = await f.service.executeRequest(plan.reference, key);
    await tick(); await f.service.list(); if (!i) { firstPlan = plan; firstKey = key; firstReply = reply; }
  }
  assert.equal(f.service.executeRequests.size, 100); const extra = await f.plan();
  assert.throws(() => f.service.executeRequest(extra.reference, randomUUID()), e => e.code === 'REQUEST_CACHE_FULL');
  assert.equal(f.calls.start, 100); assert.deepEqual(await f.service.executeRequest(firstPlan.reference, firstKey), firstReply);
  f.advance(300001); const fresh = await f.plan(); await f.service.executeRequest(fresh.reference, randomUUID());
  await tick(); assert.equal(f.calls.start, 101); assert.equal(f.service.executeRequests.size, 1);
});
test('C18 OFFLINE pending entries never expire or evict, even past TTL at capacity', async () => {
  const f = serviceFixture(), plan = await f.plan(), gate = f.holdContext(), key = randomUUID();
  const calls = [f.service.executeRequest(plan.reference, key)];
  for (let i = 1; i < 100; i++) calls.push(f.service.executeRequest(plan.reference, randomUUID()));
  const settled = Promise.allSettled(calls);
  try {
    await tick(); assert.equal(f.service.executeRequests.size, 100); f.advance(300001);
    const duplicate = f.service.executeRequest(plan.reference, key); duplicate.catch(() => {});
    assert.throws(() => f.service.executeRequest(plan.reference, randomUUID()), e => e.code === 'REQUEST_CACHE_FULL');
    assert.equal(f.calls.start, 0); assert.equal(f.service.executeRequests.size, 100);
  } finally { gate.resolve(); await settled; }
  // The plan expired while pending; no START may occur after releasing the context read.
  assert.equal(f.calls.start, 0);
});
test('C18 OFFLINE process/service replacement cannot reuse a cached key as execution authorization', async () => {
  const f = serviceFixture(), plan = await f.plan(), key = randomUUID(); await f.service.executeRequest(plan.reference, key); await tick();
  const replacement = new UnifiedAgentService(f.adapters);
  assert.throws(() => replacement.executeRequest(plan.reference, key), e => e.code === 'PLAN_UNAVAILABLE'); assert.equal(f.calls.start, 1);
});

function childrenText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(childrenText).join('');
  return typeof node === 'object' ? childrenText(node.props?.children) : String(node);
}
function findButton(node, label) {
  if (Array.isArray(node)) { for (const child of node) { const result = findButton(child, label); if (result) return result; } }
  else if (node && typeof node === 'object') {
    if (node.type === 'button' && childrenText(node) === label) return node;
    return findButton(node.props?.children, label);
  }
}
async function withPanel(run) {
  const originals = { fetch: global.fetch, setInterval: global.setInterval, clearInterval: global.clearInterval };
  const slots = [], effects = []; let cursor = 0, dirty = false, output, hold, reject = false;
  const posts = [], plan = { reference: randomUUID(), source: 'read battery', deviceId: 'A', physicalId: 'physical-A', engine: 'V2',
    expiresAt: Date.now() + 85000, summary: 'Read battery', steps: ['Read battery'], confirmations: [], reason: 'Offline fixture', catalog: [] };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { value: { current: initial } }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((d,j) => !Object.is(d,slots[i].deps[j]))) { slots[i] = { deps }; effects.push(() => { slots[i].cleanup = effect(); }); } },
  };
  const file = path.join(root, 'components/commands/UnifiedAgentPanel.tsx'), previousLoad = Module._load;
  delete require.cache[file]; Module._load = function(name, parent, main) {
    if (name === 'react' && parent?.filename === file) return hooks;
    return previousLoad.call(this, name, parent, main);
  };
  let panel; try { panel = require(file).UnifiedAgentPanel; } finally { Module._load = previousLoad; }
  const props = { text: plan.source, serial: 'A', devices: [device('A')], selectedDeviceIds: [], onText() {}, onSerial() {}, onRefresh() {},
    runtime: { tasks: [], ownerTestModes: [], command: async () => assert.fail('No runtime command') } };
  const render = () => { let attempts = 0; do { dirty = false; cursor = 0; output = panel(props); assert.ok(++attempts < 20); } while (dirty); for (const e of effects.splice(0)) e(); };
  global.setInterval = () => 1; global.clearInterval = () => {};
  global.fetch = async (url, options) => {
    assert.equal(url, '/api/unified-agent');
    if (!options?.body) return Response.json({ executions: [] });
    const body = JSON.parse(options.body); posts.push(body);
    if (body.type === 'ANALYZE') return Response.json({ plan });
    assert.equal(body.type, 'EXECUTE'); if (hold) await hold.promise;
    if (reject) throw Error('Offline transport failure');
    return Response.json({ execution: { id: randomUUID(), plan, status: 'QUEUED' } });
  };
  const fixture = { posts, plan, render, get output() { return output; }, button: label => findButton(output, label),
    async settle() { await tick(); render(); await tick(); render(); },
    hold() { hold = deferred(); return hold; }, fail() { reject = true; } };
  try { render(); fixture.button('Ph\u00e2n t\u00edch').props.onClick(); await fixture.settle(); await run(fixture); }
  finally { for (const slot of slots) slot?.cleanup?.(); Object.assign(global, originals); delete require.cache[file]; }
}
test('C18 OFFLINE component one Execute click calls fetch once with UUID and locks button synchronously', () => withPanel(async f => {
  const gate = f.hold(), button = f.button('Th\u1ef1c thi'); assert.equal(button.props.disabled, false);
  try {
    button.props.onClick(); button.props.onClick(); // Stale same-turn handler cannot bypass the in-flight lock.
    f.render(); assert.equal(f.button('Th\u1ef1c thi').props.disabled, true);
    await tick(); const posts = f.posts.filter(p => p.type === 'EXECUTE'); assert.equal(posts.length, 1);
    assert.equal(ClientRequestId.safeParse(posts[0].clientRequestId).success, true); assert.equal(posts[0].reference, f.plan.reference);
    assert.deepEqual(Object.keys(posts[0]).sort(), ['clientRequestId', 'reference', 'type']);
  } finally { gate.resolve(); await f.settle(); }
  assert.equal(f.posts.filter(p => p.type === 'EXECUTE').length, 1);
}));
test('C18 OFFLINE component never auto-retries failure; a new explicit click gets a fresh UUID', () => withPanel(async f => {
  f.fail(); f.button('Th\u1ef1c thi').props.onClick(); await f.settle(); await f.settle();
  assert.equal(f.posts.filter(p => p.type === 'EXECUTE').length, 1); assert.equal(f.button('Th\u1ef1c thi').props.disabled, false);
  f.button('Th\u1ef1c thi').props.onClick(); await f.settle(); const calls = f.posts.filter(p => p.type === 'EXECUTE');
  assert.equal(calls.length, 2); assert.notEqual(calls[0].clientRequestId, calls[1].clientRequestId);
  for (const call of calls) assert.equal(ClientRequestId.safeParse(call.clientRequestId).success, true);
}));
