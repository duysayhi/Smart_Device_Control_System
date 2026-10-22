/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { beginSearch, closeSearch, searchTransitionSatisfied } = require('../lib/android/agent/generic-search.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { executeGroundedInteraction, consumeNotSentReceipt, GroundedInteractionFailure } = require('../lib/android/grounded-interactions.ts');
const { runGenericSearch } = require('../lib/android/agent/search-executor.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const pkg = 'org.unprofiled.records';
function scene(rows) {
  const snapshotId = randomUUID(), nodes = rows.map((r, i) => ({ text: '', description: '', resourceId: '', packageName: pkg, className: 'android.widget.TextView', enabled: true, displayed: true, clickable: false, focused: false, bounds: [10, i * 70 + 10, 390, i * 70 + 70], ...r }));
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((r, i) => ({ ...r, elementId: snapshotId + ':' + i })) };
}
const field = { hint: 'Search', resourceId: pkg + ':id/query', className: 'android.widget.EditText', clickable: true };
function scoped() { const n = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'E').nodes[1]; n.packageName = pkg; return { node: n, scope: beginSearch(n, 'A', 'E', 'S') }; }
const candidate = (n, scope, s) => generateGroundedCandidates(n, s, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];

test('M3c receipt-level NOT_SENT expiration re-grounds once with a new grant and unchanged TTL', async () => {
  for (const expires of [1, 2]) {
    const originalNow = Date.now; let clock = originalNow(), text = 'old', submitted = false, locates = 0; Date.now = () => clock;
    const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'E').nodes[1]; node.packageName = pkg;
    const grants = [], calls = [], progress = [], budget = new AgentBudget();
    const view = () => scene([{ ...field, focused: true, text }, ...(submitted ? [{ text: 'No results found' }] : [])]);
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (method, path, body) => {
      if (method === 'GET') return 'false'; calls.push(path);
      if (path.endsWith('/clear')) text = '';
      if (path.endsWith('/value')) text = body.text;
      if (path.endsWith('/execute/sync')) submitted = true;
    } } };
    const observer = { readNativeSnapshot: async () => view(), locate: async () => { if (++locates <= expires) clock += 5001; return { id: 'input', interaction: { method: 'ELEMENT_CLICK' } }; },
      waitUntil: async condition => { const after = view(); assert.equal(condition(after), after); return after; } };
    const execution = { sessionId: () => 'S', interactV2: async grant => {
      assert.equal(grant.expiresAt - clock, 5000); grants.push(grant.id); return executeGroundedInteraction(session, observer, grant);
    } };
    try {
      const run = () => runGenericSearch({ node, deviceId: 'A', executionId: 'E', execution, budget, fresh: async () => view(), choose() { throw Error('Singleton candidate must not call model'); }, progress: p => progress.push(p) });
      if (expires === 1) { const proof = await run(); assert.equal(proof.search.status, 'NO_RESULTS'); assert.equal(calls.length, 3); }
      else { await assert.rejects(run(), /GRANT_EXPIRED/); assert.equal(calls.length, 0); }
      assert.equal(budget.counters.retries, 1); assert.ok(budget.counters.steps >= 2); assert.equal(new Set(grants).size, grants.length);
      assert.equal(progress.filter(p => p.phase === 'REGROUND_NOT_SENT').length, 1);
    } finally { Date.now = originalNow; }
  }
});

test('M3c UNKNOWN/forged/foreign/cloned receipts cannot authorize replay; authentic receipt is single-use', async () => {
  const originalNow = Date.now; let clock = originalNow(); Date.now = () => clock;
  const { node, scope } = scoped();
  try {
    const c = candidate(node, scope, scene([{ description: 'Search', clickable: true }])), grant = issueEffectGrant(c, node);
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async () => { throw Error('reply lost'); } } };
    const observer = { readNativeSnapshot: async () => scene([{ description: 'Search', clickable: true }]), locate: async () => { clock += 5001; return { id: 'x', interaction: { method: 'ELEMENT_CLICK' } }; } };
    let error; try { await executeGroundedInteraction(session, observer, grant); } catch (e) { error = e; }
    assert.equal(error.dispatchState, 'NOT_SENT');
    assert.equal(consumeNotSentReceipt({ ...error }, c), false);
    assert.equal(consumeNotSentReceipt(new GroundedInteractionFailure('NOT_SENT', 'GRANT_EXPIRED', Error('fake')), c), false);
    for (const key of ['deviceId', 'executionId', 'sessionId', 'nodeId']) assert.equal(consumeNotSentReceipt(error, { ...c, [key]: 'foreign' }), false);
    assert.equal(consumeNotSentReceipt(error, c), true); assert.equal(consumeNotSentReceipt(error, c), false);
    const next = candidate(node, scope, scene([{ description: 'Search', clickable: true }]));
    observer.locate = async () => ({ id: 'x', interaction: { method: 'ELEMENT_CLICK' } });
    await assert.rejects(executeGroundedInteraction(session, observer, issueEffectGrant(next, node)), e => {
      assert.equal(e.dispatchState, 'UNKNOWN'); assert.equal(consumeNotSentReceipt(e, next), false); return true;
    });
  } finally { closeSearch(scope); Date.now = originalNow; }
});

test('M3c activation precedes editing; independent focus readback allows direct focused or transitioned input only', async () => {
  const { node, scope } = scoped();
  try {
    const before = scene([{ ...field, text: 'old' }]), activate = candidate(node, scope, before);
    assert.equal(activate.search.phase, 'FOCUS'); assert.equal(activate.action, 'CLICK');
    assert.equal(searchTransitionSatisfied(activate, scene([{ ...field, text: 'old' }])), false);
    assert.equal(searchTransitionSatisfied(activate, scene([{ ...field, focused: true }, { ...field, focused: true }])), false);
    const focused = scene([{ ...field, focused: true, text: 'old' }]);
    assert.equal(searchTransitionSatisfied(activate, focused), true); assert.equal(candidate(node, scope, focused).search.phase, 'CLEAR');
    assert.equal(searchTransitionSatisfied(activate, scene([{ ...field, resourceId: pkg + ':id/new_query', focused: true }])), true, 'a unique distinct focused search editable is independent transition evidence');
    let calls = 0;
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async () => { calls++; } } };
    const observer = { readNativeSnapshot: async () => before, locate: async () => ({ id: 'x', interaction: { method: 'ELEMENT_CLICK' } }), waitUntil: async condition => {
      assert.equal(condition(scene([{ ...field }])), false); throw Error('ACTIVATION_NO_CHANGE');
    } };
    await assert.rejects(executeGroundedInteraction(session, observer, issueEffectGrant(activate, node)), e => { assert.equal(e.dispatchState, 'ACKNOWLEDGED'); assert.match(e.message, /ACTIVATION_NO_CHANGE/); return true; });
    assert.equal(calls, 1, 'no clear or value after failed activation');
  } finally { closeSearch(scope); }
});

test('M3c invalid-element-state input dispatch is UNKNOWN and never retried', async () => {
  const { node, scope } = scoped();
  try {
    const s = scene([{ ...field, focused: true, text: 'old' }]), c = candidate(node, scope, s); let writes = 0;
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async method => { if (method === 'GET') return 'false'; writes++; throw Error('invalid element state'); } } };
    const observer = { readNativeSnapshot: async () => s, locate: async () => ({ id: 'x' }) };
    await assert.rejects(executeGroundedInteraction(session, observer, issueEffectGrant(c, node)), e => { assert.equal(e.dispatchState, 'UNKNOWN'); assert.equal(consumeNotSentReceipt(e, c), false); return true; });
    assert.equal(writes, 1);
  } finally { closeSearch(scope); }
});

test('M3c structural bottom navigation and overflow search are grounded hops, never parent completion or guessed clicks', () => {
  const { node, scope } = scoped();
  try {
    const bottom = scene([{ className: 'android.view.View', clickable: true, checkable: true, selected: false, bounds: [0, 0, 400, 160] }, { text: 'Search', parentIndex: 0, bounds: [20, 10, 100, 60] }]);
    const open = candidate(node, scope, bottom); assert.ok(open); assert.equal(open.target.index, 0); assert.equal(open.search.phase, 'OPEN'); assert.ok(issueEffectGrant(open, node));
    assert.equal(searchTransitionSatisfied(open, bottom), false);
    assert.equal(searchTransitionSatisfied(open, scene([{ ...field, focused: true }])), true);
    assert.equal(candidate(node, scope, scene([{ text: 'Unrelated item', clickable: true }])), undefined);
    const menu = candidate(node, scope, scene([{ description: 'More options', clickable: true }])); assert.equal(menu.search.phase, 'MENU');
    assert.equal(searchTransitionSatisfied(menu, scene([{ text: 'Search', clickable: true }])), true);
    assert.equal(searchTransitionSatisfied(menu, scene([{ text: 'Help', clickable: true }])), false);
  } finally { closeSearch(scope); }
});

test('M3c navigation no-change/duplicate-target loops stop and consume exploration budget', async () => {
  const node = compileOutcomes('Mo ' + pkg + ' va tim new query', 'A', 'E').nodes[1]; node.packageName = pkg;
  const budget = new AgentBudget(); let calls = 0;
  const view = () => scene([{ description: 'Search', clickable: true }]);
  const execution = { sessionId: () => 'S', interactV2: async () => { calls++; return view(); } };
  await assert.rejects(runGenericSearch({ node, deviceId: 'A', executionId: 'E', execution, budget, fresh: async () => view(), choose() { throw Error('no model'); }, progress() {} }), /SEARCH_EFFECT_REPLAY_BLOCKED/);
  assert.equal(calls, 1); assert.equal(budget.counters.recoverySubtasks, 1);
});

test('M3c unlabeled selectable peer navigation derives search intent only from a unique child and one active sibling', () => {
  const { node, scope } = scoped();
  try {
    const rows = [
      { className: 'android.view.View', bounds: [0, 0, 400, 250] },
      { className: 'android.view.View', parentIndex: 0, selected: true, bounds: [0, 0, 120, 200] },
      { className: 'android.view.View', parentIndex: 0, selected: false, clickable: true, bounds: [120, 0, 240, 200] },
      { text: 'Search', parentIndex: 2, bounds: [140, 10, 220, 70] },
    ];
    const c = candidate(node, scope, scene(rows)); assert.equal(c?.target.index, 2); assert.equal(c.target.navigationIntent, 'SEARCH');
    for (const variant of [
      rows.map((r, i) => i === 1 ? { ...r, selected: false } : r),
      rows.map((r, i) => i === 0 ? { ...r, className: 'android.widget.RecyclerView' } : r),
      [...rows, { text: 'Search', parentIndex: 2, bounds: [140, 80, 220, 120] }],
      [...rows, { description: 'Purchase', parentIndex: 2, clickable: true }],
    ]) assert.equal(candidate(node, scope, scene(variant)), undefined);
  } finally { closeSearch(scope); }
});

test('M3c successful activation dispatch is independently read back before a separate replacement grant', async () => {
  const { node, scope } = scoped(); let focused = false;
  try {
    const view = () => scene([{ ...field, focused, text: 'old' }]);
    const c = candidate(node, scope, view()), writes = [];
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (_method, path) => { writes.push(path); focused = true; } } };
    const observer = { readNativeSnapshot: async () => view(), locate: async () => ({ id: 'x', interaction: { method: 'ELEMENT_CLICK' } }), waitUntil: async condition => {
      const s = view(); assert.equal(condition(s), s); return s;
    } };
    const after = await executeGroundedInteraction(session, observer, issueEffectGrant(c, node));
    assert.equal(writes.length, 1); assert.match(writes[0], /\/click$/);
    const enter = candidate(node, scope, after); assert.equal(enter.search.phase, 'CLEAR'); assert.notEqual(enter.id, c.id); assert.ok(issueEffectGrant(enter, node));
  } finally { closeSearch(scope); }
});

test('M3c exact native fallback selector retains clickable identity when parent and decoration share bounds/class', () => {
  const { selectorForNode } = require('../lib/android/state-observer.ts');
  const s = scene([{ className: 'android.view.View', clickable: true, bounds: [0, 0, 200, 200] },
    { className: 'android.view.View', clickable: false, parentIndex: 0, bounds: [0, 0, 200, 200] }]);
  const parent = selectorForNode(s.nodes[0], s.nodes), decoration = selectorForNode(s.nodes[1], s.nodes);
  assert.equal(parent.using, 'xpath'); assert.match(parent.value, /@clickable='true'/); assert.match(decoration.value, /@clickable='false'/);
  assert.notEqual(parent.value, decoration.value); assert.match(parent.value, /@package=/); assert.match(parent.value, /@class=/); assert.match(parent.value, /@bounds=/);
});

test('M3c navigation hop can prove a newly appeared collapsed search surface, not a result or completed search', () => {
  const { node, scope } = scoped();
  try {
    const tab = candidate(node, scope, scene([{ description: 'Search', clickable: true }]));
    const rows = [{ className: 'android.view.View', clickable: true, bounds: [0, 0, 400, 150] },
      { className: 'android.widget.TextView', parentIndex: 0, text: 'Search an unfamiliar catalog', bounds: [30, 20, 370, 80] }];
    const s = scene(rows), surface = candidate(node, scope, s);
    assert.equal(surface?.search.phase, 'OPEN'); assert.equal(surface.target.searchEntry, true); assert.equal(surface.target.index, 0);
    assert.equal(searchTransitionSatisfied(tab, s), true); assert.equal(searchTransitionSatisfied(surface, s), false, 'unchanged collapsed surface cannot acknowledge its own activation');
    const proof = require('../lib/android/agent/verification-registry.ts').verifySearchOutcome(scope, s, { deviceId: 'A', executionId: 'E', nodeId: node.id, packageName: pkg });
    assert.equal(proof, undefined);
    const list = scene([{ className: 'android.widget.RecyclerView', scrollable: true, bounds: [0, 0, 400, 900] },
      { ...rows[0], parentIndex: 0 }, { ...rows[1], parentIndex: 1 }]);
    assert.equal(candidate(node, scope, list), undefined, 'a result title starting with Search is not a search entry');
    assert.equal(candidate(node, scope, scene([...rows, { ...rows[1], bounds: [30, 85, 370, 130] }])), undefined);
  } finally { closeSearch(scope); }
});
