/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { planGoal, buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget, AgentLimitError } = require('../lib/android/agent/budget.ts');
const { runAgent, policyForAgentAction } = require('../lib/android/agent/agent-loop.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { AgentMemory } = require('../lib/android/agent/memory.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { DecisionSchema, GoalSpecSchema } = require('../lib/android/agent/schema.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { StateObserver } = require('../lib/android/state-observer.ts');
const chrome = 'Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.';
const settings = 'Mở Settings và tìm mục Thông tin điện thoại.';
const youtube = 'Mở YouTube, tìm podcast tiếng Anh và phát video thứ hai.';
const node = (pkg, v = {}) => ({ packageName: pkg, className: 'android.view.View', resourceId: '', text: '', description: '',
  enabled: true, displayed: true, clickable: true, focused: false, bounds: [20, 100, 380, 200], ...v });
function snapshot(pkg, nodes, screen = 'OBSERVED', web) {
  const snapshotId = randomUUID(); return { deviceSerial: 'test', foregroundPackage: pkg, activity: 'Main', snapshotId, timestamp: Date.now(), source: 'APPIUM',
    observationStatus: screen === 'UNKNOWN' ? 'UNKNOWN' : 'OBSERVED', screen, nodes, viewport: { x: 0, y: 0, width: 400, height: 700 },
    elements: nodes.map((n, i) => ({ ...n, elementId: `${snapshotId}:${i}` })), web };
}
function mockExecution(goal, budget, initial = 'outside') {
  let stage = initial, closed = 0, observations = 0, failure, dialog = false;
  const actions = [], pkg = goal.packageName, query = goal.spec.query;
  const selected = { itemType: goal.spec.resultType, ordinal: goal.spec.ordinal, identity: 'actual', title: 'Actual selected content', url: 'https://example.org/article' };
  function state() {
    if (stage === 'outside') return snapshot('launcher', [node('launcher')]);
    if (stage === 'loading') return snapshot(pkg, [], 'UNKNOWN');
    const native = goal.spec.resultType === 'browser' ? 'url_bar' : 'search_edit_text';
    const input = node(pkg, { className: 'android.widget.EditText', resourceId: pkg + ':id/' + native, focused: true,
      text: stage === 'typed' ? query : '' });
    if (stage === 'input' || stage === 'typed') return snapshot(pkg, [input], goal.spec.resultType === 'video' ? 'SEARCH_INPUT' : 'INPUT');
    if (stage === 'results') return goal.spec.resultType === 'browser' ? snapshot(pkg, [node(pkg)], 'OBSERVED',
      { status: 'DOM_AVAILABLE', document: { url: 'https://search.example.org/?q=' + encodeURIComponent(query), title: 'Results', readyState: 'complete', headings: [], ambiguousAds: false, links: [{ title: selected.title }] } }) :
      snapshot(pkg, [node(pkg, { resourceId: pkg + ':id/search_query', text: query })], 'SEARCH_RESULTS');
    if (stage === 'destination') return goal.spec.resultType === 'browser' ? snapshot(pkg, [node(pkg)], 'OBSERVED',
      { status: 'DOM_AVAILABLE', document: { url: selected.url, title: selected.title, headings: [selected.title], readyState: 'complete', links: [] } }) :
      snapshot(pkg, [node(pkg, { resourceId: pkg + ':id/watch_player' }), node(pkg, { resourceId: pkg + ':id/video_metadata_layout' }),
        node(pkg, { text: selected.title, parentIndex: 1 })], 'VIDEO_PLAYER');
    const nodes = goal.spec.operation === 'FIND_ELEMENT' ? [node(pkg, { text: goal.spec.targetText, bounds: stage === 'found' ? [20, 100, 380, 160] : [20, 900, 380, 1000] })] :
      [node(pkg, { description: 'Search', resourceId: pkg + ':id/' + (goal.spec.resultType === 'browser' ? 'url_bar' : 'menu_search') })];
    if (dialog) nodes.push(node(pkg, { className: 'android.app.Dialog', resourceId: 'android:id/alertTitle', text: 'An informational popup' }));
    return snapshot(pkg, nodes);
  }
  return { backend: 'appium', actions, selected,
    set stage(v) { stage = v; }, set dialog(v) { dialog = v; }, set failure(v) { failure = v; },
    get closed() { return closed; }, get observations() { return observations; },
    async observe() { budget.consume('snapshots'); observations++; return state(); },
    discoveryMemory() { return { anchored: true, items: [] }; },
    async execute(action) {
      actions.push(action);
      if (failure) return failure(action, this);
      if (action.type === 'OPEN_APP') stage = 'browse';
      else if (action.type === 'PRESS_KEY' && action.key === 'BACK') dialog = false;
      else if (action.type === 'CLICK') stage = /result|video_card/.test(action.target) ? 'destination' : 'input';
      else if (action.type === 'INPUT_TEXT') stage = 'typed';
      else if (action.type === 'PRESS_KEY') stage = 'results';
      else if (action.type === 'WAIT_FOR') { budget.consume('scrolls'); stage = 'found'; }
      return { verification: action.key === 'BACK' ? 'DISPATCHED' : 'VERIFIED', elapsedMs: 1,
        selection: stage === 'destination' ? selected : undefined, postcondition: 'Mock verified' };
    }, async close() { closed++; },
  };
}
async function prepared(text = chrome, limits = {}, initial) {
  const budget = new AgentBudget(limits), { goal } = await planGoal(text, budget);
  return { goal, budget, execution: mockExecution(goal, budget, initial) };
}
test('planner creates criteria, not immutable action arrays, for three distinct applications', async () => {
  for (const text of [chrome, settings, youtube]) {
    const p = await prepared(text); assert.equal(p.goal.actions, undefined); assert.ok(p.goal.subgoals.every(s => s.criterion));
    assert.equal(p.budget.counters.reasoning, 0); assert.equal(p.goal.originalRequest, text);
  }
});
test('generic loop verifies Chrome, Settings and YouTube goals in mocks with one execution context', async () => {
  for (const text of [chrome, settings, youtube]) {
    const p = await prepared(text), events = []; const out = await runAgent(p.goal, p.budget, p.execution, undefined, undefined, e => events.push(e));
    assert.equal(out.result.status, 'COMPLETED'); assert.equal(p.execution.closed, 1);
    assert.ok(events.some(e => e.status === 'VERIFYING')); assert.ok(out.memory.observations.length <= 12);
  }
});
test('already-observed results skip search actions instead of replaying a fixed script', async () => {
  const p = await prepared(chrome, {}, 'results'); const out = await runAgent(p.goal, p.budget, p.execution);
  assert.equal(out.result.status, 'COMPLETED'); assert.deepEqual(p.execution.actions, [{ type: 'CLICK', target: 'first_result' }]);
});
test('unexpected benign dialog is dismissed once and its disappearance is verified before continuing', async () => {
  const p = await prepared(settings, {}, 'browse'); p.execution.dialog = true;
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'COMPLETED');
  assert.equal(p.execution.actions.filter(a => a.key === 'BACK').length, 1);
});
test('slow loading is observed without a fixed sleep, extra AI or premature completion', async () => {
  const p = await prepared(settings, {}, 'loading'), original = p.execution.observe;
  p.execution.observe = async () => { if (p.execution.observations === 2) p.execution.stage = 'browse'; return original(); };
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'COMPLETED'); assert.equal(p.budget.counters.reasoning, 0);
});
test('missing element is BLOCKED and assistance is explicitly non-resumable after cleanup', async () => {
  const p = await prepared(settings); p.execution.failure = async action => { if (action.type === 'OPEN_APP') { p.execution.stage = 'browse'; return { verification: 'VERIFIED' }; } throw new AndroidExecutionError('NOT_FOUND', 'Missing target'); };
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'BLOCKED');
  assert.equal(out.result.assistance.resumable, false); assert.equal(p.execution.closed, 1);
});
test('wrong foreground causes bounded replan rather than weakening completion criteria', async () => {
  const p = await prepared(settings), original = p.execution.observe;
  p.execution.observe = async () => { if (p.goal.currentSubgoal === 1 && p.budget.counters.replans === 0) p.execution.stage = 'outside'; return original(); };
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'COMPLETED'); assert.equal(p.budget.counters.replans, 1);
});
test('unverified result click is not repeated when destination cannot be proven', async () => {
  const p = await prepared(chrome, {}, 'results'); p.execution.failure = async () => { throw new AndroidExecutionError('TIMEOUT', 'Unknown postcondition'); };
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'BLOCKED'); assert.equal(p.execution.actions.length, 1);
});
test('late destination evidence can complete after timeout without sending a second click', async () => {
  const p = await prepared(chrome, {}, 'results'); p.execution.failure = async () => {
    p.execution.stage = 'destination'; const e = new AndroidExecutionError('TIMEOUT', 'Delayed page'); e.selection = p.execution.selected; throw e;
  };
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'COMPLETED'); assert.equal(p.execution.actions.length, 1);
});
test('AI completion claim without snapshot criteria is rejected', async () => {
  const p = await prepared(chrome); const out = await runAgent(p.goal, p.budget, p.execution, { decide: async () => ({ type: 'COMPLETE_GOAL', reason: 'Done' }) });
  assert.equal(out.result.status, 'BLOCKED'); assert.equal(p.execution.actions.length, 0);
});
test('unsupported/shell actions and AI-generated coordinates fail validation before dispatch', () => {
  for (const d of [{ type: 'EXECUTE_ACTION', action: { type: 'SHELL', command: 'something' }, reason: 'x' },
    { type: 'EXECUTE_ACTION', action: { type: 'CLICK', target: 'first_result', command: 'something' }, reason: 'x' },
    { type: 'EXECUTE_ACTION', action: { type: 'CLICK', x: 1, y: 2 }, reason: 'x' }, { type: 'EXPLORE_UI', target: 'x', reason: 'x', script: 'alert(1)' }]) assert.equal(DecisionSchema.safeParse(d).success, false);
});
test('policy denies sensitive/foreign targets and arbitrary text even if a model proposes them', async () => {
  const p = await prepared(chrome, {}, 'results');
  for (const action of [{ type: 'CLICK', target: 'delete_button' }, { type: 'OPEN_APP', app: 'other' }, { type: 'INPUT_TEXT', text: 'not the query' }]) {
    assert.throws(() => policyForAgentAction(p.goal, action, snapshot(p.goal.packageName, [])));
  }
  const out = await runAgent(p.goal, p.budget, p.execution, { decide: async () => ({ type: 'EXECUTE_ACTION', action: { type: 'CLICK', target: 'delete_button' }, reason: 'model suggestion' }) });
  assert.equal(out.result.status, 'BLOCKED'); assert.equal(p.execution.actions.length, 0);
});
test('sensitive request or flag cannot be erased by the internal planner', async () => {
  await assert.rejects(planGoal('Mở YouTube và đăng ký kênh', new AgentBudget()));
  assert.throws(() => buildGoal(chrome, { app: 'chrome', operation: 'OPEN_APP', isSensitive: true }, new AgentBudget()));
});
test('planner cannot silently drop requested query, app or ordinal', () => {
  for (const spec of [{ app: 'chrome', operation: 'OPEN_APP', isSensitive: false },
    { app: 'chrome', operation: 'OPEN_RESULT', query: 'invented', resultType: 'browser', ordinal: 1, isSensitive: false },
    { app: 'chrome', operation: 'OPEN_RESULT', query: 'công thức nấu phở', resultType: 'browser', ordinal: 2, isSensitive: false }]) assert.throws(() => buildGoal(chrome, spec, new AgentBudget()));
});
test('iteration loop, steps, snapshots, replans and time budgets all terminate and close context', async () => {
  for (const limits of [{ steps: 1 }, { snapshots: 1 }, { iterations: 1 }]) {
    const p = await prepared(chrome, limits); const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'BLOCKED'); assert.equal(p.execution.closed, 1);
  }
  const p = await prepared(chrome); p.budget.remaining = () => 0;
  assert.equal((await runAgent(p.goal, p.budget, p.execution)).result.status, 'BLOCKED');
  const q = await prepared(chrome, { replans: 0 });
  assert.equal((await runAgent(q.goal, q.budget, q.execution, { decide: async () => ({ type: 'REPLAN_SUBGOAL', subgoalId: 'subgoal-0', reason: 'test' }) })).result.status, 'BLOCKED');
});
test('unchanged scene/zero progress is detected even if a model keeps asking to observe', async () => {
  const p = await prepared(chrome); const out = await runAgent(p.goal, p.budget, p.execution, { decide: async () => ({ type: 'OBSERVE_AGAIN', reason: 'wait' }) });
  assert.equal(out.result.status, 'BLOCKED'); assert.ok(p.execution.observations <= 4);
});
test('cancellation and cleanup errors are observable, never reported complete', async () => {
  const p = await prepared(chrome), a = new AbortController(); a.abort();
  assert.equal((await runAgent(p.goal, p.budget, p.execution, undefined, a.signal)).result.status, 'CANCELLED'); assert.equal(p.execution.closed, 1);
  const q = await prepared('Mở Chrome', {}, 'browse'); q.execution.close = async () => { throw Error('cleanup'); };
  assert.equal((await runAgent(q.goal, q.budget, q.execution)).result.status, 'FAILED');
});
test('reasoning is bounded/cached on unchanged state and never receives screenshot or full hierarchy', async () => {
  const p = await prepared(chrome, {}, 'browse'), s = snapshot(p.goal.packageName, ['tab_switcher_view_holder', 'hub_main_container'].map(id => node(p.goal.packageName, { resourceId: p.goal.packageName + ':id/' + id })));
  p.goal.currentSubgoal = 1; const memory = new AgentMemory(); memory.observe(s, 1); let calls = 0, packet;
  const engine = new AgentDecisionEngine({ generate: async (schema, system, input) => { calls++; packet = input; return schema.parse({ choice: 'OBSERVE_AGAIN', snapshotId: input.snapshotId, subgoalId: input.subgoalId, reason: 'Unknown screen' }); } });
  await engine.decide(p.goal, s, memory, {}, p.budget); await engine.decide(p.goal, s, memory, {}, p.budget);
  assert.equal(calls, 1); assert.equal(packet.screenshot, undefined); assert.equal(packet.nodes, undefined); assert.ok(packet.candidates.length <= 6);
});
test('Ollama adapter uses the existing model, a separate schema/prompt and real deadline/usage counters', async () => {
  const budget = new AgentBudget(); let body;
  const client = new OllamaAgentReasoner(async (url, options) => { body = JSON.parse(options.body); return Response.json({ message: { content: JSON.stringify({ app: 'chrome', operation: 'OPEN_APP', isSensitive: false }) } }); });
  await client.generate(GoalSpecSchema, 'Internal agent system', { request: 'Mở Chrome' }, budget);
  assert.equal(body.model, process.env.OLLAMA_MODEL ?? 'phone-commander'); assert.equal(body.stream, false); assert.equal(body.messages[0].content, 'Internal agent system'); assert.equal(budget.counters.reasoning, 1);
});
test('backend poll accounting enforces the global snapshot budget, not only agent outer loops', async () => {
  const budget = new AgentBudget({ snapshots: 1 });
  const observer = new StateObserver({ serial: 'test' }, async () => ({ stdout: '' }), { beforeSnapshot: () => budget.consume('snapshots') });
  observer.readNativeAccounted = async () => snapshot('test', [node('test')]);
  await observer.read(); await assert.rejects(observer.read(), AgentLimitError); assert.equal(budget.counters.snapshots, 1);
});
test('a verified status bit without a real completion snapshot cannot complete the goal', async () => {
  const p = await prepared(chrome, {}, 'results');
  p.execution.failure = async () => ({ verification: 'VERIFIED', selection: p.execution.selected });
  const out = await runAgent(p.goal, p.budget, p.execution); assert.notEqual(out.result.status, 'COMPLETED'); assert.equal(p.execution.closed, 1);
});
test('recent executor postcondition snapshot is accepted only after independently checking the final criterion', async () => {
  const p = await prepared(settings, {}, 'browse');
  p.execution.verificationSnapshot = () => snapshot(p.goal.packageName, [node(p.goal.packageName, { text: p.goal.spec.targetText })]);
  const out = await runAgent(p.goal, p.budget, p.execution); assert.equal(out.result.status, 'COMPLETED'); assert.equal(p.execution.closed, 1);
  const q = await prepared(settings, {}, 'browse');
  q.execution.failure = async () => ({ verification: 'VERIFIED' });
  q.execution.verificationSnapshot = () => ({ ...snapshot(q.goal.packageName, [node(q.goal.packageName, { text: q.goal.spec.targetText })]), timestamp: Date.now() - 10000 });
  const failed = await runAgent(q.goal, q.budget, q.execution); assert.notEqual(failed.result.status, 'COMPLETED');
});
test('planner refuses close/change/screenshot outcomes rather than silently treating them as OPEN_APP', () => {
  for (const request of ['Đóng Chrome', 'Mở Settings và thay đổi Wi-Fi', 'Mở Chrome và chụp screenshot']) {
    assert.throws(() => buildGoal(request, { app: request.includes('Settings') ? 'settings' : 'chrome', operation: 'OPEN_APP', isSensitive: false }, new AgentBudget()));
  }
});
