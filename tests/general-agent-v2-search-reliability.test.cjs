/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { beginSearch, closeSearch } = require('../lib/android/agent/generic-search.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
const pkg = 'org.unprofiled.catalog';
function scene(rows) {
  const snapshotId = randomUUID(), nodes = rows.map((r, i) => ({ text: '', description: '', hint: '', resourceId: '', packageName: pkg, className: 'android.widget.TextView', enabled: true, displayed: true, clickable: false, focused: false, bounds: [10, i * 70 + 10, 390, i * 70 + 70], ...r }));
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED', viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((r, i) => ({ ...r, elementId: snapshotId + ':' + i })) };
}
const searchButton = { description: 'Search', resourceId: pkg + ':id/search', clickable: true, className: 'android.widget.ImageButton' };
const searchField = { text: 'new query', hint: 'Search', resourceId: pkg + ':id/query', className: 'android.widget.EditText', clickable: true };
test('search from old results survives unrelated content updates but binds the same fresh native control', async () => {
  const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'repeat').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'repeat', 'S'), calls = [];
  try {
    const before = scene([searchButton, { text: 'Old result advertisement' }]), fresh = scene([searchButton, { text: 'Changed advertisement' }]);
    const c = generateGroundedCandidates(node, before, 'repeat', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (_method, path) => { calls.push(path); } } };
    const observer = { readNativeSnapshot: async () => fresh, locate: async (s, target) => { assert.equal(s, fresh); assert.equal(target, 'element:' + fresh.elements[0].elementId); return { id: 'fresh-search', interaction: { method: 'ELEMENT_CLICK' } }; }, waitUntil: async condition => {
      assert.equal(condition(scene([searchButton, { text: 'Another ad update' }])), false, 'unrelated changes must not count as search opening');
      const after = scene([{ ...searchField, focused: true }]); assert.equal(condition(after), after); return after;
    } };
    await executeGroundedInteraction(session, observer, issueEffectGrant(c, node)); assert.equal(calls.length, 1);
  } finally { closeSearch(scope); }
});
test('search input without focus offers a grounded focus operation, not an unfocused IME submit', () => {
  const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'focus').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'focus', 'S');
  try {
    const c = generateGroundedCandidates(node, scene([searchField]), 'focus', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    assert.ok(c); assert.equal(c.action, 'CLICK'); assert.equal(c.search.phase, 'FOCUS');
  } finally { closeSearch(scope); }
});
test('a changed search target is classified NOT_SENT, distinct from a lost dispatch response', async () => {
  for (const lost of [false, true]) {
    const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'diagnostic').nodes[1]; node.packageName = pkg;
    const scope = beginSearch(node, 'A', 'diagnostic', 'S'), calls = [];
    try {
      const before = scene([searchButton]), c = generateGroundedCandidates(node, before, 'diagnostic', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
      const changed = scene([{ ...searchButton, bounds: [0, 200, 200, 300] }]);
      const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (_m, path) => { calls.push(path); throw Error('RPC reply lost'); } } };
      const observer = { readNativeSnapshot: async () => lost ? before : changed, locate: async () => ({ id: 'search', interaction: { method: 'ELEMENT_CLICK' } }) };
      await assert.rejects(executeGroundedInteraction(session, observer, issueEffectGrant(c, node)), error => {
        assert.equal(error.dispatchState, lost ? 'UNKNOWN' : 'NOT_SENT'); assert.ok(error.diagnosticCode); return true;
      });
      assert.equal(calls.length, lost ? 1 : 0);
    } finally { closeSearch(scope); }
  }
});

test('collapsed search query takes priority over an unrelated menu; benign popup dismissal is scoped and single-use', () => {
  const { noteSearchNavigation, searchTransitionSatisfied } = require('../lib/android/agent/generic-search.ts');
  const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'collapsed').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'collapsed', 'S');
  try {
    const results = scene([{ text: 'old query', resourceId: pkg + ':id/search_query', clickable: true }, { description: 'More options', clickable: true }]);
    const candidate = generateGroundedCandidates(node, results, 'collapsed', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    assert.equal(candidate.search.phase, 'OPEN'); assert.equal(candidate.target.resourceId, pkg + ':id/search_query');
    const popup = scene([{ className: 'android.widget.ListView', bounds: [100, 30, 380, 240] }, { text: 'Search filters', clickable: true, parentIndex: 0, bounds: [110, 80, 370, 140] }]);
    const dismiss = generateGroundedCandidates(node, popup, 'collapsed', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    assert.equal(dismiss.search.phase, 'DISMISS'); assert.equal(dismiss.action, 'BACK'); assert.ok(issueEffectGrant(dismiss, node));
    noteSearchNavigation(dismiss); assert.equal(searchTransitionSatisfied(dismiss, results), true);
    assert.equal(generateGroundedCandidates(node, popup, 'collapsed', 'S', false, 0, '', false, undefined, false, scope).candidates.length, 0);
  } finally { closeSearch(scope); }
});

test('indexed semantic choices bind exact values and negation; unsupported intent is preserved without an executable capability', async () => {
  const { proposeOutcomes, compileReviewedProposal } = require('../lib/android/agent/outcome-proposal.ts');
  const { AgentBudget } = require('../lib/android/agent/budget.ts');
  const ai = { generate: async (schema, _system, input) => schema.parse({ p: input.clauses.map(() => 1) }) };
  for (const [request, expected] of [
    ['Please launch Library and search "green and gold".', ['LAUNCH', 'SEARCH']],
    ['Do not open Maps.', ['LAUNCH']],
    ['Send a reminder to Pat.', ['UNKNOWN']],
    ['Search "birds" in Books.', ['SEARCH']],
  ]) {
    const p = await proposeOutcomes(request, ai, new AgentBudget()); assert.deepEqual(p.spec.outcomes.map(o => o.kind), expected);
    if (request.startsWith('Do not')) assert.equal(p.spec.outcomes[0].negated, true);
    if (request.startsWith('Send')) { assert.equal(p.spec.outcomes[0].semanticIntent, 'SEND_MESSAGE'); assert.notEqual(compileReviewedProposal(p, 'A', 'E').coverage, 'COMPLETE'); }
    if (request.startsWith('Search')) { assert.equal(p.spec.outcomes[0].app, 'Books'); assert.equal(p.spec.outcomes[0].value, '"birds"'); }
  }
  for (const invalid of [{ p: [] }, { p: [0] }, { p: [9] }, { p: [1, 1] }, { p: [1], selector: 'guess' }]) await assert.rejects(proposeOutcomes('Please visit Reader.', { generate: async () => invalid }, new AgentBudget()));
  await assert.rejects(proposeOutcomes('Please visit Maps and do a dance', ai, new AgentBudget()), /unresolved compound/);
  const ambiguous = await proposeOutcomes('Search flowers in Reader', ai, new AgentBudget());
  assert.notEqual(compileReviewedProposal(ambiguous, 'A', 'E').coverage, 'COMPLETE');
});

test('Dashboard SSR preserves V1 default and renders source interpretation, search outcome and bounded diagnostic without claiming blocked completion', () => {
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, fileName: f }).outputText, f);
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { AgentGoalPanel } = require('../components/commands/AgentGoalPanel.tsx');
  for (const blocked of [false, true]) {
    const graph = compileOutcomes('Mo Books va tim glossary', 'A', 'SSR'), status = blocked ? 'BLOCKED' : 'COMPLETED';
    const latest = { status, reason: blocked ? 'Search not verified' : 'Search verified', v2: { version: 2, graph,
      analysis: { syntax: 'SYNTACTICALLY_VALID', semantics: 'SEMANTICALLY_FAITHFUL', execution: 'EXECUTABLE', source: 'MODEL_REVIEWED' },
      search: { phase: 'VERIFY_SEARCH_OUTCOME', query: 'glossary', state: blocked ? 'QUERY_ENTERED' : 'SEARCH_COMPLETED',
        ...(blocked ? { diagnostic: { code: 'DISPATCH_RPC', dispatchState: 'UNKNOWN', cause: 'Reply lost; no replay' } } : { status: 'RESULTS' }) } } };
    const task = { executionId: 'SSR', deviceId: 'A', request: 'Find glossary', status, createdAt: 1, finishedAt: 2, latest, events: [] };
    const html = renderToStaticMarkup(React.createElement(AgentGoalPanel, { text: '', onText() {}, devices: [], serial: 'A', onSerial() {}, onRefresh() {}, selectedDeviceIds: [], runtime: { tasks: [task], ownerTestModes: [], command: async () => {} } }));
    assert.match(html, /Agent V1/); assert.match(html, /MODEL_REVIEWED/); assert.match(html, /glossary/);
    if (blocked) { assert.match(html, /Reply lost; no replay/); assert.doesNotMatch(html, /SEARCH_COMPLETED/); }
    else assert.match(html, /SEARCH_COMPLETED/);
  }
});

test('counted native collections verify only after a single submit receipt; unrelated or suggestion lists do not', () => {
  const { beforeSearchDispatch, noteSearchSubmitted } = require('../lib/android/agent/generic-search.ts');
  const { verifySearchOutcome } = require('../lib/android/agent/verification-registry.ts');
  const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'counted').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'counted', 'S'), context = { deviceId: 'A', executionId: 'counted', nodeId: node.id, packageName: pkg };
  try {
    const before = scene([{ ...searchField, focused: true }]);
    require('./fixtures/search-protocol.cjs').enter(node, scope, scene([{ ...searchField, text: '', focused: true }]), before);
    const c = generateGroundedCandidates(node, before, 'counted', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    const rows = [{ ...searchField }, { className: 'android.widget.RecyclerView', resourceId: pkg + ':id/collection', bounds: [0, 80, 400, 800] },
      { text: '3 items', parentIndex: 1 }, { text: 'A new native record', clickable: true, parentIndex: 1 }];
    assert.equal(verifySearchOutcome(scope, scene(rows), context), undefined);
    require('../lib/android/agent/effect-grants.ts').consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, before); noteSearchSubmitted(c);
    assert.equal(verifySearchOutcome(scope, scene(rows), context)?.search?.status, 'RESULTS');
    const suggestions = rows.map(r => ({ ...r })); suggestions[1].resourceId = pkg + ':id/suggestions';
    assert.equal(verifySearchOutcome(scope, scene(suggestions), context), undefined);
    const uncounted = rows.map(r => ({ ...r })); uncounted[2].text = 'Recent folders';
    assert.equal(verifySearchOutcome(scope, scene(uncounted), context), undefined);
  } finally { closeSearch(scope); }
});

test('live-as-you-type requires exact readback, independent query summary, changed results and two distinct stable observations', () => {
  const { beforeSearchDispatch, noteSearchQueryEntered, observeLiveSearch } = require('../lib/android/agent/generic-search.ts');
  const { verifySearchOutcome } = require('../lib/android/agent/verification-registry.ts');
  const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'live').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'live', 'S'), context = { deviceId: 'A', executionId: 'live', nodeId: node.id, packageName: pkg };
  const collection = [{ className: 'android.widget.RecyclerView', resourceId: pkg + ':id/results', bounds: [0, 80, 400, 800] }, { text: 'Old record', clickable: true, parentIndex: 1 }];
  try {
    const before = scene([{ ...searchField, text: '', focused: true }, ...collection]);
    const c = generateGroundedCandidates(node, before, 'live', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    require('../lib/android/agent/effect-grants.ts').consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, before);
    noteSearchQueryEntered(c, before, scene([{ ...searchField }, ...collection]));
    const unchanged = [{ ...searchField }, ...collection, { text: 'Results for new query' }];
    assert.equal(observeLiveSearch(scope, scene(unchanged)), false, 'a changed query summary cannot re-label an old result body');
    const changed = unchanged.map(r => ({ ...r })); changed[2].text = 'New record';
    assert.equal(observeLiveSearch(scope, scene(changed.slice(0, -1))), false, 'input and changed content alone do not prove query application');
    const first = scene(changed); assert.equal(observeLiveSearch(scope, first), 'PENDING');
    assert.equal(observeLiveSearch(scope, first), 'PENDING', 'one snapshot cannot count twice');
    assert.equal(verifySearchOutcome(scope, first, context), undefined);
    const second = scene(changed); assert.equal(observeLiveSearch(scope, second), 'VERIFIED');
    assert.equal(verifySearchOutcome(scope, second, context)?.search?.submission, 'LIVE_TRANSITION');
  } finally { closeSearch(scope); }
});
