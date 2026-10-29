/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { OwnerTestPolicy, assertOwnerTestExecution, ownerEffectAllowed, destructiveTestIntent } = require('../lib/android/agent/owner-test-policy.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant, assertEffectGrantAuthorization } = require('../lib/android/agent/effect-grants.ts');
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const { RuntimeCommand } = require('../lib/android/agent/runtime-schema.ts');
const noAI = { generate() { throw Error('No model needed'); } }, pkg = 'org.unprofiled.display';
function snapshot(checked = false, label = 'Show labels') {
  const snapshotId = randomUUID(), n = { text: label, description: '', hint: '', resourceId: pkg + ':id/labels', packageName: pkg, className: 'android.widget.Switch', enabled: true,
    clickable: true, checkable: true, checked, selected: false, focused: false, displayed: true, bounds: [0, 50, 350, 120] };
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: 'OBSERVED', viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes: [n], elements: [{ ...n, elementId: snapshotId + ':0' }] };
}
function fixture(options = {}) {
  const events = []; let checked = false, actions = 0, closed = 0;
  const adapter = { catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) }, open: async () => ({ backend: 'appium', sessionId: () => 'S',
    observe: async () => snapshot(checked), execute: async () => {}, close: async () => { closed++; }, interactV2: async grant => {
      options.beforeDispatch?.(); consumeEffectGrant(grant, 'A', 'S'); actions++; checked = options.wrongState ? false : grant.candidate.desired; return snapshot(checked);
    } }) };
  return { adapter, events, get actions() { return actions; }, get closed() { return closed; } };
}
function scope(policy = new OwnerTestPolicy()) { policy.enable('A', 'physical-a'); return { policy, authorization: policy.bind('A', 'physical-a', 'exec-a') }; }
const goal = 'Mo ' + pkg + ' va bat Show labels';

test('owner authorization is explicit, process-issued, physical/execution/device bound, expiring and revocable', () => {
  const { policy, authorization } = scope();
  assert.doesNotThrow(() => assertOwnerTestExecution(authorization, 'A', 'physical-a', 'exec-a'));
  for (const args of [[{ ...authorization }, 'A', 'physical-a', 'exec-a'], [authorization, 'B', 'physical-a', 'exec-a'], [authorization, 'A', 'other', 'exec-a'], [authorization, 'A', 'physical-a', 'other']]) assert.throws(() => assertOwnerTestExecution(...args));
  assert.throws(() => policy.bind('B', 'physical-a', 'exec-b'));
  assert.equal(new OwnerTestPolicy().list().length, 0, 'restart does not restore authorization from JSON');
  const unaudited = new OwnerTestPolicy();
  assert.throws(() => unaudited.enable('A', 'physical-a', () => { throw Error('Audit unavailable'); }));
  assert.equal(unaudited.list().length, 0, 'audit failure cannot expose active authority');
  policy.disable('A', authorization.id);
  assert.throws(() => assertOwnerTestExecution(authorization, 'A', 'physical-a', 'exec-a'));
  assert.deepEqual(policy.history().map(e => e.event), ['ENABLED', 'BOUND', 'DISABLED']);
  const next = scope(), oldNow = Date.now;
  try { Date.now = () => next.authorization.expiresAt + 1; assert.throws(() => assertOwnerTestExecution(next.authorization, 'A', 'physical-a', 'exec-a')); assert.equal(next.policy.list().length, 0); }
  finally { Date.now = oldNow; }
});

test('owner mode removes effect confirmation only; normal V2 still requires it and wrong outcome never completes', async () => {
  for (const enabled of [false, true]) {
    const f = fixture(), auth = enabled ? scope().authorization : undefined;
    const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
    await runAgentV2(goal, 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, event => {
      f.events.push(event);
      if (event.v2?.assistance) { assert.equal(enabled, false); const a = event.v2.assistance; submitAssistanceV2({ token: a.token, deviceId: 'A', executionId: 'exec-a', approved: true, choice: a.choices[0].id }); }
    }, undefined, noAI, auth);
    assert.equal(f.events.at(-1).status, 'COMPLETED'); assert.equal(f.actions, 1); assert.equal(f.closed, 1);
    assert.equal(f.events.filter(e => e.status === 'NEED_HUMAN_ASSISTANCE').length, enabled ? 0 : 1);
    if (enabled) assert.ok(f.events.some(e => e.reason.includes('scoped effect approval')));
  }
  const f = fixture({ wrongState: true });
  await runAgentV2(goal, 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI, scope().authorization);
  assert.equal(f.events.at(-1).status, 'BLOCKED'); assert.equal(f.actions, 1);
});

test('revocation between fresh observation and dispatch prevents writes, including already-consumed grants', async () => {
  const auth = scope(), f = fixture({ beforeDispatch: () => auth.policy.disable('A', auth.authorization.id) });
  await runAgentV2(goal, 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI, auth.authorization);
  assert.equal(f.actions, 0); assert.equal(f.events.at(-1).status, 'BLOCKED'); assert.equal(f.closed, 1);
  const next = scope(), node = compileOutcomes(goal, 'A', 'exec-a').nodes[1]; node.packageName = pkg;
  const candidate = generateGroundedCandidates(node, snapshot(), 'exec-a', 'S', false).candidates[0];
  const grant = issueEffectGrant(candidate, node, next.authorization); consumeEffectGrant(grant, 'A', 'S');
  next.policy.disable('A', next.authorization.id);
  assert.throws(() => assertEffectGrantAuthorization(grant));
  assert.throws(() => consumeEffectGrant(grant, 'A', 'S'));
});

test('destructive goals and observed destructive controls are denied, never expanded by owner consent', async () => {
  for (const action of ['Delete photos', 'Uninstall app', 'Factory reset', 'Format storage', 'Overwrite note', 'Xóa dữ liệu', 'pm clear package', 'Remove account']) {
    assert.equal(destructiveTestIntent(action), true, action);
    const f = fixture(); await runAgentV2(action, 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI, scope().authorization);
    assert.equal(f.actions, 0); assert.equal(f.closed, 0); assert.equal(f.events.at(-1).status, 'BLOCKED');
  }
  assert.equal(destructiveTestIntent('tao record title "Delete", body "Do not remove this text"'), false);
  const auth = scope().authorization;
  for (const label of ['Delete', 'Remove', 'Clear data', 'Overwrite', 'Format', 'Xóa']) {
    const node = compileOutcomes('Mo ' + pkg + ' va chon ' + label, 'A', 'exec-a').nodes[1]; node.packageName = pkg;
    const s = snapshot(false, label); s.nodes[0].checkable = false; s.nodes[0].className = 'android.widget.Button'; s.nodes[0].resourceId = pkg + ':id/menu_item';
    assert.equal(generateGroundedCandidates(node, s, 'exec-a', 'S', false).candidates.length, 0);
    assert.equal(ownerEffectAllowed(auth, node.outcome, 'A', 'physical-a', 'exec-a'), false);
  }
});

test('unfamiliar generic menu commands need navigation evidence even with owner authorization', () => {
  const node = compileOutcomes('Mo ' + pkg + ' va chon Prepare device', 'A', 'exec-a').nodes[1]; node.packageName = pkg;
  const s = snapshot(false, 'Prepare device'); s.nodes[0].checkable = false; s.nodes[0].className = 'android.widget.Button'; s.nodes[0].resourceId = pkg + ':id/menu_item';
  const legacyCandidates = generateGroundedCandidates(node, s, 'exec-a', 'S', false).candidates;
  assert.equal(legacyCandidates.length, 1);
  assert.equal(generateGroundedCandidates(node, s, 'exec-a', 'S', false, 0, '', false, undefined, true).candidates.length, 0);
  assert.throws(() => issueEffectGrant(legacyCandidates[0], node, scope().authorization));
});

test('expected owner physical identity is checked before Appium creation even if transport serial is reused', async () => {
  const { ManagedAppiumSession } = require('../lib/android/appium/session-manager.ts');
  let rpc = 0, verify = 0;
  const otherHardware = '[ro.serialno]: [DIFFERENT01]\n[ro.boot.serialno]: [DIFFERENT01]\n[ro.product.manufacturer]: [Example]\n[ro.product.model]: [ModelB]';
  const session = new ManagedAppiumSession({ request: async () => { rpc++; throw Error('Must not create Session'); } }, 'A', async args => ({ stdout: args.includes('get-state') ? 'device' : otherHardware, stderr: '' }), async () => { verify++; }, undefined, 'physical-a');
  await assert.rejects(session.open(), /physical device changed before Session creation/);
  assert.equal(rpc, 0); assert.equal(verify, 0);
});

test('runtime validates selected physical identity and V2 opt-in; restart never restores authority', async () => {
  const device = { serial: 'A', physicalId: 'physical-a', identityVerified: true, status: 'device', connectionType: 'USB' };
  const f = fixture(), registry = new DeviceRuntimeRegistry({ discover: async () => [device], v2: () => f.adapter });
  const command = { type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'physical-a', enabled: true };
  await assert.rejects(registry.setOwnerTestMode({ ...command, physicalId: 'foreign' }));
  assert.equal(RuntimeCommand.safeParse({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal, ownerAuthorizedTest: true }] }).success, false);
  const start = () => registry.start({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal: 'Mo ' + pkg, agentVersion: 2, ownerAuthorizedTest: true }] });
  await assert.rejects(start()); await registry.setOwnerTestMode(command);
  const [task] = await start(); await registry.settled(task.executionId);
  assert.equal(registry.list()[0].status, 'COMPLETED'); assert.ok(task.ownerTestMode);
  const mode = registry.ownerTestModes()[0];
  assert.equal(await registry.setOwnerTestMode({ ...command, enabled: false, authorizationId: mode.id }), true);
  await assert.rejects(start());
  const restored = new DeviceRuntimeRegistry({ discover: async () => [device] }); restored.restore(registry.persisted());
  assert.equal(restored.ownerTestModes().length, 0);
});

test('disabling mode cancels an active owner execution but leaves another device waiting for technical assistance', async () => {
  const devices = ['A', 'B'].map(serial => ({ serial, physicalId: 'physical-' + serial.toLowerCase(), identityVerified: true, status: 'device', connectionType: 'USB' }));
  let opens = 0;
  const registry = new DeviceRuntimeRegistry({ discover: async () => devices, v2: () => ({ readiness: async () => 'UNLOCK_REQUIRED', catalog: { resolve: async () => { throw Error('Must not discover locked phone'); } }, open: async () => { opens++; throw Error('Must not open Session'); } }) });
  await registry.setOwnerTestMode({ type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'physical-a', enabled: true });
  const tasks = await registry.start({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal: 'Mo ' + pkg, agentVersion: 2, ownerAuthorizedTest: true }, { deviceId: 'B', goal: 'Mo ' + pkg, agentVersion: 2 }] });
  try {
    for (let i = 0; i < 100 && !registry.list().every(t => t.status === 'WAITING_HUMAN'); i++) await new Promise(r => setImmediate(r));
    assert.equal(registry.list().every(t => t.status === 'WAITING_HUMAN'), true);
    assert.equal(registry.list()[0].latest.v2.assistance.category, 'DEVICE_UNLOCK', 'owner consent must not fake technical readiness');
    const mode = registry.ownerTestModes()[0];
    await registry.setOwnerTestMode({ type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'physical-a', enabled: false, authorizationId: mode.id });
    await registry.settled(tasks[0].executionId);
    assert.equal(registry.list()[0].status, 'CANCELLED');
    assert.equal(registry.list()[1].status, 'WAITING_HUMAN'); assert.equal(opens, 0);
  } finally { await registry.shutdown(); }
});

test('worker HTTP checks identity/origin, persists audit, and restarts with owner mode OFF', async () => {
  const { startWorker } = require('../lib/android/agent/worker-server.ts'), path = require('node:path'), os = require('node:os'), p = require('node:fs/promises');
  const directory = await p.mkdtemp(path.join(os.tmpdir(), 'owner-policy-http-'));
  const adapter = { discover: async () => [{ serial: 'A', physicalId: 'physical-a', identityVerified: true, status: 'device', connectionType: 'USB' }] };
  let worker = await startWorker({ directory, adapter });
  try {
    const address = JSON.parse(await p.readFile(path.join(directory, 'address.json'), 'utf8'));
    const url = 'http://127.0.0.1:' + address.port, headers = { Authorization: 'Bearer ' + address.token, 'Content-Type': 'application/json' };
    const input = { type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'physical-a', enabled: true };
    const post = body => fetch(url + '/tasks', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await fetch(url + '/tasks', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: JSON.stringify(input) })).status, 403);
    assert.equal((await post({ ...input, physicalId: 'foreign' })).status, 409);
    assert.equal((await post(input)).status, 200);
    const state = await (await fetch(url + '/tasks', { headers })).json(); assert.equal(state.ownerTestModes.length, 1);
    const rows = (await p.readFile(path.join(directory, 'owner-test-policy-audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows[0].event, 'ENABLED'); assert.equal(rows[0].accepted, true); assert.equal(rows[0].deviceId, 'A');
    await worker.shutdown(); worker = await startWorker({ directory, adapter });
    assert.equal(worker.registry.ownerTestModes().length, 0);
  } finally {
    await worker.shutdown();
    for (const file of ['tasks.json', 'owner-test-policy-audit.jsonl']) await p.unlink(path.join(directory, file)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await p.rmdir(directory);
  }
});

test('Dashboard owner-mode control exposes explicit on/off and device scope without changing V1 default', () => {
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, fileName: f }).outputText, f);
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { OwnerTestModeControl, AgentGoalPanel } = require('../components/commands/AgentGoalPanel.tsx');
  const off = renderToStaticMarkup(React.createElement(OwnerTestModeControl, { disabled: false, onChange() {} }));
  assert.match(off, /role="switch"/); assert.doesNotMatch(off, /checked=""/);
  const on = renderToStaticMarkup(React.createElement(OwnerTestModeControl, { disabled: false, mode: scope().authorization, onChange() {} }));
  assert.match(on, /checked=""/); assert.match(on, />A /);
  const panel = renderToStaticMarkup(React.createElement(AgentGoalPanel, { text: goal, onText() {}, devices: [], serial: 'A', onSerial() {}, onRefresh() {}, selectedDeviceIds: [], runtime: { tasks: [], command: async () => {} } }));
  assert.doesNotMatch(panel, /role="switch"/); assert.match(panel, /Agent V1/);
});
