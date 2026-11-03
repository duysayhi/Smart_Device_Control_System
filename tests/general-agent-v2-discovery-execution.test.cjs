/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { verifyPredicate } = require('../lib/android/agent/verification-registry.ts');
const { verifyAll } = require('../lib/android/agent/composite-verification.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const search = require('../lib/android/agent/generic-search.ts');
const { validatePrimitiveDecomposition, bindReviewedPrimitives } = require('../lib/android/agent/primitive-decomposition.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { RouteHints } = require('../lib/android/agent/route-hints.ts');
const { BoundedExploration } = require('../lib/android/agent/bounded-exploration.ts');
const pkg = 'org.sample.explorer';
function scene(rows, packageName = pkg) {
  const snapshotId = randomUUID();
  const nodes = rows.map((r, i) => ({ text: '', description: '', className: 'android.widget.TextView', resourceId: '', packageName,
    enabled: true, displayed: true, clickable: false, focused: false, bounds: [0, i * 70, 380, i * 70 + 60], ...r }));
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: packageName, observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}
const context = (nodeId = 'N') => ({ deviceId: 'A', executionId: 'E', nodeId, packageName: pkg });
const field = { className: 'android.widget.EditText', resourceId: pkg + ':id/search_box', text: 'delta', focused: true, clickable: true };
const empty = { text: 'Không tìm thấy kết quả', resourceId: pkg + ':id/empty' };

test('M1 native predicate catalog returns independent evidence classes and rejects ambiguous/foreign facts', () => {
  const s = scene([{ text: 'Ready' }, { text: 'Wireless', className: 'android.widget.Switch', checkable: true, checked: false }, field, empty]);
  for (const p of [{ kind: 'ELEMENT_TEXT_PRESENT', text: 'Ready' }, { kind: 'WIDGET_STATE', label: 'Wireless', property: 'checked', expected: false },
    { kind: 'EXPLICIT_EMPTY_RESULT', query: 'delta', fieldResourceId: field.resourceId }]) {
    const proof = verifyPredicate(p, s, context()).evidence;
    assert.ok(proof); assert.ok(proof.assessment.evidenceClass); assert.ok(proof.assessment.why);
    assert.equal(verifyPredicate(p, { ...s, deviceSerial: 'B' }, context()).evidence, undefined);
  }
  assert.equal(verifyPredicate({ kind: 'WIDGET_STATE', label: 'Wireless', property: 'checked', expected: true }, s, context()).evidence, undefined);
  assert.equal(verifyPredicate({ kind: 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED', scopeId: 'invented' }, s, context()).evidence, undefined);
  const incomplete = verifyAll({ purpose: 'OUTCOME', all: [{ kind: 'EXPLICIT_EMPTY_RESULT', query: 'delta', fieldResourceId: field.resourceId }] }, s, context());
  assert.equal(incomplete.status, 'SAFE_BLOCKED'); assert.ok(incomplete.missing.includes('QUERY_COMMIT_CONTRACT_REQUIRED'));
  assert.equal(verifyPredicate({ kind: 'EXPLICIT_EMPTY_RESULT', query: 'delta', fieldResourceId: field.resourceId }, scene([field, { ...empty, clickable: true }]), context()).evidence, undefined, 'a clickable no-results label is not an empty-state widget');
  const list = scene([field, { className: 'android.widget.RecyclerView', resourceId: pkg + ':id/results', bounds: [0, 70, 400, 700] },
    { text: 'Delta record', clickable: true, parentIndex: 1 }, { text: 'Results for delta' }]);
  const p = { kind: 'LIST_NONEMPTY_CORRELATED_WITH_VALUE', query: 'delta', fieldResourceId: field.resourceId };
  assert.equal(verifyPredicate(p, list, context()).evidence?.assessment.confidence, 'CORRELATED');
  list.nodes[3].text = 'Results for old'; assert.equal(verifyPredicate(p, list, context()).evidence, undefined);
});

test('M1 live result observed before submit can complete as stable outcome state, never from typed text or stale empty alone', () => {
  for (const stale of [false, true]) {
    const node = compileOutcomes('Mo ' + pkg + ' va tim delta', 'A', 'E').nodes[1]; node.packageName = pkg;
    const scope = search.beginSearch(node, 'A', 'E', 'SESSION');
    try {
      const before = scene([{ ...field, text: '' }, ...(stale ? [empty] : [{ text: 'Recent folders' }])]);
      const enter = generateGroundedCandidates(node, before, 'E', 'SESSION', false, 0, '', false, undefined, false, scope).candidates[0];
      consumeEffectGrant(issueEffectGrant(enter, node), 'A', 'SESSION'); search.beforeSearchDispatch(enter, before);
      const typed = scene([field, empty]); search.noteSearchQueryEntered(enter, before, typed);
      assert.equal(search.searchResult(scope, scene([{ ...field, focused: false }, empty])), undefined, 'typing alone has no commit evidence');
      const submit = generateGroundedCandidates(node, typed, 'E', 'SESSION', false, 0, '', false, undefined, false, scope).candidates[0];
      consumeEffectGrant(issueEffectGrant(submit, node), 'A', 'SESSION'); search.beforeSearchDispatch(submit, typed); search.noteSearchSubmitted(submit);
      const first = scene([{ ...field, focused: false }, empty]);
      assert.equal(search.searchResult(scope, first), undefined);
      assert.equal(search.searchResult(scope, first), undefined, 'same snapshot is not a second observation');
      const second = scene([{ ...field, focused: false }, empty]);
      assert.equal(Boolean(search.searchResult(scope, second)), !stale);
      assert.equal(verifyPredicate({ kind: 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED', scopeId: scope.id }, second, { ...context(node.id), executionId: 'OTHER' }).evidence, undefined);
      if (stale) assert.match(search.searchOutcomeDiagnostic(scope), /UNCHANGED_RESULT/);
    } finally { search.closeSearch(scope); }
  }
});

function proposal(request, needle, primitive = 'OPEN_APP') {
  return { steps: [{ primitive, source: { start: 0, end: request.length }, target: { start: request.indexOf(needle), end: request.indexOf(needle) + needle.length }, value: null, negated: false, dependencies: [] }] };
}
test('M2 new-language source-bound primitives bind only existing executor/verifier contracts', () => {
  const request = 'Ghé ' + pkg, p = validatePrimitiveDecomposition(request, proposal(request, pkg));
  const graph = bindReviewedPrimitives(p, 'A', 'E');
  assert.equal(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes[0].outcome.span.text, request);
  assert.equal(graph.primitiveBindings[0].state, 'BOUND'); assert.equal(graph.nodes[0].status, 'PENDING');
  assert.equal(graph.nodes[0].evidenceIds.length, 0, 'binding never completes the parent');
  const r = 'Rà soát chứng chỉ', unknown = validatePrimitiveDecomposition(r, proposal(r, 'chứng chỉ', 'READ_VALUE'));
  const unbound = bindReviewedPrimitives(unknown, 'A', 'E'); assert.notEqual(unbound.coverage, 'COMPLETE');
  assert.equal(unbound.primitiveBindings[0].state, 'DISCOVERY_REQUIRED'); assert.ok(unbound.primitiveBindings[0].missing.length);
  const qualified = 'Search "coral" in Books', start = qualified.indexOf('"'), finish = qualified.indexOf('"', start + 1) + 1;
  const qualifiedProposal = validatePrimitiveDecomposition(qualified, { steps: [{ primitive: 'SEARCH', source: { start: 0, end: qualified.length }, target: null,
    value: { start, end: finish }, negated: false, dependencies: [] }] });
  assert.equal(bindReviewedPrimitives(qualifiedProposal, 'A', 'E').nodes[0].app, 'Books');
  p.spec.outcomes[0].value = 'invented'; assert.throws(() => bindReviewedPrimitives(p, 'A', 'E'));
});

test('M2 rejects source omissions, slot invention, effects hidden as reads, negation changes and invalid dependencies', () => {
  const request = 'Ghé ' + pkg, good = proposal(request, pkg);
  for (const bad of [
    { ...good, selector: 'guess' },
    { steps: [{ ...good.steps[0], target: { start: 100, end: 110 } }] },
    { steps: [{ ...good.steps[0], dependencies: [0] }] },
    { steps: [{ ...good.steps[0], negated: true }] },
  ]) assert.throws(() => validatePrimitiveDecomposition(request, bad));
  for (const r of ['Ghé ' + pkg + ' rồi xóa dữ liệu', 'Đừng ghé ' + pkg, 'Gửi thông tin tới ' + pkg, 'Tắt ' + pkg]) assert.throws(() => validatePrimitiveDecomposition(r, proposal(r, pkg)));
  assert.throws(() => validatePrimitiveDecomposition('Mo ' + pkg, proposal('Mo ' + pkg, pkg, 'NAVIGATE_TO')), /KNOWN_OUTCOME_CHANGED/);
  const tail = request + ' và so sánh dữ liệu'; assert.throws(() => validatePrimitiveDecomposition(tail, good), /DROPPED_SOURCE/);
});

test('M2 reviewed novel Vietnamese command resumes one execution, launches only source app and completes via backend proof', async () => {
  const request = 'Ghé ' + pkg, events = []; let opens = 0, closed = 0, foreground = 'launcher';
  const adapter = { catalog: { async resolve(name) { assert.equal(name, pkg); return { app: { serial: 'A', packageName: pkg }, choices: [] }; } },
    async open() { opens++; return { backend: 'appium', sessionId: () => 'SESSION', async observe() { return scene([{ text: 'Ready' }], foreground); },
      async execute(action) { assert.deepEqual(action, { type: 'OPEN_APP', app: pkg }); foreground = pkg; }, async close() { closed++; } }; } };
  const ai = { async generate(schema, _system, input) { assert.equal(input.request, request);
    return schema.parse({ c: input.c, p: 'OPEN_APP', s: input.slots.find(s => s[1] === pkg)[0], a: null, n: false, d: [] }); } };
  await runAgentV2(request, 'A', 'E', 'physical-A', new AgentBudget(), adapter, event => {
    events.push(event);
    if (event.v2?.assistance) {
      assert.equal(opens, 0, 'interpretation precedes Session creation');
      assert.equal(event.v2.assistance.category, 'GOAL_INTERPRETATION');
      assert.equal(submitAssistanceV2({ deviceId: 'A', executionId: 'E', token: event.v2.assistance.token, approved: true, choice: 'accept' }), true);
    }
  }, undefined, ai);
  const last = events.at(-1); assert.equal(last.status, 'COMPLETED'); assert.equal(last.v2.result, 'ASSISTED_COMPLETED');
  assert.equal(last.v2.graph.primitiveBindings[0].state, 'BOUND'); assert.equal(last.v2.graph.nodes[0].evidenceIds.length, 1);
  assert.equal(opens, 1); assert.equal(closed, 1);
});

test('M3 route hints persist only issued independently verified transitions and isolate physical device/package version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-route-test-')), graph = compileOutcomes('Mo ' + pkg + ' va xem Exhibits', 'A', 'E'), node = graph.nodes[1]; node.packageName = pkg;
  const tab = { text: 'Exhibits', className: 'android.widget.TabWidget', clickable: true, selected: false, resourceId: pkg + ':id/tab' };
  const before = scene([tab]), after = scene([{ ...tab, selected: true }]);
  const c = generateGroundedCandidates(node, before, 'E', 'SESSION', false).candidates[0];
  const proof = verifyPredicate({ kind: 'ELEMENT_VISIBLE', label: 'Exhibits' }, after, context(node.id)).evidence;
  const scope = { deviceId: 'A', physicalId: 'physical-A', executionId: 'E', packageName: pkg, packageVersion: '42' };
  const routes = new RouteHints(scope, root); assert.throws(() => routes.record(before, after, c, { ...proof }));
  routes.record(before, after, c, proof); assert.equal(new RouteHints(scope, root).hints().length, 1);
  assert.equal(new RouteHints({ ...scope, physicalId: 'physical-B' }, root).hints().length, 0);
  assert.equal(new RouteHints({ ...scope, packageVersion: '43' }, root).hints().length, 0);
  const changed = verifyPredicate({ kind: 'STATE_CHANGED', beforeFingerprint: 'old' }, after, context(node.id)).evidence;
  assert.throws(() => routes.record(before, after, c, changed));
  const ledger = new BoundedExploration(), key = ledger.begin(c, node, new AgentBudget()); ledger.markUncertain(key);
  assert.throws(() => ledger.begin(c, node, new AgentBudget()), /UNCERTAIN_EFFECT_REPLAY/);
});
