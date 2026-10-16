/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { generateActionCandidates, resolveCandidateChoice, revalidateCandidate, candidateChoiceSchema } = require('../lib/android/agent/action-candidates.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { AgentMemory } = require('../lib/android/agent/memory.ts');
const { verifyReversibleNavigation } = require('../lib/android/action-verifier.ts');
const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
const { runAgent } = require('../lib/android/agent/agent-loop.ts');
const { matchesBrowserDestination } = require('../lib/android/browser-destination.ts');
const { verifyDiscoveredSelection } = require('../lib/android/action-verifier.ts');
function snapshot(ids = ['tab_switcher_view_holder', 'hub_main_container']) {
  const snapshotId = randomUUID(), pkg = 'com.android.chrome';
  const nodes = ids.map((id, i) => ({ resourceId: pkg + ':id/' + id, packageName: pkg, className: 'android.widget.FrameLayout', enabled: true, displayed: true,
    clickable: false, focused: false, text: '', description: '', bounds: [0, i * 50, 400, i * 50 + 50] }));
  return { snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: 'OBSERVED', nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })), viewport: { x: 0, y: 0, width: 400, height: 800 } };
}
async function prepared() { const budget = new AgentBudget(), { goal } = await planGoal('Mở Chrome, tìm công thức nấu phở.', budget); goal.currentSubgoal = 1; return { goal, budget }; }
test('changed destination path requires same-origin redirect provenance, canonical and bidirectional language identity', () => {
  const doc = { url: 'https://example.org/vi-VN/', title: 'Example', headings: [], readyState: 'complete', canonicalUrls: ['https://example.org/vi-VN/'],
    alternateUrls: ['https://example.org/', 'https://example.org/vi-VN/'], redirectCount: 1, navigationType: 'navigate', navigationUrl: 'https://example.org/vi-VN/' };
  assert.equal(matchesBrowserDestination('https://example.org/', doc), true);
  for (const value of [{ ...doc, redirectCount: 0 }, { ...doc, canonicalUrls: [] }, { ...doc, alternateUrls: [doc.url] },
    { ...doc, navigationType: 'back_forward' }, { ...doc, navigationUrl: 'https://example.org/other' }, { ...doc, canonicalUrls: [doc.url, 'https://example.org/other'] },
    { ...doc, url: 'https://evil.org/vi-VN/' }]) assert.equal(matchesBrowserDestination('https://example.org/', value), false);
  const before = snapshot(), selection = { itemType: 'browser', url: 'https://example.org/', title: 'Example', ordinal: 1 };
  assert.equal(verifyDiscoveredSelection(selection, before, { ...snapshot(), web: { status: 'DOM_AVAILABLE', document: doc } }), true);
  assert.equal(verifyDiscoveredSelection(selection, before, { ...snapshot(), web: { status: 'DOM_AVAILABLE', document: { ...doc, title: 'Captcha', headings: [] } } }), false);
  const native = snapshot(['url_bar', 'content', 'title']); native.nodes[0].text = 'example.org/other'; native.nodes[1].className = 'android.webkit.WebView'; native.nodes[2].text = 'Example';
  assert.equal(verifyDiscoveredSelection(selection, before, native), false);
  native.nodes[0].text = 'example.org';
  assert.equal(verifyDiscoveredSelection(selection, before, { ...native, web: { status: 'AMBIGUOUS_CONTEXT' } }), false);
});
test('candidate is grounded in a real snapshot element and does not contain a selector or coordinates', async () => {
  const { goal } = await prepared(), s = snapshot(), [candidate] = generateActionCandidates(goal, s);
  assert.equal(candidate.snapshotId, s.snapshotId); assert.equal(candidate.targetElementId, s.elements[1].elementId);
  assert.deepEqual(candidate.action, { type: 'PRESS_KEY', key: 'BACK' }); assert.equal(candidate.evidence.policy, 'ALLOW');
  assert.equal(candidate.selector, undefined); assert.equal(candidate.coordinates, undefined);
});
test('unrelated clickable controls and private tab content are not navigation candidates', async () => {
  const { goal } = await prepared(), s = snapshot(['delete_account', 'random_ad', 'tab_title']); s.nodes.forEach(n => { n.clickable = true; n.text = 'private information'; });
  assert.deepEqual(generateActionCandidates(goal, s), []);
});
test('hidden, offscreen, disabled, foreign-app, sensitive and unsaved-input candidates are rejected', async () => {
  const { goal } = await prepared();
  for (const alter of [s => { s.nodes[1].displayed = false; }, s => { s.nodes[1].enabled = false; }, s => { s.nodes[1].bounds = [0, 900, 400, 950]; },
    s => { s.foregroundPackage = 'other'; }, s => { s.nodes[1].packageName = 'com.android.permissioncontroller'; },
    s => { s.nodes.push({ ...s.nodes[0], className: 'android.widget.EditText', focused: true, text: 'unsaved text' }); }]) {
    const s = snapshot(); alter(s); assert.deepEqual(generateActionCandidates(goal, s), []);
  }
  assert.deepEqual(generateActionCandidates({ ...goal, spec: { ...goal.spec, isSensitive: true } }, snapshot()), []);
});
test('model cannot invent a candidate ID, raw action, old snapshot or another subgoal', async () => {
  const { goal } = await prepared(), s = snapshot(), candidates = generateActionCandidates(goal, s);
  const valid = { choice: candidates[0].candidateId, snapshotId: s.snapshotId, subgoalId: goal.subgoals[1].id, reason: 'Return to web search' };
  assert.equal(resolveCandidateChoice(candidates, valid, goal, s), candidates[0]);
  for (const invalid of [{ ...valid, choice: 'invented' }, { ...valid, snapshotId: randomUUID() }, { ...valid, subgoalId: 'other' },
    { ...valid, action: { type: 'PRESS_KEY', key: 'BACK' } }, { ...valid, shell: 'anything' }]) assert.throws(() => resolveCandidateChoice(candidates, invalid, goal, s));
});
test('fresh observation rebinds equivalent evidence but rejects stale/changed/sensitive state', async () => {
  const { goal } = await prepared(), s = snapshot(), candidate = generateActionCandidates(goal, s)[0];
  assert.equal(revalidateCandidate(candidate, goal, snapshot()), true);
  assert.equal(revalidateCandidate(candidate, goal, { ...snapshot(), timestamp: Date.now() - 10000 }), false);
  const changed = snapshot(); changed.nodes[1].enabled = false; assert.equal(revalidateCandidate(candidate, goal, changed), false);
  assert.equal(revalidateCandidate(candidate, { ...goal, currentSubgoal: 0 }, snapshot()), false);
});
test('no candidate abstains without calling a model; ABSTAIN is never silently changed to BACK', async () => {
  const { goal, budget } = await prepared(), memory = new AgentMemory(), s = snapshot([]); memory.observe(s, 1);
  const never = new AgentDecisionEngine({ async generate() { throw Error('Should not call model'); } });
  assert.equal((await never.decide(goal, s, memory, {}, budget)).type, 'REQUEST_HUMAN_ASSISTANCE');
  const grounded = snapshot(), m = new AgentMemory(); m.observe(grounded, 1);
  const abstain = new AgentDecisionEngine({ async generate(schema, sys, input) { return schema.parse({ choice: 'ABSTAIN', snapshotId: input.snapshotId, subgoalId: input.subgoalId, reason: 'Need help' }); } });
  assert.equal((await abstain.decide(goal, grounded, m, {}, budget)).type, 'REQUEST_HUMAN_ASSISTANCE');
  assert.equal(candidateChoiceSchema([], grounded.snapshotId, goal.subgoals[1].id).safeParse({ choice: 'ABSTAIN', snapshotId: grounded.snapshotId, subgoalId: goal.subgoals[1].id, reason: 'Need help' }).success, true);
});
test('Action Verifier requires removed overlay, same app and the expected native destination', () => {
  const before = snapshot(), after = snapshot(['url_bar']); after.nodes[0].className = 'android.widget.EditText';
  assert.equal(verifyReversibleNavigation(before, after), true);
  assert.equal(verifyReversibleNavigation(before, snapshot()), false);
  assert.equal(verifyReversibleNavigation(before, snapshot([])), false);
  assert.equal(verifyReversibleNavigation(before, { ...after, foregroundPackage: 'launcher' }), false);
});
test('Executor verifies BACK instead of treating dispatch as success, and preconditions run before sending it', async () => {
  const before = snapshot(), after = snapshot(['url_bar']); let sent = 0, verified = 0;
  const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', async ensureActive() {} }, async () => ({ stdout: '', stderr: '' }), { beforeKey() {}, verifyNavigation: verifyReversibleNavigation });
  executor.observer = { async read() { return before; }, async waitUntil(condition) { verified++; assert.ok(condition(after)); return after; } };
  executor.legacy = { async execute() { sent++; } };
  const outcome = await executor.execute({ type: 'PRESS_KEY', key: 'BACK' });
  assert.equal(outcome.verification, 'VERIFIED'); assert.equal(sent, 1); assert.equal(verified, 1);
  executor.accounting.beforeKey = () => { throw Error('Changed scope'); };
  await assert.rejects(executor.execute({ type: 'PRESS_KEY', key: 'BACK' })); assert.equal(sent, 1);
});
test('Agent Loop independently rejects an old candidate or a changed action even without a reasoning counter', async () => {
  for (const changedAction of [false, true]) {
    const { goal, budget } = await prepared(), old = snapshot(), fresh = changedAction ? old : snapshot();
    // Isolate untrusted provider validation from deterministic recovery decisions.
    budget.limits.recoverySubtasks = 0;
    const candidate = generateActionCandidates(goal, old)[0]; let sent = 0, closed = 0;
    const execution = { backend: 'appium', async observe() { return fresh; }, discoveryMemory() { return {}; }, async execute() { sent++; }, async close() { closed++; } };
    const provider = { async decide() { return { type: 'EXECUTE_ACTION', grounding: candidate,
      action: changedAction ? { type: 'CLICK', target: 'address_bar' } : candidate.action, reason: 'Untrusted selection test' }; } };
    const out = await runAgent(goal, budget, execution, provider);
    assert.equal(out.result.status, 'BLOCKED'); assert.equal(sent, 0); assert.equal(closed, 1);
  }
});
test('snapshot-source counters enforce one global budget and do not contain URL or page text', () => {
  const budget = new AgentBudget({ snapshots: 3 });
  budget.recordSnapshot('NATIVE'); budget.recordSnapshot('DOM_VERIFY'); budget.recordSnapshot('DOM_VERIFY');
  assert.deepEqual(budget.snapshotSources, { NATIVE: 1, DOM_VERIFY: 2 });
  assert.throws(() => budget.recordSnapshot('DOM_VERIFY')); assert.equal(budget.counters.snapshots, 3);
});
