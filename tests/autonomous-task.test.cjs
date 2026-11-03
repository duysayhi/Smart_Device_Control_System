/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => {
  if (f === path.resolve(__dirname, '../app/api/agent/assistance/route.ts')) {
    const localRequire = m.require.bind(m);
    m.require = id => localRequire(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  }
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { readLocationVerified, storageFreeEvidence, locationSearchQuery } = require('../lib/android/agent/navigation-semantics.ts');
const { isReadInformationLabel } = require('../lib/android/security-policy.ts');
const { waitForHuman, submitHumanChoice, registerAgentCancellation, cancelAgent } = require('../lib/android/agent/human-assistance.ts');
const { runAgent } = require('../lib/android/agent/agent-loop.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const storage = 'Mở Cài đặt và xem dung lượng lưu trữ còn trống của điện thoại.';
function snapshot(labels) {
  const pkg = 'com.samsung.android.lool', snapshotId = randomUUID();
  return { snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes: labels.map((text, i) => ({ text, description: '', resourceId: pkg + ':id/title', packageName: pkg, className: 'android.widget.TextView', bounds: [0, i * 80, 400, (i + 1) * 80], enabled: true, displayed: true })) };
}
test('product goal phrases preserve app, exact query and final ordinal without model calls', async () => {
  const reasoner = { generate() { throw Error('Unexpected AI'); } };
  const chrome = await planGoal('Tìm hướng dẫn cài đặt Python trên Windows và mở bài hướng dẫn đầu tiên phù hợp.', new AgentBudget(), reasoner);
  assert.equal(chrome.goal.spec.app, 'chrome'); assert.equal(chrome.goal.spec.query, 'hướng dẫn cài đặt Python trên Windows'); assert.equal(chrome.goal.spec.ordinal, 1);
  const youtube = await planGoal('Tìm podcast tiếng Anh và phát video thông thường thứ hai.', new AgentBudget(), reasoner);
  assert.equal(youtube.goal.spec.app, 'youtube'); assert.equal(youtube.goal.spec.ordinal, 2); assert.equal(youtube.goal.spec.query, 'podcast tiếng Anh');
  const explicit = await planGoal('Mở YouTube, tìm podcast tiếng Anh và phát video thông thường thứ hai.', new AgentBudget(), reasoner);
  assert.equal(explicit.goal.spec.operation, 'OPEN_RESULT'); assert.equal(explicit.goal.spec.resultType, 'video');
  assert.equal(explicit.goal.spec.ordinal, 2); assert.equal(explicit.goal.spec.query, 'podcast tiếng Anh');
  const { goal } = await planGoal(storage, new AgentBudget(), reasoner); assert.equal(locationSearchQuery(goal), 'lưu trữ');
  await assert.rejects(planGoal('Mở Cài đặt và xem dung lượng bộ nhớ.', new AgentBudget(), reasoner), /RAM.*lưu trữ/);
});
test('free storage outcome rejects RAM, search rows, loading and unrelated sizes', async () => {
  const { goal } = await planGoal(storage, new AgentBudget());
  assert.equal(readLocationVerified(goal, snapshot(['Bộ nhớ', 'Còn trống 2 GB', 'Tổng 4 GB'])), false);
  assert.equal(readLocationVerified(goal, snapshot(['Lưu trữ', '2 GB', 'Đã dùng 50%'])), false);
  const s = snapshot(['Lưu trữ', 'Còn trống 20,5 GB']); assert.equal(readLocationVerified(goal, s), true); assert.equal(storageFreeEvidence(goal, s).value, '20,5 GB');
  const search = snapshot(['Lưu trữ', 'Còn trống 20 GB']); search.nodes.push({ ...search.nodes[0], className: 'android.widget.EditText', resourceId: 'settings:id/search_query' });
  assert.equal(readLocationVerified(goal, search), false);
  assert.equal(isReadInformationLabel(goal.spec.targetText, 'Bộ nhớ', 'android:id/title'), false);
  assert.equal(isReadInformationLabel(goal.spec.targetText, 'Lưu trữ', 'android:id/title'), true);
});
test('observed Samsung internal storage computes free space from a bound used/total pair, never RAM or SD card', async () => {
  const { goal } = await planGoal(storage, new AgentBudget()), s = snapshot(['Lưu trữ']);
  s.foregroundPackage = 'com.sec.android.app.myfiles'; s.nodes[0].packageName = s.foregroundPackage;
  const prefix = s.foregroundPackage + ':id/';
  const add = (id, text, parentIndex) => s.nodes.push({ ...s.nodes[0], resourceId: prefix + id, text, parentIndex });
  add('as_container', '', undefined); add('as_usage_summary_container', '', 1);
  add('viewpager_storage_name', 'Bộ nhớ trong', 2); add('as_usage_label', 'đã dùng', 2);
  add('used_space_summary', '', 1); add('used_space_size', '26,01 GB', 5); add('total_space_size', '64,00 GB', 5);
  assert.equal(storageFreeEvidence(goal, s).value, '37,99 GB'); assert.equal(storageFreeEvidence(goal, s).basis.derived, true);
  s.nodes[3].text = 'Thẻ SD'; assert.equal(storageFreeEvidence(goal, s), undefined);
  s.nodes[3].text = 'Bộ nhớ trong'; s.nodes[7].parentIndex = 2; assert.equal(storageFreeEvidence(goal, s), undefined);
});
const visual = () => ({ id: randomUUID(), status: 'HUMAN_REQUIRED', coherent: true, ordinalVerified: true, expiresAt: Date.now() + 5000 });
test('assistance is bound to evidence, single-use, cancellable and expires', async () => {
  const v = visual(); let token;
  const promise = waitForHuman(v, undefined, t => { token = t; });
  assert.equal(submitHumanChoice(token, { evidenceId: randomUUID(), x: 5, y: 5, confirmed: true }), false);
  const choice = { evidenceId: v.id, x: 5, y: 5, confirmed: true };
  assert.equal(submitHumanChoice(token, choice), true); assert.deepEqual(await promise, choice);
  assert.equal(submitHumanChoice(token, choice), false);
  const controller = new AbortController(); const cancelled = waitForHuman(visual(), controller.signal, () => {});
  controller.abort(); await assert.rejects(cancelled, e => e.code === 'CANCELLED');
  const expired = waitForHuman({ ...visual(), expiresAt: Date.now() + 20 }, undefined, () => {});
  await assert.rejects(expired, e => e.code === 'TIMEOUT');
  assert.throws(() => waitForHuman({ ...visual(), ordinalVerified: false }, undefined, () => {}), /not safe/);
});
test('cancel token is single-use, disposed after execution and aborts the pending assistance', async () => {
  const controller = new AbortController(), handle = registerAgentCancellation(controller); let token;
  const waiting = waitForHuman(visual(), controller.signal, t => { token = t; });
  assert.equal(cancelAgent(randomUUID()), false); assert.equal(controller.signal.aborted, false);
  assert.equal(cancelAgent(handle.token), true); assert.equal(cancelAgent(handle.token), false);
  await assert.rejects(waiting, e => e.code === 'CANCELLED');
  assert.equal(submitHumanChoice(token, 'CANCEL'), false); handle.dispose();
  const finished = registerAgentCancellation(new AbortController()); finished.dispose(); assert.equal(cancelAgent(finished.token), false);
});
test('timeout is not labelled as user cancellation and an aborted request cannot publish assistance', async () => {
  const controller = new AbortController(); let published = false;
  const waiting = waitForHuman(visual(), controller.signal, () => { published = true; });
  controller.abort(new DOMException('Deadline', 'TimeoutError'));
  await assert.rejects(waiting, e => e.code === 'TIMEOUT'); assert.equal(published, true);
  assert.throws(() => waitForHuman(visual(), controller.signal, () => assert.fail('Already aborted')), e => e.code === 'TIMEOUT');
});
test('assistance API validates origin, strict payload, evidence identity and rejects replays without device access', async () => {
  const { POST } = require('../app/api/agent/assistance/route.ts');
  const post = (body, origin = 'http://localhost:3000') => POST(new Request('http://localhost:3000/api/agent/assistance', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }));
  assert.equal((await post({ type: 'STOP', token: randomUUID() }, 'https://untrusted.example')).status, 403);
  assert.equal((await post({ type: 'STOP', token: randomUUID(), ignored: true })).status, 400);
  assert.equal((await post({ type: 'STOP', token: randomUUID() })).status, 409);
  const v = visual(); let token; const waiting = waitForHuman(v, undefined, t => { token = t; });
  try {
    const confirmation = { type: 'CONFIRM', token, evidenceId: v.id, x: 100, y: 150, confirmed: true };
    assert.equal((await post({ ...confirmation, x: null })).status, 400);
    assert.equal((await post({ ...confirmation, evidenceId: randomUUID() })).status, 409);
    assert.equal((await post(confirmation)).status, 200); assert.equal((await waiting).evidenceId, v.id);
    assert.equal((await post(confirmation)).status, 409);
  } finally { submitHumanChoice(token, 'CANCEL'); }
  const controller = new AbortController(), handle = registerAgentCancellation(controller);
  try {
    assert.equal((await post({ type: 'STOP', token: handle.token })).status, 200); assert.equal(controller.signal.aborted, true);
    assert.equal((await post({ type: 'STOP', token: handle.token })).status, 409);
  } finally { handle.dispose(); }
});
test('paused activation resumes the original execution and still independently verifies the destination before closing', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Tìm podcast tiếng Anh và phát video thông thường thứ hai.', budget);
  goal.currentSubgoal = 2; goal.subgoals[0].status = goal.subgoals[1].status = 'VERIFIED';
  const pkg = goal.packageName, v = visual(), events = []; let closed = 0, taps = 0;
  const node = fields => ({ packageName: pkg, resourceId: '', text: '', description: '', className: 'android.view.View', bounds: [0, 80, 400, 200], enabled: true, displayed: true, ...fields });
  const scene = (nodes, screen) => ({ snapshotId: randomUUID(), timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen, viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: [] });
  const before = scene([node({ resourceId: pkg + ':id/search_query', text: goal.spec.query })], 'SEARCH_RESULTS');
  const after = scene([node({ resourceId: pkg + ':id/watch_player' }), node({ resourceId: pkg + ':id/video_metadata_layout' }), node({ text: 'Selected public podcast', parentIndex: 1 })], 'VIDEO_PLAYER');
  after.playback = { source: 'ADB_MEDIA_SESSION', packageName: pkg, title: 'Selected public podcast', positionMs: 2000, previousPositionMs: 1000 };
  const execution = { backend: 'appium', async observe() { return before; }, discoveryMemory() { return {}; }, verificationSnapshot() { return after; },
    async execute() { const e = new AndroidExecutionError('AMBIGUOUS', 'Confirm activation region'); e.visual = v; throw e; },
    async confirmVisualTap(choice) { taps++; assert.equal(choice.evidenceId, v.id); return { verification: 'VERIFIED', selection: { ordinal: 2, itemType: 'video', title: 'Selected public podcast', identity: 'actual' } }; },
    async close() { closed++; } };
  const out = await runAgent(goal, budget, execution, undefined, undefined, e => events.push(e), async (evidence, publish) => {
    publish('test-only', evidence.expiresAt); return { evidenceId: evidence.id, x: 150, y: 150, confirmed: true };
  });
  assert.equal(events.find(e => e.status === 'NEED_HUMAN_ASSISTANCE').assistance.sessionRetained, true);
  assert.equal(out.result.status, 'COMPLETED'); assert.equal(taps, 1); assert.equal(closed, 1); assert.equal(out.result.destinationEvidence.ordinal, 2);
});
