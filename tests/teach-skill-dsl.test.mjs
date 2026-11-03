import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { inspect } from 'node:util';
import ts from 'typescript';

const load = createRequire(import.meta.url);
Module._extensions['.ts'] = (loaded, file) => loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { SkillSchema, FORBIDDEN_KEYS, SKILL_OPERATIONS, SKILL_OPERATION_FAMILIES, SKILL_VERIFIERS } = load('../lib/skills/skill-schema.ts');
const { validateSkill, OPERATION_VERIFIERS } = load('../lib/skills/skill-validator.ts');
const { sanitizeSnapshot, createEphemeralDiagnostics } = load('../lib/skills/snapshot-sanitizer.ts');
const { EvidencePredicateV2Schema } = load('../lib/android/agent/evidence-predicates.ts');

const target = (role = 'search_field', label = 'Search') => ({ semanticRole: role, label, containerRole: role === 'search_action' ? 'toolbar' : role === 'navigation' ? 'navigation' : 'search' });
const step = (id, operation, arguments_, verify) => ({ id, operation, arguments: arguments_, verify, effectClass: 'READ', timeoutMs: 5000, onFail: 'BLOCK' });
function searchSkill(weak = false) {
  return { schemaVersion: 1, name: 'Search a phrase', appScope: { alias: 'youtube' },
    parameters: { query: { type: 'string', maxLength: 200, required: true, description: 'Exact search phrase.' } }, maxSteps: 20,
    steps: [
      step('open', 'OPEN_APPLICATION', { appRef: 'youtube' }, { kind: 'FOREGROUND_IS', appRef: 'youtube' }),
      step('search', 'ACTIVATE_CONTROL', { target: target('search_action'), purpose: 'SEARCH' }, { kind: 'ELEMENT_VISIBLE', target: target() }),
      step('enter', 'INPUT_TEXT', { target: target(), value: { param: 'query' } }, { kind: 'WIDGET_STATE', target: target(), property: 'value', expected: { param: 'query' } }),
      step('submit', 'SUBMIT_SEARCH', { scope: 'search' }, weak ? { kind: 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED', scope: 'search' } : { kind: 'SEARCH_OUTCOME_MATCHES', scope: 'search', value: { param: 'query' } }),
    ] };
}
const clone = value => structuredClone(value);
const has = (result, code) => result.errors.some(error => error.code === code);
function frozen(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) frozen(child); } return value; }
const live = (extra = {}) => ({ className: 'android.widget.EditText', text: 'OpenAI', description: 'Search', hint: 'Search here',
  resourceId: 'org.fixture:id/search', password: false, secure: false, sensitive: false, fieldType: 'SEARCH',
  enabled: true, displayed: true, bounds: [0, 0, 200, 80], elementId: 'live-S1-element', ...extra });

test('C2 valid YouTube search is a typed data draft, never a verified/published skill', () => {
  const input = searchSkill(), parsed = SkillSchema.safeParse(input), outcome = validateSkill(input);
  assert.equal(parsed.success, true); assert.equal(outcome.ok, true); assert.equal(outcome.maxStatus, 'PENDING_VALIDATION');
  assert.equal(outcome.warnings.some(row => row.code === 'REAL_DEVICE_VALIDATION_REQUIRED'), true);
  assert.equal(outcome.warnings.some(row => row.code === 'MISSING_TERMINAL_VERIFIER'), false);
});
test('C2 search with only commit/keyboard evidence lacks terminal proof and remains pending', () => {
  const result = validateSkill(searchSkill(true));
  assert.equal(result.ok, true); assert.equal(result.maxStatus, 'PENDING_VALIDATION');
  assert.equal(result.warnings.some(row => row.code === 'MISSING_TERMINAL_VERIFIER'), true);
});
test('C2 seven operation families, with observation/assertion aliases and real registered verifiers', () => {
  assert.equal(SKILL_OPERATION_FAMILIES.length, 7); assert.equal(SKILL_OPERATIONS.length, 8);
  const kinds = EvidencePredicateV2Schema.options.map(option => option.shape.kind.value);
  for (const allowed of SKILL_VERIFIERS) assert.equal(kinds.includes(allowed), true);
  assert.equal(Object.isFrozen(OPERATION_VERIFIERS), true);
  for (const list of Object.values(OPERATION_VERIFIERS)) { assert.equal(Object.isFrozen(list), true); for (const kind of list) assert.equal(SKILL_VERIFIERS.includes(kind), true); }
});
for (const operation of ['OBSERVE_UI', 'ASSERT_UI']) test('C2 registered observation alias: ' + operation, () => {
  const s = searchSkill(), predicate = clone(s.steps.at(-1).verify);
  s.steps.push(step('observe', operation, { predicate }, clone(predicate)));
  assert.equal(validateSkill(s).ok, true);
});
test('C2 literal search value and declarative label parameter bind exactly', () => {
  const s = searchSkill(); s.parameters.searchLabel = { type: 'string', maxLength: 40, required: true, description: 'Visible search label.' };
  for (const holder of [s.steps[1].verify.target, s.steps[2].arguments.target, s.steps[2].verify.target]) { delete holder.label; holder.labelParam = 'searchLabel'; }
  s.steps[2].arguments.value = 'marine biology'; s.steps[2].verify.expected = 'marine biology'; s.steps[3].verify.value = 'marine biology';
  assert.equal(validateSkill(s).ok, true);
});
for (const key of ['bounds', 'rawPoint', 'raw_point', 'tapPoint', 'point', 'coordinates', 'elementId', 'candidateId', 'grant', 'proof', 'verified']) {
  for (const depth of [0, 3, 18]) test('C2 forbidden key at depth ' + depth + ': ' + key, () => {
    const input = searchSkill(); let nested = { [key]: 'not-authority' };
    for (let i = 0; i < depth; i++) nested = { nested: [nested] };
    input.extra = nested;
    const result = validateSkill(input);
    assert.equal(result.ok, false); assert.equal(has(result, 'FORBIDDEN_KEY'), true);
    assert.equal(SkillSchema.safeParse(input).success, false);
  });
}
test('C2 forbidden-key contract has exactly the eleven owner-specified names, not SQL-inferred names', () => {
  assert.deepEqual([...FORBIDDEN_KEYS], ['bounds', 'rawPoint', 'raw_point', 'tapPoint', 'point', 'coordinates', 'elementId', 'candidateId', 'grant', 'proof', 'verified']);
  assert.equal(Object.isFrozen(FORBIDDEN_KEYS), true);
});
for (const operation of ['DELETE_PHOTOS', 'UNINSTALL_APPLICATION', 'FACTORY_RESET', 'BUY_PRODUCT', 'OVERWRITE_FILE']) test('T7 prohibited operation is denied: ' + operation, () => {
  const s = searchSkill(); s.steps.push(step('bad', operation, {}, { kind: 'STATE_CHANGED' }));
  const outcome = validateSkill(s); assert.equal(outcome.ok, false); assert.equal(has(outcome, 'HARD_DENY'), true); assert.equal(outcome.maxStatus, 'DRAFT');
});
for (const label of ['Xóa hết ảnh', 'Gỡ cài đặt', 'Factory reset', 'Purchase item', 'Change password', 'Overwrite existing file', 'Grant permission', 'Send message', 'Call number']) test('T7 navigation cannot disguise a prohibited/sensitive control: ' + label, () => {
  const s = searchSkill(); s.steps[1].arguments = { purpose: 'NAVIGATION', target: target('navigation', label) };
  assert.equal(validateSkill(s).ok, false);
});
test('C2 an unknown operation and an unknown verifier are separately diagnosed', () => {
  const s = searchSkill(); s.steps[1].operation = 'INVENTED_TOOL'; assert.equal(has(validateSkill(s), 'UNKNOWN_OPERATION'), true);
  const other = searchSkill(); other.steps[3].verify = { kind: 'MAGIC_SUCCESS' }; assert.equal(has(validateSkill(other), 'UNKNOWN_VERIFIER'), true);
});
for (const operation of ['HOME', 'PRESS_KEY', 'TAP_POINT', 'SWIPE', 'SELECT_SEARCH_RESULT', 'PLAY_VIDEO']) test('C2 unsupported primitive is not admitted: ' + operation, () => {
  const s = searchSkill(); s.steps[1].operation = operation;
  assert.equal(has(validateSkill(s), 'UNSUPPORTED_IN_MVP'), true);
});
for (const key of ['ordinal', 'resultIndex']) test('C2 selection index greater than one is rejected: ' + key, () => {
  const s = searchSkill(); s.steps[3].arguments[key] = 2;
  assert.equal(has(validateSkill(s), 'UNSUPPORTED_IN_MVP'), true);
});
test('C2 parameterized ordinal selection is outside the MVP even without a literal index', () => {
  const s = searchSkill(); s.parameters.resultIndex = { type: 'integer', maxLength: 2, required: true, description: 'Requested position.' };
  assert.equal(has(validateSkill(s), 'UNSUPPORTED_IN_MVP'), true);
});
for (const role of ['password', 'otp', 'payment', 'editable']) test('C2 INPUT_TEXT cannot target arbitrary or sensitive field: ' + role, () => {
  const s = searchSkill(); s.steps[2].arguments.target.semanticRole = role; s.steps[2].verify.target.semanticRole = role;
  assert.equal(validateSkill(s).ok, false);
});
test('C2 a search role cannot hide a password resource hint', () => {
  const s = searchSkill(); s.steps[2].arguments.target.resourceIdHint = 'org.fixture:id/password';
  assert.equal(has(validateSkill(s), 'SENSITIVE_CONTENT'), true);
});
for (const name of ['password', 'otp', 'apiKey', 'accessToken', 'paymentCard']) test('T9 sensitive parameter declarations are forbidden: ' + name, () => {
  const s = searchSkill(); s.parameters[name] = { type: 'string', maxLength: 100, required: true, description: 'Do not store.' };
  assert.equal(has(validateSkill(s), 'SENSITIVE_PARAMETER'), true);
});
test('C2 parameter references must exist, be strings and be required', () => {
  for (const declaration of [undefined, { type: 'integer', maxLength: 5, required: true, description: 'Input number.' }, { type: 'string', maxLength: 50, required: false, description: 'Optional input.' }]) {
    const s = searchSkill(); if (declaration) s.parameters.query = declaration; else delete s.parameters.query;
    assert.equal(has(validateSkill(s), 'PARAMETER_MISMATCH'), true);
  }
});
test('C2 verifier must match operation, exact target, query and scope', () => {
  for (const mutate of [
    s => { s.steps[0].verify = { kind: 'STATE_CHANGED' }; },
    s => { s.steps[2].verify.expected = 'different phrase'; },
    s => { s.steps[2].verify.target.label = 'Other'; },
    s => { s.steps[3].verify.scope = 'foreign'; },
    s => { s.steps[3].verify.value = 'different phrase'; },
  ]) { const s = searchSkill(); mutate(s); assert.equal(has(validateSkill(s), 'VERIFIER_MISMATCH'), true); }
});
test('C2 search entry/submit cannot occur without activation and entry provenance', () => {
  const s = searchSkill(); s.steps.splice(1, 1); assert.equal(has(validateSkill(s), 'SEARCH_SCOPE_REQUIRED'), true);
  const other = searchSkill(); other.steps.splice(2, 1); assert.equal(has(validateSkill(other), 'SEARCH_SCOPE_REQUIRED'), true);
  const changed = searchSkill(); changed.steps[2].arguments.target.label = 'Other'; changed.steps[2].verify.target.label = 'Other';
  assert.equal(has(validateSkill(changed), 'SEARCH_SCOPE_REQUIRED'), true);
  const duplicate = searchSkill(); const extra = clone(duplicate.steps[3]); extra.id = 'duplicate'; duplicate.steps.push(extra);
  assert.equal(has(validateSkill(duplicate), 'SEARCH_SCOPE_REQUIRED'), true);
});
test('C2 reopening an app invalidates search scope and prevents an invented final search assertion', () => {
  const s = searchSkill(); s.steps.splice(3, 0, step('reopen', 'OPEN_APPLICATION', { appRef: 'youtube' }, { kind: 'FOREGROUND_IS', appRef: 'youtube' }));
  assert.equal(has(validateSkill(s), 'SEARCH_SCOPE_REQUIRED'), true);
  const other = searchSkill(); other.steps = [step('observe', 'OBSERVE_UI', { predicate: clone(other.steps[3].verify) }, clone(other.steps[3].verify))];
  assert.equal(has(validateSkill(other), 'SEARCH_SCOPE_REQUIRED'), true);
});
test('C2 app scope and optional duplicate target cannot be overridden', () => {
  const s = searchSkill(); s.steps[0].arguments.appRef = 'other'; assert.equal(has(validateSkill(s), 'APP_SCOPE_MISMATCH'), true);
  const other = searchSkill(); other.steps[2].target = target('search_field', 'Other'); assert.equal(has(validateSkill(other), 'TARGET_MISMATCH'), true);
});
test('C2 twenty steps and total 120000 ms are accepted exactly; larger budgets are rejected', () => {
  const s = searchSkill(); s.steps = Array.from({ length: 20 }, (_, i) => step('s' + i, 'OPEN_APPLICATION', { appRef: 'youtube' }, { kind: 'FOREGROUND_IS', appRef: 'youtube' }));
  s.steps.forEach(row => { row.timeoutMs = 6000; }); assert.equal(validateSkill(s).ok, true);
  const tooMany = clone(s); tooMany.steps.push(clone(s.steps[0])); assert.equal(validateSkill(tooMany).ok, false);
  const tooLong = clone(s); tooLong.steps[0].timeoutMs++; assert.equal(has(validateSkill(tooLong), 'TIMEOUT_LIMIT'), true);
  const smaller = clone(s); smaller.maxSteps = 19; assert.equal(has(validateSkill(smaller), 'STEP_LIMIT'), true);
  const invalidMax = clone(s); invalidMax.maxSteps = 21; assert.equal(validateSkill(invalidMax).ok, false);
});
test('C2 repeated step ID, unknown effect/onFail and zero/oversized per-step timeout fail closed', () => {
  for (const mutate of [s => { s.steps[1].id = s.steps[0].id; }, s => { s.steps[0].effectClass = 'WRITE'; },
    s => { s.steps[0].onFail = 'RETRY'; }, s => { s.steps[0].timeoutMs = 0; }, s => { s.steps[0].timeoutMs = 120001; }]) {
    const s = searchSkill(); mutate(s); assert.equal(validateSkill(s).ok, false);
  }
});
test('C2 bounded SCROLL and benign BACK are auxiliary, not a final outcome claim', () => {
  for (const operation of ['SCROLL_CONTAINER', 'BACK']) {
    const s = searchSkill(), args = operation === 'BACK' ? { reason: 'DISMISS_BENIGN' } : { target: { semanticRole: 'scroll_container', label: 'Results', containerRole: 'results' }, direction: 'DOWN', maxAttempts: 5 };
    s.steps.push(step('auxiliary', operation, args, { kind: 'STATE_CHANGED' }));
    const result = validateSkill(s); assert.equal(result.ok, true); assert.equal(result.warnings.some(row => row.code === 'MISSING_TERMINAL_VERIFIER'), true);
    if (operation === 'SCROLL_CONTAINER') { s.steps.at(-1).arguments.maxAttempts = 6; assert.equal(validateSkill(s).ok, false); }
  }
});
test('C2 skill validation and schema parsing do not mutate frozen input and are deterministic', () => {
  const s = frozen(searchSkill()), before = JSON.stringify(s);
  assert.deepEqual(validateSkill(s), validateSkill(s)); assert.equal(SkillSchema.safeParse(s).success, true);
  assert.equal(JSON.stringify(s), before);
});
test('T9 validator/schema errors never echo unrecognized keys, secrets or raw received values', () => {
  const secret = 'synthetic-private-fixture-' + 'x'.repeat(32), inputs = [];
  const a = searchSkill(); a[secret] = { nested: [secret] }; inputs.push(a);
  const b = searchSkill(); b.steps[0].verify = { kind: secret }; inputs.push(b);
  const c = searchSkill(); c.parameters[secret] = { type: secret }; inputs.push(c);
  const d = searchSkill(); d.extra = { nested: [{ deep: { proof: secret } }] }; inputs.push(d);
  const e = searchSkill(); e.name = { [secret]: [secret] }; inputs.push(e);
  for (const value of inputs) {
    const result = validateSkill(value); assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(secret), false);
    const parsed = SkillSchema.safeParse(value); assert.equal(parsed.success, false); assert.equal(JSON.stringify(parsed.error).includes(secret), false);
    try { SkillSchema.parse(value); assert.fail('Expected a closed schema error'); } catch (error) { assert.equal(String(error).includes(secret), false); }
  }
});
test('T9 getters, toJSON, cycles and extreme nesting cannot execute or leak through diagnostics', () => {
  const secret = 'synthetic-never-echo', values = []; let getterCalls = 0;
  const a = searchSkill(); Object.defineProperty(a, secret, { enumerable: true, get() { getterCalls++; throw Error(secret); } }); values.push(a);
  const b = searchSkill(); b.toJSON = () => { getterCalls++; return secret; }; values.push(b);
  const c = searchSkill(); c.extra = c; values.push(c);
  const d = searchSkill(); let nested = { value: secret }; for (let i = 0; i < 1000; i++) nested = { nested: [nested] }; d.extra = nested; values.push(d);
  for (const value of values) { const outcome = validateSkill(value); assert.equal(outcome.ok, false); assert.equal(JSON.stringify(outcome).includes(secret), false); }
  assert.equal(getterCalls, 0);
});
test('T9 credential-shaped literal values are rejected without appearing in results', () => {
  for (const secret of ['Bearer synthetic_credential_for_fixture_only', 'https://example.invalid/?token=synthetic', '4111 1111 1111 1111', '123456']) {
    const s = searchSkill(); s.steps[2].arguments.value = secret;
    const result = validateSkill(s); assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
test('C2 sanitizer projects structural semantics only, even for explicitly safe search input', () => {
  const original = frozen([live()]), before = JSON.stringify(original), result = sanitizeSnapshot(original);
  assert.equal(result.redactionStatus, 'REDACTED'); assert.equal(result.captureAllowed, false);
  assert.equal(result.nodes[0].role, 'search_field'); assert.equal(result.nodes[0].labelClass, 'SEARCH_FIELD');
  for (const key of ['text', 'hint', 'value', 'description', 'resourceId', 'bounds', 'elementId', 'image', 'xml']) assert.equal(Object.hasOwn(result.nodes[0], key), false);
  assert.equal(JSON.stringify(result).includes('OpenAI'), false); assert.equal(JSON.stringify(original), before);
  assert.deepEqual(result, sanitizeSnapshot(original));
});
for (const extra of [{ password: true }, { secure: true }, { sensitive: true }, { fieldType: 'PASSWORD' }, { fieldType: 'OTP' }, { fieldType: 'PAYMENT' }]) test('T9 sensitive live metadata omits all content: ' + Object.keys(extra)[0] + ':' + String(Object.values(extra)[0]), () => {
  const secret = 'synthetic-sensitive-fixture', result = sanitizeSnapshot([live({ ...extra, text: secret, hint: secret, value: secret, description: secret })]);
  assert.equal(result.redactionStatus, 'SENSITIVE_CONTENT_OMITTED'); assert.equal(result.nodes[0].role, 'sensitive'); assert.equal(JSON.stringify(result).includes(secret), false);
});
for (const omitted of ['password', 'secure', 'sensitive', 'fieldType']) test('C2 missing privacy metadata fails closed: ' + omitted, () => {
  const node = live(); delete node[omitted]; const result = sanitizeSnapshot([node]);
  assert.equal(result.redactionStatus, 'CAPTURE_SAFETY_UNKNOWN'); assert.equal(result.captureAllowed, false); assert.equal(JSON.stringify(result).includes('OpenAI'), false);
});
for (const content of ['https://example.invalid/?query=private', 'token=synthetic-private', '4111 1111 1111 1111', '987654']) test('T9 URL/query/card-like content is omitted: ' + (content.startsWith('http') ? 'URL' : content.startsWith('token') ? 'token' : 'digits'), () => {
  const result = sanitizeSnapshot([live({ text: content })]);
  assert.equal(result.redactionStatus, 'SENSITIVE_CONTENT_OMITTED'); assert.equal(JSON.stringify(result).includes(content), false);
});
test('T9 raw XML, image payload, nested unknown values and hostile field names never enter snapshot output', () => {
  const secret = 'synthetic-nested-content';
  const input = [live({ rawXml: '<hierarchy>' + secret + '</hierarchy>', image: { bytes: [secret] }, [secret]: { nested: [secret] } })];
  assert.equal(JSON.stringify(sanitizeSnapshot(input)).includes(secret), false);
});
test('C2 sensitive and unknown ancestor status propagates to apparently safe children', () => {
  const parent = live({ className: 'android.widget.FrameLayout', fieldType: 'TEXT', secure: true });
  const child = live({ parentIndex: 0 });
  assert.equal(sanitizeSnapshot([parent, child]).nodes[1].redactionStatus, 'SENSITIVE_CONTENT_OMITTED');
  delete parent.secure; assert.equal(sanitizeSnapshot([parent, child]).nodes[1].redactionStatus, 'CAPTURE_SAFETY_UNKNOWN');
  assert.equal(sanitizeSnapshot([live({ parentIndex: 0 })]).nodes[0].redactionStatus, 'CAPTURE_SAFETY_UNKNOWN');
});
test('C2 malformed snapshot/cycle/getter is unknown and does not invoke input code', () => {
  let called = 0; const getter = live(); Object.defineProperty(getter, 'text', { get() { called++; throw Error('not emitted'); } });
  const cycle = live(); cycle.extra = cycle;
  for (const input of [undefined, 'raw XML', [getter], [cycle], [null]]) assert.equal(sanitizeSnapshot(input).redactionStatus, 'CAPTURE_SAFETY_UNKNOWN');
  assert.equal(called, 0);
});
test('C2 ephemeral geometry/identity are separate and cannot serialize into a persisted snapshot or inspect log', () => {
  const nodes = frozen([live()]), diagnostic = createEphemeralDiagnostics(nodes), entries = diagnostic.readForLocalInspection();
  assert.deepEqual(entries, [{ nodeIndex: 0, bounds: [0, 0, 200, 80], elementId: 'live-S1-element' }]);
  const serialized = JSON.stringify(diagnostic), inspected = inspect(diagnostic);
  for (const text of [serialized, inspected, JSON.stringify(sanitizeSnapshot(nodes))]) { assert.equal(text.includes('live-S1-element'), false); assert.equal(text.includes('OpenAI'), false); }
  entries[0].bounds[0] = 999; assert.equal(diagnostic.readForLocalInspection()[0].bounds[0], 0);
  assert.deepEqual(createEphemeralDiagnostics([live({ secure: true })]).readForLocalInspection(), []);
});
test('T9 pure validation/sanitization produces no console log or error output', () => {
  const methods = ['log', 'warn', 'error', 'info', 'debug'], saved = methods.map(key => console[key]); let calls = 0;
  try {
    for (const key of methods) console[key] = () => { calls++; };
    validateSkill(searchSkill()); validateSkill({ unexpected: ['synthetic-private-value'] }); sanitizeSnapshot([live({ password: true, text: 'synthetic-private-value' })]);
  } finally { methods.forEach((key, index) => { console[key] = saved[index]; }); }
  assert.equal(calls, 0);
});
test('C2 modules have no execution, database, model or I/O entry points', () => {
  const files = ['skill-schema.ts', 'skill-safety.ts', 'skill-validator.ts', 'snapshot-sanitizer.ts'];
  for (const file of files) {
    const source = fs.readFileSync(path.resolve('lib/skills', file), 'utf8');
    assert.equal(/(?:node:fs|node:http|node:net|child_process|process\.env|\bfetch\s*\(|\bconsole\.|\bnew Date\b|Date\.now|Math\.random)/.test(source), false);
  }
});
