/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { sourceSlots } = require('../lib/android/agent/source-slots.ts');
const { proposePrimitiveDecomposition, canAutoReviewReadOnly } = require('../lib/android/agent/primitive-decomposition.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { readKeyboardVisibility } = require('../lib/android/agent/keyboard-visibility.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { verifyPredicate } = require('../lib/android/agent/verification-registry.ts');
const search = require('../lib/android/agent/generic-search.ts');
test('slotting preserves original grapheme ranges, quoted connectors and exact clause coverage', () => {
  const original = '  Ghe\u0301 Atlas rồi dò "bãi triều và chim biển".  ', p = sourceSlots(original, [{ packageName: 'org.atlas', label: 'Atlas' }]);
  assert.equal(p.clauses.length, 2); assert.equal(p.request, original.normalize('NFC').trim());
  const quoted = p.clauses[1].slots.find(s => s.kind === 'QUOTED'); assert.equal(quoted.text, '"bãi triều và chim biển"');
  for (const c of p.clauses) for (const s of c.slots) assert.equal(original.slice(s.rawStart, s.rawEnd).normalize('NFC'), s.text);
  const ambiguous = sourceSlots('Ghé Reader', [{ packageName: 'org.one', label: 'Reader' }, { packageName: 'org.two', label: 'Reader' }]);
  assert.equal(ambiguous.clauses[0].slots.find(s => s.text === 'Reader').ambiguous, true);
});
test('per-clause model protocol contains only issued IDs; source reconstruction retains validators and dependencies', async () => {
  let calls = 0;
  const ai = { async generate(schema, _system, input) {
    calls++; assert.equal('offsets' in input, false); assert.equal('start' in input, false);
    const query = input.slots.find(s => s[1].startsWith('"'));
    return schema.parse({ c: input.c, p: query ? 'SEARCH' : 'OPEN_APP', s: query?.[0] ?? input.slots.find(s => s[1] === 'Atlas')[0], a: null, n: false, d: input.prior });
  } };
  const p = await proposePrimitiveDecomposition('Ghé Atlas rồi dò "nước mặn"', ai, new AgentBudget(), undefined, { forceModel: true, apps: [{ packageName: 'org.atlas', label: 'Atlas' }] });
  assert.equal(calls, 2); assert.deepEqual(p.steps[1].dependencies, [0]); assert.equal(p.spec.outcomes[1].value, '"nước mặn"');
  assert.equal(canAutoReviewReadOnly(p), false); assert.equal(canAutoReviewReadOnly(p, true), true);
  p.slotBindings[1].value.text = 'invented'; assert.equal(canAutoReviewReadOnly(p, true), false);
  const bad = { async generate() { return { c: 1, p: 'OPEN_APP', t: 999, v: null, n: false, d: [], selector: 'guess' }; } };
  await assert.rejects(proposePrimitiveDecomposition('Ghé Atlas', bad, new AgentBudget(), undefined, { forceModel: true }));
  const foreign = { async generate(_schema, _system, input) { return { c: input.c, p: input.c === 1 ? 'OPEN_APP' : 'SEARCH', s: input.c === 1 ? input.slots[0][0] : 1, a: null, n: false, d: [] }; } };
  await assert.rejects(proposePrimitiveDecomposition('Ghé Atlas rồi dò "muối"', foreign, new AgentBudget(), undefined, { forceModel: true, apps: [{ packageName: 'org.atlas', label: 'Atlas' }] }), /SOURCE_SLOT/);
});
test('read-only review remains disabled and cannot cover mutating or unknown-app slots', async () => {
  const choose = { async generate(schema, _system, input) { return schema.parse({ c: input.c, p: 'OPEN_APP', s: input.slots.find(s => s[1] === 'org.unknown.app')[0], a: null, n: false, d: [] }); } };
  const p = await proposePrimitiveDecomposition('Ghé org.unknown.app', choose, new AgentBudget());
  assert.equal(canAutoReviewReadOnly(p, true), false); assert.equal(process.env.AGENT_V2_READONLY_REVIEW_MODE, undefined);
  const mutation = { async generate(schema, _system, input) {
    return schema.parse({ c: input.c, p: input.c === 1 ? 'OPEN_APP' : 'CREATE_RECORD',
      s: input.slots.find(s => input.c === 1 ? s[1] === 'Atlas' : s[1] === '"draft"')[0], a: null, n: false, d: input.prior });
  } };
  const write = await proposePrimitiveDecomposition('Ghe Atlas roi tao "draft"', mutation, new AgentBudget(), undefined,
    { apps: [{ packageName: 'org.atlas', label: 'Atlas' }] });
  assert.equal(canAutoReviewReadOnly(write, true), false, 'known app and exact quoted data never auto-authorize mutations');
});
test('keyboard provider uses only scoped dumpsys readback and rejects unknown/conflicting state and forged receipts', async () => {
  for (const [stdout, shown] of [['mInputShown=true', true], ['mInputShown=false', false], ['mShowRequested=false', undefined], ['mInputShown=true mInputShown=false', undefined]]) {
    const k = await readKeyboardVisibility('A', async args => { assert.deepEqual(args, ['-s', 'A', 'shell', 'dumpsys', 'input_method']); return { stdout }; });
    assert.equal(k.shown, shown);
  }
  const pkg = 'org.test.search', node = compileOutcomes('Mo ' + pkg + ' va tim delta', 'A', 'E').nodes[1]; node.packageName = pkg;
  function scene(text) {
    const snapshotId = randomUUID(), n = { text, description: '', className: 'android.widget.EditText', resourceId: pkg + ':id/search_box', packageName: pkg, enabled: true, displayed: true, clickable: true, focused: true, bounds: [0, 0, 400, 60] };
    return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', nodes: [n], elements: [{ ...n, elementId: snapshotId + ':0' }], viewport: { x: 0, y: 0, width: 400, height: 800 } };
  }
  const scope = search.beginSearch(node, 'A', 'E', 'S');
  try {
    const before = scene(''), c = generateGroundedCandidates(node, before, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); search.beforeSearchDispatch(c, before); const typed = scene('delta'); search.noteSearchQueryEntered(c, before, typed);
    const k = await readKeyboardVisibility('A', async () => ({ stdout: 'mInputShown=false' }));
    assert.throws(() => search.noteSearchKeyboard(scope, { ...k }));
    search.noteSearchKeyboard(scope, k);
    const proof = verifyPredicate({ kind: 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED', scopeId: scope.id }, typed, { deviceId: 'A', executionId: 'E', nodeId: node.id, packageName: pkg }).evidence;
    assert.equal(proof.assessment.evidenceClass, 'KEYBOARD_READBACK'); assert.equal(search.searchResult(scope, typed), undefined, 'hidden keyboard is not search completion');
  } finally { search.closeSearch(scope); }
});
