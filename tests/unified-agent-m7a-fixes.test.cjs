/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { UnifiedAgentService } = require('../lib/android/unified-agent/service.ts');
const { UnifiedCommand } = require('../lib/android/unified-agent/contracts.ts');
const { alarmPeriodChoices } = require('../lib/android/unified-agent/clarification.ts');
function fixture() {
  let now = Date.now(), prepares = 0, starts = 0;
  const c = { deviceId: 'A', physicalId: 'physical-A', backend: 'appium', runtimeHash: 'h1', policyMode: 'normal', ownerId: 'owner-1', busy: false };
  const prepared = [];
  const service = new UnifiedAgentService({
    context: async () => ({ ...c }),
    prepare: async (source, deviceId, engine) => { prepares++; const reference = randomUUID(); prepared.push({ source, deviceId, engine, reference }); return { reference, expiresAt: now + 90000, summary: source, steps: [source], confirmations: [] }; },
    start: async ref => { starts++; const row = prepared.find(p => p.reference === ref); return { executionId: randomUUID(), batchId: ref, request: row.source, deviceId: 'A', physicalId: c.physicalId, agentVersion: 2, createdAt: now, status: 'RUNNING', events: [] }; },
    tasks: async () => [], cancel: async () => {},
    interpret: async () => { throw Error('Unexpected legacy path'); }, legacy: async () => { throw Error('Unexpected legacy dispatch'); },
  }, () => now);
  return { service, c, prepared, advance: ms => { now += ms; }, counts: () => ({ prepares, starts }) };
}
const input = source => ({ source, deviceId: 'A' });
for (const [source, am, pm] of [['Đặt báo thức 3:30', '03:30', '15:30'], ['Set an alarm for 12:30', '00:30', '12:30'], ['dat bao thuc 6 gio', '06:00', '18:00']]) {
  test('OFFLINE clarification is one minimal AM/PM question without plan or effect: ' + source, async () => {
    const f = fixture(), result = await f.service.analyzeForDashboard(input(source));
    assert.equal(result.plan, undefined); assert.ok(result.clarification.question.endsWith('?'));
    assert.equal(result.clarification.choices.length, 2); assert.match(result.clarification.choices[0].label, new RegExp(am)); assert.match(result.clarification.choices[1].label, new RegExp(pm));
    assert.deepEqual(f.counts(), { prepares: 0, starts: 0 });
    await assert.rejects(f.service.execute(result.clarification.reference), /unavailable/);
  });
}
for (const choice of ['am', 'pm']) test('OFFLINE selected period generates a new plan, not an execution: ' + choice, async () => {
  const f = fixture(), original = 'Đặt báo thức 3:30', question = (await f.service.analyzeForDashboard(input(original))).clarification;
  const { plan } = await f.service.clarify(question.reference, choice);
  assert.notEqual(plan.reference, question.reference); assert.equal(plan.source, original + ' ' + choice.toUpperCase()); assert.equal(plan.clarifiedFrom, original);
  assert.deepEqual(f.counts(), { prepares: 1, starts: 0 });
  await assert.rejects(f.service.clarify(question.reference, choice), /used|unavailable/);
  await f.service.execute(plan.reference); await new Promise(setImmediate); assert.equal(f.counts().starts, 1);
});
test('OFFLINE period clarification preserves other clauses and timezone', () => {
  const source = 'Mở Đồng hồ rồi đặt báo thức 3:30 múi giờ Asia/Ho_Chi_Minh';
  const options = alarmPeriodChoices(source);
  assert.equal(options.choices[1].source, 'Mở Đồng hồ rồi đặt báo thức 3:30 PM múi giờ Asia/Ho_Chi_Minh');
  assert.equal(alarmPeriodChoices('Đặt báo thức 07:00'), undefined);
  assert.equal(alarmPeriodChoices('Tìm "đặt báo thức 3:30"'), undefined);
});
for (const [key, value] of [['physicalId', 'foreign'], ['ownerId', 'new-owner'], ['runtimeHash', 'new-source'], ['policyMode', 'development'], ['backend', 'adb'], ['busy', true]]) {
  test('OFFLINE pending clarification rejects changed binding: ' + key, async () => {
    const f = fixture(), { clarification } = await f.service.analyzeForDashboard(input('Đặt báo thức 3:30')); f.c[key] = value;
    await assert.rejects(f.service.clarify(clarification.reference, 'am'), /changed/); assert.equal(f.counts().prepares, 0);
  });
}
test('OFFLINE concurrent period answers prepare exactly once', async () => {
  const f = fixture(), { clarification } = await f.service.analyzeForDashboard(input('Đặt báo thức 3:30'));
  const results = await Promise.allSettled([f.service.clarify(clarification.reference, 'am'), f.service.clarify(clarification.reference, 'pm')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.counts().prepares, 1);
});
test('OFFLINE expiry and invalid choice mint no plan', async () => {
  const f = fixture(), { clarification } = await f.service.analyzeForDashboard(input('Đặt báo thức 3:30'));
  await assert.rejects(f.service.clarify(clarification.reference, 'arbitrary'), /unavailable/);
  f.advance(120001); await assert.rejects(f.service.clarify(clarification.reference, 'am'), /expired/);
  assert.deepEqual(f.counts(), { prepares: 0, starts: 0 });
});
test('OFFLINE destructive mixed source cannot obtain a clarification ticket', async () => {
  const f = fixture(); await assert.rejects(f.service.analyzeForDashboard(input('Đặt báo thức 3:30 rồi xóa hết ảnh')), /HARD|destructive|excluded/);
  assert.deepEqual(f.counts(), { prepares: 0, starts: 0 });
});
test('OFFLINE Dashboard clarification uses a separate preflight contract without execution', async () => {
  const f = fixture();
  const c = await f.service.analyzeForDashboard(input('Đặt báo thức 3:30')); assert.ok(c.clarification);
  assert.equal(f.counts().starts, 0);
});
test('OFFLINE production temporal adapter opts into native collection targeting', async () => {
  const inventory = require('../lib/android/agent/temporal-ui-inventory.ts'), original = inventory.readTemporalUiInventory;
  const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
  const instance = Object.create(ConditionExecutor.prototype);
  instance.session = {}; instance.observer = {}; instance.run = () => {}; instance.accounting = {};
  let called = 0;
  inventory.readTemporalUiInventory = async (...args) => { called++; assert.equal(args[6], instance.accounting); assert.deepEqual(args[7], { scrollTarget: 'NATIVE_ELEMENT' }); return 'issued-inventory'; };
  try { assert.equal(await instance.temporalUiInventoryV2('org.generic.clock', { kind: 'ALARM' }), 'issued-inventory'); assert.equal(called, 1); }
  finally { inventory.readTemporalUiInventory = original; }
});
test('OFFLINE expired plan remains non-executable and explicit reanalysis issues a new reference', async () => {
  const f = fixture(), first = await f.service.analyze(input('Mở Drive và tìm báo cáo thực tập'));
  f.advance(86000); await assert.rejects(f.service.execute(first.reference), e => e.code === 'PLAN_EXPIRED');
  const fresh = await f.service.reanalyze(first.reference);
  assert.notEqual(fresh.reference, first.reference); assert.ok(fresh.expiresAt > first.expiresAt); assert.equal(fresh.source, first.source);
  assert.equal(f.prepared.length, 2); assert.notEqual(f.prepared[0].reference, f.prepared[1].reference);
  await assert.rejects(f.service.execute(first.reference)); await f.service.execute(fresh.reference); await new Promise(setImmediate);
  assert.equal(f.counts().starts, 1);
});
test('OFFLINE reanalysis revokes even an unexpired old reference before awaiting a new plan', async () => {
  const f = fixture(), first = await f.service.analyze(input('Mở Drive và tìm báo cáo thực tập'));
  const updating = f.service.reanalyze(first.reference); await assert.rejects(f.service.execute(first.reference));
  await updating; assert.equal(f.counts().starts, 0);
});
test('OFFLINE consumed/unknown plans cannot be reanalyzed to replay an uncertain effect', async () => {
  const f = fixture(), first = await f.service.analyze(input('Mở Camera và chụp 1 tấm ảnh'));
  await f.service.execute(first.reference); await assert.rejects(f.service.reanalyze(first.reference));
  await assert.rejects(f.service.reanalyze(randomUUID())); assert.equal(f.counts().prepares, 1);
});
test('OFFLINE strict clarification/reanalysis contracts reject client source, device, engine and rights', () => {
  for (const type of ['CLARIFY', 'REANALYZE']) {
    const command = { type, reference: randomUUID(), ...(type === 'CLARIFY' ? { choice: 'am' } : {}) };
    assert.equal(UnifiedCommand.safeParse(command).success, true);
    for (const extra of [{ source: 'other' }, { deviceId: 'B' }, { engine: 'V1' }, { ownerAuthorizedTest: true }, { plan: {} }]) assert.equal(UnifiedCommand.safeParse({ ...command, ...extra }).success, false);
  }
});
