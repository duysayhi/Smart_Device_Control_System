/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { RecoveryManager } = require('../lib/android/agent/recovery.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { runAgent, policyForAgentAction } = require('../lib/android/agent/agent-loop.ts');
const { ruleDecision } = require('../lib/android/agent/decision-engine.ts');
const { AgentMemory } = require('../lib/android/agent/memory.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const pkg = 'com.android.chrome';
function scene(kind = 'ready', overrides = {}) {
  const base = { packageName: pkg, resourceId: '', text: '', description: '', className: 'android.view.View',
    bounds: [10, 80, 390, 160], enabled: true, displayed: true, clickable: false, focused: false };
  const nodes = kind === 'dialog' ? [{ ...base, className: 'android.app.Dialog', text: 'Information' }] :
    kind === 'loading' ? [{ ...base, className: 'android.widget.ProgressBar' }] :
    kind === 'empty' ? [] : [{ ...base, description: 'Search', resourceId: pkg + ':id/url_bar', clickable: true }];
  const snapshotId = randomUUID();
  return { snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: 'OBSERVED',
    deviceSerial: 'simulated', viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })), ...overrides };
}
function setup(limits = {}) {
  const budget = new AgentBudget(limits);
  const goal = buildGoal('Open Chrome search Python', { app: 'chrome', operation: 'SEARCH', query: 'Python', resultType: 'browser', isSensitive: false }, budget);
  goal.subgoals[0].status = 'VERIFIED'; goal.currentSubgoal = 1;
  const manager = new RecoveryManager(), events = [];
  return { budget, goal, manager, events, next: s => manager.next(goal, s, budget, r => events.push(r)) };
}
test('SIMULATION: popup suspends parent, independently verifies removal and preserves criteria', () => {
  const t = setup(), criteria = JSON.stringify(t.goal.subgoals);
  assert.equal(t.next(scene('dialog')).action.key, 'BACK');
  assert.equal(t.manager.summary().parentStatus, 'SUSPENDED');
  assert.equal(t.manager.active.triggerSnapshotId.length > 0, true);
  assert.equal(t.next(scene()), undefined);
  assert.equal(t.manager.history[0].status, 'COMPLETED');
  assert.ok(t.manager.history[0].verificationSnapshotId);
  assert.equal(t.manager.summary().parentStatus, 'RUNNING');
  assert.equal(JSON.stringify(t.goal.subgoals), criteria);
});
test('SIMULATION: unexpected foreground restores only the authorized app', () => {
  const t = setup(), outside = scene('empty', { foregroundPackage: 'other.app' });
  const decision = t.next(outside); assert.equal(decision.action.app, 'chrome');
  policyForAgentAction(t.goal, decision.action, outside);
  assert.equal(t.next(scene()), undefined); assert.equal(t.manager.history[0].status, 'COMPLETED');
});
test('SIMULATION: missing control is observed again without a mutation, then resumes when present', () => {
  const t = setup(); assert.equal(t.next(scene('empty')).type, 'OBSERVE_AGAIN');
  assert.equal(t.manager.history.length, 0);
  assert.equal(t.next(scene('empty')).action.type, 'WAIT_FOR');
  assert.equal(t.manager.active.objective, 'WAIT_READY');
  assert.equal(t.next(scene()), undefined);
});
test('SIMULATION: nested popup during loading resumes child then parent with one shared budget', () => {
  const t = setup(); t.next(scene('loading'));
  const parent = t.manager.active; t.next(scene('dialog'));
  assert.equal(parent.status, 'SUSPENDED'); assert.equal(t.manager.active.parentSubtaskId, parent.subtaskId);
  t.next(scene());
  assert.deepEqual(t.manager.history.map(task => task.status), ['COMPLETED', 'COMPLETED']);
  assert.equal(t.budget.counters.recoverySubtasks, 2); assert.equal(t.goal.currentSubgoal, 1);
  assert.equal(t.manager.history[1].parentGoalId, t.goal.id);
});
test('SIMULATION: unchanged popup is never BACKed twice; duplicate evidence is bounded', () => {
  const t = setup(), s = scene('dialog'); t.next(s);
  assert.equal(t.next({ ...s, snapshotId: randomUUID() }).type, 'REQUEST_HUMAN_ASSISTANCE');
  assert.equal(t.manager.history[0].status, 'BLOCKED');
  assert.equal(t.next(s).type, 'REQUEST_HUMAN_ASSISTANCE');
  assert.equal(t.manager.history.length, 1);
});
test('SIMULATION: depth/count/attempt limits and deadline do not reset parent budget', () => {
  const t = setup({ recoveryDepth: 1 }); t.next(scene('loading'));
  assert.equal(t.next(scene('dialog')).type, 'REQUEST_HUMAN_ASSISTANCE');
  const zero = setup({ recoverySubtasks: 0 }); assert.equal(zero.next(scene('dialog')), undefined);
  const timed = setup(); timed.next(scene('loading')); timed.manager.active.createdAt -= 16000;
  assert.equal(timed.next(scene()).type, 'REQUEST_HUMAN_ASSISTANCE');
  assert.equal(timed.manager.history[0].status, 'BLOCKED');
  const attempts = setup(); attempts.next(scene('loading')); attempts.next(scene('loading'));
  assert.equal(attempts.next(scene('loading')).type, 'REQUEST_HUMAN_ASSISTANCE');
  const expired = setup(); Object.defineProperty(expired.budget, 'started', { value: performance.now() - 300000 });
  assert.throws(() => expired.next(scene('dialog')), /time budget/);
  assert.throws(() => new AgentBudget({ recoveryDepth: 3 }));
});
test('SIMULATION: stale evidence, sensitive text descendants, CAPTCHA and unsaved input are denied', () => {
  const t = setup(); t.next(scene('loading'));
  assert.equal(t.next(scene('dialog', { timestamp: Date.now() - 10000 })).type, 'REQUEST_HUMAN_ASSISTANCE');
  for (const label of ['Delete account', 'CAPTCHA']) {
    const a = setup(), s = scene('dialog'); s.nodes.push({ ...s.nodes[0], className: 'android.widget.TextView', text: label });
    assert.equal(a.next(s).category, 'SENSITIVE_ACTION');
    assert.throws(() => policyForAgentAction(a.goal, { type: 'PRESS_KEY', key: 'BACK' }, s));
  }
  const a = setup(), s = scene('dialog');
  s.nodes.push({ ...s.nodes[0], className: 'android.widget.EditText', text: 'unsaved', focused: true });
  assert.equal(a.next(s).type, 'REQUEST_HUMAN_ASSISTANCE');
});
test('SIMULATION: recovery cannot hide a failed parent mutation and authorize its replay', () => {
  const t = setup(), memory = new AgentMemory();
  memory.actions.push({ action: { type: 'CLICK', target: 'address_bar' }, verification: 'FAILED' },
    { action: { type: 'PRESS_KEY', key: 'BACK' }, verification: 'VERIFIED', recoverySubtaskId: randomUUID() });
  assert.equal(ruleDecision(t.goal, scene(), memory).type, 'REQUEST_HUMAN_ASSISTANCE');
});
test('SIMULATION integration: parent -> popup recovery -> fresh resume -> independently verified completion', async () => {
  const t = setup(), events = [], actions = []; let state = 'dialog', closed = 0, decisions = 0;
  const execution = { backend: 'appium', async observe() { t.budget.recordSnapshot(); return scene(state); }, discoveryMemory() {},
    async execute(action) { actions.push(action); state = 'ready'; return { verification: 'VERIFIED', postcondition: 'Layer removed' }; }, async close() { closed++; } };
  // This fixture uses an independently evaluated foreground criterion, not a model success claim.
  t.goal.subgoals[1].criterion = { kind: 'FOREGROUND', packageName: pkg };
  const decision = { async decide(goal) {
    decisions++; assert.equal(state, 'ready');
    return { type: goal.currentSubgoal < goal.subgoals.length ? 'COMPLETE_SUBGOAL' : 'COMPLETE_GOAL', reason: 'Check fresh criterion' };
  } };
  const out = await runAgent(t.goal, t.budget, execution, decision, undefined, e => events.push(e));
  assert.equal(out.result.status, 'COMPLETED'); assert.equal(closed, 1); assert.equal(actions.length, 1);
  assert.equal(out.memory.recovery.history[0].status, 'COMPLETED'); assert.ok(decisions > 0);
  assert.ok(events.some(e => e.recovery?.parentStatus === 'SUSPENDED'));
  assert.equal(t.budget.counters.steps, 1); assert.ok(t.budget.counters.snapshots >= 3);
});
test('SIMULATION integration: cancellation stops the entire tree before dispatch and isolates another execution', async () => {
  const t = setup(), other = setup(), controller = new AbortController(); let sent = 0, closed = 0;
  other.next(scene('loading'));
  const out = await runAgent(t.goal, t.budget, { backend: 'appium', observe: async () => scene('dialog'), discoveryMemory() {},
    async execute() { sent++; }, async close() { closed++; } }, undefined, controller.signal,
  e => { if (e.status === 'EXECUTING') controller.abort(); });
  assert.equal(out.result.status, 'CANCELLED'); assert.equal(sent, 0); assert.equal(closed, 1);
  assert.equal(out.result.recovery.history[0].status, 'CANCELLED'); assert.equal(other.manager.active.status, 'RUNNING');
});
for (const code of ['DEVICE_ERROR', 'SESSION_ERROR']) test(`SIMULATION integration: ${code} cannot complete recovery`, async () => {
  const t = setup(); let closed = 0;
  const out = await runAgent(t.goal, t.budget, { backend: 'appium', observe: async () => scene('dialog'), discoveryMemory() {},
    async execute() { throw new AndroidExecutionError(code, 'Device unavailable'); }, async close() { closed++; } });
  assert.equal(out.result.status, 'FAILED'); assert.equal(out.result.recovery.history[0].status, 'FAILED'); assert.equal(closed, 1);
});
test('SIMULATION: Dashboard renders actual recovery events, escapes UI text and shows parent resume', () => {
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f,
  }).outputText, f);
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { RecoveryProgressView } = require('../components/commands/AgentGoalPanel.tsx');
  const t = setup(); t.next(scene('dialog'));
  t.manager.history[0].description = '<script>untrusted UI</script>';
  const render = () => renderToStaticMarkup(React.createElement(RecoveryProgressView, { recovery: t.manager.summary() }));
  assert.match(render(), /SUSPENDED/); assert.match(render(), /RUNNING/); assert.doesNotMatch(render(), /<script>/);
  t.next(scene()); assert.match(render(), /COMPLETED/); assert.match(render(), /RUNNING/);
  assert.equal(renderToStaticMarkup(React.createElement(RecoveryProgressView, { recovery: new RecoveryManager().summary() })), '');
});
test('SIMULATION: maximum three distinct obstacles and inherited action scope are enforced', () => {
  const t = setup();
  for (let i = 0; i < 3; i++) {
    const s = scene('dialog'); s.nodes[0].text = 'Information ' + i;
    assert.equal(t.next(s).action.key, 'BACK'); t.next(scene());
  }
  const fourth = scene('dialog'); fourth.nodes[0].text = 'Information 4';
  assert.equal(t.next(fourth).type, 'REQUEST_HUMAN_ASSISTANCE');
  assert.equal(t.manager.history.length, 3);
  const scoped = setup(); scoped.goal.allowedActionScope = ['OPEN_APP'];
  assert.equal(scoped.next(scene('dialog')).type, 'REQUEST_HUMAN_ASSISTANCE');
  assert.equal(scoped.manager.history.length, 0);
});
test('SIMULATION integration: recovery revalidates the candidate and never BACKs a disappeared layer', async () => {
  const t = setup(); let reads = 0, sent = 0;
  const out = await runAgent(t.goal, t.budget, { backend: 'appium', async observe() { return scene(++reads === 1 ? 'dialog' : 'ready'); },
    discoveryMemory() {}, async execute() { sent++; }, async close() {} },
  { decide: async () => ({ type: 'FAIL_GOAL', reason: 'End stale recovery check' }) });
  assert.equal(sent, 0); assert.equal(out.result.status, 'FAILED');
  assert.equal(out.result.recovery.history[0].status, 'COMPLETED');
});
