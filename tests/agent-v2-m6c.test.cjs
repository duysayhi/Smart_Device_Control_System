/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { parseTemporal } = require('../lib/android/agent/temporal-contract.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const ui = require('../lib/android/agent/temporal-ui.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { runTemporalUi } = require('../lib/android/agent/temporal-ui-runner.ts');
const { GroundedInteractionFailure } = require('../lib/android/grounded-interactions.ts');
const { readTemporalUiInventory } = require('../lib/android/agent/temporal-ui-inventory.ts');
const pkg = 'org.unprofiled.time';
function scene(nodes) {
  const id = randomUUID();
  nodes = nodes.map((n, i) => ({ text: '', description: '', resourceId: '', packageName: pkg, className: 'android.widget.TextView', displayed: true, enabled: true, clickable: false, focused: false, bounds: [10, 10 + i * 25, 390, 30 + i * 25], ...n }));
  return { deviceSerial: 'A', snapshotId: id, timestamp: Date.now(), observedAt: new Date().toISOString(), observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'UNKNOWN', foregroundPackage: pkg, viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: id + ':' + i })) };
}
function form(kind, values = [0, 0, 0], range24 = true) {
  const nodes = [{ className: kind === 'ALARM' ? 'android.widget.TimePicker' : 'android.widget.LinearLayout', bounds: [0, 0, 400, 700] }];
  for (const [i, unit] of (kind === 'ALARM' ? ['Hours', 'Minutes'] : ['Hours', 'Minutes', 'Seconds']).entries()) {
    const parentIndex = nodes.length, left = 10 + i * 125; nodes.push({ className: 'android.widget.NumberPicker', parentIndex: 0, bounds: [left, 50, left + 110, 600] });
    nodes.push({ text: (i === 0 && range24 ? '23' : '05') + ', ' + unit, className: 'android.widget.Button', parentIndex, bounds: [left, 60, left + 110, 100] });
    nodes.push({ text: String(values[i]).padStart(2, '0') + ', ' + unit, className: 'android.widget.EditText', parentIndex, resourceId: 'android:id/numberpicker_input', bounds: [left, 110, left + 110, 160] });
  }
  nodes.push({ text: kind === 'ALARM' ? 'Save' : 'Start', clickable: true, className: 'android.widget.Button', bounds: [10, 750, 390, 800] });
  return scene(nodes);
}
const oldRows = [{ hour: 6, minute: 0, enabled: false, label: '' }];
function inventory(kind, rows = oldRows, overrides = {}) { return ui.sealTemporalUiInventory({ deviceId: 'A', packageName: pkg, sessionId: 'S', kind, zone: 'Asia/Bangkok', observedAt: Date.now(), monotonicMs: performance.now(), snapshots: [randomUUID()], rows: kind === 'ALARM' ? rows : [], ...overrides }); }
function fixture(kind = 'ALARM') {
  const executionId = randomUUID(), source = kind === 'ALARM' ? 'Set an alarm for 7 AM' : 'Set a timer for 10 minutes', node = compileOutcomes(source, 'A', executionId).nodes[0]; node.packageName = pkg;
  const before = inventory(kind), scope = ui.beginTemporalUi(node, before, executionId, source); return { source, node, before, scope, executionId };
}
function candidate(f, s, phase) { ui.setTemporalUiPhase(f.scope, phase); const c = generateGroundedCandidates(f.node, s, f.executionId, 'S', false, 0, '', false, undefined, false, undefined, f.scope).candidates; assert.equal(c.length, 1); return c[0]; }
function created(f) {
  const s = scene([{ text: 'Add alarm', className: 'android.widget.Button', clickable: true }]), c = candidate(f, s, 'CREATE');
  ui.beforeTemporalUiDispatch(c, s); ui.temporalUiAcknowledged(c);
}
for (const [text, expected] of [
  ['đặt báo thức 7 giờ sáng', ['ALARM', 7, 0]], ['đặt báo thức 3:30 chiều', ['ALARM', 15, 30]],
  ['báo thức lúc 6 rưỡi sáng', ['ALARM', 6, 30]], ['bao thuc luc 6 ruoi sang', ['ALARM', 6, 30]],
  ['hẹn giờ 10 phút', ['TIMER', 600]], ['báo tôi sau 5 phút', ['TIMER', 300]], ['bao toi sau 5 phut', ['TIMER', 300]],
  ['set an alarm for 6:45 PM', ['ALARM', 18, 45]], ['set a timer for 1 hour 20 minutes', ['TIMER', 4800]],
  ['dat bao thuc 6:45 PM', ['ALARM', 18, 45]], ['set a timer for 1 gio 20 minutes', ['TIMER', 4800]],
]) test('M6c source-exact natural phrasing: ' + text, () => {
  const r = parseTemporal(text).request; assert.deepEqual(r.kind === 'ALARM' ? [r.kind, r.hour, r.minute] : [r.kind, r.seconds], expected);
  assert.deepEqual(compileOutcomes(text, 'A', 'E').nodes[0].outcome.temporal, r);
});
for (const text of ['bao thuc luc 6 ruoi sang tomorrow', 'báo thức lúc 6 rưỡi sáng mỗi ngày', 'bao toi sau 5 phut tomorrow', 'hen gio -5 phut', 'hen gio 0 phut', 'dat bao thuc 25 gio sang']) test('M6c unsupported qualifiers/values remain blocked: ' + text, () => assert.ok(parseTemporal(text).issue));
test('M6c ambiguous 3:30 emits one minimal question with default suggestion and no device effect', async () => {
  const events = [], executionId = 'ambiguous-' + randomUUID(); let opens = 0;
  await runAgentV2('đặt báo thức 3:30', 'A', executionId, 'P', new AgentBudget(), { catalog: {}, open() { opens++; throw Error('must not open'); } }, e => {
    events.push(e); const a = e.v2?.assistance;
    if (a) submitAssistanceV2({ token: a.token, deviceId: 'A', executionId, approved: false, choice: 'am' });
  }, undefined, { generate() { throw Error('no model needed'); } });
  const questions = events.filter(e => e.v2?.assistance?.category === 'FIELD_AMBIGUITY'); assert.equal(questions.length, 1);
  assert.equal(questions[0].v2.assistance.choices.length, 2); assert.match(questions[0].v2.assistance.choices[0].label, /suggested/);
  assert.equal(opens, 0); assert.equal(events.at(-1).status, 'BLOCKED');
});
test('M6c shared picker resource IDs resolve by unit and parent structure, not index/package', () => {
  const f = fixture('TIMER'), s = form('TIMER'); const c = candidate(f, s, 'MINUTE');
  assert.equal(c.value, '10'); assert.equal(ui.pickerRole(s, c.target.index), 'MINUTE');
  assert.equal(ui.temporalUiCandidateAllowed({ ...c }), false); assert.equal(ui.temporalUiCandidateAllowed(c, f.node), true);
});
test('M6c missing period/range evidence blocks alarm before field writes', () => {
  const f = fixture(); created(f); ui.setTemporalUiPhase(f.scope, 'HOUR');
  assert.throws(() => ui.temporalUiSteps(f.scope, form('ALARM', [6, 0], false)), /TIME_FORMAT_UNPROVEN/);
});
test('M6c native 24h range evidence survives value change only for unchanged structure', () => {
  const f = fixture(); created(f); assert.equal(ui.alarmFormat(f.scope, form('ALARM')), '24');
  assert.equal(ui.alarmFormat(f.scope, form('ALARM', [7, 0], false)), '24');
  const moved = form('ALARM', [7, 0], false); moved.nodes[3].bounds[1] += 100; assert.equal(ui.alarmFormat(f.scope, moved), undefined);
});
test('M6c 12h AM/PM must expose a unique selected period', () => {
  const f = fixture(); created(f); const s = form('ALARM', [7, 0], false);
  s.nodes.push({ ...s.nodes.at(-1), text: 'AM', selected: true }, { ...s.nodes.at(-1), text: 'PM', selected: false });
  s.elements.push({ elementId: 'am' }, { elementId: 'pm' }); assert.equal(ui.alarmFormat(f.scope, s), '12'); assert.equal(ui.temporalFormExact(f.scope, s), true);
  s.nodes.at(-1).selected = true; assert.equal(ui.alarmFormat(f.scope, s), undefined);
});
test('M6c duplicate time precondition and malformed/stale inventories cannot open new editor', () => {
  const f = fixture(); assert.throws(() => ui.beginTemporalUi(f.node, inventory('ALARM', [...oldRows, { hour: 7, minute: 0, enabled: false, label: '' }]), 'E', f.source), /DUPLICATE_TIME/);
  assert.throws(() => ui.temporalUiPrecondition({ ...f.before }, f.node.outcome.temporal), /STALE_UI_INVENTORY/);
  assert.throws(() => inventory('ALARM', oldRows, { observedAt: Date.now() - 6000 }), /STALE_UI_INVENTORY/);
});
for (const [name, rows, expected] of [
  ['zero new', oldRows, 'NEW_ROW_COUNT_NOT_ONE'],
  ['two new', [...oldRows, { hour: 7, minute: 0, enabled: true, label: '' }, { hour: 8, minute: 0, enabled: true, label: '' }], 'NEW_ROW_COUNT_NOT_ONE'],
  ['old switch changed', [{ ...oldRows[0], enabled: true }, { hour: 7, minute: 0, enabled: true, label: '' }], 'OLD_ROW_CHANGED'],
  ['new disabled', [...oldRows, { hour: 7, minute: 0, enabled: false, label: '' }], 'NEW_ROW_VALUE_MISMATCH'],
]) test('M6c independent alarm delta rejects ' + name, () => assert.equal(ui.alarmDeltaReason(oldRows, rows, fixture().node.outcome.temporal, ''), expected));
test('M6c new-only proof requires two fresh distinct complete inventories and authentic commit', () => {
  const f = fixture(); created(f); const s = form('ALARM', [7, 0]); const c = candidate(f, s, 'COMMIT');
  const grant = issueEffectGrant(c, f.node); consumeEffectGrant(grant, 'A', 'S'); ui.beforeTemporalUiDispatch(c, s);
  const rows = [...oldRows, { hour: 7, minute: 0, enabled: true, label: '' }], a = inventory('ALARM', rows), b = inventory('ALARM', rows);
  assert.throws(() => ui.verifyTemporalUi(f.scope, a, a), /REUSED/);
  const proof = ui.verifyTemporalUi(f.scope, a, b); assert.equal(proof.tier, 'UI_LIST_READBACK'); assert.equal(ui.isTemporalUiProof(proof), true); assert.equal(ui.isTemporalUiProof({ ...proof }), false);
  assert.throws(() => ui.setTemporalUiPhase(f.scope, 'COMMIT'), /REPLAY/); assert.throws(() => ui.beforeTemporalUiDispatch(c, s), /REPLAY/);
  assert.throws(() => ui.beginTemporalUi(f.node, inventory('ALARM'), f.executionId, f.source), /ALREADY_ATTEMPTED/);
});
test('M6c stale UI and changed form cannot authorize Save', () => {
  const f = fixture(); created(f); const s = form('ALARM', [7, 0]), c = candidate(f, s, 'COMMIT');
  assert.throws(() => ui.beforeTemporalUiDispatch(c, { ...s, timestamp: Date.now() - 6000 }), /FORM_CHANGED/);
  s.nodes[6].text = '40, Minutes'; assert.throws(() => ui.beforeTemporalUiDispatch(c, s), /FORM_CHANGED/);
});
test('M6c RTC_WAKEUP alone never becomes new-alarm/system clock evidence', () => {
  const f = fixture(); created(f); const s = form('ALARM', [7, 0]), c = candidate(f, s, 'COMMIT'); ui.beforeTemporalUiDispatch(c, s);
  const rows = [...oldRows, { hour: 7, minute: 0, enabled: true, label: '' }], p = ui.verifyTemporalUi(f.scope, inventory('ALARM', rows), inventory('ALARM', rows));
  assert.equal(ui.corroborateTemporalUi(p, 'RTC_WAKEUP when=07:00').systemCorroboration, undefined);
});
test('M6c unknown Save is never replayed; polling may find independent late evidence', async () => {
  const f = fixture(); let values = [0, 0], phase = 'list', saved = false, commits = 0;
  const execution = { sessionId: () => 'S', async temporalUiInventoryV2() { return inventory('ALARM', saved ? [...oldRows, { hour: 7, minute: 0, enabled: true, label: '' }] : oldRows); },
    async interactV2(g) { consumeEffectGrant(g, 'A', 'S'); const c = g.candidate, s = await fresh(); ui.beforeTemporalUiDispatch(c, s);
      if (c.temporal.phase === 'CREATE') { phase = 'form'; ui.temporalUiAcknowledged(c); }
      else if (c.temporal.phase === 'HOUR') values[0] = Number(c.value);
      else if (c.temporal.phase === 'COMMIT') { saved = true; commits++; throw new GroundedInteractionFailure('UNKNOWN', 'RPC', Error('lost reply')); }
      return fresh(); } };
  const fresh = async () => phase === 'list' ? scene([{ text: 'Add alarm', clickable: true, className: 'android.widget.Button' }]) : form('ALARM', values);
  const proof = await runTemporalUi({ source: f.source, node: f.node, executionId: f.executionId, execution, budget: new AgentBudget(), fresh, confirm: async () => {}, registerJournal() {}, emit() {} });
  assert.equal(commits, 1); assert.equal(proof.tier, 'UI_LIST_READBACK');
});
function countdown(text = '10:00', control = 'Pause') { return scene([{ text, className: 'android.widget.TextView' }, { text: control, className: 'android.widget.Button', clickable: true }]); }
test('M6c timer running readback decreases with independently measured monotonic time', async () => {
  const f = fixture('TIMER'), s = form('TIMER', [0, 10, 0]), c = candidate(f, s, 'COMMIT'); ui.beforeTemporalUiDispatch(c, s);
  const a = countdown(); ui.noteTemporalTimerRead(f.scope, a);
  await new Promise(r => setTimeout(r, 1200)); const b = countdown('09:59'); ui.noteTemporalTimerRead(f.scope, b);
  const proof = ui.verifyTemporalUi(f.scope, a, b); assert.equal(proof.tier, 'UI_RUNNING_READBACK'); assert.deepEqual(proof.remaining, [600, 599]);
  assert.throws(() => ui.setTemporalUiPhase(f.scope, 'COMMIT'), /REPLAY/);
});
for (const [name, text, control] of [['paused', '09:59', 'Resume'], ['unchanged', '10:00', 'Pause'], ['wrong duration', '11:00', 'Pause'], ['finished', '00:00', 'Pause']]) test('M6c timer cannot complete with ' + name, async () => {
  const f = fixture('TIMER'), s = form('TIMER', [0, 10, 0]), c = candidate(f, s, 'COMMIT'); ui.beforeTemporalUiDispatch(c, s);
  const a = countdown(); ui.noteTemporalTimerRead(f.scope, a); const b = countdown(text, control); ui.noteTemporalTimerRead(f.scope, b);
  assert.throws(() => ui.verifyTemporalUi(f.scope, a, b), /UNVERIFIED/);
});
test('M6c stale or ambiguous remaining time is not running evidence', () => {
  assert.equal(ui.runningTimer({ ...countdown(), timestamp: Date.now() - 6000 }), undefined);
  assert.equal(ui.runningTimer(scene([{ text: '09:59' }, { text: '10:00' }, { text: 'Pause', clickable: true }])), undefined);
});
test('M6c UI candidates remain node/session bound and cannot request a destructive control', () => {
  const f = fixture('TIMER'), s = form('TIMER'), c = candidate(f, s, 'MINUTE');
  assert.throws(() => issueEffectGrant({ ...c, value: '55' }, f.node));
  assert.throws(() => issueEffectGrant(c, { ...f.node, id: 'foreign' }));
  const g = issueEffectGrant(c, f.node); assert.throws(() => consumeEffectGrant(g, 'B', 'S'));
  const forgedNode = structuredClone(f.node); forgedNode.outcome.temporal.seconds = 300;
  assert.throws(() => ui.beginTemporalUi(forgedNode, inventory('TIMER'), randomUUID(), f.source), /not source-bound/);
  const changed = form('TIMER', [0, 10, 0]); changed.nodes.at(-1).className = 'android.widget.Switch'; changed.nodes.at(-1).checkable = true; changed.nodes.at(-1).checked = false;
  ui.setTemporalUiPhase(f.scope, 'COMMIT'); assert.deepEqual(ui.temporalUiSteps(f.scope, changed), []);
});
function listScene(options = {}) {
  const nodes = [{ className: 'android.widget.ListView', bounds: [0, 50, 400, 700] }];
  for (const [i, text] of ['00:15', '06:00'].entries()) {
    const parentIndex = nodes.length, y = 60 + i * 220;
    nodes.push({ className: 'android.view.ViewGroup', parentIndex: 0, bounds: [0, y, 400, y + 190] });
    nodes.push({ text, parentIndex, bounds: [10, y + 30, 170, y + 90] });
    nodes.push({ className: 'android.widget.Switch', parentIndex, checked: false, checkable: true, clickable: true, bounds: [300, y + 30, 390, y + 90] });
  }
  nodes.push({ className: 'androidx.action.Tab', description: 'Alarm Tab 1 of 4.', selected: true, clickable: true, bounds: [0, 750, 390, 810] });
  if (options.occluded) nodes.push({ text: 'Foreign action', clickable: true, packageName: 'org.other', bounds: [10, 100, 300, 300] });
  return scene(nodes);
}
function nativeInventoryFixture(options = {}) {
  const calls = [], session = { serial: 'A', sessionId: 'S', path: '/session/S', async ensureActive() {}, async assertPhysicalIdentity() {}, client: { async request(method, route, data) { calls.push({ method, route, data }); return options.termination; } } };
  const observer = { async readNativeSnapshot() { return listScene(options); } };
  const run = async args => ({ stdout: args.includes('policy') ? options.locked ? 'screenState=SCREEN_STATE_OFF mIsShowing=true' : 'screenState=SCREEN_STATE_ON mIsShowing=false' : 'Asia/Bangkok', stderr: '' });
  return { calls, session, observer, run };
}
test('M6c native complete inventory requires both native top/bottom termination and accounts scrolls', async () => {
  const f = nativeInventoryFixture({ termination: false }); let scrolls = 0;
  const v = await readTemporalUiInventory(f.session, f.observer, f.run, pkg, fixture().node.outcome.temporal, undefined, { beforeScroll() { scrolls++; } });
  assert.equal(ui.issuedTemporalUiInventory(v), true); assert.equal(v.rows.length, 2); assert.equal(scrolls, 2);
  assert.deepEqual(f.calls.map(c => c.data.args[0].direction), ['up', 'down']);
  assert.ok(f.calls.every(c => c.data.script === 'mobile: scrollGesture'));
});
for (const [name, options, reason] of [
  ['no termination evidence', {}, /EXHAUSTION_UNPROVEN/], ['top never reached', { termination: true }, /TOP_BUDGET/],
  ['foreign overlay', { termination: false, occluded: true }, /OCCLUDED/], ['keyguard', { locked: true }, /DEVICE_LOCKED/],
]) test('M6c native UI inventory blocks ' + name + ' without data write', async () => {
  const f = nativeInventoryFixture(options);
  await assert.rejects(readTemporalUiInventory(f.session, f.observer, f.run, pkg, fixture().node.outcome.temporal), reason);
  assert.ok(f.calls.every(c => c.data.script === 'mobile: scrollGesture'));
});
