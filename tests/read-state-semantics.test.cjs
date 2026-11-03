/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => {
  const original = m.require.bind(m);
  m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { understandOutcomes, validateOutcomeSpans, assertLegacyCoverage, registerReviewedOutcomes } = require('../lib/android/agent/outcome-spec.ts');
const { matchIntentSource, proposeIntentOutcomes, approveIntentSource, assertIntentApproval, intentCapabilities } = require('../lib/android/agent/intent-capabilities.ts');
const { prepareV2 } = require('../lib/android/agent/prepared-v2.ts');
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { decidePermission } = require('../lib/android/agent/permission-decision.ts');

const battery = 'Cho m\u00ecnh xem pin c\u00f2n bao nhi\u00eau';
const wifi = 'Cho m\u00ecnh bi\u1ebft Wi-Fi \u0111ang b\u1eadt hay t\u1eaft';
for (const [source, state] of [
  [battery, 'battery'], [wifi, 'wifi'],
  ['Cho minh xem pin con bao nhieu', 'battery'], ['Cho toi biet Wi Fi dang bat hay tat', 'wifi'],
  ['Kiem tra trang thai Wi-Fi', 'wifi'], ['Wi-Fi co dang bat khong?', 'wifi'],
  ['Please show me the battery level', 'battery'], ['How much battery is left?', 'battery'],
  ['What is the current battery percentage?', 'battery'], ['Can you check Wi-Fi status?', 'wifi'],
  ['Is Wi-Fi on or off?', 'wifi'], ['Tell me whether Wi-Fi is on or off', 'wifi'],
  ['Could you show me Bluetooth status', 'bluetooth'], ['Read screen brightness', 'brightness'],
  ['Show me media volume level', 'media_volume'], ['Check ringtone volume', 'ring_volume'],
  ['Read do not disturb status', 'dnd'], ['Xem khong lam phien', 'dnd'],
  ['Check auto rotation status', 'rotation'], ['Read torch status', 'flashlight'], ['Read airplane mode', 'airplane'],
  ...['wifi', 'battery', 'media_volume', 'ring_volume', 'brightness', 'bluetooth', 'dnd', 'rotation', 'flashlight', 'airplane'].map(state => ['read ' + state, state]),
]) test('OFFLINE source-bound READ_STATE: ' + source, () => {
  const graph = compileOutcomes(source, 'A', 'E');
  assert.equal(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes.length, 1);
  const node = graph.nodes[0], outcome = node.outcome;
  assert.equal(outcome.kind, 'INTENT'); assert.equal(outcome.effect, 'READ'); assert.equal(node.app, undefined);
  assert.deepEqual(outcome.intent.request, { name: 'READ_STATE', args: { state } });
  assert.equal(source.slice(outcome.span.start, outcome.span.end), outcome.span.text);
  assert.deepEqual(matchIntentSource(source, outcome.span.start, outcome.span.end), outcome.intent);
  assert.deepEqual(outcome.intent.slots, { state: 1 });
  const proposal = proposeIntentOutcomes(source);
  assert.deepEqual(proposal, graph.original); validateOutcomeSpans(proposal);
  const approval = approveIntentSource(source, 'A', 'E', 'P');
  assert.doesNotThrow(() => assertIntentApproval(approval, 'A', 'E', outcome.span, outcome.intent));
});

test('OFFLINE typed read contract retains independent readback and session grants', () => {
  assert.equal(intentCapabilities.READ_STATE.effect, 'READ_ONLY');
  assert.equal(intentCapabilities.READ_STATE.executor, 'READ_ONLY_ADB');
  assert.equal(intentCapabilities.READ_STATE.verifier, 'TWO_INDEPENDENT_READ_PATHS_AGREE');
  assert.deepEqual(intentCapabilities.READ_STATE.requiredGrants, ['SOURCE_BOUND', 'DEVICE_SESSION']);
});

for (const source of [
  'Do not read battery', 'Khong xem pin con bao nhieu', 'Never check wifi',
  'Show me "battery"', 'Show me battery then reboot', 'Tell me wifi on',
  'Show me battery and delete photos', 'Is Wi-Fi on or off and turn it on',
  'read wifi 1', 'read unknown_state', 'Show me battery in AnotherApp',
]) test('OFFLINE a read matcher cannot absorb negation, data, writes or unsupported tails: ' + source, () => {
  assert.equal(matchIntentSource(source, 0, source.length), undefined);
});

test('OFFLINE mixed reads preserve exact full-source coverage and dependencies', () => {
  const source = battery + ' r\u1ed3i ' + wifi;
  const graph = compileOutcomes(source, 'A', 'E'), proposal = proposeIntentOutcomes(source);
  assert.equal(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.nodes.map(n => n.outcome.intent.request.args.state), ['battery', 'wifi']);
  assert.deepEqual(graph.nodes[1].dependencies, [graph.nodes[0].id]);
  assert.deepEqual(proposal, graph.original); validateOutcomeSpans(proposal);
  assert.throws(() => compileOutcomes({ ...proposal, outcomes: proposal.outcomes.slice(0, 1) }, 'A', 'E'), /coverage/);
});

test('OFFLINE mixed app/read/capture retains effects without assigning the read an app', () => {
  const source = 'Mo org.example.camera va ' + battery + ' roi chup 1 tam anh';
  const graph = compileOutcomes(source, 'A', 'E');
  assert.equal(graph.coverage, 'COMPLETE');
  assert.deepEqual(graph.nodes.map(n => n.capability), ['LAUNCH', 'INTENT', 'CAPTURE_MEDIA']);
  assert.equal(graph.nodes[1].app, undefined); assert.equal(graph.nodes[2].app, 'org.example.camera');
  assert.equal(graph.nodes[2].outcome.effect, 'LOCAL_WRITE'); assert.equal(proposeIntentOutcomes(source), undefined);
});

test('OFFLINE reads cannot convert explicit writes into read-only coverage', () => {
  const source = 'read battery; set wifi 1', proposal = proposeIntentOutcomes(source);
  assert.deepEqual(proposal.outcomes.map(o => [o.intent.request.name, o.effect]), [['READ_STATE', 'READ'], ['SET_DEVICE_STATE', 'LOCAL_WRITE']]);
  registerReviewedOutcomes(proposal);
  assert.equal(compileOutcomes(proposal, 'A', 'E').coverage, 'COMPLETE');
  assert.equal(understandOutcomes('bat wifi').outcomes[0].kind, 'SET_STATE');
  assert.notEqual(understandOutcomes('set wifi 1').outcomes[0].intent?.request.name, 'READ_STATE');
});

test('OFFLINE quoted read language remains search data', () => {
  const graph = compileOutcomes('Mo org.example.notes va tim "' + wifi + '"', 'A', 'E');
  assert.deepEqual(graph.nodes.map(n => n.capability), ['LAUNCH', 'SEARCH']);
  assert.equal(graph.nodes[1].outcome.value, '"' + wifi + '"');
});

test('OFFLINE forged state, source span, slot, device and execution bindings are rejected', () => {
  const outcome = understandOutcomes(battery).outcomes[0], approval = approveIntentSource(battery, 'A', 'E', 'P');
  const changed = structuredClone(understandOutcomes(battery)); changed.outcomes[0].intent.request.args.state = 'wifi';
  assert.throws(() => compileOutcomes(changed, 'A', 'E'), /binding changed/);
  for (const [device, execution, span, binding] of [
    ['B', 'E', outcome.span, outcome.intent], ['A', 'other', outcome.span, outcome.intent],
    ['A', 'E', { start: 1, end: outcome.span.end }, outcome.intent],
    ['A', 'E', outcome.span, { ...outcome.intent, slots: {} }],
    ['A', 'E', outcome.span, { ...outcome.intent, request: { name: 'READ_STATE', args: { state: 'wifi' } } }],
  ]) assert.throws(() => assertIntentApproval(approval, device, execution, span, binding), /SAFE_BLOCKED/);
});

function fixture(options = {}) {
  const calls = { apps: 0, intents: 0, open: 0, legacy: 0, modelInventory: 0 };
  const adapter = {
    catalog: { resolve: async () => { calls.apps++; return { app: options.app, choices: [] }; } },
    planningApps: async () => { calls.modelInventory++; throw Error('Unexpected model inventory'); },
    open: async () => { calls.open++; throw Error('No Session during preparation'); },
    ...(options.resolver ? { resolveIntentApp: async () => { calls.intents++; throw Error('READ_STATE must not resolve an app'); } } : {}),
  };
  const runtime = new DeviceRuntimeRegistry({
    discover: async () => [{ serial: 'A', status: 'device', identityVerified: true, physicalId: 'P' }],
    v2: () => adapter,
    plan: async () => { calls.legacy++; throw Error('Unexpected V1 planner'); }, open: adapter.open,
  });
  return { calls, adapter, runtime };
}

for (const resolver of [false, true]) for (const source of [battery, wifi, battery + ' roi ' + wifi])
  test('OFFLINE preparation binds typed reads with no application, resolver=' + resolver + ': ' + source, async () => {
    const f = fixture({ resolver });
    const prepared = await prepareV2(source, 'A', f.adapter, new AgentBudget(), new AbortController().signal);
    assert.equal(prepared.graph.coverage, 'COMPLETE'); assert.equal(prepared.review, false);
    const view = await f.runtime.prepare(source, 'A', 'V2');
    assert.ok(view.reference); assert.deepEqual(view.steps, prepared.graph.nodes.map(n => n.outcome.span.text));
    assert.deepEqual(f.calls, { apps: 0, intents: 0, open: 0, legacy: 0, modelInventory: 0 });
  });

test('OFFLINE app/read preparation still validates the separate app binding', async () => {
  for (const app of [undefined, { serial: 'B', packageName: 'org.example.camera' }, { serial: 'A', packageName: 'org.example.camera' }]) {
    const f = fixture({ app, resolver: true }), source = 'Mo Camera va ' + battery;
    if (app?.serial === 'A') assert.ok((await f.runtime.prepare(source, 'A', 'V2')).reference);
    else await assert.rejects(f.runtime.prepare(source, 'A', 'V2'), /handler is missing or ambiguous/);
    assert.equal(f.calls.apps, 1); assert.equal(f.calls.intents, 0); assert.equal(f.calls.open, 0);
  }
});

test('OFFLINE an unresolved mixed clause blocks preparation without dropping the read', async () => {
  const source = battery + ' roi mo Tool va lam viec chua hieu', graph = compileOutcomes(source, 'A', 'E');
  assert.notEqual(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes[0].outcome.intent.request.name, 'READ_STATE');
  assert.equal(proposeIntentOutcomes(source), undefined);
  const f = fixture(); await assert.rejects(f.runtime.prepare(source, 'A', 'V2'), /UNSUPPORTED_OUTCOME|NEEDS_CLARIFICATION/);
  assert.deepEqual(f.calls, { apps: 0, intents: 0, open: 0, legacy: 0, modelInventory: 0 });
});

for (const source of [battery + ' roi xoa anh cu', 'Read wifi then delete old photos', 'read battery then change PIN'])
  test('OFFLINE M6a whole-source hard deny survives a read prefix: ' + source, async () => {
    for (const stage of ['REQUEST', 'INTERPRETATION', 'EFFECT', 'LEGACY'])
      assert.equal(decidePermission({ source, stage, legacy: 'ALLOW' }).decision, 'DENY');
    const f = fixture(); await assert.rejects(f.runtime.prepare(source, 'A', 'V2'), /HARD_DENY/);
    assert.equal(f.calls.open, 0); assert.equal(f.calls.apps, 0);
  });

test('OFFLINE V1 coverage and temporal clarification boundaries remain intact', () => {
  assert.doesNotThrow(() => assertLegacyCoverage('Mo Camera', 'OPEN_APP'));
  assert.throws(() => assertLegacyCoverage('Xem pin con bao nhieu', 'OPEN_APP'), /UNSUPPORTED_OUTCOME/);
  assert.equal(compileOutcomes('Dat bao thuc 3:30', 'A', 'E').coverage, 'NEEDS_CLARIFICATION');
  assert.equal(compileOutcomes('Mo clock va dat bao thuc 07:00', 'A', 'E').nodes[1].capability, 'SET_STRUCTURED_STATE');
});
