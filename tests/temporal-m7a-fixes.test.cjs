/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const ui = require('../lib/android/agent/temporal-ui.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { readTemporalUiInventory } = require('../lib/android/agent/temporal-ui-inventory.ts');
const { runTemporalUi } = require('../lib/android/agent/temporal-ui-runner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { GroundedInteractionFailure } = require('../lib/android/grounded-interactions.ts');
const pkg = 'org.generic.temporal';

function scene(nodes) {
  const snapshotId = randomUUID();
  nodes = nodes.map((n, i) => ({ text: '', description: '', resourceId: '', packageName: pkg,
    className: 'android.widget.TextView', displayed: true, enabled: true, clickable: false, focused: false,
    bounds: [10, 10 + i * 20, 390, 25 + i * 20], ...n }));
  return { deviceSerial: 'device', snapshotId, timestamp: Date.now(), observedAt: new Date().toISOString(),
    observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'UNKNOWN', foregroundPackage: pkg,
    viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}
function form(values = [0, 2, 0], summary) {
  const nodes = [{ className: 'android.widget.LinearLayout', description: summary || '', bounds: [0, 0, 400, 700] }];
  for (const [i, unit] of ['Hours', 'Minutes', 'Seconds'].entries()) {
    const parentIndex = nodes.length, left = 10 + i * 125;
    nodes.push({ className: 'android.widget.NumberPicker', parentIndex: 0, bounds: [left, 50, left + 110, 600] });
    nodes.push({ text: String(values[i]).padStart(2, '0') + ', ' + unit,
      className: 'android.widget.EditText', parentIndex, bounds: [left, 110, left + 110, 160] });
  }
  nodes.push({ text: 'Start', className: 'android.widget.Button', clickable: true, bounds: [10, 750, 390, 800] });
  return scene(nodes);
}
function inventory(kind = 'TIMER') {
  return ui.sealTemporalUiInventory({ deviceId: 'device', packageName: pkg, sessionId: 'session', kind,
    zone: 'Asia/Bangkok', observedAt: Date.now(), monotonicMs: performance.now(), snapshots: [randomUUID()], rows: [] });
}
function fixture() {
  const executionId = randomUUID(), source = 'Set a timer for 2 minutes';
  const node = compileOutcomes(source, 'device', executionId).nodes[0]; node.packageName = pkg;
  const scope = ui.beginTemporalUi(node, inventory(), executionId, source);
  return { source, node, executionId, scope };
}
function candidate(f, view, phase) {
  ui.setTemporalUiPhase(f.scope, phase);
  const candidates = generateGroundedCandidates(f.node, view, f.executionId, 'session', false, 0, '', false, undefined, false, undefined, f.scope).candidates;
  assert.equal(candidates.length, 1); return candidates[0];
}

for (const summary of ['0 Hours 0 Minutes 1 Second', '0 Gi\u1edd 0 Ph\u00fat 1 Gi\u00e2y', '0 hours, 0 minutes, 1 second']) {
  test('M7a timer rejects conflicting enclosing duration: ' + summary, () => {
    const f = fixture(), view = form([0, 2, 0], summary);
    assert.equal(ui.temporalFormExact(f.scope, view), false);
    ui.setTemporalUiPhase(f.scope, 'COMMIT');
    assert.deepEqual(ui.temporalUiSteps(f.scope, view), []);
  });
}
test('M7a timer accepts matching composite values and widgets with no composite description', () => {
  const f = fixture();
  for (const summary of [undefined, '0 Hours 2 Minutes 0 Seconds']) {
    const view = form([0, 2, 0], summary);
    assert.equal(ui.temporalFormExact(f.scope, view), true);
    ui.setTemporalUiPhase(f.scope, 'COMMIT');
    assert.equal(ui.temporalUiSteps(f.scope, view).length, 1);
  }
});
test('M7a unrelated duration descriptions cannot bind to the picker', () => {
  const f = fixture(), view = form();
  view.nodes.push({ ...view.nodes[0], description: '0 Hours 0 Minutes 1 Second', parentIndex: undefined });
  assert.equal(ui.temporalFormExact(f.scope, view), true);
});
test('M7a field transition rejects editor-only echo when enclosing picker disagrees', () => {
  const f = fixture(), c = candidate(f, form([0, 0, 1], '0 Hours 0 Minutes 1 Second'), 'MINUTE');
  assert.equal(ui.temporalUiTransition(c, form([0, 2, 1], '0 Hours 0 Minutes 1 Second')), false);
  assert.equal(ui.temporalUiTransition(c, form([0, 2, 1], '0 Hours 2 Minutes 1 Second')), true);
});
test('M7a changed composite description revokes a previously grounded Start before dispatch', () => {
  const f = fixture(), view = form([0, 2, 0], '0 Hours 2 Minutes 0 Seconds');
  const c = candidate(f, view, 'COMMIT'), grant = issueEffectGrant(c, f.node);
  consumeEffectGrant(grant, 'device', 'session');
  assert.throws(() => ui.beforeTemporalUiDispatch(c, form([0, 2, 0], '0 Hours 0 Minutes 1 Second')), /FORM_CHANGED/);
});
test('M7a runner stops before Start for inconsistent editor readback', async () => {
  const f = fixture(); let commits = 0;
  await assert.rejects(runTemporalUi({ ...f, execution: {
    sessionId: () => 'session', temporalUiInventoryV2: async () => inventory(),
    interactV2: async () => { commits++; throw Error('Start must not be sent'); },
  }, budget: new AgentBudget(), fresh: async () => form([0, 2, 0], '0 Hours 0 Minutes 1 Second'),
  confirm: async () => {}, registerJournal() {}, emit() {} }), /FORM_READBACK_MISMATCH/);
  assert.equal(commits, 0);
});

function list(times = ['00:15', '06:00'], selected = true) {
  const nodes = [{ className: 'android.widget.ListView', bounds: [0, 50, 400, 700] }];
  for (const [i, text] of times.entries()) {
    const parentIndex = nodes.length, y = 60 + i * 170;
    nodes.push({ className: 'android.view.ViewGroup', parentIndex: 0, bounds: [0, y, 400, y + 150] });
    nodes.push({ text, parentIndex, bounds: [10, y + 20, 170, y + 80] });
    nodes.push({ className: 'android.widget.Switch', parentIndex, checked: false, checkable: true,
      clickable: true, bounds: [300, y + 20, 390, y + 80] });
  }
  nodes.push({ className: 'androidx.generic.Tab', description: 'Alarm Tab 1 of 4.', selected,
    clickable: true, bounds: [0, 750, 190, 810] });
  nodes.push({ className: 'androidx.generic.Tab', description: 'World clock Tab 2 of 4.', selected: !selected,
    clickable: true, bounds: [200, 750, 390, 810] });
  return scene(nodes);
}
function scan({ changeBefore, changeAfter, foreignDevice, pages = [['00:15', '06:00']] } = {}) {
  let reads = 0, gestures = 0, page = 0;
  const session = { serial: 'device', sessionId: 'session', path: '/session/session', async ensureActive() {}, async assertPhysicalIdentity() {},
    client: { async request(method, route, data) {
      assert.equal(data.script, 'mobile: scrollGesture'); gestures++;
      if (data.args[0].direction === 'up') return false;
      page = Math.min(page + 1, pages.length - 1); return page < pages.length - 1;
    } } };
  const observer = { async readNativeSnapshot() {
    reads++;
    const view = list(pages[page], !(changeBefore && reads === 2 || changeAfter && gestures >= 1));
    if (foreignDevice && reads === 2) view.deviceSerial = 'other';
    return view;
  } };
  const run = async args => ({ stdout: args.includes('policy') ? 'screenState=SCREEN_STATE_ON mIsShowing=false' : 'Asia/Bangkok', stderr: '' });
  return { read: () => readTemporalUiInventory(session, observer, run, pkg, { kind: 'ALARM', hour: 7, minute: 0 }), gestures: () => gestures };
}
test('M7a alarm rejects same-package tab drift before any scroll', async () => {
  const f = scan({ changeBefore: true });
  await assert.rejects(f.read(), /UI_INVENTORY_TAB_CHANGED/); assert.equal(f.gestures(), 0);
});
test('M7a alarm rejects same-package tab drift immediately after scroll', async () => {
  const f = scan({ changeAfter: true });
  await assert.rejects(f.read(), /UI_INVENTORY_TAB_CHANGED/); assert.equal(f.gestures(), 1);
});
test('M7a alarm rejects a fresh snapshot from another device before scrolling', async () => {
  const f = scan({ foreignDevice: true });
  await assert.rejects(f.read(), /UI_INVENTORY_FOREIGN_OR_STALE/); assert.equal(f.gestures(), 0);
});
test('M7a alarm still requires continuity even when native scrolling reports bottom', async () => {
  const f = scan({ pages: [['00:15', '06:00'], ['08:00', '09:00']] });
  await assert.rejects(f.read(), /UI_LIST_CONTINUITY_UNPROVEN: page=1 previousRows=2 currentRows=2/);
});
test('M7a alarm preserves native termination plus overlapping-row inventory', async () => {
  const f = scan({ pages: [['00:15', '06:00'], ['06:00', '08:00']] });
  const result = await f.read(); assert.equal(ui.issuedTemporalUiInventory(result), true);
  assert.deepEqual(result.rows.map(r => [r.hour, r.minute]), [[0, 15], [6, 0], [8, 0]]);
  assert.equal(f.gestures(), 2);
});

const countdown = text => scene([{ text }, { text: 'Pause', className: 'android.widget.Button', clickable: true }]);
test('M7a unknown Start is sent once and needs independent decreasing running evidence', async () => {
  const f = fixture(); let commits = 0, started;
  const fresh = async () => commits ? countdown('01:' + String(59 - Math.floor((performance.now() - started) / 1000)).padStart(2, '0')) : form();
  const execution = { sessionId: () => 'session', temporalUiInventoryV2: async () => inventory(), async interactV2(grant) {
    consumeEffectGrant(grant, 'device', 'session'); ui.beforeTemporalUiDispatch(grant.candidate, await fresh());
    assert.equal(grant.candidate.temporal.phase, 'COMMIT'); commits++; started = performance.now();
    throw new GroundedInteractionFailure('UNKNOWN', 'RPC', Error('lost Start response'));
  } };
  const proof = await runTemporalUi({ ...f, execution, budget: new AgentBudget(), fresh,
    confirm: async () => {}, registerJournal() {}, emit() {} });
  assert.equal(commits, 1); assert.equal(proof.tier, 'UI_RUNNING_READBACK');
  assert.ok(proof.remaining[1] < proof.remaining[0]); assert.equal(ui.isTemporalUiProof(proof), true);
});
test('M7a absent running countdown blocks at the readback deadline without Start replay', async () => {
  const f = fixture(), budget = new AgentBudget(); let commits = 0;
  const remaining = budget.remaining.bind(budget);
  budget.remaining = () => commits ? 0 : remaining();
  const execution = { sessionId: () => 'session', temporalUiInventoryV2: async () => inventory(), async interactV2(grant) {
    consumeEffectGrant(grant, 'device', 'session'); ui.beforeTemporalUiDispatch(grant.candidate, form());
    assert.equal(grant.candidate.temporal.phase, 'COMMIT'); commits++;
    return form();
  } };
  await assert.rejects(runTemporalUi({ ...f, execution, budget, fresh: async () => form(),
    confirm: async () => {}, registerJournal() {}, emit() {} }), /UI_TIMER_RUNNING_DECREASE_UNVERIFIED: no running countdown observed/);
  assert.equal(commits, 1);
});
test('M7a unchanged countdown never verifies or authorizes another Start', async () => {
  const f = fixture(), view = form(), c = candidate(f, view, 'COMMIT'); ui.beforeTemporalUiDispatch(c, view);
  const a = countdown('02:00'); ui.noteTemporalTimerRead(f.scope, a);
  await delay(1100); const b = countdown('02:00'); ui.noteTemporalTimerRead(f.scope, b);
  assert.throws(() => ui.verifyTemporalUi(f.scope, a, b), /UI_TIMER_RUNNING_DECREASE_UNVERIFIED/);
  assert.throws(() => ui.setTemporalUiPhase(f.scope, 'COMMIT'), /REPLAY/);
});
