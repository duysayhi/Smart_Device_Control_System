/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const ui = require('../lib/android/agent/temporal-ui.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { executeGroundedInteraction, GroundedInteractionFailure } = require('../lib/android/grounded-interactions.ts');
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const { LocalEffectJournal } = require('../lib/android/agent/local-effect-journal.ts');
const { runTemporalUi } = require('../lib/android/agent/temporal-ui-runner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const pkg = 'org.generic.clock';
const phases = ['HOUR', 'MINUTE', 'SECOND'];

function scene(nodes) {
  const snapshotId = randomUUID();
  nodes = nodes.map(n => ({ text: '', description: '', resourceId: '', packageName: pkg, enabled: true,
    className: 'android.widget.TextView', displayed: true, clickable: false, focused: false, ...n }));
  return { deviceSerial: 'device', snapshotId, timestamp: Date.now(), observationStatus: 'OBSERVED',
    source: 'APPIUM', screen: 'OBSERVED', foregroundPackage: pkg, observedAt: new Date().toISOString(),
    viewport: { x: 0, y: 0, width: 600, height: 900 }, nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}
function form(values, backing, focus) {
  const nodes = [{ className: 'android.widget.LinearLayout', description: `${backing[0]} Hours ${backing[1]} Minutes ${backing[2]} Seconds`, bounds: [0, 0, 600, 700] }];
  for (const [i, unit] of ['Hours', 'Minutes', 'Seconds'].entries()) {
    const parentIndex = nodes.length, left = 20 + i * 180;
    nodes.push({ className: 'android.widget.NumberPicker', parentIndex: 0, bounds: [left, 80, left + 150, 600] });
    nodes.push({ className: 'android.widget.EditText', text: values[i] === '' ? '' : String(values[i]).padStart(2, '0') + ', ' + unit,
      hint: unit, resourceId: pkg + ':id/shared_picker_input', parentIndex, clickable: true, focused: focus === phases[i],
      bounds: [left, 220, left + 150, 310] });
  }
  nodes.push({ text: 'Start', className: 'android.widget.Button', clickable: true, bounds: [20, 750, 580, 820] });
  return scene(nodes);
}
function inventory() {
  return ui.sealTemporalUiInventory({ deviceId: 'device', packageName: pkg, sessionId: 'session', kind: 'TIMER',
    zone: 'Asia/Bangkok', observedAt: Date.now(), monotonicMs: performance.now(), snapshots: [randomUUID()], rows: [] });
}
async function fixture(t, options = {}) {
  let wall = Date.now(); t.mock.method(Date, 'now', () => wall);
  const executionId = randomUUID(), source = 'Set a timer for 2 minutes';
  const node = compileOutcomes(source, 'device', executionId).nodes[0]; node.packageName = pkg;
  const phase = options.phase || 'MINUTE', values = options.values || [0, 0, 1];
  let backing = [...values], focus = options.initialFocus ? phase : undefined, stage = 'initial', previous, grant;
  const calls = [], effects = [], observations = [], locates = [], controller = new AbortController();
  const policy = new OwnerTestPolicy(); let owner, journal;
  if (options.owner || options.journal) {
    policy.enable('device', 'physical', undefined, { fullControl: Boolean(options.journal) });
    owner = policy.bind('device', 'physical', executionId);
    t.after(() => policy.disable('device', owner.id));
  }
  const raw = () => {
    const view = form(values, backing, focus);
    options.mutate?.(view, stage);
    if (options.reused && stage === 'typed') view.snapshotId = previous.snapshotId;
    previous = view; observations.push({ stage, view }); return view;
  };
  const before = raw(), baseline = inventory(), scope = ui.beginTemporalUi(node, baseline, executionId, source);
  ui.setTemporalUiPhase(scope, phase);
  const candidates = generateGroundedCandidates(node, before, executionId, 'session', false, 0, '', false, undefined, Boolean(owner), undefined, scope).candidates;
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  if (options.journal) {
    journal = await LocalEffectJournal.begin(owner, source, node, before, baseline);
    t.after(() => fsp.rm(join(tmpdir(), 'phone-commander-local-effects', journal.id + '.jsonl'), { force: true }));
  }
  const ticket = await journal?.prepare(candidate);
  grant = issueEffectGrant(candidate, node, owner, ticket);
  const session = { serial: 'device', sessionId: 'session', path: '/session/session', async ensureActive() {},
    client: { async request(method, route, data) {
      calls.push({ method, route, data, stage });
      if (method === 'GET') {
        if (route.endsWith('/attribute/password')) return options.password || 'false';
        assert.ok(route.endsWith('/attribute/focused'));
        if (stage === 'typed' && options.expireBeforeDone) wall = grant.expiresAt + 1;
        return options.nativeFocusFalse ? 'false' : String(focus === phase);
      }
      const effect = route.endsWith('/click') ? 'focus' : route.endsWith('/clear') ? 'clear' : route.endsWith('/value') ? 'value' : 'done';
      effects.push(effect);
      if (options.fail === effect) throw Error('lost ' + effect + ' response');
      if (effect === 'focus') { if (!options.noFocus) focus = phase; stage = 'focused'; }
      else if (effect === 'clear') values[phases.indexOf(phase)] = '';
      else if (effect === 'value') {
        values[phases.indexOf(phase)] = options.wrongEcho ? 9 : Number(data.text); stage = 'typed';
        if (options.expireAfterType) wall = grant.expiresAt + 1;
        if (options.revokeAfterType) policy.disable('device', owner.id);
      } else {
        assert.equal(data.script, 'mobile: performEditorAction'); assert.deepEqual(data.args, [{ action: 'done' }]);
        if (!options.stuckBacking) backing = [...values]; focus = undefined; stage = 'done';
      }
      if (options.abortAfter === effect) controller.abort();
      return null;
    } } };
  const observer = { async readNativeSnapshot() { return raw(); }, async locate(view, target, clickable) {
    const index = view.elements.findIndex(e => 'element:' + e.elementId === target);
    assert.ok(index >= 0); const role = ui.pickerRole(view, index); assert.equal(role, phase);
    locates.push({ stage, clickable, snapshotId: view.snapshotId });
    if (options.locateMissing && stage === 'typed') return false;
    const id = options.replaced && stage === 'typed' ? 'replacement' : 'native-' + role;
    return { id, node: view.nodes[index], snapshot: view,
      interaction: clickable && !options.unsafeFocus ? { method: 'ELEMENT_CLICK', evidence: [] } : undefined };
  }, async waitUntil(condition) {
    const view = raw(), result = await condition(view);
    if (!result) throw Error('TEMPORAL_PARENT_CONSISTENCY_UNVERIFIED'); return result;
  } };
  return { source, node, executionId, candidate, scope, grant, journal, session, observer, effects, calls, observations, locates,
    run: () => executeGroundedInteraction(session, observer, grant, controller.signal) };
}

test('M7a numeric editor focuses, writes, freshly binds focus/value, and sends Done once', async t => {
  const f = await fixture(t); const after = await f.run();
  assert.deepEqual(f.effects, ['focus', 'clear', 'value', 'done']);
  assert.deepEqual(f.locates.map(l => l.clickable), [true, false, false]);
  assert.equal(new Set(f.locates.map(l => l.snapshotId)).size, 3);
  assert.equal(ui.temporalUiTransition(f.candidate, after), true);
  assert.equal(ui.temporalFormExact(f.scope, after), false); // Seconds still need their own requested edit.
});
for (const [phase, values] of [['HOUR', [1, 2, 0]], ['SECOND', [0, 2, 1]]]) test('M7a numeric editor protocol is role-bound for ' + phase, async t => {
  const f = await fixture(t, { phase, values }); await f.run();
  assert.deepEqual(f.effects, ['focus', 'clear', 'value', 'done']);
});
test('M7a already focused exact numeric field needs no focus click', async t => {
  const f = await fixture(t, { initialFocus: true }); await f.run();
  assert.deepEqual(f.effects, ['clear', 'value', 'done']);
});
test('M7a an unsafe focus target cannot receive even the focus click', async t => {
  const f = await fixture(t, { unsafeFocus: true });
  await assert.rejects(f.run(), /FOCUS_NOT_LOCATABLE/); assert.deepEqual(f.effects, []);
});
test('M7a acknowledged click without focused native readback never clears or types', async t => {
  const f = await fixture(t, { noFocus: true });
  await assert.rejects(f.run(), /FOCUS_UNPROVEN/); assert.deepEqual(f.effects, ['focus']);
});
const mutations = {
  'foreign device': v => { v.deviceSerial = 'other'; },
  'foreign application': v => { v.foregroundPackage = 'org.other'; },
  'unknown observation': v => { v.observationStatus = 'UNKNOWN'; },
  'stale source': v => { v.timestamp -= 6000; },
  'future source': v => { v.timestamp += 1000; },
  'lost focus': v => { v.nodes.find(n => n.focused).focused = false; },
  'different focused field': v => { v.nodes.find(n => n.focused).focused = false; v.nodes[2].focused = true; },
  'duplicate focus': v => { v.nodes[2].focused = true; },
  'duplicate minute role': v => { v.nodes.push({ ...v.nodes[4] }); v.elements.push({ ...v.elements[4], elementId: 'duplicate' }); },
  'parent changed': v => { v.nodes[3].resourceId = 'new-parent'; },
  'editable identity changed': v => { v.nodes[4].resourceId = 'new-field'; },
  'permission overlay': v => { v.nodes.push({ ...v.nodes[0], packageName: 'org.permissioncontroller' }); },
  'dialog overlay': v => { v.nodes.push({ ...v.nodes[0], className: 'android.app.Dialog' }); },
  'keyguard overlay': v => { v.nodes.push({ ...v.nodes[0], resourceId: 'keyguard' }); },
};
for (const [name, mutate] of Object.entries(mutations)) test('M7a typed editor with ' + name + ' cannot receive Done', async t => {
  const f = await fixture(t, { mutate(view, stage) { if (stage === 'typed') mutate(view); } });
  await assert.rejects(f.run(), GroundedInteractionFailure);
  assert.deepEqual(f.effects, ['focus', 'clear', 'value']);
});
for (const option of ['wrongEcho', 'replaced', 'locateMissing', 'nativeFocusFalse', 'reused']) test('M7a ' + option + ' prevents editor Done', async t => {
  const f = await fixture(t, { [option]: true }); await assert.rejects(f.run(), GroundedInteractionFailure);
  assert.ok(!f.effects.includes('done'));
});
for (const option of ['expireAfterType', 'expireBeforeDone']) test('M7a ' + option + ' cannot renew the original grant', async t => {
  const f = await fixture(t, { [option]: true }); const expires = f.grant.expiresAt;
  await assert.rejects(f.run(), e => e instanceof GroundedInteractionFailure && e.dispatchState !== 'NOT_SENT');
  assert.equal(f.grant.expiresAt, expires); assert.deepEqual(f.effects, ['focus', 'clear', 'value']);
});
test('M7a revoked owner authorization after typing prevents Done', async t => {
  const f = await fixture(t, { owner: true, revokeAfterType: true });
  await assert.rejects(f.run(), /revoked/); assert.deepEqual(f.effects, ['focus', 'clear', 'value']);
});
for (const effect of ['focus', 'clear', 'value', 'done']) test('M7a lost ' + effect + ' reply cannot replay the protocol', async t => {
  const f = await fixture(t, { fail: effect });
  await assert.rejects(f.run(), e => e instanceof GroundedInteractionFailure && e.dispatchState === 'UNKNOWN' && e.classification === 'UNKNOWN_EFFECT');
  const count = f.effects.length; await assert.rejects(f.run()); assert.equal(f.effects.length, count);
  assert.throws(() => ui.setTemporalUiPhase(f.scope, 'MINUTE'), /REPLAY/);
});
for (const effect of ['focus', 'value']) test('M7a cancellation after ' + effect + ' prevents further editor actions', async t => {
  const f = await fixture(t, { abortAfter: effect }); await assert.rejects(f.run(), GroundedInteractionFailure);
  assert.equal(f.effects.at(-1), effect);
});
test('M7a numeric substeps share one issued journal ticket and never become outcome verification', async t => {
  const f = await fixture(t, { journal: true }); await f.run();
  assert.equal(f.journal.records.length, 1); assert.equal(f.journal.records[0].verified, false);
  const lines = (await fsp.readFile(join(tmpdir(), 'phone-commander-local-effects', f.journal.id + '.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.filter(l => l.event === 'PREPARED_SINGLE_USE').length, 1);
  assert.equal(lines.filter(l => l.event === 'DISPATCH_ATTEMPT').length, 4);
  assert.equal(lines.filter(l => l.event === 'DISPATCH_ACKNOWLEDGED').length, 4);
});
test('M7a Done ACK with unchanged parent model blocks the runner before Start', async t => {
  const f = await fixture(t, { stuckBacking: true });
  await assert.rejects(runTemporalUi({ source: f.source, node: f.node, executionId: randomUUID(),
    execution: { sessionId: () => 'session', temporalUiInventoryV2: async () => inventory(),
      interactV2: grant => executeGroundedInteraction(f.session, f.observer, grant) },
    budget: new AgentBudget(), fresh: () => f.observer.readNativeSnapshot(), confirm: async () => {}, registerJournal() {}, emit() {} }), /PARENT_CONSISTENCY_UNVERIFIED/);
  assert.deepEqual(f.effects, ['focus', 'clear', 'value', 'done']);
  assert.ok(f.calls.filter(c => c.method === 'POST' && c.route.endsWith('/click')).every(c => c.route.includes('native-MINUTE')));
});
test('M7a ordinary calculation SET_VALUE retains clear/value without focus or Done', async () => {
  const executionId = randomUUID(), node = compileOutcomes('Calculate 2 + 3', 'device', executionId).nodes[0]; node.packageName = pkg;
  let text = ''; const effects = [];
  const current = () => scene([{ className: 'android.widget.EditText', resourceId: pkg + ':id/expression', text, bounds: [20, 50, 580, 150] },
    ...['1', '4', '5', '+', '='].map((text, i) => ({ text, className: 'android.widget.Button', clickable: true, bounds: [20 + i * 100, 300, 100 + i * 100, 400] }))]);
  const view = current(), candidates = generateGroundedCandidates(node, view, executionId, 'session', false).candidates;
  assert.equal(candidates.length, 1); assert.equal(candidates[0].action, 'SET_VALUE');
  const grant = issueEffectGrant(candidates[0], node);
  const session = { serial: 'device', sessionId: 'session', path: '/session/session', async ensureActive() {}, client: { async request(method, route, data) {
    if (method === 'GET') return 'false'; effects.push(route.split('/').at(-1)); text = data.text || ''; return null;
  } } };
  const observer = { async readNativeSnapshot() { return current(); }, async locate(view) { return { id: 'expression', node: view.nodes[0], snapshot: view }; },
    async waitUntil(condition) { const view = current(); assert.ok(await condition(view)); return view; } };
  await executeGroundedInteraction(session, observer, grant); assert.deepEqual(effects, ['clear', 'value']);
});
