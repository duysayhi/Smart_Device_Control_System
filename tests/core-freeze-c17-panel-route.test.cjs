/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file,
}).outputText, file);
const device = (serial = 'A', status = 'device', physicalId = 'physical-' + serial) => ({
  serial, physicalId, identityVerified: true, status, model: 'SIM-' + serial, connectionType: 'USB',
});
const tick = () => new Promise(setImmediate);

// Execute the production hook/component with in-memory hook slots and its real JSX handlers.
// This is an offline state-transition test, not a browser or React DOM acceptance run.
function hookHarness(relative, exportName, initialProps = {}) {
  const slots = [], effects = new Map(); let cursor = 0, dirty = false, output, props = initialProps;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(slots[index].value, value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { value: { current: initial } }; return slots[index].value; },
    useEffect(effect, deps) {
      const index = cursor++; if (changed(slots[index]?.deps, deps)) effects.set(index, { effect, deps });
    },
    useCallback(callback, deps) {
      const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { value: callback, deps }; return slots[index].value;
    },
  };
  const file = path.join(root, relative), load = Module._load;
  delete require.cache[file];
  Module._load = function(name, parent, main) {
    if (name === 'react' && parent?.filename === file) return hooks;
    return load.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, main);
  };
  let component;
  try { component = require(file)[exportName]; } finally { Module._load = load; }
  function render(next) {
    if (next) props = { ...props, ...next };
    let attempts = 0;
    do {
      dirty = false; cursor = 0; output = component(props);
      assert.ok(++attempts < 20, 'offline hook render must converge');
    } while (dirty);
    for (const [index, pending] of effects) {
      slots[index]?.cleanup?.();
      slots[index] = { deps: pending.deps, cleanup: pending.effect() };
    }
    effects.clear(); return output;
  }
  return { render, get output() { return output; }, async settle() { await tick(); render(); await tick(); render(); },
    close() { for (const slot of slots) slot?.cleanup?.(); } };
}
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function find(node, predicate, result = []) {
  if (Array.isArray(node)) { for (const child of node) find(child, predicate, result); }
  else if (node && typeof node === 'object') { if (predicate(node)) result.push(node); find(node.props?.children, predicate, result); }
  return result;
}
function button(h, label) {
  const matches = find(h.output, node => node.type === 'button' && text(node) === label);
  assert.equal(matches.length, 1, 'button ' + label); return matches[0];
}
async function withEnvironment(run) {
  const original = { fetch: global.fetch, setInterval: global.setInterval, clearInterval: global.clearInterval, now: Date.now };
  let now = 1000000, timer = 0;
  global.setInterval = () => ++timer; global.clearInterval = () => {}; Date.now = () => now;
  const closers = [];
  try { await run({ advance: ms => { now += ms; }, close: h => { closers.push(h); return h; } }); }
  finally { for (const h of closers) h.close(); global.fetch = original.fetch; global.setInterval = original.setInterval; global.clearInterval = original.clearInterval; Date.now = original.now; }
}
function panelFixture(env) {
  const posts = [], plans = new Map();
  const props = { text: 'Mở YouTube', serial: 'A', devices: [device()], selectedDeviceIds: [],
    onText(value) { props.text = value; }, onSerial(value) { props.serial = value; }, onRefresh() {},
    runtime: { tasks: [], ownerTestModes: [], command: async () => assert.fail('No runtime mutation allowed') } };
  let holdAnalysis;
  global.fetch = async (url, options) => {
    assert.equal(url, '/api/unified-agent');
    if (!options?.body) return Response.json({ executions: [] });
    const body = JSON.parse(options.body); posts.push(body);
    if (body.type === 'ANALYZE' || body.type === 'REANALYZE') {
      const source = body.input?.source ?? plans.get(body.reference)?.source;
      const serial = body.input?.deviceId ?? plans.get(body.reference)?.deviceId;
      const plan = { reference: randomUUID(), source, deviceId: serial, physicalId: 'physical-' + serial, engine: 'V2',
        expiresAt: Date.now() + 85000, summary: source, steps: [source], confirmations: [], reason: 'Offline fake preparation', catalog: [] };
      plans.set(plan.reference, plan);
      if (holdAnalysis && body.type === 'ANALYZE') await holdAnalysis.promise;
      return Response.json({ plan });
    }
    assert.fail('Unexpected execute, grant or assistance dispatch');
  };
  const h = env.close(hookHarness('components/commands/UnifiedAgentPanel.tsx', 'UnifiedAgentPanel', props)); h.render();
  return { h, props, posts, plans,
    async analyze() { button(h, 'Phân tích').props.onClick(); await h.settle(); },
    update(next) { Object.assign(props, next); h.render(props); },
    hold() { let resolve; const promise = new Promise(r => { resolve = r; }); holdAnalysis = { promise, resolve }; return resolve; },
  };
}

test('C17 OFFLINE component: A offline/B READY disables Execute and reanalysis, never posts to B', () => withEnvironment(async env => {
  const f = panelFixture(env); await f.analyze(); assert.equal(button(f.h, 'Thực thi').props.disabled, false);
  f.update({ devices: [device('A', 'offline'), device('B')] });
  assert.equal(button(f.h, 'Thực thi').props.disabled, true);
  assert.equal(button(f.h, 'Phân tích').props.disabled, true);
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, true);
  assert.match(text(f.h.output), /Thiết bị đã mất kết nối; chọn lại thiết bị và phân tích lại/);
  assert.doesNotMatch(text(f.h.output), /Kế hoạch hết hạn/);
  button(f.h, 'Thực thi').props.onClick(); button(f.h, 'Phân tích lại kế hoạch').props.onClick(); await f.h.settle();
  assert.deepEqual(f.posts.map(p => p.type), ['ANALYZE']);
  assert.equal(f.posts.some(p => p.input?.deviceId === 'B'), false);
}));

test('C17 OFFLINE component: recovery keeps old plan invalid until explicit reanalysis issues a fresh reference', () => withEnvironment(async env => {
  const f = panelFixture(env); await f.analyze(); const first = [...f.plans.keys()][0];
  f.update({ devices: [device('A', 'offline')] });
  f.update({ devices: [device()] });
  assert.equal(button(f.h, 'Thực thi').props.disabled, true);
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, false);
  button(f.h, 'Thực thi').props.onClick(); await f.h.settle(); assert.equal(f.posts.length, 1);
  button(f.h, 'Phân tích lại kế hoạch').props.onClick(); await f.h.settle();
  assert.deepEqual(f.posts[1], { type: 'REANALYZE', reference: first });
  assert.equal(f.plans.size, 2); assert.notEqual([...f.plans.keys()][1], first);
  assert.equal(button(f.h, 'Thực thi').props.disabled, false);
}));

test('C17 OFFLINE component: serial change cannot attach A plan to B, including switching back', () => withEnvironment(async env => {
  const f = panelFixture(env); await f.analyze();
  f.update({ serial: 'B', devices: [device(), device('B')] });
  assert.equal(button(f.h, 'Thực thi').props.disabled, true);
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, true);
  assert.match(text(f.h.output), /Kế hoạch không còn hợp lệ do đổi thiết bị/);
  button(f.h, 'Thực thi').props.onClick(); await f.h.settle(); assert.equal(f.posts.length, 1);
  f.update({ serial: 'A' }); assert.equal(button(f.h, 'Thực thi').props.disabled, true);
}));

test('C17 OFFLINE component: same-physical alias switch still requires a new serial-bound plan', () => withEnvironment(async env => {
  const f = panelFixture(env); await f.analyze();
  f.update({ serial: '192.168.50.9:5555', devices: [{ ...device(), serial: '192.168.50.9:5555', connectionType: 'Wi-Fi' }] });
  assert.equal(button(f.h, 'Thực thi').props.disabled, true);
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, true);
  assert.match(text(f.h.output), /do đổi thiết bị/); assert.equal(f.posts.length, 1);
}));

test('C17 OFFLINE component: expiry label is distinct and reanalysis is disabled when the selected device disappears', () => withEnvironment(async env => {
  const f = panelFixture(env); await f.analyze(); env.advance(86000);
  // A failed operation is unnecessary: analysis stored the original time; mount a fresh expired plan by its server response.
  const expired = [...f.plans.values()][0]; expired.expiresAt = Date.now() - 1;
  global.fetch = async (_url, options) => options?.body ? Response.json({ plan: expired }) : Response.json({ executions: [] });
  await f.analyze(); assert.match(text(f.h.output), /Kế hoạch hết hạn; phân tích lại/);
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, false);
  f.update({ devices: [] });
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, true);
  assert.match(text(f.h.output), /Thiết bị đã mất kết nối/);
  assert.match(text(f.h.output), /A - OFFLINE/);
}));

test('C17 OFFLINE component: changed physical identity and unverified identity invalidate without granting effects', () => withEnvironment(async env => {
  const f = panelFixture(env); await f.analyze();
  f.update({ devices: [device('A', 'device', 'different-physical')] });
  assert.match(text(f.h.output), /do đổi thiết bị/);
  assert.equal(button(f.h, 'Thực thi').props.disabled, true);
  f.update({ devices: [{ ...device(), identityVerified: false }] });
  assert.equal(button(f.h, 'Phân tích lại kế hoạch').props.disabled, true);
  assert.equal(f.posts.length, 1);
}));

test('C17 OFFLINE component: a delayed analysis is discarded when the selected device disconnects', () => withEnvironment(async env => {
  const f = panelFixture(env), release = f.hold();
  button(f.h, 'Phân tích').props.onClick(); f.h.render();
  f.update({ devices: [device('A', 'offline'), device('B')] });
  release(); await f.h.settle();
  assert.equal(find(f.h.output, n => n.props?.['aria-label'] === 'Kế hoạch thực hiện').length, 0);
  assert.equal(button(f.h, 'Thực thi').props.disabled, true); assert.equal(f.posts.length, 1);
}));

test('C17 OFFLINE Dashboard hook: verified history retains missing A while B stays READY and survives a discovery error', () => withEnvironment(async env => {
  let rows = [device()], fail = false;
  global.fetch = async url => { assert.equal(url, '/api/devices'); if (fail) throw Error('Fake discovery unavailable'); return Response.json({ success: true, devices: rows }); };
  const h = env.close(hookHarness('hooks/useDashboardDemo.ts', 'useDashboardDemo')); h.render(); await h.settle();
  assert.equal(h.output.selectedAndroidSerial, 'A'); rows = [device('B')];
  await h.output.refreshAndroidDevices(); h.render();
  assert.equal(h.output.selectedAndroidSerial, 'A');
  assert.equal(h.output.androidDevices.find(d => d.serial === 'A').status, 'offline');
  fail = true; await h.output.refreshAndroidDevices(); h.render();
  assert.equal(h.output.selectedAndroidSerial, 'A'); assert.match(h.output.androidDevicesError, /Fake discovery/);
}));

test('C17 OFFLINE Dashboard hook: same verified physical identity permits USB to Wi-Fi fallback', () => withEnvironment(async env => {
  let rows = [device()];
  global.fetch = async url => { assert.equal(url, '/api/devices'); return Response.json({ success: true, devices: rows }); };
  const h = env.close(hookHarness('hooks/useDashboardDemo.ts', 'useDashboardDemo')); h.render(); await h.settle();
  rows = [{ ...device(), serial: '192.168.50.9:5555', connectionType: 'Wi-Fi' }];
  await h.output.refreshAndroidDevices(); h.render(); assert.equal(h.output.selectedAndroidSerial, rows[0].serial);
}));

test('C17 OFFLINE Dashboard hook: an unobserved demo ID is discarded and multiple READY devices are not auto-selected', () => withEnvironment(async env => {
  let rows = [device(), device('B')];
  global.fetch = async url => { assert.equal(url, '/api/devices'); return Response.json({ success: true, devices: rows }); };
  const h = env.close(hookHarness('hooks/useDashboardDemo.ts', 'useDashboardDemo')); h.render(); await h.settle();
  assert.equal(h.output.selectedAndroidSerial, ''); h.output.handleAndroidDeviceChange('dev-001'); h.render();
  rows = []; await h.output.refreshAndroidDevices(); h.render(); assert.equal(h.output.selectedAndroidSerial, '');
}));

function routeFixture() {
  const calls = { context: 0, prepare: 0, start: 0 }, prepared = new Map(); let devices = [device(), device('B')];
  const load = Module._load;
  delete global.phoneCommanderUnifiedCatalog;
  const file = path.join(root, 'app/api/unified-agent/route.ts'); delete require.cache[file];
  Module._load = function(name, parent, main) {
    if (name === '@/lib/android/agent/runtime-storage') return { androidRuntimeDigest: () => 'a'.repeat(64) };
    if (name === '@/lib/android/agent/worker-client') return { workerRequest: async (method, command) => {
      if (method === 'GET') { calls.context++; return Response.json({ devices, tasks: [], ownerTestModes: [] }); }
      if (command.type === 'PREPARE') {
        calls.prepare++; assert.equal(command.engine, 'V2'); const reference = randomUUID(); prepared.set(reference, command);
        return Response.json({ reference, expiresAt: Date.now() + 90000, summary: command.source, steps: [command.source], confirmations: [] });
      }
      assert.equal(command.type, 'START_PREPARED'); calls.start++; const row = prepared.get(command.reference); assert.ok(row);
      return Response.json({ tasks: [{ executionId: randomUUID(), batchId: command.reference, request: row.source, deviceId: row.deviceId,
        physicalId: 'physical-' + row.deviceId, agentVersion: 2, createdAt: Date.now(), finishedAt: Date.now(), status: 'COMPLETED', events: [] }] });
    } };
    return load.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, main);
  };
  let route;
  try { route = require(file); } finally { Module._load = load; }
  return { calls, setDevices: next => { devices = next; }, async post(body) {
    const response = await route.POST(new Request('http://localhost:3000/api/unified-agent', { method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body.type === 'EXECUTE' ? { ...body, clientRequestId: randomUUID() } : body) }));
    return { status: response.status, value: await response.json() };
  }, close() { delete global.phoneCommanderUnifiedCatalog; } };
}

test('C17 OFFLINE production route: plan A plus client device B is rejected before any context or dispatch', async () => {
  const f = routeFixture();
  try {
    const { value: { plan } } = await f.post({ type: 'ANALYZE', input: { source: 'Mở YouTube', deviceId: 'A' } });
    const context = f.calls.context;
    const denied = await f.post({ type: 'EXECUTE', reference: plan.reference, deviceId: 'B' });
    assert.equal(denied.status, 400); assert.equal(f.calls.context, context); assert.equal(f.calls.start, 0);
    assert.equal(f.calls.prepare, 1); assert.equal(plan.deviceId, 'A');
  } finally { f.close(); }
});

test('C17 OFFLINE production route: A offline never dispatches A plan to READY B', async () => {
  const f = routeFixture();
  try {
    const { value: { plan } } = await f.post({ type: 'ANALYZE', input: { source: 'Mở YouTube', deviceId: 'A' } });
    f.setDevices([device('A', 'offline'), device('B')]);
    const denied = await f.post({ type: 'EXECUTE', reference: plan.reference });
    assert.equal(denied.status, 409); assert.match(denied.value.error, /identity is unavailable/); assert.equal(f.calls.start, 0);
  } finally { f.close(); }
});

test('C17 OFFLINE production route: physical replacement on the same serial rejects the old plan', async () => {
  const f = routeFixture();
  try {
    const { value: { plan } } = await f.post({ type: 'ANALYZE', input: { source: 'Mở YouTube', deviceId: 'A' } });
    f.setDevices([device('A', 'device', 'physical-B'), device('B')]);
    assert.equal((await f.post({ type: 'EXECUTE', reference: plan.reference })).status, 409); assert.equal(f.calls.start, 0);
  } finally { f.close(); }
});

test('C17 OFFLINE production route: reference-only execution remains bound to original A and dispatches exactly once', async () => {
  const f = routeFixture();
  try {
    const { value: { plan } } = await f.post({ type: 'ANALYZE', input: { source: 'Mở YouTube', deviceId: 'A' } });
    const accepted = await f.post({ type: 'EXECUTE', reference: plan.reference }); await tick();
    assert.equal(accepted.status, 200); assert.equal(accepted.value.execution.plan.deviceId, 'A'); assert.equal(f.calls.start, 1);
    assert.equal((await f.post({ type: 'EXECUTE', reference: plan.reference })).status, 409); assert.equal(f.calls.start, 1);
  } finally { f.close(); }
});
