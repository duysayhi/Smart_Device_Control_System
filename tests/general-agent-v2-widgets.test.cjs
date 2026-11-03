/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates, revalidateGroundedCandidate } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { verifyPredicate } = require('../lib/android/agent/verification-registry.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { normalizeMathDisplay } = require('../lib/android/agent/math-keypad.ts');
const pkg = 'net.unseen.widgets';
function scene(expression = '', result = '', toggle = undefined) {
  const nodes = [
    { text: expression, resourceId: pkg + ':id/formula', className: 'android.widget.TextView' },
    ...['0','1','2','3','4','5','6','7','8','9','×','+','-','/','='].map(text => ({ text, className: 'android.widget.Button', clickable: true })),
    { text: result, resourceId: pkg + ':id/result', className: 'android.widget.TextView' },
  ];
  if (toggle !== undefined) nodes.push({ text: 'Show labels', className: 'android.widget.Switch', resourceId: pkg + ':id/labels', checkable: true, checked: toggle, clickable: true });
  const snapshotId = randomUUID();
  const rows = nodes.map((n, i) => ({ text: '', description: '', resourceId: '', className: '', packageName: pkg, enabled: true, displayed: true, focused: false, clickable: false, bounds: [5, i * 35, 350, i * 35 + 30], ...n }));
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED', viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes: rows, elements: rows.map((row, i) => ({ ...row, elementId: snapshotId + ':' + i })) };
}
function fixture(options = {}) {
  let expression = options.initial ?? '', result = '', state = false, closed = 0;
  const actions = [], events = [];
  const adapter = { catalog: { async resolve(name) { return { app: { serial: 'A', requestedName: name, packageName: pkg, component: pkg + '/.Main' }, choices: [] }; } },
    async open() { return { backend: 'appium', sessionId: () => 'session-a', observe: async () => scene(expression, result, state), execute: async () => {}, close: async () => { closed++; },
      async interactV2(grant) {
        consumeEffectGrant(grant, 'A', 'session-a'); const c = grant.candidate; actions.push(c);
        if (options.uncertain) throw Error('response lost');
        if (c.keypad) expression = options.wrongKey ? '999' : c.keypad.after;
        else if (c.desired !== undefined) state = options.noTransition ? state : c.desired;
        else result = options.wrongResult ? '3' : '6000';
        return scene(expression, result, state);
      } }; } };
  return { adapter, actions, events, get closed() { return closed; } };
}
const noAI = { generate() { throw Error('Unique controls must use rules'); } };
test('OFFLINE keypad: each requested key is freshly grounded and read back before equals/result completion', async () => {
  const f = fixture();
  await runAgentV2('Mo net.unseen.widgets va tinh 125 * 48', 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI);
  assert.equal(f.events.at(-1).status, 'COMPLETED');
  assert.deepEqual(f.actions.map(c => c.keypad?.key ?? '='), ['1','2','5','*','4','8','=']);
  assert.equal(f.closed, 1);
});
test('OFFLINE keypad never replays uncertain input, accepts wrong readback or overwrites a preexisting expression', async () => {
  for (const options of [{ uncertain: true }, { wrongKey: true }, { wrongResult: true }, { initial: '7+2' }]) {
    const f = fixture(options);
    await runAgentV2('Mo net.unseen.widgets va tinh 125 * 48', 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI);
    assert.notEqual(f.events.at(-1).status, 'COMPLETED');
    assert.equal(f.actions.filter(c => c.keypad?.after === '1').length <= 1, true);
    if (options.initial) assert.equal(f.actions.length, 0);
  }
});
test('OFFLINE keypad rejects stale, duplicate, changed-device and changed-expression candidates', () => {
  const node = compileOutcomes('Mo net.unseen.widgets va tinh 11 + 2', 'A', 'exec-a').nodes[1]; node.packageName = pkg;
  const s = scene(), c = generateGroundedCandidates(node, s, 'exec-a', 'session-a', false).candidates[0];
  assert.ok(c?.keypad);
  assert.equal(revalidateGroundedCandidate(c, node, { ...s, timestamp: Date.now() - 6000 }, 'exec-a', 'session-a', false), undefined);
  assert.equal(revalidateGroundedCandidate(c, node, scene('9'), 'exec-a', 'session-a', false), undefined);
  assert.equal(revalidateGroundedCandidate(c, node, { ...s, deviceSerial: 'B' }, 'exec-a', 'session-a', false), undefined);
  s.nodes.push({ ...s.nodes[2] }); s.elements.push({ ...s.elements[2], elementId: 'duplicate' });
  assert.equal(generateGroundedCandidates(node, s, 'exec-a', 'session-a', false).candidates.length, 0);
  assert.equal(normalizeMathDisplay('12 × 5'), '12*5');
});
test('OFFLINE toggle requires scoped effect confirmation and observed desired state; denial does not click', async () => {
  for (const options of [{}, { denied: true }, { noTransition: true }, { uncertain: true }]) {
    const f = fixture(options); let requests = 0;
    await runAgentV2('Mo net.unseen.widgets va bat Show labels', 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => {
      f.events.push(e);
      if (e.v2?.assistance) { requests++; const a = e.v2.assistance; assert.equal(a.category, 'EFFECT_CONFIRMATION'); assert.equal(a.sessionRetained, true);
        assert.equal(submitAssistanceV2({ deviceId: 'A', executionId: 'exec-a', token: a.token, approved: !options.denied, choice: a.choices[0].id }), true); }
    }, undefined, noAI);
    assert.equal(requests, 1);
    assert.equal(f.events.at(-1).status, Object.keys(options).length ? 'BLOCKED' : 'COMPLETED', JSON.stringify({ options, reason: f.events.at(-1).reason }));
    assert.equal(f.actions.length, options.denied ? 0 : 1);
    assert.equal(f.closed, 1);
  }
});
test('OFFLINE toggle verifier rejects disabled and duplicate controls, permission overlays and wrong device', () => {
  const context = { deviceId: 'A', executionId: 'exec-a', nodeId: 'state', packageName: pkg };
  const predicate = { kind: 'ITEM_SELECTED', label: 'Show labels', checked: true };
  assert.ok(verifyPredicate(predicate, scene('', '', true), context).evidence);
  assert.equal(verifyPredicate(predicate, scene('', '', false), context).evidence, undefined);
  const s = scene('', '', true); s.nodes.push({ ...s.nodes.at(-1), checked: false });
  assert.equal(verifyPredicate(predicate, s, context).evidence, undefined);
  assert.equal(verifyPredicate(predicate, { ...scene('', '', true), deviceSerial: 'B' }, context).evidence, undefined);
  const overlay = scene('', '', true); overlay.nodes[0].packageName = 'com.android.permissioncontroller';
  assert.equal(verifyPredicate(predicate, overlay, context).evidence, undefined);
});
test('OFFLINE localized buttons use their observed glyphs; a clickable formula containing 1 is not a second key', () => {
  const node = compileOutcomes('Mo net.unseen.widgets va tinh 125 * 48', 'A', 'exec-a').nodes[1]; node.packageName = pkg;
  const s = scene('1'); s.nodes[0].className = 'android.widget.EditText'; s.nodes[0].clickable = true; s.nodes[0].focused = true;
  for (const row of s.nodes) if (row.className === 'android.widget.Button') row.description = 'Localized spoken label ' + row.text;
  const candidates = generateGroundedCandidates(node, s, 'exec-a', 'session-a', false, 0, '1').candidates;
  assert.equal(candidates.length, 1); assert.equal(candidates[0].keypad.key, '2'); assert.equal(candidates[0].keypad.after, '12');
});
test('OFFLINE expression readback derives spoken operators from actual observed buttons, not an app or language dictionary', () => {
  const { observedMathExpression } = require('../lib/android/agent/math-keypad.ts');
  const s = scene('125 Nhân'); s.nodes.find(n => n.text === '×').description = 'Nhân';
  assert.equal(observedMathExpression(s), '125*');
  const node = compileOutcomes('Mo net.unseen.widgets va tinh 125 * 48', 'A', 'exec-a').nodes[1]; node.packageName = pkg;
  assert.equal(generateGroundedCandidates(node, s, 'exec-a', 'session-a', false, 0, '125*').candidates[0].keypad.key, '4');
  s.nodes[0].text = '125 injected'; assert.equal(observedMathExpression(s), undefined);
});
test('OFFLINE MediaStore requires issued inventories, unique new owned nonempty media and physical provenance', async () => {
  const { createHash } = require('node:crypto');
  const { MediaStoreReader, capturedMediaDelta } = require('../lib/android/agent/media-evidence.ts');
  const { verifyCapturedMedia } = require('../lib/android/agent/verification-registry.ts');
  const { ArtifactStore } = require('../lib/android/agent/artifact-store.ts');
  const physicalId = 'android:' + createHash('sha256').update(JSON.stringify(['SERIAL1234','Acme','Device'])).digest('hex');
  const properties = '[ro.serialno]: [SERIAL1234]\n[ro.boot.serialno]: [SERIAL1234]\n[ro.product.manufacturer]: [Acme]\n[ro.product.model]: [Device]\n';
  const row = (id, owner = pkg, size = 40) => `Row: 0 _id=${id}, date_added=${Math.floor(Date.now()/1000)}, _size=${size}, mime_type=image/jpeg, owner_package_name=${owner}`;
  let output = 'No result found.';
  const reader = new MediaStoreReader('A', async args => ({ stdout: args.includes('getprop') ? properties : output, stderr: '' }));
  const before = await reader.read(physicalId); output = row(10);
  const after = await reader.read(physicalId);
  assert.equal(capturedMediaDelta(before, after, 'A', physicalId, pkg).mediaId, '10');
  assert.equal(capturedMediaDelta({ ...before }, after, 'A', physicalId, pkg), undefined);
  assert.equal(capturedMediaDelta(before, after, 'B', physicalId, pkg), undefined);
  assert.equal(capturedMediaDelta(before, after, 'A', 'wrong', pkg), undefined);
  assert.equal(capturedMediaDelta(after, after, 'A', physicalId, pkg), undefined);
  const proof = verifyCapturedMedia(before, after, scene(), { deviceId: 'A', executionId: 'exec-a', nodeId: 'capture', packageName: pkg }, physicalId);
  assert.ok(proof); const store = new ArtifactStore('A', physicalId, 'exec-a');
  const artifact = store.put(proof, ['next']); assert.equal(artifact.kind, 'SAVED_MEDIA'); assert.equal(artifact.media.uri, 'content://media/external/images/media/10');
  assert.throws(() => store.put(proof, ['next']), /Duplicate/);
  assert.throws(() => store.read(artifact.id, 'B', 'exec-a', 'next'));
  assert.throws(() => store.read(artifact.id, 'A', 'other', 'next'));
  for (const invalid of [row(11, 'other.owner'), row(12, pkg, 0), row(13) + '\n' + row(14)]) {
    output = invalid; const inventory = await reader.read(physicalId); assert.equal(capturedMediaDelta(before, inventory, 'A', physicalId, pkg), undefined);
  }
  output = row(15) + '\n' + row(15); await assert.rejects(reader.read(physicalId), /duplicate/);
  output = 'SecurityException: Permission Denial'; await assert.rejects(reader.read(physicalId), /denied/);
  output = 'No result found.'; await assert.rejects(reader.read('wrong'), /MISMATCH/);
});
test('OFFLINE capture executes one observed shutter only after approval and verifies a saved URI, not a thumbnail', async () => {
  const { createHash } = require('node:crypto');
  const { MediaStoreReader } = require('../lib/android/agent/media-evidence.ts');
  const physicalId = 'android:' + createHash('sha256').update(JSON.stringify(['SERIAL1234','Acme','Device'])).digest('hex');
  const properties = '[ro.serialno]: [SERIAL1234]\n[ro.boot.serialno]: [SERIAL1234]\n[ro.product.manufacturer]: [Acme]\n[ro.product.model]: [Device]\n';
  for (const denied of [false, true]) {
    let captured = false, clicks = 0, closed = 0; const events = [];
    const observe = () => {
      const s = scene();
      const extra = [{ text: '', description: '', className: 'android.view.SurfaceView', clickable: false }, { text: '', description: 'Take photo', className: 'android.widget.Button', clickable: true }];
      for (const row of extra) { const n = { ...s.nodes[0], ...row, resourceId: '', bounds: row.className === 'android.view.SurfaceView' ? [0,0,400,600] : [5,710,350,760] }; s.nodes.push(n); s.elements.push({ ...n, elementId: randomUUID() }); }
      return s;
    };
    const media = new MediaStoreReader('A', async args => ({ stdout: args.includes('getprop') ? properties : captured ? `Row: 0 _id=71, date_added=${Math.floor(Date.now()/1000)}, _size=100, mime_type=image/jpeg, owner_package_name=${pkg}` : 'No result found.', stderr: '' }));
    const adapter = { media, catalog: { resolve: async () => ({ app: { serial: 'A', requestedName: pkg, packageName: pkg }, choices: [] }) },
      open: async () => ({ backend: 'appium', sessionId: () => 'session-a', observe: async () => observe(), execute: async () => {}, close: async () => { closed++; },
        interactV2: async grant => { consumeEffectGrant(grant, 'A', 'session-a'); assert.equal(grant.candidate.capture, true); clicks++; captured = true; return observe(); } }) };
    await runAgentV2('Mo net.unseen.widgets va chup mot tam hinh', 'A', 'exec-a', physicalId, new AgentBudget(), adapter, e => {
      events.push(e); if (e.v2?.assistance) { const a=e.v2.assistance; submitAssistanceV2({ deviceId: 'A', executionId: 'exec-a', token: a.token, approved: !denied, choice: a.choices[0].id }); }
    }, undefined, noAI);
    assert.equal(events.at(-1).status, denied ? 'BLOCKED' : 'COMPLETED'); assert.equal(clicks, denied ? 0 : 1); assert.equal(closed, 1);
    if (!denied) assert.equal(events.at(-1).v2.graph.nodes.at(-1).evidenceIds.length, 1);
  }
});
test('OFFLINE localized arithmetic requires observed locale plus executed expression trace; 6.000 is not guessed as 6000', () => {
  const s = scene('6.000 Kết quả tính toán'); s.nodes[0].className = 'android.widget.EditText'; s.nodes[0].focused = true; s.nodes[0].clickable = true;
  const context = { deviceId: 'A', executionId: 'exec-a', nodeId: 'calc', packageName: pkg, observedExpression: '125 * 48', numberLocale: 'vi-VN' };
  const predicate = { kind: 'VALUE_EQUALS', expression: '125 * 48', value: '6000' };
  assert.ok(verifyPredicate(predicate, s, context).evidence);
  for (const altered of [{ numberLocale: undefined }, { numberLocale: 'en-US' }, { observedExpression: undefined }]) assert.equal(verifyPredicate(predicate, s, { ...context, ...altered }).evidence, undefined);
  s.nodes[0].text = '6.000 + 1'; assert.equal(verifyPredicate(predicate, s, context).evidence, undefined);
});
test('OFFLINE constrained decomposition keeps spans, rejects omissions/effects/code and requires human review before discovery', async () => {
  const { validateOutcomeProposal, compileReviewedProposal } = require('../lib/android/agent/outcome-proposal.ts');
  const request = 'Start application net.unseen.widgets', start = request.indexOf('net.');
  const raw = { nodes: [{ kind: 'LAUNCH', span: { start: 0, end: request.length }, valueSpan: { start, end: request.length }, dependencies: [] }] };
  const proposal = validateOutcomeProposal(request, raw);
  assert.equal(compileReviewedProposal(proposal, 'A', 'exec-a').coverage, 'COMPLETE');
  proposal.spec.outcomes[0].value = 'invented'; assert.throws(() => compileReviewedProposal(proposal, 'A', 'exec-a'));
  assert.throws(() => validateOutcomeProposal(request, { nodes: [{ ...raw.nodes[0], selector: 'invented' }] }));
  assert.throws(() => validateOutcomeProposal(request, { nodes: [{ ...raw.nodes[0], kind: 'CREATE_RECORD' }] }));
  const destructive = 'Delete net.unseen.widgets';
  assert.throws(() => validateOutcomeProposal(destructive, { nodes: [{ ...raw.nodes[0], span: { start: 0, end: destructive.length }, valueSpan: { start: 7, end: destructive.length } }] }));
  const compound = 'Mo net.unseen.widgets roi Work out 17 + 3';
  assert.throws(() => validateOutcomeProposal(compound, { nodes: [{ kind: 'CALCULATE', span: { start: compound.indexOf('Work'), end: compound.length }, valueSpan: { start: compound.indexOf('17'), end: compound.length }, dependencies: [] }] }));
  const math = 'Work out 17 + 3';
  assert.throws(() => validateOutcomeProposal(math, { nodes: [{ kind: 'CALCULATE', span: { start: 0, end: math.length }, valueSpan: { start: 9, end: 11 }, dependencies: [] }] }));
  for (const denied of [false, true]) {
    const f = fixture(); let discovered = 0, reviews = 0; const resolve = f.adapter.catalog.resolve;
    f.adapter.catalog.resolve = async (...args) => { discovered++; return resolve(...args); };
    await runAgentV2(request, 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => {
      f.events.push(e); if (e.v2?.assistance) { reviews++; const a = e.v2.assistance; assert.equal(a.category, 'GOAL_INTERPRETATION'); assert.equal(discovered, 0); assert.equal(a.sessionRetained, false);
        submitAssistanceV2({ deviceId: 'A', executionId: 'exec-a', token: a.token, approved: !denied, choice: a.choices[0].id }); }
    }, undefined, { async generate(_schema, _system, context) { assert.deepEqual(context.clauses, [request]); return { nodes: [{ kind: 'LAUNCH', text: request, value: request.slice(start), dependencies: [] }] }; } });
    assert.equal(reviews, 1); assert.equal(discovered, denied ? 0 : 1);
    assert.equal(f.events.at(-1).status, denied ? 'BLOCKED' : 'COMPLETED');
    if (!denied) assert.equal(f.events.at(-1).v2.result, 'ASSISTED_COMPLETED');
  }
});
