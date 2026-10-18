/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { planChromeCommand, parseChromeRequest, validateAndroidPlan, androidCapabilityPrompt } = require('../lib/android/capabilities.ts');
const { ActionPlanSchema } = require('../lib/validators/action-plan.schema.ts');
const { assessPlanPolicy } = require('../lib/android/security-policy.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
let modelCalls = 0;
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === '@/lib/android/agent/worker-client') return { queuedOllamaFetch: async () => {
    modelCalls++;
    return Response.json({ message: { content: JSON.stringify({ intent: 'search', isSensitive: false, actions: [
      { type: 'OPEN_APP', app: 'chrome' }, { type: 'INPUT_TEXT', text: 'recipe' }, { type: 'PRESS_KEY', key: 'ENTER' },
    ] }) } });
  } };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
const { POST } = require('../app/api/commands/interpret/route.ts');
const request = prompt => new Request('http://localhost/api/commands/interpret', { method: 'POST', body: JSON.stringify({ prompt }) });

test('Chrome search prepares the address bar before typing and never waits for video_list', () => {
  for (const prompt of ['Mở chrome và tìm công thức nấu bún bò huế ngon', 'Mở Chrome, tìm Công thức nấu ăn', 'Mở Chrome tìm recipe']) {
    const plan = ActionPlanSchema.parse(planChromeCommand(prompt));
    assert.deepEqual(plan.actions.map(a => a.type), ['OPEN_APP', 'WAIT_FOR', 'CLICK', 'INPUT_TEXT', 'PRESS_KEY']);
    assert.equal(plan.actions[2].target, 'address_bar');
    assert.equal(plan.actions[4].key, 'ENTER');
    assert.ok(!plan.actions.some(a => a.target === 'video_list'));
    assert.doesNotThrow(() => validateAndroidPlan(plan.actions, true));
    assert.equal(assessPlanPolicy(plan).decision, 'ALLOW');
  }
});

test('second article is preserved for numeric and written Vietnamese ordinals', () => {
  for (const ordinal of ['thứ 2', 'thứ hai', '2']) {
    const prompt = `Mở Chrome và tìm công thức nấu bún bò Huế ngon và chọn bài viết ${ordinal}`;
    const parsed = parseChromeRequest(prompt), plan = planChromeCommand(prompt);
    assert.equal(parsed.query, 'công thức nấu bún bò Huế ngon'); assert.equal(parsed.ordinal, 2);
    assert.equal(plan.actions.at(-1).target, 'result_2');
    assert.equal(plan.actions.filter(a => a.type === 'INPUT_TEXT')[0].text, parsed.query);
  }
  assert.equal(planChromeCommand('Tìm cách cài Python rồi mở bài hướng dẫn thứ ba').actions.at(-1).target, 'result_3');
  assert.equal(planChromeCommand('Mở Chrome, tìm OpenAI và mở kết quả đầu tiên').actions.at(-1).target, 'first_result');
});

test('standalone selection never invents or repeats a query', () => {
  const plan = planChromeCommand('Chọn bài viết thứ 2');
  assert.deepEqual(plan.actions, [{ type: 'OPEN_APP', app: 'chrome' }, { type: 'CLICK', target: 'result_2' }]);
  assert.equal(plan.actions.some(a => a.type === 'INPUT_TEXT'), false);
});

test('unsupported outcomes are not silently absorbed as search text; bounds are enforced', () => {
  for (const prompt of ['Mở Chrome và tìm recipe và gửi tin nhắn', 'Mở Chrome, tìm recipe rồi xóa dữ liệu', 'Mở YouTube, tìm OpenAI và mở video thứ 2']) {
    assert.equal(planChromeCommand(prompt), undefined);
  }
  for (const number of [0, 100]) assert.throws(() => planChromeCommand(`Mở Chrome, tìm recipe và mở bài viết thứ ${number}`), /1\.\.99/);
});

test('incomplete Chrome plans and cross-app browser targets fail validation before execution', () => {
  assert.throws(() => validateAndroidPlan([{ type: 'OPEN_APP', app: 'chrome' }, { type: 'INPUT_TEXT', text: 'recipe' }], true), /CLICK address_bar/);
  assert.throws(() => validateAndroidPlan([{ type: 'OPEN_APP', app: 'chrome' }, { type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 }], true), /YouTube/);
  assert.throws(() => validateAndroidPlan([{ type: 'OPEN_APP', app: 'youtube' }, { type: 'CLICK', target: 'result_2' }], true), /chrome/);
  assert.throws(() => validateAndroidPlan([{ type: 'OPEN_APP', app: 'chrome' }, { type: 'CLICK', target: 'result_100' }], true), /1\.\.99/);
  assert.match(androidCapabilityPrompt(true), /result_1\.\.99/);
});

test('Agent planner recognizes article selection without asking the model or dropping the ordinal', async () => {
  let calls = 0;
  const reasoner = { generate: async () => { calls++; throw Error('Unexpected inference'); } };
  const result = await planGoal('Mở Chrome và tìm công thức nấu bún bò Huế ngon và chọn bài viết thứ 2', new AgentBudget(), reasoner);
  assert.equal(result.source, 'RULES'); assert.equal(result.goal.spec.operation, 'OPEN_RESULT');
  assert.equal(result.goal.spec.ordinal, 2); assert.equal(result.goal.subgoals.at(-1).criterion.target, 'result_2'); assert.equal(calls, 0);
});

test('interpret endpoint returns complete Chrome plan locally and rejects malformed model plans', async () => {
  const old = process.env.ANDROID_EXECUTOR_BACKEND; process.env.ANDROID_EXECUTOR_BACKEND = 'appium';
  try {
    const before = modelCalls;
    const response = await POST(request('Mở Chrome và tìm công thức nấu bún bò Huế ngon và chọn bài viết thứ hai'));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.actionPlan.actions[2].target, 'address_bar'); assert.equal(body.actionPlan.actions.at(-1).target, 'result_2');
    assert.equal(modelCalls, before);
    const malformed = await POST(request('Sử dụng trình duyệt để tìm recipe'));
    assert.equal(malformed.status, 422); assert.match((await malformed.json()).error, /CLICK address_bar/);
  } finally { if (old === undefined) delete process.env.ANDROID_EXECUTOR_BACKEND; else process.env.ANDROID_EXECUTOR_BACKEND = old; }
});
