/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { UnifiedAgentService } = require('../lib/android/unified-agent/service.ts');
const { routeCapability } = require('../lib/android/unified-agent/capability-router.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { proposeIntentOutcomes } = require('../lib/android/agent/intent-capabilities.ts');
const { registerReviewedOutcomes } = require('../lib/android/agent/outcome-spec.ts');
const originalFetch = global.fetch;
global.fetch = async () => assert.fail('No network, model or Android in stage 2');
test.after(() => { global.fetch = originalFetch; });
function fixture() {
  const calls = { prepare: 0, start: 0, legacy: 0, interpret: 0 };
  const service = new UnifiedAgentService({
    context: async deviceId => ({ deviceId, physicalId: 'offline-physical', backend: 'appium', runtimeHash: 'frozen', policyMode: 'normal', busy: false }),
    prepare: async () => { calls.prepare++; throw Error('ASK: backend capability unavailable; no fallback permitted'); },
    start: async () => { calls.start++; assert.fail('No execution'); },
    legacy: async () => { calls.legacy++; assert.fail('No alternate engine'); },
    interpret: async () => { calls.interpret++; assert.fail('No alternate planner'); },
    tasks: async () => [], cancel: async () => {},
  });
  return { service, calls };
}
for (const source of ['delete all photos', 'uninstall org.example.reader', 'overwrite existing notes',
  'capture photo then delete old photos']) {
  test('OFFLINE destructive or mixed request is denied as a whole before any preparation: ' + source, async () => {
    const { service, calls } = fixture();
    await assert.rejects(service.analyzeForDashboard({ source, deviceId: 'A', debugEngine: 'V2' }), /HARD|destructive|excluded/);
    assert.deepEqual(calls, { prepare: 0, start: 0, legacy: 0, interpret: 0 });
    assert.deepEqual(await service.list(), []);
  });
}
for (const source of [
  'M\u1edf YouTube, t\u00ecm marine research v\u00e0 ph\u00e1t video \u0111\u1ea7u ti\u00ean',
  'M\u1edf YouTube, t\u00ecm marine research v\u00e0 ph\u00e1t video th\u1ee9 hai',
]) {
  test('OFFLINE removed forced engine is rejected before prepare and cannot silently call V1/AP: ' + source, async () => {
    const { service, calls } = fixture();
    await assert.rejects(service.analyzeForDashboard({ source, deviceId: 'A', debugEngine: 'V2' }), /ENGINE_SELECTION_REMOVED/);
    assert.deepEqual(calls, { prepare: 0, start: 0, legacy: 0, interpret: 0 });
  });
}
test('OFFLINE ported P1 reaches V2 typed preparation without engine selection or execution', async () => {
  const source = 'M\u1edf Chrome, t\u00ecm marine research v\u00e0 m\u1edf b\u00e0i \u0111\u1ea7u ti\u00ean';
  let prepares = 0;
  const service = new UnifiedAgentService({
    context: async deviceId => ({ deviceId, physicalId: 'offline-physical', backend: 'appium', runtimeHash: 'frozen', policyMode: 'normal', busy: false }),
    prepare: async (text, device, engine) => {
      prepares++; assert.equal(text, source); assert.equal(device, 'A'); assert.equal(engine, 'V2');
      const graph = compileOutcomes(text, device, randomUUID()); assert.equal(graph.coverage, 'COMPLETE');
      return { reference: randomUUID(), expiresAt: Date.now() + 90000, summary: text, steps: graph.nodes.map(n => n.capability), confirmations: [] };
    },
    start: async () => assert.fail('No execution authorized by analysis'), tasks: async () => [], cancel: async () => {},
    interpret: async () => assert.fail('No AP planner fallback'), legacy: async () => assert.fail('No legacy execution'),
  });
  const result = await service.analyzeForDashboard({ source, deviceId: 'A' });
  assert.equal(result.plan.engine, 'V2'); assert.deepEqual(result.plan.steps, ['LAUNCH', 'SEARCH', 'OPEN_RESULT']); assert.equal(prepares, 1);
});
const excluded = [
  ['SSID', 'ket noi wifi voi ten mang la DemoNetwork'],
  ['record', 'create note titled demo with body development only'],
  ['Gallery', 'open Gallery'],
  ['URL', 'open https://example.org/research'],
  ['Maps', 'open Maps'],
  ['Bluetooth', 'set bluetooth 1'],
];
for (const [name, source] of excluded) {
  test('OFFLINE catalog router rejects demo-cut capability before context for ' + name, async () => {
    assert.throws(() => routeCapability(source, 'appium'), /CAPABILITY_DISABLED|UNSUPPORTED_OUTCOME|NEEDS_CLARIFICATION/);
    const { service, calls } = fixture();
    await assert.rejects(service.analyzeForDashboard({ source, deviceId: 'A' }), /CAPABILITY_DISABLED|UNSUPPORTED_OUTCOME|NEEDS_CLARIFICATION/);
    assert.deepEqual(calls, { prepare: 0, start: 0, legacy: 0, interpret: 0 });
  });
  test.todo('Stage 3.4 demo-cut gate must reject ' + name + ' before prepare, independently of backend availability');
}

test('OFFLINE retained typed reads and writes keep exact state and dependency order without adding an app to reads', () => {
  const source = 'open settings android.settings.SETTINGS; read battery; read wifi; read brightness; set dnd 0';
  assert.equal(compileOutcomes(source, 'A', randomUUID()).coverage, 'NEEDS_CLARIFICATION');
  // prepareV2 binds the typed-intent proposal before compiling this mixed request.
  const proposal = proposeIntentOutcomes(source);
  registerReviewedOutcomes(proposal);
  const graph = compileOutcomes(proposal, 'A', randomUUID());
  assert.equal(graph.coverage, 'COMPLETE');
  assert.deepEqual(graph.nodes.map(n => n.outcome.intent.request.name), ['OPEN_SETTINGS', 'READ_STATE', 'READ_STATE', 'READ_STATE', 'SET_DEVICE_STATE']);
  assert.deepEqual(graph.nodes.slice(1, 4).map(n => n.outcome.intent.request.args.state), ['battery', 'wifi', 'brightness']);
  assert.equal(graph.nodes[4].outcome.effect, 'LOCAL_WRITE');
  for (let i = 1; i < graph.nodes.length; i++) assert.deepEqual(graph.nodes[i].dependencies, [graph.nodes[i - 1].id]);
  graph.nodes.slice(1, 4).forEach(n => assert.equal(n.app, undefined));
});

test('OFFLINE AM/PM clarification creates no plan/execution and blocks replay after a backend preparation error', async () => {
  const { service, calls } = fixture();
  const result = await service.analyzeForDashboard({ source: 'Dat bao thuc 3:30', deviceId: 'A' });
  assert.equal(result.plan, undefined); assert.equal(result.clarification.kind, 'ALARM_PERIOD');
  assert.deepEqual(result.clarification.choices.map(c => c.id), ['am', 'pm']);
  assert.equal(calls.prepare, 0);
  await assert.rejects(service.clarify(result.clarification.reference, 'pm'), /ASK: backend capability unavailable/);
  await assert.rejects(service.clarify(result.clarification.reference, 'am'), /used or unavailable/);
  assert.deepEqual(calls, { prepare: 1, start: 0, legacy: 0, interpret: 0 });
});
