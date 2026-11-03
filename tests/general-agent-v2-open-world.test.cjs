/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID, createHash } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { understandUiWorld } = require('../lib/android/agent/ui-world-model.ts');
const { discoveryPlan, chooseGroundedNext } = require('../lib/android/agent/open-world-plan.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { verifyAll } = require('../lib/android/agent/composite-verification.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const fixtures = require('./fixtures/agent-v2-open-world-holdout.cjs');
const runtimeFiles = fs.readdirSync('lib/android/agent').filter(f => f.endsWith('.ts')).sort();
const digest = () => createHash('sha256').update(runtimeFiles.map(f => fs.readFileSync('lib/android/agent/' + f)).join('\n')).digest('hex');
const frozen = digest();

function scene(f, selected = false) {
  const snapshotId = randomUUID(), packageName = f.app;
  const row = { text: f.label, description: '', className: f.widget, resourceId: packageName + ':id/x91', packageName,
    enabled: true, clickable: true, focused: false, displayed: true, selected, bounds: [10, 50, 350, 110] };
  const nodes = [row, ...(f.duplicate ? [{ ...row, bounds: [10, 150, 350, 210] }] : []), ...(f.overlay ? [{ ...row, className: 'android.app.Dialog', text: 'Information', clickable: false, resourceId: 'android:id/alertTitle' }] : [])];
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: packageName, observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}

test('open goals preserve unbound requests and dependencies without fabricating execution contracts', () => {
  for (const f of fixtures.filter(f => f.group === 'TASK')) {
    const graph = compileOutcomes(f.request, 'A', 'E'), plan = discoveryPlan(graph);
    assert.equal(plan.originalGoal, f.request); assert.equal(plan.goals[0].source, graph.original.outcomes[0].span.text);
    assert.equal(plan.goals[0].state, f.expected); assert.ok(plan.goals[0].missing.includes('INDEPENDENT_VERIFIER'));
    assert.equal(plan.next.purpose, 'DISCOVER_CONTRACT'); assert.equal(graph.coverage, 'NEEDS_CLARIFICATION');
  }
  const g = compileOutcomes('Mo org.unseen.archive va xem Collections', 'A', 'E');
  const plan = discoveryPlan(g); assert.deepEqual(plan.goals[1].dependencies, [plan.goals[0].id]);
  assert.equal(plan.next.parentId, plan.goals[0].id);
  assert.equal(digest(), frozen);
});

test('universal model records structural roles, unknowns, unique identity and explicit hierarchy only', () => {
  const f = fixtures[0], s = scene(f), model = understandUiWorld(s, 'E', 'SESSION');
  assert.ok(model.widgets[0].roles.includes('navigation')); assert.ok(model.widgets[0].identity); assert.equal(model.state, 'READY');
  const duplicate = understandUiWorld(scene({ ...f, duplicate: true }), 'E', 'SESSION');
  assert.equal(duplicate.widgets.every(w => !w.identity), true);
  const unknown = scene({ ...f, widget: 'org.custom.Shape' }); unknown.nodes[0].clickable = false;
  const unclassified = understandUiWorld(unknown, 'E', 'SESSION').widgets[0];
  assert.deepEqual(unclassified.roles, ['unknown']); assert.equal(unclassified.allowed, false);
  const stale = understandUiWorld({ ...s, timestamp: Date.now() - 6000 }, 'E', 'SESSION');
  assert.equal(stale.state, 'STALE'); assert.equal(stale.widgets.every(w => !w.allowed), true);
  const form = scene(f); form.nodes[0].className = 'com.google.android.material.textfield.TextInputLayout';
  form.nodes.push({ ...form.nodes[0], className: 'android.widget.EditText', text: '', resourceId: 'org.holdout.archive:id/entry' });
  form.elements.push({ ...form.nodes[1], elementId: form.snapshotId + ':1', parentElementId: form.elements[0].elementId });
  assert.equal(understandUiWorld(form, 'E', 'SESSION').groups[0].members.length, 1);
});

test('new widget roles do not turn arbitrary clickable controls into navigation candidates', () => {
  for (const f of fixtures.filter(f => f.group === 'APPLICATION')) {
    const graph = compileOutcomes(`Mo ${f.app} va xem ${f.label}`, 'A', 'E'), node = graph.nodes[1]; node.packageName = f.app;
    const page = generateGroundedCandidates(node, scene(f), 'E', 'SESSION', false);
    assert.equal(page.candidates.length, f.expected === 'COMPLETED' ? 1 : 0);
  }
});

test('next-action reasoner receives original goal, outstanding outcomes, effects and budget, never arbitrary execution output', async () => {
  const f = fixtures[0], graph = compileOutcomes(`Mo ${f.app} va xem ${f.label}`, 'A', 'E'), node = graph.nodes[1]; node.packageName = f.app;
  const s = scene(f), world = understandUiWorld(s, 'E', 'SESSION'), candidates = generateGroundedCandidates(node, s, 'E', 'SESSION', false).candidates;
  let calls = 0;
  const reasoner = { async generate(schema, system, data) {
    calls++; assert.equal(data.originalGoal, graph.original.request); assert.equal(data.outstanding.length, 2);
    assert.ok(data.remainingMs > 0); assert.equal(data.candidates[0].effect, 'READ');
    assert.ok(!JSON.stringify(data).includes('selector')); return schema.parse({ choice: candidates[0].id, reason: 'Observed navigation' });
  } };
  assert.equal((await chooseGroundedNext(node, graph, candidates, world, [], new AgentBudget(), reasoner)).choice, candidates[0].id);
  await assert.rejects(chooseGroundedNext(node, graph, [{ ...candidates[0] }], world, [], new AgentBudget(), reasoner));
  await assert.rejects(chooseGroundedNext(node, graph, candidates, { ...world, deviceId: 'B' }, [], new AgentBudget(), reasoner));
  const bad = { async generate() { return { choice: 'shell', reason: 'invented', selector: '//guess' }; } };
  await assert.rejects(chooseGroundedNext(node, graph, candidates, world, [], new AgentBudget(), bad));
  assert.equal(calls, 1);
});

test('composite completion requires all independent predicates; partial evidence and screen change cannot complete', () => {
  const s = scene(fixtures[0], true), ctx = { deviceId: 'A', executionId: 'E', nodeId: 'N', packageName: s.foregroundPackage };
  const contract = { purpose: 'OUTCOME', all: [{ kind: 'FOREGROUND_IS', packageName: s.foregroundPackage }, { kind: 'ELEMENT_VISIBLE', label: fixtures[0].label }] };
  assert.equal(verifyAll(contract, s, ctx).status, 'VERIFIED');
  const missing = verifyAll({ ...contract, all: [...contract.all, { kind: 'TEXT_EQUALS', value: 'absent' }] }, s, ctx);
  assert.equal(missing.status, 'SAFE_BLOCKED'); assert.equal(missing.evidence.length, 0);
  assert.equal(verifyAll({ purpose: 'OUTCOME', all: [{ kind: 'STATE_CHANGED', beforeFingerprint: 'old' }] }, s, ctx).status, 'SAFE_BLOCKED');
  assert.equal(verifyAll(contract, { ...s, deviceSerial: 'B' }, ctx).status, 'SAFE_BLOCKED');
});

test('FROZEN SIMULATED application and initial-state holdout: runtime completes only verified selection, never retries uncertain dispatch', async () => {
  const rows = [];
  for (const f of fixtures.filter(f => f.group !== 'TASK')) {
    let selected = Boolean(f.selected), clicks = 0, closed = 0; const events = [], actions = [];
    const adapter = { catalog: { async resolve() { return { app: { serial: 'A', packageName: f.app }, choices: [] }; } },
      async open() { return { backend: 'appium', sessionId: () => 'SESSION', async observe() { return scene(f, selected); }, async execute(action) { actions.push(action); },
        async interactV2(grant) { consumeEffectGrant(grant, 'A', 'SESSION'); clicks++; if (f.uncertain) throw Error('Lost response'); selected = true; return scene(f, selected); }, async close() { closed++; } }; } };
    const noAI = { async generate() { throw Error('No model needed for unique direct target'); } };
    await runAgentV2(`Mo ${f.app} va xem ${f.label}`, 'A', 'E', 'physical-A', new AgentBudget(), adapter, e => events.push(e), undefined, noAI);
    const last = events.at(-1); assert.equal(last.status, f.expected, f.id); assert.equal(closed, 1);
    assert.equal(clicks <= 1, true); assert.equal(actions.length, 0, 'Never reset or force launch when already in app');
    if (f.selected) assert.equal(clicks, 0);
    if (last.status === 'COMPLETED') assert.equal(last.v2.graph.nodes.every(n => n.evidenceIds.length), true);
    assert.ok(last.v2.discovery); rows.push({ id: f.id, status: last.status, clicks });
  }
  assert.equal(digest(), frozen, 'Runtime changed during held-out evaluation');
  console.log('OFFLINE_HOLDOUT ' + JSON.stringify({ runtimeSha256: frozen, rows }));
});
