/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { z } = require('zod'), { AgentBudget } = require('../lib/android/agent/budget.ts');
const { sourceSlots } = require('../lib/android/agent/source-slots.ts');
const { proposePrimitiveDecomposition, validatePrimitiveDecomposition } = require('../lib/android/agent/primitive-decomposition.ts');
const { chooseCompatible, rankCompatible } = require('../lib/android/agent/compatible-choice.ts');
const { issueCloudCommand, cloudCommandText } = require('../lib/android/agent/cloud-command.ts');
const schema = z.object({ choice: z.enum(['C1', 'C2', 'C3', 'ABSTAIN']) }).strict();
for (const [source, expected] of [
  ['loc marine biology catalogue', 'marine biology catalogue'], ['loc tidal ecology notes', 'tidal ecology notes'],
  ['tìm kiếm sinh học biển', 'sinh học biển'], ['tim kiem sinh hoc bien', 'sinh hoc bien'],
  ['please search for marine biology talks please', 'marine biology talks'], ['vui lòng tìm hải dương học nhé', 'hải dương học'],
  ['nhap full multi word value', 'full multi word value'], ['tao ghi chu thu nghiem', 'ghi chu thu nghiem'],
]) test('M4e maximal unquoted value: ' + source, () => {
  const p = sourceSlots(source), slots = p.clauses[0].slots;
  assert.equal(slots.length, 1); assert.equal(slots[0].text, expected); assert.equal(p.request.slice(slots[0].start, slots[0].end), expected);
});
test('M4e both real failing queries now skip inference with full review values', async () => {
  for (const [pkg, value] of [['com.sec.android.app.myfiles', 'marine biology catalogue'], ['com.google.android.apps.docs', 'tidal ecology notes']]) {
    const b = new AgentBudget(); let calls = 0;
    const p = await proposePrimitiveDecomposition('Ghe ' + pkg + ' roi loc ' + value, { generate() { calls++; throw Error('No inference needed'); } }, b);
    assert.equal(calls, 0); assert.equal(b.profiling.singletonClausesSkipped, 2); assert.equal(p.spec.outcomes[1].value, value); assert.ok(p.summary.endsWith(value));
  }
});
test('M4e quoted connectors stay literal, ambiguous unquoted connectors clarify', () => {
  assert.equal(sourceSlots('loc "rock and roll"').clauses[0].slots[0].text, '"rock and roll"');
  for (const source of ['loc rock and roll', 'loc marine, biology', 'loc ocean then', 'loc in Unknown for marine talks']) assert.throws(() => sourceSlots(source), /NEEDS_CLARIFICATION/);
});
test('M4e unique app qualifiers preserve full contiguous value', async () => {
  const apps = [{ packageName: 'org.atlas', label: 'Atlas' }];
  for (const source of ['loc trong Atlas ve marine biology', 'loc marine biology trong Atlas', 'search in Atlas for marine biology']) {
    const p = await proposePrimitiveDecomposition(source, { generate() { throw Error('No model'); } }, new AgentBudget(), undefined, { apps });
    assert.equal(p.spec.outcomes[0].value, 'marine biology'); assert.equal(p.spec.outcomes[0].app, 'Atlas');
  }
});
test('M4e incomplete direct value, omitted actions and destructive injection still rejected', () => {
  const request = 'loc marine biology catalogue';
  assert.throws(() => validatePrimitiveDecomposition(request, { steps: [{ primitive: 'SEARCH', source: { start: 0, end: request.length }, target: null, value: { start: 11, end: request.length }, negated: false, dependencies: [] }] }), /NOT_MAXIMAL/);
  for (const source of ['loc ocean; delete all photos', 'loc ocean roi xoa all', 'do not loc marine biology']) {
    if (source.startsWith('do not')) assert.ok(sourceSlots(source).clauses.length); else assert.throws(() => sourceSlots(source));
  }
});
test('M4e pre-rank skips singleton, excludes writes, and abstains on zero', async () => {
  let calls = 0; const ai = { generate() { calls++; throw Error('No model'); } }, b = new AgentBudget();
  const input = { candidates: [{ id: 'C1', action: 'CLICK', role: 'SEARCH', effect: 'READ' }, { id: 'C2', action: 'CLICK', role: 'MENU', effect: 'READ' }] };
  assert.equal((await chooseCompatible(schema, '', input, { kind: 'NEXT', source: 'search ocean' }, ai, b)).decision.choice, 'C1');
  assert.equal((await chooseCompatible(schema, '', input, { kind: 'NEXT', source: 'delete photos' }, ai, b)).decision.choice, 'ABSTAIN'); assert.equal(calls, 0);
  assert.deepEqual(rankCompatible({ kind: 'NEXT', source: 'search ocean' }, [{ ...input.candidates[0], sensitive: true }]).ids, []);
});
test('M4e multiple compatible IDs call once on reduced set; incompatible answer abstains', async () => {
  let offered;
  const input = { candidates: [{ id: 'C1', action: 'CLICK', role: 'SEARCH' }, { id: 'C2', action: 'CLICK', role: 'SEARCH' }, { id: 'C3', action: 'CLICK', role: 'MENU' }] };
  const result = await chooseCompatible(schema, '', input, { kind: 'NEXT', source: 'search ocean' }, { async generate(_s, _sys, input) { offered = input.candidates; return { choice: 'C3' }; } }, new AgentBudget());
  assert.deepEqual(offered.map(x => x.id), ['C1', 'C2']); assert.equal(result.decision.choice, 'ABSTAIN'); assert.equal(result.rejected, true);
});
test('M4e cloud command opt-in authenticates source and withholds sensitive, editable and long text', () => {
  const old = process.env.AGENT_GROQ_SEND_COMMAND_TEXT;
  try {
    delete process.env.AGENT_GROQ_SEND_COMMAND_TEXT; const ref = issueCloudCommand('search marine biology'); assert.equal(cloudCommandText({ commandRef: ref }), undefined);
    process.env.AGENT_GROQ_SEND_COMMAND_TEXT = 'true'; assert.equal(cloudCommandText({ commandRef: ref }), 'search marine biology');
    assert.equal(cloudCommandText({ commandRef: {}, request: 'private screen label' }), undefined);
    for (const source of ['type password secret', 'send message hello to 5550100', 'open contacts', 'search ' + 'a'.repeat(513)]) assert.equal(cloudCommandText({ commandRef: issueCloudCommand(source) }), undefined);
    assert.equal(cloudCommandText({ commandRef: ref, sensitive: true }), undefined); assert.equal(cloudCommandText({ commandRef: ref, editable: true }), undefined);
  } finally { if (old === undefined) delete process.env.AGENT_GROQ_SEND_COMMAND_TEXT; else process.env.AGENT_GROQ_SEND_COMMAND_TEXT = old; }
});
test('M4e unresolved read identity abstains after a valid model ID instead of treating choice as proof', async () => {
  let calls = 0;
  const input = { candidates: [{ id: 'C1', action: 'READ_VALUE', role: 'READ_VALUE', effect: 'READ' }, { id: 'C2', action: 'READ_VALUE', role: 'READ_VALUE', effect: 'READ' }] };
  const r = await chooseCompatible(schema, '', input, { kind: 'NEXT', source: 'read current value' }, { async generate() { calls++; return { choice: 'C1' }; } }, new AgentBudget());
  assert.equal(calls, 1); assert.equal(r.skipped, false); assert.equal(r.rawChoice, 'C1'); assert.equal(r.decision.choice, 'ABSTAIN'); assert.equal(r.rejected, true);
});
