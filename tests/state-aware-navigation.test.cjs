/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { runAgent, policyForAgentAction } = require('../lib/android/agent/agent-loop.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { generateActionCandidates, revalidateCandidate } = require('../lib/android/agent/action-candidates.ts');
const { verifyCandidateOutcome } = require('../lib/android/agent/candidate-verifier.ts');
const { understandCurrentScreen, resolveRequiredCapability } = require('../lib/android/agent/navigation-semantics.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const youtube = 'com.google.android.youtube', chrome = 'com.android.chrome', settings = 'com.android.settings';
function scene(kind, pkg = youtube, device = 'A', query = '') {
  const node = (v = {}) => ({ packageName: pkg, className: 'android.view.View', resourceId: '', text: '', description: '',
    bounds: [0, 100, 400, 180], enabled: true, displayed: true, clickable: false, focused: false, ...v });
  let nodes = [], screen = 'OBSERVED', web;
  if (kind === 'media' || kind === 'fullscreen') {
    nodes = [node({ resourceId: pkg + ':id/watch_player', bounds: kind === 'media' ? [0, 0, 400, 225] : [0, 0, 800, 400], description: 'Video player' })];
    if (kind === 'media') nodes.push(node({ resourceId: pkg + ':id/video_metadata_layout', bounds: [0, 225, 400, 800] }));
    screen = kind === 'media' ? 'VIDEO_PLAYER' : 'OBSERVED';
  } else if (kind === 'home' || kind === 'web') {
    nodes = [node({ resourceId: pkg + ':id/' + (pkg === chrome ? 'url_bar' : 'menu_search'), description: 'Search', clickable: true })];
    if (kind === 'web') nodes.push(node({ className: 'android.webkit.WebView', bounds: [0, 200, 400, 800] }));
  } else if (kind === 'input' || kind === 'typed') {
    nodes = [node({ className: 'android.widget.EditText', resourceId: pkg + ':id/' + (pkg === chrome ? 'url_bar' : 'search_edit_text'),
      focused: true, clickable: true, text: query })]; screen = 'SEARCH_INPUT';
  } else if (kind === 'results') {
    nodes = [node({ resourceId: pkg + ':id/search_query', text: query })]; screen = 'SEARCH_RESULTS';
    if (pkg === chrome) web = { status: 'DOM_AVAILABLE', document: { url: 'https://example.org/?q=' + encodeURIComponent(query),
      title: 'Results', readyState: 'complete', headings: [], ambiguousAds: false, links: [{ title: 'Python guide' }] } };
  } else if (kind.startsWith('settings')) {
    nodes = [node({ className: 'android.widget.Toolbar', resourceId: pkg + ':id/toolbar', bounds: [0, 0, 400, 100] }),
      node({ className: 'android.widget.TextView', resourceId: 'android:id/title', text: kind === 'settings-detail' ? 'Display' : kind === 'settings-middle' ? 'Advanced' : 'Settings',
        bounds: [70, 10, 350, 90], parentIndex: 0 })];
    if (kind !== 'settings-root') nodes.push(node({ className: 'android.widget.ImageButton', description: 'Navigate up', clickable: true, bounds: [0, 10, 60, 90], parentIndex: 0 }));
    else nodes.push(node({ className: 'androidx.recyclerview.widget.RecyclerView', scrollable: true, bounds: [0, 100, 400, 800] }),
      node({ text: 'Thông tin điện thoại', clickable: true, parentIndex: 2, bounds: [0, 110, 400, 180] }));
  } else if (kind === 'unknown') nodes = [node({ text: 'Unclassified content' })];
  const snapshotId = randomUUID();
  return { snapshotId, timestamp: Date.now(), deviceSerial: device, foregroundPackage: pkg, activity: 'Activity', observationStatus: 'OBSERVED', screen,
    viewport: { x: 0, y: 0, width: kind === 'fullscreen' ? 800 : 400, height: kind === 'fullscreen' ? 400 : 800 }, nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })), web };
}
function fixture(initial = 'media', pkg = youtube, device = 'A', options = {}) {
  const budget = new AgentBudget({ reasoning: 1, ...options.limits });
  budget.runtimeIdentity = { deviceId: device, executionId: randomUUID() };
  const goal = pkg === settings ? buildGoal('Mở Settings và tìm mục Thông tin điện thoại',
    { app: 'settings', operation: 'FIND_ELEMENT', targetText: 'Thông tin điện thoại', isSensitive: false }, budget) :
    buildGoal(`Mở ${pkg === chrome ? 'Chrome' : 'YouTube'}, tìm OpenAI`, { app: pkg === chrome ? 'chrome' : 'youtube', operation: 'SEARCH',
      query: 'OpenAI', resultType: pkg === chrome ? 'browser' : 'video', isSensitive: false }, budget);
  let state = initial, query = '', verified, closed = 0, reasoning = 0;
  const events = [], actions = [];
  const read = () => {
    const s = scene(state, state === 'outside' ? settings : pkg, device, query);
    if (options.ambiguousRoutes && state === 'media') {
      const base = s.nodes[0];
      s.nodes.push({ ...base, resourceId: pkg + ':id/toolbar_up', description: 'Navigate up', bounds: [0, 230, 60, 290], clickable: true },
        { ...base, resourceId: pkg + ':id/toolbar_menu', description: 'More options', bounds: [320, 230, 400, 290], clickable: true });
      s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
    }
    return s;
  };
  const execution = { backend: 'appium', deviceId: device, discoveryMemory() {}, verificationSnapshot: () => verified,
    async observe() { budget.recordSnapshot(); return options.observe?.(read()) ?? read(); },
    async execute(action, signal, _progress, candidate) {
      signal?.throwIfAborted(); const before = read(); actions.push(action); verified = undefined;
      if (options.error) throw new AndroidExecutionError(options.error, 'Simulated failure');
      if (!options.noProgress) {
        if (action.type === 'OPEN_APP') state = options.afterOpen ?? 'home';
        else if (candidate?.semanticRole === 'capability_navigation') state = state === 'fullscreen' ? 'media' : state.startsWith('settings') ? 'settings-root' : 'home';
        else if (action.type === 'CLICK') state = 'input';
        else if (action.type === 'INPUT_TEXT') { state = 'typed'; query = action.text; }
        else if (action.type === 'PRESS_KEY' && action.key === 'ENTER') state = 'results';
      }
      verified = read();
      if (candidate && !verifyCandidateOutcome(goal, candidate, before, verified)) throw new AndroidExecutionError('TIMEOUT', 'No verified route');
      return { verification: 'VERIFIED', elapsedMs: 1, postcondition: 'Simulated observed transition' };
    }, async close() { closed++; } };
  const engine = new AgentDecisionEngine({ async generate(schema, _prompt, payload, budget) {
    reasoning++;
    if (!options.ambiguousRoutes) throw Error('Unexpected model call');
    budget.consume('reasoning');
    assert.equal(payload.screen.deviceId, device); assert.equal(payload.screen.executionId, budget.runtimeIdentity.executionId);
    assert.equal(payload.requiredCapability.name, 'SEARCH_CONTENT');
    return schema.parse({ choice: payload.candidates.find(c => c.description.includes('UP')).id, snapshotId: payload.snapshotId,
      subgoalId: payload.subgoalId, reason: 'Choose the supplied reversible Up control.' });
  } });
  return { goal, budget, actions, events, execution, get closed() { return closed; }, get reasoning() { return reasoning; },
    run: signal => runAgent(goal, budget, execution, engine, signal, e => { events.push(e); options.progress?.(e); }) };
}

test('SIMULATED: media, fullscreen, focused search, Chrome page, Settings submenu and unknown are evidence classified', () => {
  for (const [kind, pkg, type] of [['media', youtube, 'MEDIA_PLAYBACK'], ['fullscreen', youtube, 'FULLSCREEN'],
    ['input', youtube, 'SEARCH_INPUT'], ['web', chrome, 'CONTENT_DETAIL'], ['settings-detail', settings, 'CONTENT_DETAIL'], ['unknown', youtube, 'UNKNOWN']]) {
    const s = scene(kind, pkg), state = understandCurrentScreen(s, 'execution');
    assert.equal(state.screenType, type); assert.equal(state.snapshotId, s.snapshotId);
    assert.equal(state.deviceId, 'A'); assert.equal(state.executionId, 'execution');
  }
  assert.equal(understandCurrentScreen({ ...scene('media'), nodes: [], elements: [] }, 'execution').screenType, 'UNKNOWN');
});

for (const [initial, count] of [['home', 0], ['media', 1], ['fullscreen', 2]]) test(`SIMULATED: ${initial} reaches search without reset or unnecessary navigation`, async context => {
  const t = fixture(initial), out = await t.run();
  assert.equal(out.result.status, 'COMPLETED'); assert.equal(t.closed, 1); assert.equal(t.reasoning, 0);
  assert.equal(out.memory.navigation.length, count);
  assert.ok(out.memory.navigation.every(row => row.verification === 'VERIFIED'));
  assert.equal(t.actions.filter(a => a.type === 'PRESS_KEY' && a.key === 'BACK').length, count);
  assert.ok(!t.actions.some(a => ['CLOSE_APP', 'OPEN_APP'].includes(a.type)));
  assert.equal(out.result.currentScreen.executionId, t.budget.runtimeIdentity.executionId);
  assert.equal(out.result.currentScreen.screenType, 'SEARCH_RESULTS');
  assert.ok(!JSON.stringify(out.memory.screenStates).includes('<hierarchy'));
  context.diagnostic(JSON.stringify({ initial, navigationActions: count, steps: t.budget.counters.steps,
    snapshots: t.budget.counters.snapshots, reasoning: t.reasoning, recognitionMs: out.result.navigation.recognitionMs,
    navigationMs: out.result.navigation.navigationMs, totalMs: out.result.timings.totalMs }));
});

test('SIMULATED: already focused input skips navigation and a Chrome page keeps its address bar', async () => {
  const a = fixture('input'), b = fixture('web', chrome);
  for (const t of [a, b]) {
    const out = await t.run(); assert.equal(out.result.status, 'COMPLETED'); assert.equal(out.memory.navigation.length, 0);
    assert.ok(!t.actions.some(a => a.type === 'PRESS_KEY' && a.key === 'BACK'));
  }
  assert.equal(a.actions[0].type, 'INPUT_TEXT'); assert.equal(b.actions[0].type, 'CLICK');
});

test('SIMULATED: Settings uses the observed Up control and preserves the parent target', async () => {
  const t = fixture('settings-detail', settings), criteria = JSON.stringify(t.goal.subgoals.map(s => s.criterion));
  const out = await t.run(); assert.equal(out.result.status, 'COMPLETED');
  assert.equal(out.memory.navigation.length, 1); assert.equal(out.memory.navigation[0].action.type, 'CLICK');
  assert.equal(JSON.stringify(t.goal.subgoals.map(s => s.criterion)), criteria);
  assert.equal(out.memory.recovery.history[0].objective, 'NAVIGATE_CAPABILITY');
  assert.equal(out.memory.recovery.history[0].status, 'COMPLETED');
});

test('SIMULATED: three different starting screens navigate independently with no cross-device state', async () => {
  const fixtures = [fixture('home', youtube, 'A'), fixture('media', youtube, 'B'), fixture('outside', youtube, 'C', { afterOpen: 'media' })];
  const outcomes = await Promise.all(fixtures.map(t => t.run()));
  assert.deepEqual(outcomes.map(o => o.result.status), ['COMPLETED', 'COMPLETED', 'COMPLETED']);
  assert.deepEqual(outcomes.map(o => o.memory.navigation.length), [0, 1, 1]);
  assert.equal(fixtures[2].actions[0].type, 'OPEN_APP');
  outcomes.forEach((out, i) => assert.ok(out.memory.screenStates.every(s => s.deviceId === ['A', 'B', 'C'][i])));
});

test('SIMULATED: unchanged BACK never repeats or completes; unknown UI requests assistance', async () => {
  const a = fixture('media', youtube, 'A', { noProgress: true }), b = fixture('unknown');
  for (const t of [a, b]) { const out = await t.run(); assert.equal(out.result.status, 'BLOCKED'); assert.equal(t.closed, 1); }
  assert.equal(a.actions.length, 1); assert.ok(!b.actions.some(a => a.type === 'CLICK' || a.type === 'PRESS_KEY'));
});

test('SIMULATED: stale, cross-device, wrong-app, foreign and sensitive route evidence is rejected', () => {
  const t = fixture(), s = scene('media'); t.goal.currentSubgoal = 1;
  const candidate = generateActionCandidates(t.goal, s)[0];
  assert.equal(candidate.semanticRole, 'capability_navigation');
  assert.equal(revalidateCandidate(candidate, t.goal, { ...s, timestamp: Date.now() - 10000 }), false);
  assert.equal(verifyCandidateOutcome(t.goal, candidate, s, scene('home', youtube, 'B')), false);
  assert.equal(verifyCandidateOutcome(t.goal, candidate, s, scene('home', settings)), false);
  const input = scene('input'); input.nodes[0].text = 'unsaved draft';
  assert.throws(() => policyForAgentAction(t.goal, candidate.action, input, candidate));
  const sensitive = scene('media'); sensitive.nodes.push({ ...sensitive.nodes[0], packageName: 'com.android.permissioncontroller' });
  assert.equal(generateActionCandidates(t.goal, sensitive).length, 0);
});

test('SIMULATED: navigation cancellation, disconnect and changed device isolate other executions and close once', async () => {
  for (const code of ['DEVICE_ERROR', 'SESSION_ERROR']) {
    const t = fixture('media', youtube, 'A', { error: code }); const out = await t.run();
    assert.equal(out.result.status, 'FAILED'); assert.equal(t.closed, 1);
  }
  const controller = new AbortController();
  const a = fixture('media', youtube, 'A', { progress(e) { if (e.status === 'EXECUTING') controller.abort(); } }), b = fixture('home', youtube, 'B');
  const [cancelled, completed] = await Promise.all([a.run(controller.signal), b.run()]);
  assert.equal(cancelled.result.status, 'CANCELLED'); assert.equal(a.actions.length, 0); assert.equal(completed.result.status, 'COMPLETED');
  const cross = fixture('media', youtube, 'A', { observe: s => ({ ...s, deviceSerial: 'B' }) });
  assert.equal((await cross.run()).result.status, 'FAILED'); assert.equal(cross.actions.length, 0);
});

test('SIMULATED: UI changed while choosing a route discards the decision instead of using a stale element', async () => {
  let reads = 0;
  const t = fixture('media', youtube, 'A', { observe(s) { return ++reads === 3 ? scene('home') : s; } });
  const out = await t.run();
  assert.ok(t.events.some(e => e.reason.includes('UI changed while reasoning')));
  assert.notEqual(out.result.status, 'FAILED');
  assert.ok(out.memory.screenStates.length <= 12);
});

test('SIMULATED: navigation deadline and shared step budget are not reset', async () => {
  const t = fixture('fullscreen', youtube, 'A', { limits: { steps: 1 } });
  const out = await t.run(); assert.equal(out.result.status, 'BLOCKED'); assert.equal(t.actions.length, 1);
  assert.equal(t.budget.counters.steps, 1); assert.equal(t.closed, 1);
  assert.equal(resolveRequiredCapability(t.goal, scene('media')).name, 'SEARCH_CONTENT');
});

test('SIMULATED: multiple valid routes use one constrained reasoning call with execution identity', async () => {
  const t = fixture('media', youtube, 'A', { ambiguousRoutes: true }); const out = await t.run();
  assert.equal(out.result.status, 'COMPLETED'); assert.equal(t.reasoning, 1);
  assert.equal(out.memory.navigation[0].action.type, 'CLICK');
  assert.equal(out.memory.navigation[0].verification, 'VERIFIED');
});

test('SIMULATED: a UI change during reasoning never activates the old candidate', async () => {
  let reads = 0;
  const t = fixture('media', youtube, 'A', { ambiguousRoutes: true, observe(s) { return ++reads >= 3 ? scene('unknown') : s; } });
  const out = await t.run();
  assert.equal(out.result.status, 'BLOCKED'); assert.equal(t.reasoning, 1); assert.equal(t.actions.length, 0);
  assert.ok(t.events.some(e => e.reason.includes('UI changed while reasoning')));
});

test('SIMULATED: generic accessible applications use observed Up, not a vendor-specific action sequence', async () => {
  const { discoverApplication } = require('../lib/android/agent/application-discovery.ts');
  const pkg = 'org.example.gallery', budget = new AgentBudget();
  const app = await discoverApplication('A', pkg, async () => ({ stdout: pkg + '/.Main', stderr: '' }));
  const goal = buildGoal(`Mở ${pkg} và mở trang Albums`, { app: pkg, operation: 'OPEN_PAGE', targetText: 'Albums', isSensitive: false }, budget, app);
  goal.currentSubgoal = 1;
  const old = scene('settings-detail', pkg), candidates = generateActionCandidates(goal, old);
  assert.equal(candidates.length, 1); assert.equal(candidates[0].semanticRole, 'capability_navigation');
  assert.doesNotThrow(() => policyForAgentAction(goal, candidates[0].action, old, candidates[0]));
  const fresh = scene('settings-root', pkg);
  assert.equal(verifyCandidateOutcome(goal, candidates[0], old, fresh), true);
});

test('SIMULATED: Dashboard renders screen, required capability and actual verification without chain of thought', () => {
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f,
  }).outputText, f);
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { NavigationProgressView } = require('../components/commands/AgentGoalPanel.tsx');
  const event = { currentScreen: understandCurrentScreen(scene('media'), 'execution'), navigation: { required: { name: 'SEARCH_CONTENT', ready: false },
    phase: 'NAVIGATING', lastAction: 'PRESS_KEY', verification: 'VERIFIED', candidates: [], actionCount: 1, recognitionMs: 1.2, navigationMs: 250 } };
  const markup = renderToStaticMarkup(React.createElement(NavigationProgressView, { event }));
  assert.ok(markup.includes('MEDIA_PLAYBACK')); assert.ok(markup.includes('SEARCH_CONTENT')); assert.ok(markup.includes('VERIFIED'));
});

test('SIMULATED: executor submits an existing exact search query without relying on a previous INPUT_TEXT', async () => {
  const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
  let keys = 0;
  const executor = new ConditionExecutor({ serial: 'A', ensureActive: async () => {}, client: { request: async () => {} } }, async args => {
    assert.ok(args.some(arg => /keyevent/.test(arg))); keys++; return { stdout: '', stderr: '' };
  });
  executor.observer = { read: async () => scene('input', youtube, 'A', 'OpenAI'), waitUntil: async condition => {
    const results = scene('results', youtube, 'A', 'OpenAI'); assert.ok(await condition(results, 1000)); return results;
  } };
  const outcome = await executor.execute({ type: 'PRESS_KEY', key: 'ENTER' });
  assert.equal(outcome.verification, 'VERIFIED'); assert.equal(keys, 1); assert.match(outcome.postcondition, /search results verified/);
});

test('SIMULATED: an unverified navigation dispatch cannot resume the parent goal', async () => {
  const t = fixture('media');
  t.execution.execute = async () => ({ verification: 'DISPATCHED' });
  const out = await t.run();
  assert.equal(out.result.status, 'BLOCKED'); assert.equal(out.memory.navigation[0].verification, 'SENT'); assert.equal(t.closed, 1);
});

test('SIMULATED: filled unfocused forms and loading pages cannot authorize an Up gesture', () => {
  const t = fixture('settings-detail', settings); t.goal.currentSubgoal = 1;
  const form = scene('settings-detail', settings);
  form.nodes.push({ ...form.nodes[1], className: 'android.widget.EditText', resourceId: settings + ':id/name', text: 'Unsaved draft', parentIndex: undefined,
    bounds: [0, 200, 400, 300], focused: false });
  form.elements = form.nodes.map((n, i) => ({ ...n, elementId: form.snapshotId + ':' + i }));
  assert.ok(!generateActionCandidates(t.goal, form).some(c => c.semanticRole === 'capability_navigation'));
  const loading = scene('settings-detail', settings);
  loading.nodes.push({ ...loading.nodes[1], className: 'android.widget.ProgressBar', text: '', bounds: [0, 200, 400, 300], parentIndex: undefined });
  loading.elements = loading.nodes.map((n, i) => ({ ...n, elementId: loading.snapshotId + ':' + i }));
  assert.ok(!generateActionCandidates(t.goal, loading).some(c => c.semanticRole === 'capability_navigation'));
});

test('SIMULATED: ticking video content does not invalidate a stable route, but changed route evidence does', () => {
  const t = fixture('media'); t.goal.currentSubgoal = 1;
  const old = scene('media'), candidate = generateActionCandidates(t.goal, old)[0];
  const fresh = scene('media');
  fresh.nodes.push({ ...fresh.nodes[1], resourceId: youtube + ':id/time', text: '00:12', bounds: [0, 300, 120, 340] });
  fresh.elements = fresh.nodes.map((n, i) => ({ ...n, elementId: fresh.snapshotId + ':' + i }));
  assert.equal(revalidateCandidate(candidate, t.goal, fresh), true);
  for (const changed of [scene('fullscreen'), scene('home'), scene('media', youtube, 'B')]) {
    assert.equal(revalidateCandidate(candidate, t.goal, changed), false);
  }
  const moved = scene('media'); moved.nodes[0].bounds = [0, 0, 400, 220];
  assert.equal(revalidateCandidate(candidate, t.goal, moved), false);
  const permission = scene('media'); permission.nodes.push({ ...permission.nodes[0], packageName: 'com.android.permissioncontroller' });
  assert.equal(revalidateCandidate(candidate, t.goal, permission), false);
});

test('SIMULATED: continuously changing playback counters still allow a verified navigation step', async () => {
  let reads = 0;
  const t = fixture('media', youtube, 'A', { observe(s) {
    if (s.screen === 'VIDEO_PLAYER') {
      s.nodes.push({ ...s.nodes[1], resourceId: youtube + ':id/time', text: String(++reads), bounds: [0, 300, 100, 340] });
      s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
    }
    return s;
  } });
  const out = await t.run(); assert.equal(out.result.status, 'COMPLETED'); assert.equal(out.memory.navigation.length, 1);
});
