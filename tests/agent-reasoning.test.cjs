/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { DecisionSchema } = require('../lib/android/agent/schema.ts');
const { planGoal, buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { navigationLayers } = require('../lib/android/browser-navigation.ts');
const { runAgent, policyForAgentAction } = require('../lib/android/agent/agent-loop.ts');
const { probeOllama } = require('../lib/android/agent/diagnostics.ts');
const { StateObserver } = require('../lib/android/state-observer.ts');
const { matchUiTarget } = require('../lib/android/ui-understanding.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { AgentMemory } = require('../lib/android/agent/memory.ts');
function state(ids = []) {
  const pkg = 'com.android.chrome', snapshotId = randomUUID();
  const nodes = ids.map((id, i) => ({ packageName: pkg, className: 'android.view.View', resourceId: pkg + ':id/' + id,
    text: '', description: '', enabled: true, clickable: id === 'url_bar', displayed: true, focused: false, bounds: [20, 100 + i * 40, 380, 140 + i * 40] }));
  return { snapshotId, timestamp: Date.now(), source: 'APPIUM', foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: 'OBSERVED', nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: `${snapshotId}:${i}` })), viewport: { x: 0, y: 0, width: 400, height: 800 } };
}
const overview = ['tab_switcher_view_holder', 'hub_main_container'];
test('explicit search-only goal verifies results without silently weakening a selection request', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm công thức nấu phở.', budget);
  assert.equal(goal.spec.operation, 'SEARCH'); assert.equal(goal.subgoals.length, 2); assert.equal(goal.subgoals[1].criterion.kind, 'SEARCH_RESULTS');
  assert.throws(() => buildGoal('Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.', goal.spec, budget));
  await assert.rejects(planGoal('Mở Chrome, tìm phở và đóng app.', budget));
});
test('model schema constrains inferred targets and allows only evidenced overlay navigation actions', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm phở.', budget);
  goal.currentSubgoal = 1; const snapshot = state(overview), memory = new AgentMemory(); memory.observe(snapshot, 1);
  const engine = new AgentDecisionEngine({ async generate(schema, system, input) {
    assert.equal(schema.safeParse({ type: 'EXPLORE_UI', target: 'search_box', reason: 'Guess' }).success, false);
    assert.equal(schema.safeParse({ type: 'EXECUTE_ACTION', action: { type: 'CLICK', target: 'address_bar' }, reason: 'Hidden target' }).success, false);
    assert.ok(JSON.stringify(input).length < 6000); assert.equal(input.candidates[0].role, 'reversible_navigation');
    return schema.parse({ choice: input.candidates[0].id, snapshotId: input.snapshotId, subgoalId: input.subgoalId, reason: 'Dismiss native overview' });
  } });
  assert.equal((await engine.decide(goal, snapshot, memory, {}, budget)).action.key, 'BACK');
});
test('competing address controls stop without asking a model to guess activation', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm phở.', budget);
  goal.currentSubgoal = 1; const snapshot = state(['url_bar', 'url_bar']), memory = new AgentMemory(); memory.observe(snapshot, 1);
  const engine = new AgentDecisionEngine({ async generate() { throw new Error('Must not be called'); } });
  const result = await engine.decide(goal, snapshot, memory, {}, budget);
  assert.equal(result.type, 'REQUEST_HUMAN_ASSISTANCE'); assert.equal(result.category, 'INTERACTION_POSITION'); assert.equal(budget.counters.reasoning, 0);
});
test('a tab-search EditText is not the browser address bar', () => {
  const snapshot = state(['search_box_text']); snapshot.nodes[0].className = 'android.widget.EditText'; snapshot.nodes[0].clickable = true;
  assert.equal(matchUiTarget(snapshot, 'address_bar').status, 'MISSING');
  assert.equal(matchUiTarget(state(['url_bar']), 'address_bar').status, 'MATCH');
});
test('real adapter telemetry is derived from server metrics, not fabricated token counts', async () => {
  const budget = new AgentBudget();
  const client = new OllamaAgentReasoner(async () => Response.json({ message: { content: '{"type":"OBSERVE_AGAIN","reason":"Wait for evidence"}' }, load_duration: 123000000, prompt_eval_count: 80, eval_count: 12, eval_duration: 456000000 }));
  await client.generate(DecisionSchema, 'Internal', {}, budget);
  assert.equal(budget.counters.reasoning, 1);
  assert.deepEqual({ ...budget.reasoningMeasurements[0], model: '', elapsedMs: 0, responseMs: 0 }, { model: '', elapsedMs: 0, responseMs: 0, status: 'VALID', loadMs: 123, promptTokens: 80, outputTokens: 12, evalMs: 456 });
});
test('timeout, HTTP failure and invalid JSON are distinct safe outcomes with one counted call', async () => {
  for (const [status, fetcher] of [['TIMEOUT', async () => { throw new DOMException('Timeout', 'TimeoutError'); }],
    ['HTTP_ERROR', async () => new Response('', { status: 500 })], ['INVALID_JSON', async () => Response.json({ message: { content: 'not JSON' } })]]) {
    const budget = new AgentBudget(); await assert.rejects(new OllamaAgentReasoner(fetcher).generate(DecisionSchema, 'Internal', {}, budget));
    assert.equal(budget.reasoningMeasurements[0].status, status); assert.equal(budget.counters.reasoning, 1);
  }
});
test('BACK requires a proven reversible layer, not a guessed unknown screen', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm phở và mở kết quả đầu tiên.', budget);
  assert.throws(() => policyForAgentAction(goal, { type: 'PRESS_KEY', key: 'BACK' }, state()));
  assert.doesNotThrow(() => policyForAgentAction(goal, { type: 'PRESS_KEY', key: 'BACK' }, state(overview)));
  assert.deepEqual(navigationLayers(state(['hub_main_container'])), []);
  assert.deepEqual(navigationLayers({ ...state(overview), foregroundPackage: 'other' }), []);
  const changed = state(overview); changed.nodes.push({ ...changed.nodes[0], packageName: 'com.android.permissioncontroller' });
  assert.throws(() => policyForAgentAction(goal, { type: 'PRESS_KEY', key: 'BACK' }, changed));
});
test('UI change while model reasons discards the action and cannot dispatch against stale state', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm phở và mở kết quả đầu tiên.', budget);
  let reads = 0, decisions = 0, actions = 0, closed = 0;
  const execution = { backend: 'appium', async observe() { budget.consume('snapshots'); return ++reads === 1 ? state(overview) : state(['url_bar']); },
    discoveryMemory() { return {}; }, async execute() { actions++; }, async close() { closed++; } };
  const provider = { async decide() { decisions++; if (decisions === 1) { budget.consume('reasoning'); return { type: 'EXECUTE_ACTION', action: { type: 'PRESS_KEY', key: 'BACK' }, reason: 'Dismiss overlay' }; }
    return { type: 'FAIL_GOAL', reason: 'End changed-state test' }; } };
  const out = await runAgent(goal, budget, execution, provider);
  assert.equal(actions, 0); assert.equal(closed, 1); assert.equal(out.result.status, 'FAILED'); assert.equal(decisions, 2);
});
test('BACK is verified only when an observed layer disappears and a valid search control returns', async () => {
  const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm phở và mở kết quả đầu tiên.', budget);
  let reads = 0, decisions = 0;
  const execution = { backend: 'appium', async observe() { return ++reads === 1 ? state(overview) : state(['url_bar']); }, discoveryMemory() { return {}; },
    async execute() { return { verification: 'DISPATCHED', elapsedMs: 1 }; }, async close() {} };
  const provider = { async decide() { return ++decisions === 1 ? { type: 'EXECUTE_ACTION', action: { type: 'PRESS_KEY', key: 'BACK' }, reason: 'Dismiss observed layer' } : { type: 'FAIL_GOAL', reason: 'End verification test' }; } };
  const out = await runAgent(goal, budget, execution, provider);
  assert.equal(out.memory.actions[0].verification, 'VERIFIED'); assert.equal(goal.subgoals.at(-1).status, 'PENDING');
});
test('streaming probe validates complete JSON and measures first content without exposing content', async () => {
  const fetcher = async url => String(url).endsWith('/api/chat') ? new Response(
    '{"message":{"content":"{\\"ready\\":true}"},"done":false}\n{"done":true,"load_duration":9000000,"prompt_eval_count":36,"eval_count":6}\n') : Response.json({ models: [] });
  const report = await probeOllama(true, undefined, fetcher);
  assert.equal(report.chat.status, 'VALID'); assert.equal(report.chat.loadMs, 9); assert.equal(report.chat.outputTokens, 6);
  assert.equal(report.chat.content, undefined); assert.equal(typeof report.chat.firstTokenMs, 'number');
});
test('missing stream final packet cannot be reported as a healthy model response', async () => {
  const fetcher = async url => String(url).endsWith('/api/chat') ? new Response('{"message":{"content":"{\\"ready\\":true}"}}\n') : Response.json({ models: [] });
  assert.equal((await probeOllama(true, undefined, fetcher)).chat.status, 'FAILED');
});
test('native browser overview is observed without attaching DOM or activating a different tab', async () => {
  const requests = [];
  const session = { serial: 'test', path: '/session/test', client: { async request(method, path) {
    requests.push(path);
    if (path.endsWith('/context')) return 'NATIVE_APP';
    if (path.endsWith('/current_package')) return 'com.android.chrome';
    if (path.endsWith('/current_activity')) return 'Main';
    if (path.endsWith('/window/rect')) return { x: 0, y: 0, width: 400, height: 800 };
    if (path.endsWith('/source')) return '<hierarchy>' + overview.map(id => `<node package="com.android.chrome" resource-id="com.android.chrome:id/${id}" class="android.widget.FrameLayout" enabled="true" clickable="true" displayed="true" bounds="[0,0][400,800]" />`).join('') + '</hierarchy>';
    throw new Error('Unexpected DOM or context operation');
  } } };
  const snapshot = await new StateObserver(session, async () => ({ stdout: 'device', stderr: '' })).read();
  assert.equal(snapshot.web.status, 'WEB_UNAVAILABLE'); assert.equal(snapshot.web.source, 'NATIVE_ONLY');
  assert.equal(requests.some(p => /contexts|execute/.test(p)), false);
});
