/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { routeCapability } = require('../lib/android/unified-agent/capability-router.ts');
const { UnifiedAgentService } = require('../lib/android/unified-agent/service.ts');
const { clearGoal, buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const video = 'Mở YouTube, tìm OpenAI và phát video đầu tiên';

for (const source of [video, 'Mở YouTube, tìm hải dương học và mở video thứ hai', 'Mở Chrome, tìm công thức nấu phở và mở kết quả thứ hai']) {
  test('OFFLINE catalog rejects unsupported ordinal coverage without choosing another engine: ' + source, () => {
    assert.throws(() => routeCapability(source, 'appium'), /CAPABILITY_DISABLED/);
  });
}

test('OFFLINE catalog cuts playback routing while preserving internal V1 verifier criteria', () => {
  assert.throws(() => routeCapability(video, 'appium'), /CAPABILITY_DISABLED/);
  const spec = clearGoal(video), goal = buildGoal(video, spec, new AgentBudget());
  assert.equal(spec.query, 'OpenAI'); assert.equal(spec.ordinal, 1); assert.equal(spec.operation, 'OPEN_RESULT');
  assert.equal(goal.subgoals.at(-1).criterion.target, 'video_card_1');
  assert.throws(() => routeCapability(video, 'appium', 'V1'), /ENGINE_SELECTION_REMOVED/);
});

test('OFFLINE removed debug selection and disabled playback create no plan or fallback', async () => {
  let prepares = 0, starts = 0, engine;
  const service = new UnifiedAgentService({
    context: async deviceId => ({ deviceId, physicalId: 'physical-A', backend: 'appium', runtimeHash: 'h1', policyMode: 'normal', busy: false }),
    prepare: async (source, deviceId, selected) => { prepares++; engine = selected; assert.equal(source, video); assert.equal(deviceId, 'A'); return { reference: randomUUID(), expiresAt: Date.now() + 90000, summary: source, steps: ['Existing verified playback'], confirmations: [] }; },
    start: async () => { starts++; throw Error('No execution authorized by this test'); },
    tasks: async () => [], cancel: async () => {}, interpret: async () => { throw Error('No fallback'); }, legacy: async () => { throw Error('No fallback'); },
  });
  await assert.rejects(service.analyzeForDashboard({ source: video, deviceId: 'A', debugEngine: 'V2' }), /ENGINE_SELECTION_REMOVED/);
  assert.equal(prepares, 0); assert.equal(starts, 0); assert.deepEqual(await service.list(), []);
  await assert.rejects(service.analyzeForDashboard({ source: video, deviceId: 'A' }), /CAPABILITY_DISABLED/);
  assert.equal(engine, undefined); assert.equal(prepares, 0); assert.equal(starts, 0);
});

for (const source of ['Mở Drive và tìm báo cáo thực tập', 'Mở YouTube và tìm nhạc không lời', 'Đặt báo thức 7 giờ sáng', 'Hẹn giờ 2 phút']) {
  test('OFFLINE supported V2 routing needs no engine selection: ' + source, () => assert.equal(routeCapability(source, 'appium').engine, 'V2'));
}

test('OFFLINE destructive mixed requests are denied before an engine-coverage suggestion', () => {
  assert.throws(() => routeCapability(video + ' rồi xóa ảnh cũ', 'appium', 'V2'), /HARD|destructive|excluded/);
});

test('OFFLINE debug Action Plan is removed and supported V2 still requires Appium', () => {
  assert.throws(() => routeCapability(video, 'appium', 'ACTION_PLAN'), /ENGINE_SELECTION_REMOVED/);
  assert.throws(() => routeCapability('Hẹn giờ 2 phút', 'adb'), /Appium/);
});
