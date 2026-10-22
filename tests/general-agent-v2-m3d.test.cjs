/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const search = require('../lib/android/agent/generic-search.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
const { runGenericSearch, SearchNeedsUserAction } = require('../lib/android/agent/search-executor.ts');
const { exclusiveActivationPoint } = require('../lib/android/activation-point.ts');
const { readKeyboardVisibility } = require('../lib/android/agent/keyboard-visibility.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const pkg = 'org.new.search';
function scene(rows) {
  const snapshotId = randomUUID(), nodes = rows.map((r, i) => ({ text: '', description: '', resourceId: '', packageName: pkg, className: 'android.widget.TextView', enabled: true, displayed: true, clickable: false, focused: false, bounds: [10, i * 70 + 10, 390, i * 70 + 70], ...r }));
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((r, i) => ({ ...r, elementId: snapshotId + ':' + i })) };
}
function setup() { const node = compileOutcomes('Mo ' + pkg + ' va tim exact query', 'A', 'E').nodes[1]; node.packageName = pkg; return { node, scope: search.beginSearch(node, 'A', 'E', 'S') }; }
const candidate = (node, scope, s) => generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
const field = { className: 'android.widget.EditText', resourceId: pkg + ':id/query', hint: 'Search', clickable: true, focused: true };

for (const initial of ['exact query', 'different query']) test('M3d replace ' + initial + ': verified empty precedes exact entry and fresh result proof', async () => {
  const { node, scope } = setup(); let text = initial, submitted = false; const calls = [];
  const view = () => scene([{ ...field, text }, ...(text === '' ? [] : [{ text: 'No results found' }])]);
  const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (method, path, body) => {
    if (method === 'GET') return 'false'; calls.push(path);
    if (path.endsWith('/clear')) text = '';
    if (path.endsWith('/value')) text = body.text;
    if (path.endsWith('/execute/sync')) submitted = true;
  } } };
  const observer = { readNativeSnapshot: async () => view(), locate: async () => ({ id: 'field' }), waitUntil: async condition => { const s = view(); assert.equal(await condition(s), s); return s; } };
  try {
    const clear = candidate(node, scope, view()); assert.equal(clear.search.phase, 'CLEAR');
    const empty = await executeGroundedInteraction(session, observer, issueEffectGrant(clear, node)); assert.equal(empty.nodes[0].text, '');
    const enter = candidate(node, scope, empty); assert.equal(enter.search.phase, 'ENTER');
    await executeGroundedInteraction(session, observer, issueEffectGrant(enter, node));
    assert.equal(search.searchResult(scope, view()), undefined, 'typing alone is not submission');
    const submit = candidate(node, scope, view()); assert.equal(submit.search.phase, 'SUBMIT');
    await executeGroundedInteraction(session, observer, issueEffectGrant(submit, node)); assert.equal(submitted, true);
    const k = await readKeyboardVisibility('A', async () => ({ stdout: 'mInputShown=false' })); search.noteSearchKeyboard(scope, k);
    assert.equal(search.searchResult(scope, view()), undefined, 'first unchanged-at-submit body needs independent stable second snapshot');
    assert.equal(search.searchResult(scope, view()).status, 'NO_RESULTS');
    assert.deepEqual(calls.map(p => p.split('/').at(-1)), ['clear', 'value', 'sync']);
  } finally { search.closeSearch(scope); }
});

test('M3d failed clear, stale body and password never authorize query entry or completion', async () => {
  const { node, scope } = setup();
  try {
    const s = scene([{ ...field, text: 'old' }]), c = candidate(node, scope, s);
    assert.throws(() => search.noteSearchCleared(c, scene([{ ...field, text: 'old' }])));
    assert.equal(candidate(node, scope, s).search.phase, 'CLEAR');
    assert.equal(candidate(node, scope, scene([{ ...field, text: 'secret', password: true }])), undefined);
    assert.equal(search.searchResult(scope, scene([{ ...field, text: 'exact query' }, { text: 'No results found' }])), undefined);
    assert.throws(() => search.noteSearchQueryEntered(c, s, scene([{ ...field, text: 'exact query' }])));
    assert.equal(search.confirmSearchActivation(c, s, { deviceId: 'A', shown: true, observedAt: Date.now() }, true), false);
  } finally { search.closeSearch(scope); }
});

test('M3d native showing-hint is required to distinguish an empty editable from literal hint-valued input', () => {
  const { parseUiHierarchy } = require('../lib/android/targets.ts');
  const { observedAffordances } = require('../lib/android/agent/ui-affordances.ts');
  for (const showing of ['true', 'false', undefined]) {
    const xml = `<hierarchy><node package="${pkg}" class="android.widget.EditText" text="Search" hint="Search" ${showing ? `showing-hint="${showing}"` : ''} enabled="true" clickable="true" focused="true" bounds="[0,0][400,60]" /></hierarchy>`;
    const nodes = parseUiHierarchy(xml), s = scene(nodes), row = observedAffordances(s, 'E', 'S')[0];
    assert.equal(s.nodes[0].text, 'Search', 'raw native evidence is preserved');
    assert.equal(row.text, showing === 'true' ? '' : 'Search');
  }
});

test('M3d uncertain clear cannot proceed to entry; observed empty-field recovery is bounded and cannot discard data', async () => {
  const { node, scope } = setup();
  try {
    const old = scene([{ ...field, text: 'old' }]), clear = candidate(node, scope, old); let writes = 0;
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async method => { if (method === 'GET') return 'false'; writes++; } } };
    const observer = { readNativeSnapshot: async () => old, locate: async () => ({ id: 'field' }), waitUntil: async condition => { assert.equal(await condition(old), false); throw Error('EMPTY_NOT_VERIFIED'); } };
    await assert.rejects(executeGroundedInteraction(session, observer, issueEffectGrant(clear, node)), e => e.dispatchState === 'ACKNOWLEDGED' && /EMPTY_NOT_VERIFIED/.test(e.message));
    assert.equal(writes, 1); assert.equal(candidate(node, scope, old).search.phase, 'CLEAR');
  } finally { search.closeSearch(scope); }
  const next = setup();
  try {
    const back = { description: 'Navigate up', clickable: true }, blank = { ...field, resourceId: '', hint: '', text: '' };
    const c = candidate(next.node, next.scope, scene([back, blank])); assert.equal(c.search.phase, 'RESET'); assert.ok(issueEffectGrant(c, next.node));
    assert.equal(candidate(next.node, next.scope, scene([back, { ...blank, text: 'unsaved' }])), undefined);
    search.noteSearchNavigation(c); assert.equal(candidate(next.node, next.scope, scene([back, blank])), undefined);
  } finally { search.closeSearch(next.scope); }
});

test('M3d executor confirms unlabelled editable only after acknowledged issued activation and independent native password/keyboard readbacks', async () => {
  const { node, scope } = setup();
  try {
    const before = scene([{ description: 'Search', clickable: true }]), after = scene([{ className: 'android.widget.EditText', clickable: true, focused: true }]);
    const c = candidate(node, scope, before); const calls = [];
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (method, path) => { calls.push(path); return method === 'GET' ? 'false' : undefined; } } };
    const observer = { readNativeSnapshot: async () => before, locate: async () => ({ id: 'field', interaction: { method: 'ELEMENT_CLICK' } }),
      keyboardVisibility: async () => readKeyboardVisibility('A', async () => ({ stdout: 'mInputShown=true' })), waitUntil: async condition => { assert.equal(await condition(after), after); return after; } };
    await executeGroundedInteraction(session, observer, issueEffectGrant(c, node));
    assert.equal(candidate(node, scope, after).search.phase, 'ENTER');
    assert.deepEqual(calls, ['/session/S/element/field/click', '/session/S/element/field/attribute/password']);
  } finally { search.closeSearch(scope); }
});

test('M3d safe activation partitions center coverage, full overlays, nested controls and viewport clip', () => {
  const target = { clickable: true, bounds: [0, 0, 400, 200] };
  const partial = scene([target, { clickable: true, bounds: [150, 0, 250, 200] }]);
  const p = exclusiveActivationPoint(partial, partial.nodes[0]); assert.ok(p); assert.ok(p.x < 150 || p.x > 250);
  const full = scene([target, { clickable: true, bounds: [0, 0, 400, 200] }]); assert.equal(exclusiveActivationPoint(full, full.nodes[0]), undefined);
  const nested = scene([target, { clickable: true, parentIndex: 0, bounds: [100, 0, 400, 200] }]);
  assert.ok(exclusiveActivationPoint(nested, nested.nodes[0]).x < 100);
  const offscreen = scene([{ ...target, bounds: [-100, -50, 200, 100] }]);
  const clipped = exclusiveActivationPoint(offscreen, offscreen.nodes[0]); assert.ok(clipped.x >= 0 && clipped.y >= 0);
  const invisible = scene([{ ...target, bounds: [-100, -50, -1, -1] }]); assert.equal(exclusiveActivationPoint(invisible, invisible.nodes[0]), undefined);
});

test('M3d exact record correlation recognizes a generic collection, not history, editable echo, duplicate lists or stale records', () => {
  const { resultSurface } = require('../lib/android/agent/read-only-verifiers.ts');
  const rows = [{ ...field, text: 'exact query' }, { className: 'android.widget.RecyclerView', resourceId: pkg + ':id/collection', bounds: [0, 80, 400, 800] },
    { clickable: true, parentIndex: 1, bounds: [10, 100, 390, 300] }, { text: 'exact query', parentIndex: 2, bounds: [10, 130, 390, 190] }];
  assert.equal(resultSurface(scene(rows), 'exact query').containers.length, 1);
  for (const bad of [rows.slice(0, 3), rows.map((r, i) => i === 1 ? { ...r, resourceId: pkg + ':id/history' } : r),
    rows.map((r, i) => i === 3 ? { ...r, text: 'exact query plus unrelated' } : r)]) assert.equal(resultSurface(scene(bad), 'exact query').containers.length, 0);
  const duplicated = scene([...rows, { ...rows[1] }, { ...rows[2], parentIndex: 4 }, { ...rows[3], parentIndex: 5 }]);
  assert.equal(resultSurface(duplicated, 'exact query').containers.length, 2, 'ambiguous peer collections are not silently selected');
  for (const stale of [false, true]) {
    const { node, scope } = setup();
    try {
      const typed = scene(rows), before = scene([{ ...field, text: '' }, ...(stale ? rows.slice(1) : [])]);
      require('./fixtures/search-protocol.cjs').enter(node, scope, before, typed);
      const submit = candidate(node, scope, typed); search.beforeSearchDispatch(submit, typed); search.noteSearchSubmitted(submit);
      const final = () => scene(rows.map((r, i) => i === 0 ? { ...r, focused: false } : r));
      assert.equal(search.searchResult(scope, final()), undefined);
      assert.equal(Boolean(search.searchResult(scope, final())), !stale);
    } finally { search.closeSearch(scope); }
  }
});

test('M3d transient loading is observed again without clicking or accepting launch as content completion', async () => {
  const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts'); let reads = 0, effects = 0, closed = 0; const events = [];
  const adapter = { catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) }, open: async () => ({
    backend: 'appium', sessionId: () => 'S', observe: async () => scene(++reads === 1 ? [{ className: 'android.widget.ProgressBar' }] : [{ text: 'App home' }]),
    execute: async () => { effects++; }, interactV2: async () => { effects++; }, close: async () => { closed++; } }) };
  await runAgentV2('Mo ' + pkg, 'A', 'E', 'physical', new AgentBudget(), adapter, e => events.push(e), undefined, { generate() { throw Error('No model'); } });
  assert.equal(events.at(-1).status, 'COMPLETED'); assert.equal(reads, 2); assert.equal(effects, 0); assert.equal(closed, 1);
});

test('M3d Dashboard SSR renders typed user-action metadata and current-screen reference without claiming completion', () => {
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, fileName: f }).outputText, f);
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), { AgentGoalPanel } = require('../components/commands/AgentGoalPanel.tsx');
  const graph = compileOutcomes('Mo ' + pkg + ' va tim exact query', 'A', 'E');
  const latest = { status: 'BLOCKED', v2: { version: 2, graph, result: 'SAFE_BLOCKED', search: { phase: 'NEEDS_USER_ACTION', query: 'exact query', userAction: { state: 'NEEDS_USER_ACTION', reason: 'CONSENT_OR_PRIVACY_SURFACE', snapshotId: 'observed-snapshot', screenshotRef: '/api/devices/A/screenshot' } } } };
  const html = renderToStaticMarkup(React.createElement(AgentGoalPanel, { text: '', onText() {}, devices: [], serial: 'A', onSerial() {}, onRefresh() {}, selectedDeviceIds: [], runtime: { tasks: [{ executionId: 'E', deviceId: 'A', status: 'BLOCKED', createdAt: 1, finishedAt: 2, latest, events: [] }], ownerTestModes: [], command: async () => {} } }));
  assert.match(html, /CONSENT_OR_PRIVACY_SURFACE/); assert.match(html, /observed-snapshot/); assert.match(html, /href="\/api\/devices\/A\/screenshot"/); assert.doesNotMatch(html, /SEARCH_COMPLETED/);
});

for (const mode of ['new', 'no-field', 'two', 'unchanged', 'resized', 'password', 'no-keyboard', 'forged']) test('M3d activation provenance: ' + mode, async () => {
  const { node, scope } = setup();
  try {
    const unlabelled = { className: 'android.widget.EditText', clickable: true, focused: true, resourceId: '', bounds: [0, 200, 400, 260] };
    const before = scene([{ description: 'Search', clickable: true }, ...(['unchanged', 'resized'].includes(mode) ? [{ ...unlabelled, ...(mode === 'resized' ? { bounds: [0, 200, 350, 260] } : {}) }] : [])]);
    const c = candidate(node, scope, before); assert.ok(c);
    search.noteSearchActivationAcknowledged(c, before);
    const after = scene(mode === 'no-field' ? [] : [unlabelled, ...(mode === 'two' ? [{ ...unlabelled, bounds: [0, 300, 400, 360] }] : [])]);
    const k = await readKeyboardVisibility('A', async () => ({ stdout: 'mInputShown=' + (mode !== 'no-keyboard') }));
    assert.equal(search.confirmSearchActivation(c, after, mode === 'forged' ? { ...k } : k, mode !== 'password'), mode === 'new');
    assert.equal(Boolean(candidate(node, scope, after)), mode === 'new');
  } finally { search.closeSearch(scope); }
});

test('M3d consent is typed user action with screenshot reference, zero clicks, and repeated fresh classification on resume', async () => {
  const { node, scope } = setup(); search.closeSearch(scope);
  let clicks = 0, observations = 0, assistance = 0; const progress = [];
  const input = { node, deviceId: 'A', executionId: 'E', budget: new AgentBudget(),
    execution: { sessionId: () => 'S', interactV2: async () => { clicks++; throw Error('Consent must not click'); } },
    fresh: async () => { observations++; return scene([{ text: 'Privacy terms' }, { text: 'Accept', clickable: true }, { text: 'Decline', clickable: true }]); },
    choose() { throw Error('No choices'); }, progress: p => progress.push(p) };
  await assert.rejects(runGenericSearch(input), e => e instanceof SearchNeedsUserAction && e.userAction.screenshotRef.includes('/screenshot'));
  input.budget = new AgentBudget({ iterations: 3 }); input.userAction = async () => { assistance++; };
  await assert.rejects(runGenericSearch(input), /iterations budget/);
  assert.equal(clicks, 0); assert.equal(assistance, 3); assert.equal(observations, 4); assert.equal(progress.filter(p => p.phase === 'NEEDS_USER_ACTION').length, 4);
});

test('M3d singleton clauses keep full validation and skip inference, forced protocol yields the same binding', async () => {
  const { proposePrimitiveDecomposition } = require('../lib/android/agent/primitive-decomposition.ts');
  const request = 'Ghe Atlas roi do "salt water"', apps = [{ label: 'Atlas', packageName: 'org.atlas' }];
  const budget = new AgentBudget(); let calls = 0;
  const ai = { generate: async (schema, _system, input) => { calls++; return schema.parse({ c: input.c, p: input.c === 1 ? 'OPEN_APP' : 'SEARCH', s: input.slots.find(s => input.c === 1 ? s[1] === 'Atlas' : s[1].startsWith('"'))[0], a: null, n: false, d: input.prior }); } };
  const fast = await proposePrimitiveDecomposition(request, ai, budget, undefined, { apps }); assert.equal(calls, 0); assert.equal(budget.profiling.singletonClausesSkipped, 2);
  const reference = await proposePrimitiveDecomposition(request, ai, new AgentBudget(), undefined, { apps, forceModel: true }); assert.equal(calls, 2); assert.deepEqual(fast.steps, reference.steps);
  await assert.rejects(proposePrimitiveDecomposition('Ghe Atlas roi xoa "all"', ai, new AgentBudget(), undefined, { apps }));
});
