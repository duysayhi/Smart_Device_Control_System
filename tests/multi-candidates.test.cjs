/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { generateActionCandidates, resolveCandidateChoice, revalidateCandidate } = require('../lib/android/agent/action-candidates.ts');
const { verifyCandidateOutcome } = require('../lib/android/agent/candidate-verifier.ts');
const { goalPackageAllowed, readLocationVerified } = require('../lib/android/agent/navigation-semantics.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { AgentMemory } = require('../lib/android/agent/memory.ts');
const { policyForAgentAction, runAgent } = require('../lib/android/agent/agent-loop.ts');
const { geometryFingerprint } = require('../lib/android/visual-grounding.ts');
function snapshot(rows = ['Display'], pkg = 'com.android.settings') {
  const snapshotId = randomUUID();
  const node = (fields) => ({ resourceId: '', packageName: pkg, className: 'android.widget.TextView', text: '', description: '', enabled: true, displayed: true, focused: false, clickable: false, scrollable: false, bounds: [0, 0, 400, 800], ...fields });
  const nodes = [node({ className: 'android.widget.FrameLayout' }), node({ className: 'androidx.recyclerview.widget.RecyclerView', resourceId: pkg + ':id/list', scrollable: true, parentIndex: 0, bounds: [0, 100, 400, 800] }),
    node({ className: 'android.widget.Button', description: 'Search', clickable: true, parentIndex: 0, bounds: [300, 0, 400, 80] }),
    ...rows.map((text, i) => node({ text, resourceId: pkg + ':id/title', clickable: true, parentIndex: 1, bounds: [0, 120 + i * 80, 400, 190 + i * 80] }))];
  return { snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: 'OBSERVED', nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })), viewport: { x: 0, y: 0, width: 400, height: 800 } };
}
async function prepared() { const budget = new AgentBudget(), { goal } = await planGoal('Mở Cài đặt và tìm nơi xem dung lượng bộ nhớ.', budget); goal.currentSubgoal = 1; return { budget, goal }; }
test('information goal preserves the requested outcome and does not accept a search row as capacity evidence', async () => {
  const { goal } = await prepared(); assert.equal(goal.spec.operation, 'FIND_PLACE'); assert.equal(goal.spec.targetText, 'dung lượng bộ nhớ');
  assert.equal(readLocationVerified(goal, snapshot(['Memory'])), false);
  assert.equal(readLocationVerified(goal, snapshot(['Memory', 'Available 2 GB', 'Total 4 GB'])), true);
  assert.equal(readLocationVerified(goal, snapshot(['Memory', 'Total 4 GB'], 'evil.app')), false);
  const search = snapshot(['Memory', 'Available 2 GB', 'Total 4 GB']); search.nodes[2].className = 'android.widget.EditText'; search.nodes[2].resourceId = 'com.android.settings:id/search_query';
  assert.equal(readLocationVerified(goal, search), false);
  assert.equal(readLocationVerified(goal, snapshot(['Memory', '2.2 GB / 4 GB', 'Voice synthesis 92 MB'])), false);
  assert.equal(readLocationVerified(goal, snapshot(['Memory', '2.2 GB / 4 GB', 'Used 55%'])), true);
  assert.equal(readLocationVerified(goal, snapshot(['Memory', '92 MB', 'Used 55%'])), false);
  const { goal: battery } = await planGoal('Mở Cài đặt và tìm nơi xem dung lượng pin.', new AgentBudget()); battery.currentSubgoal = 1;
  assert.equal(readLocationVerified(battery, snapshot(['Memory', 'Available 2 GB', 'Total 4 GB'])), false);
  assert.equal(generateActionCandidates(battery, snapshot(['Memory'])).some(c => c.semanticRole === 'read_navigation'), false);
});
test('real-shaped UI yields distinct search and scroll choices but unrelated clickable labels are excluded', async () => {
  const { goal } = await prepared(), s = snapshot(['Display', 'Delete account']), candidates = generateActionCandidates(goal, s);
  assert.deepEqual(candidates.map(c => c.semanticRole), ['search_navigation', 'scroll_discovery']);
  for (const c of candidates) { assert.equal(c.snapshotId, s.snapshotId); assert.equal(c.preconditions.packageName, s.foregroundPackage); assert.equal(c.safety, 'READ_NAVIGATION'); assert.ok(c.verification.kind); assert.equal(c.coordinates, undefined); }
});
test('candidate selection binds goal-related navigation among multiple choices and raw or stale choices fail', async () => {
  const { goal } = await prepared(), s = snapshot(['Memory', 'Display']), candidates = generateActionCandidates(goal, s), read = candidates.find(c => c.semanticRole === 'read_navigation');
  assert.ok(candidates.length >= 3); assert.ok(read);
  const reply = { choice: read.candidateId, snapshotId: s.snapshotId, subgoalId: goal.subgoals[1].id, reason: 'Read memory information' };
  assert.equal(resolveCandidateChoice(candidates, reply, goal, s), read);
  assert.throws(() => resolveCandidateChoice(candidates, { ...reply, choice: 'unknown' }, goal, s));
  assert.throws(() => resolveCandidateChoice(candidates, { ...reply, snapshotId: randomUUID() }, goal, s));
  assert.throws(() => resolveCandidateChoice(candidates, { ...reply, action: { type: 'CLICK', target: 'delete' } }, goal, s));
  assert.equal(resolveCandidateChoice(candidates, { ...reply, choice: 'ABSTAIN' }, goal, s), undefined);
});
test('similar labels can differ in meaning; duplicate identical labels cannot authorize random activation', async () => {
  const { goal } = await prepared(), s = snapshot(['Memory', 'Memory management', 'Memory']);
  const candidates = generateActionCandidates(goal, s); assert.equal(candidates.some(c => c.semanticRole === 'read_navigation'), false);
  assert.equal(generateActionCandidates(goal, snapshot(['Memory', 'memory'])).some(c => c.semanticRole === 'read_navigation'), false);
});
test('observed attribute conjunction distinguishes a result title from an identically named breadcrumb, not identical rows', async () => {
  const { goal } = await prepared(), s = snapshot(['Memory', 'Memory']); s.nodes[4].resourceId = 'com.android.settings:id/breadcrumb';
  const candidates = generateActionCandidates(goal, s);
  // A breadcrumb is context, not permission to activate the unrelated row it describes.
  assert.equal(candidates.filter(c => c.semanticRole === 'read_navigation').length, 1);
  const { matchUiTarget } = require('../lib/android/ui-understanding.ts');
  const target = 'observed:' + JSON.stringify({ resourceId: s.nodes[3].resourceId, text: 'Memory', className: s.nodes[3].className });
  assert.equal(matchUiTarget(s, target, true).node, s.nodes[3]);
  assert.equal(matchUiTarget(s, 'observed:{"resourceId":"invented"}', true).status, 'MISSING');
});
test('policy recomputes control semantics and blocks toggles, forged verification and stale preconditions', async () => {
  const { goal } = await prepared(), s = snapshot(['Memory']), candidate = generateActionCandidates(goal, s).find(c => c.semanticRole === 'read_navigation');
  assert.doesNotThrow(() => policyForAgentAction(goal, candidate.action, s, candidate));
  assert.throws(() => policyForAgentAction(goal, candidate.action, s));
  assert.equal(revalidateCandidate({ ...candidate, verification: { kind: 'FOCUSED_SEARCH', label: '' } }, goal, s), false);
  const unsafe = snapshot(['Memory']); unsafe.nodes[3].className = 'android.widget.Switch';
  assert.equal(generateActionCandidates(goal, unsafe).some(c => c.semanticRole === 'read_navigation'), false);
  assert.equal(revalidateCandidate(candidate, goal, { ...s, timestamp: Date.now() - 10000 }), false);
  const { isSensitiveControl } = require('../lib/android/security-policy.ts');
  for (const text of ['Dọn dẹp ngay', 'Clear data', 'Optimize now', 'Factory reset']) assert.equal(isSensitiveControl(text), true);
  const webpage = snapshot(['Memory']); webpage.nodes[1].className = 'android.webkit.WebView';
  assert.equal(generateActionCandidates(goal, webpage).some(c => c.semanticRole === 'read_navigation'), false);
});
test('model mock chooses a manifest ID and failed candidates are not proposed again', async () => {
  const { goal, budget } = await prepared(), s = snapshot(['Memory']), memory = new AgentMemory(); memory.observe(s, 1);
  const failed = generateActionCandidates(goal, s).find(c => c.semanticRole === 'read_navigation');
  memory.actions.push({ action: failed.action, fingerprint: geometryFingerprint(s), subgoalId: 'subgoal-1', verification: 'FAILED', reason: 'mock' });
  // Existing mutating failure guard stops safely; it is not a Recovery Engine.
  let calls = 0; const engine = new AgentDecisionEngine({ async generate() { calls++; throw Error('No retry'); } });
  assert.equal((await engine.decide(goal, s, memory, {}, budget)).type, 'REQUEST_HUMAN_ASSISTANCE'); assert.equal(calls, 0);
  const engine2 = new AgentDecisionEngine({ async generate(schema, _, input) {
    assert.ok(input.candidates.length >= 2); assert.equal(input.nodes, undefined); assert.equal(input.xml, undefined);
    const chosen = input.candidates.find(c => c.role === 'read_navigation');
    return schema.parse({ choice: chosen.id, snapshotId: input.snapshotId, subgoalId: input.subgoalId, reason: 'Read memory' });
  } });
  const decision = await engine2.decide(goal, s, new AgentMemory(), {}, budget); assert.equal(decision.grounding.semanticRole, 'read_navigation');
});
test('search and scroll require different verified transitions; unrelated changes and foreign app fail', async () => {
  const { goal } = await prepared(), before = snapshot(), candidates = generateActionCandidates(goal, before), scroll = candidates.find(c => c.semanticRole === 'scroll_discovery'), search = candidates.find(c => c.semanticRole === 'search_navigation');
  assert.equal(verifyCandidateOutcome(goal, scroll, before, snapshot(['Memory'])), true);
  assert.equal(verifyCandidateOutcome(goal, scroll, before, before), false);
  assert.equal(verifyCandidateOutcome(goal, search, before, snapshot(['Memory'])), false);
  const after = snapshot(); after.nodes[2].className = 'android.widget.EditText'; after.nodes[2].focused = true; after.nodes[2].resourceId = 'com.android.settings:id/search_query';
  assert.equal(verifyCandidateOutcome(goal, search, before, after), true);
  const delegated = snapshot([], 'com.android.settings.intelligence'); delegated.nodes[2].className = 'android.widget.EditText'; delegated.nodes[2].focused = true; delegated.nodes[2].resourceId = 'com.android.settings.intelligence:id/search_src_text';
  assert.equal(verifyCandidateOutcome(goal, search, before, delegated), true);
  assert.doesNotThrow(() => policyForAgentAction(goal, { type: 'INPUT_TEXT', text: 'bộ nhớ' }, delegated));
  assert.throws(() => policyForAgentAction(goal, { type: 'INPUT_TEXT', text: 'different' }, delegated));
  assert.equal(verifyCandidateOutcome(goal, search, before, { ...after, foregroundPackage: 'launcher' }), false);
});
test('read-only destination family is goal-limited, not authorization for arbitrary app switching', async () => {
  const { goal } = await prepared(); assert.equal(goalPackageAllowed(goal, 'com.samsung.android.lool'), true); assert.equal(goalPackageAllowed(goal, 'evil.app'), false);
  const { goal: chrome } = await planGoal('Mở Chrome', new AgentBudget()); assert.equal(goalPackageAllowed(chrome, 'com.samsung.android.lool'), false);
});
test('an unverified grounded action cannot complete a read location goal', async () => {
  const { goal, budget } = await prepared(), before = snapshot(); let close = 0;
  const execution = { backend: 'appium', async observe() { return before; }, discoveryMemory() { return {}; }, async execute() { return { verification: 'DISPATCHED' }; }, async close() { close++; } };
  const candidate = generateActionCandidates(goal, before)[0];
  const out = await runAgent(goal, budget, execution, { async decide() { return { type: 'EXECUTE_ACTION', action: candidate.action, grounding: candidate, reason: 'mock' }; } });
  assert.equal(out.result.status, 'BLOCKED'); assert.equal(close, 1); assert.notEqual(out.result.verifiedSubgoals, out.result.totalSubgoals);
});
