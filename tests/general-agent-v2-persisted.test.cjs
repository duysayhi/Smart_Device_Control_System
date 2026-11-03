/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { parseUiHierarchy } = require('../lib/android/targets.ts');
const { geometryFingerprint } = require('../lib/android/visual-grounding.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates, revalidateGroundedCandidate } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const { beginRecordDraft, resolvePersistedRecord, verifyPersistenceReadback, validRecordDraft } = require('../lib/android/agent/record-persistence.ts');
const { verifyPredicate } = require('../lib/android/agent/verification-registry.ts');

test('device readiness requires explicit awake/unlocked evidence and rejects contradictory metadata', () => {
  assert.equal(deviceReadiness('screenState=SCREEN_STATE_ON mIsShowing=false'), 'READY');
  assert.equal(deviceReadiness('screenState=SCREEN_STATE_OFF mIsShowing=false'), 'UNLOCK_REQUIRED');
  assert.equal(deviceReadiness('screenState=SCREEN_STATE_ON mIsShowing=true'), 'UNLOCK_REQUIRED');
  assert.equal(deviceReadiness('screenState=SCREEN_STATE_ON mIsShowing=false mIsShowing=true'), 'UNLOCK_REQUIRED');
  assert.equal(deviceReadiness('mIsShowing=false'), 'UNKNOWN');
  assert.equal(deviceReadiness('unrecognized vendor metadata'), 'UNKNOWN');
});

test('locked preflight requires human acknowledgement plus fresh unlock proof before app discovery', async () => {
  for (const mode of ['unlock', 'denied', 'still-locked', 'unknown']) {
    let checks = 0, discoveries = 0, approvals = 0;
    const events = [];
    const adapter = {
      async readiness() { checks++; return mode === 'unknown' ? 'UNKNOWN' : mode === 'unlock' && checks > 1 ? 'READY' : 'UNLOCK_REQUIRED'; },
      catalog: { async resolve() { discoveries++; return { choices: [], reason: 'Fixture ends before session creation' }; } },
      async open() { throw Error('No session or device action permitted in this test'); },
    };
    await runAgentV2('Mo com.android.settings', 'A', 'unlock-' + mode, 'physical-a', new AgentBudget(), adapter, event => {
      events.push(event);
      const a = event.v2?.assistance;
      if (a) {
        approvals++;
        assert.equal(a.category, 'DEVICE_UNLOCK'); assert.equal(a.sessionRetained, false); assert.equal(discoveries, 0);
        submitAssistanceV2({ token: a.token, deviceId: 'A', executionId: 'unlock-' + mode, approved: mode !== 'denied', choice: a.choices[0].id });
      }
    }, undefined, { generate() { throw Error('No model expected'); } });
    assert.equal(discoveries, mode === 'unlock' ? 1 : 0);
    assert.equal(approvals, mode === 'unknown' ? 0 : 1);
    assert.equal(events.at(-1).status, 'BLOCKED');
    if (mode === 'still-locked') assert.match(events.at(-1).reason, /DEVICE_LOCKED/);
    if (mode === 'unknown') assert.match(events.at(-1).reason, /DEVICE_READINESS_UNKNOWN/);
  }
});

function snapshot(pkg, rows) {
  const snapshotId = randomUUID(), nodes = rows.map((row, i) => ({ text: '', description: '', resourceId: '', className: 'android.widget.TextView', packageName: pkg,
    enabled: true, displayed: true, clickable: false, focused: false, bounds: [10, i * 65 + 10, 380, i * 65 + 65], ...row }));
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((row, i) => ({ ...row, elementId: snapshotId + ':' + i })) };
}
function formFixture(options = {}) {
  const pkg = options.pkg ?? 'org.test.records'; let phase = options.existingEditor ? 'editor' : 'initial', fields = options.alarm ? { hour: '12', minute: '30', enabled: false } : { title: '', body: '' }, saved, closed = 0, createdTime;
  const events = [], actions = [];
  const scene = () => {
    if (phase === 'initial') return snapshot(pkg, [{ text: options.locale ? 'Tạo mới' : 'New', className: 'android.widget.Button', clickable: true }, ...(options.postIdentity || options.timedIdentity ? [{ text: 'record-collection: complete' }] : [])]);
    if (phase === 'list' && options.timedIdentity && saved) return snapshot(pkg, [{ text: 'record-collection: complete' }, { text: 'Entry', clickable: true, bounds: [0, 0, 400, 800] },
      { description: 'title: ' + saved.title, parentIndex: 1 }, { description: 'body: ' + saved.body, parentIndex: 1 }, { description: 'record-created-at: ' + createdTime, parentIndex: 1 }]);
    if (phase === 'list') return snapshot(pkg, [...(saved ? Array.from({ length: options.duplicate ? 2 : 1 }, () => ({ text: options.alarm ? `${saved.hour}:${saved.minute}` : saved.title, description: 'record-id: ' + (options.wrongId ? 'other-record' : 'new-opaque-id'), clickable: true, className: 'android.widget.Button' })) : [{ text: 'No saved record' }]), ...(options.postIdentity ? [{ text: 'record-collection: complete' }] : [])]);
    const rows = [
      { description: options.timedIdentity ? saved ? 'record-created-at: ' + createdTime : '' : options.noIdentity || options.postIdentity && !saved ? '' : 'record-id: new-opaque-id' },
      { text: options.alarm ? fields.hour : fields.title, hint: options.alarm ? 'Hour' : options.locale ? 'Tiêu đề' : 'Title', className: 'android.widget.EditText', resourceId: pkg + ':id/a' },
      { text: options.alarm ? fields.minute : fields.body, hint: options.alarm ? 'Minute' : options.locale ? 'Nội dung' : 'Body', className: 'android.widget.EditText', resourceId: pkg + ':id/b' },
      { text: options.locale ? 'Lưu' : 'Save', className: 'android.widget.Button', clickable: true },
    ];
    if (options.alarm) rows.push({ text: 'Enabled', hint: 'Enabled', checkable: true, checked: fields.enabled, clickable: true, className: 'android.widget.Switch', resourceId: pkg + ':id/enabled' }, { text: options.ambiguousTime ? 'PM' : '24h' });
    if (options.ambiguous) rows.push({ ...rows[1], resourceId: pkg + ':id/another' });
    return snapshot(pkg, rows);
  };
  const adapter = { persistedForms: true, catalog: { async resolve(name) { return { app: { serial: 'A', requestedName: name, packageName: pkg }, choices: [] }; } }, async open() {
    return { backend: 'appium', sessionId: () => 'session-a', observe: async () => scene(), execute: async () => {}, close: async () => { closed++; }, async interactV2(grant) {
      consumeEffectGrant(grant, 'A', 'session-a'); const c = grant.candidate; actions.push(c.record.phase + ':' + (c.record.field ?? ''));
      if (options.uncertainSave && c.record.phase === 'SAVE') throw Error('Save response lost');
      if (c.record.phase === 'CREATE') phase = 'editor';
      else if (c.record.phase === 'FIELD') fields[c.record.field] = options.wrongField ? 'incorrect' : c.desired ?? c.value;
      else if (c.record.phase === 'SAVE') { createdTime = Date.now(); saved = options.noPersistence ? undefined : { ...fields }; if (saved && options.disabledAfterSave) saved.enabled = false; phase = 'list'; }
      else if (c.record.phase === 'REOPEN') { fields = { ...saved }; if (options.wrongReadback) fields.body = 'wrong saved body'; phase = 'editor'; }
      return scene();
    } };
  } };
  return { pkg, adapter, actions, events, get closed() { return closed; } };
}
const noAI = { generate() { throw Error('No model needed for unique form controls'); } };
async function runForm(options = {}) {
  const f = formFixture(options);
  const ownerScope = options.owner ? (() => { const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts'); const p = new OwnerTestPolicy(); p.enable('A', 'physical-a'); return p.bind('A', 'physical-a', 'exec-a'); })() : undefined;
  await runAgentV2(`Mo ${f.pkg} va ${options.alarm ? 'dat bao thuc ' + (options.time ?? '07:00') : `tao record title "${options.title ?? 'Report'}", body "${options.body ?? 'Meet at ten'}"`}`, 'A', 'exec-a', 'physical-a', new AgentBudget(), f.adapter, e => {
    f.events.push(e); if (e.v2?.assistance) { const a = e.v2.assistance; assert.equal(a.sessionRetained, true);
      submitAssistanceV2({ token: a.token, deviceId: 'A', executionId: 'exec-a', approved: !options.denied, choice: a.choices[0].id }); }
  }, undefined, noAI, ownerScope);
  return f;
}

test('owner-authorized new record saves without effect prompts but cannot overwrite existing editors or invent persistence', async () => {
  for (const options of [{ owner: true }, { owner: true, postIdentity: true }, { owner: true, timedIdentity: true }]) {
    const f = await runForm(options);
    assert.equal(f.events.at(-1).status, 'COMPLETED');
    assert.equal(f.events.some(e => e.v2?.assistance?.category === 'EFFECT_CONFIRMATION'), false);
    assert.equal(f.actions.filter(a => a === 'SAVE:').length, 1);
  }
  for (const options of [{ owner: true, existingEditor: true }, { owner: true, noIdentity: true }, { owner: true, wrongReadback: true }]) {
    const f = await runForm(options);
    assert.notEqual(f.events.at(-1).status, 'COMPLETED');
    assert.equal(f.actions.filter(a => a === 'SAVE:').length <= 1, true);
    if (options.existingEditor) assert.equal(f.actions.length, 0);
  }
});

test('post-Save identity strategy runs through the real generic form executor without a draft ID', async () => {
  for (const pkg of ['org.sample.journal', 'net.other.records']) {
    const f = await runForm({ pkg, postIdentity: true, title: 'Field visit', body: 'Check meter at nine' });
    assert.equal(f.events.at(-1).status, 'COMPLETED');
    assert.equal(f.actions.filter(a => a === 'SAVE:').length, 1);
    assert.equal(f.actions.filter(a => a === 'REOPEN:').length, 1);
  }
  const duplicate = await runForm({ postIdentity: true, duplicate: true });
  assert.notEqual(duplicate.events.at(-1).status, 'COMPLETED');
  assert.equal(duplicate.actions.filter(a => a === 'SAVE:').length, 1);
  const timed = await runForm({ pkg: 'org.fieldtime.records', timedIdentity: true });
  assert.equal(timed.events.at(-1).status, 'COMPLETED');
  assert.equal(timed.actions.filter(a => a === 'SAVE:').length, 1);
});

test('exact-fields/creation-time strategy requires a complete baseline, unique full match and independent reopen', () => {
  const pkg = 'org.example.entries', fields = { title: 'Same heading', body: 'Distinct exact content' };
  const baseline = snapshot(pkg, [{ text: 'record-collection: complete' }, { text: 'New', clickable: true }]);
  const draft = snapshot(pkg, [{ hint: 'Title', className: 'android.widget.EditText' }, { hint: 'Body', className: 'android.widget.EditText' }]);
  const scope = beginRecordDraft(baseline, draft, fields, 'record-exec');
  assert.ok(scope);
  const created = draft.timestamp;
  const list = snapshot(pkg, [{ text: 'record-collection: complete' }, { text: 'Entry', clickable: true, bounds: [0, 0, 400, 800] },
    { description: 'title: ' + fields.title, parentIndex: 1 }, { description: 'body: ' + fields.body, parentIndex: 1 }, { description: 'record-created-at: ' + created, parentIndex: 1 }]);
  list.timestamp = Math.max(list.timestamp, created);
  const reopened = snapshot(pkg, [{ hint: 'Title', text: fields.title, className: 'android.widget.EditText' }, { hint: 'Body', text: fields.body, className: 'android.widget.EditText' }, { description: 'record-created-at: ' + created }]);
  assert.equal(resolvePersistedRecord(scope, list, 'record-exec')?.strategy, 'EXACT_FIELDS_CREATED_AT');
  assert.equal(verifyPersistenceReadback(scope, list, reopened, 'record-exec')?.strategy, 'EXACT_FIELDS_CREATED_AT');
  assert.equal(validRecordDraft({ ...scope }, draft, fields, 'record-exec'), false);
  assert.equal(resolvePersistedRecord(scope, list, 'foreign-exec'), undefined);
  const wrong = structuredClone(reopened); wrong.nodes[1].text = 'Different body';
  assert.equal(verifyPersistenceReadback(scope, list, wrong, 'record-exec'), undefined);
  const titleOnly = structuredClone(list); titleOnly.nodes[3].description = '';
  assert.equal(resolvePersistedRecord(scope, titleOnly, 'record-exec'), undefined);
  const old = structuredClone(list); old.nodes[4].description = 'record-created-at: ' + (created - 1);
  assert.equal(resolvePersistedRecord(scope, old, 'record-exec'), undefined);
  const incomplete = structuredClone(baseline); incomplete.nodes[0].text = '';
  assert.equal(beginRecordDraft(incomplete, draft, fields, 'record-exec'), undefined);
});

test('resource-less native tabs use class semantics and selected-state verification across apps/languages', () => {
  for (const [pkg, label, value] of [['org.clock.sample', 'Chuông báo Tab 1 của 4.', 'Chuông báo'], ['net.reader.tabs', 'History Tab 2 of 3.', 'History']]) {
    const s = snapshot(pkg, [{ description: label, className: 'androidx.appcompat.app.ActionBar$Tab', clickable: true, selected: false }]);
    const node = compileOutcomes('Mo ' + pkg + ' va chon ' + value, 'A', 'tabs').nodes.at(-1); node.packageName = pkg;
    const page = generateGroundedCandidates(node, s, 'tabs', 'session-a', false);
    assert.equal(page.candidates.length, 1);
    const context = { deviceId: 'A', executionId: 'tabs', nodeId: node.id, packageName: pkg };
    assert.equal(verifyPredicate({ kind: 'ELEMENT_VISIBLE', label: value }, s, context).evidence, undefined);
    s.nodes[0].selected = true;
    assert.ok(verifyPredicate({ kind: 'ELEMENT_VISIBLE', label: value }, s, context).evidence);
    s.nodes.push({ ...s.nodes[0] });
    assert.equal(verifyPredicate({ kind: 'ELEMENT_VISIBLE', label: value }, s, context).evidence, undefined);
  }
});

test('source-text proposals preserve UTF-16 spans without model arithmetic and reject ambiguity, omissions and invented data', () => {
  const { validateSourceOutcomeProposal, compileReviewedProposal } = require('../lib/android/agent/outcome-proposal.ts');
  const request = 'Please bring up the calendar';
  const raw = { nodes: [{ kind: 'LAUNCH', text: request, value: 'calendar', dependencies: [] }] };
  assert.equal(compileReviewedProposal(validateSourceOutcomeProposal(request, raw), 'A', 'heldout').coverage, 'COMPLETE');
  assert.throws(() => validateSourceOutcomeProposal(request, { nodes: [{ ...raw.nodes[0], text: 'calendar' }] }));
  assert.throws(() => validateSourceOutcomeProposal(request, { nodes: [{ ...raw.nodes[0], value: 'camera' }] }));
  assert.throws(() => validateSourceOutcomeProposal('calendar calendar', { nodes: [{ ...raw.nodes[0], text: 'calendar calendar' }] }));
  assert.throws(() => validateSourceOutcomeProposal('Delete calendar', { nodes: [{ ...raw.nodes[0], text: 'Delete calendar' }] }));
  const vietnamese = 'Vui lòng khởi động ứng dụng Lịch';
  const proposal = validateSourceOutcomeProposal(vietnamese, { nodes: [{ kind: 'LAUNCH', text: vietnamese, value: 'Lịch', dependencies: [] }] });
  const outcome = proposal.spec.outcomes[0];
  assert.equal(vietnamese.slice(outcome.span.start, outcome.span.end), vietnamese);
  assert.equal(outcome.value, 'Lịch');
});

test('native spinner editable fields sharing a resource ID cannot verify a value written into the other field', async () => {
  const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
  const { issueEffectGrant } = require('../lib/android/agent/effect-grants.ts');
  const pkg = 'net.unprofiled.clock';
  const s = snapshot(pkg, [{ description: 'record-id: new-clock-id' }, { text: '06', description: '06, Hour', className: 'android.widget.EditText', resourceId: pkg + ':id/input' },
    { text: '00', description: '00, Minute', className: 'android.widget.EditText', resourceId: pkg + ':id/input' }, { text: '24h' }]);
  const node = compileOutcomes('Mo ' + pkg + ' va dat bao thuc 07:00', 'A', 'spinner-exec').nodes.at(-1); node.packageName = pkg;
  const candidate = generateGroundedCandidates(node, s, 'spinner-exec', 'session-a', false, 0, '', false, { phase: 'FIELD', field: 'hour', identity: 'new-clock-id' }).candidates[0];
  assert.ok(candidate);
  const wrong = structuredClone(s); wrong.nodes[2].text = '07'; wrong.nodes[2].description = '07, Minute';
  const session = { serial: 'A', sessionId: 'session-a', path: '/session/session-a', ensureActive: async () => {}, client: { request: async (_method, path) => path.endsWith('/attribute/password') ? 'false' : undefined } };
  const observer = { readNativeSnapshot: async () => s, locate: async () => ({ id: 'native-hour' }), waitUntil: async predicate => {
    assert.equal(predicate(wrong), false, 'matching minute text must not verify the hour write');
    const correct = structuredClone(s); correct.nodes[1].text = '07'; correct.nodes[1].description = '07, Hour';
    assert.equal(predicate(correct), correct); return correct;
  } };
  const result = await executeGroundedInteraction(session, observer, issueEffectGrant(candidate, node));
  assert.equal(result.nodes[1].text, '07');
});
test('OFFLINE generic form fills exact values, saves once, exits and reopens the same stable record identity on two apps/layout languages', async () => {
  for (const options of [{}, { pkg: 'net.heldout.forms', locale: true, title: 'Công việc', body: 'Họp nhóm lúc 9 giờ' }]) {
    const f = await runForm(options);
    assert.equal(f.events.at(-1).status, 'COMPLETED', f.events.at(-1).reason);
    assert.deepEqual(f.actions, ['CREATE:', 'FIELD:title', 'FIELD:body', 'SAVE:', 'REOPEN:']);
    assert.equal(f.events.at(-1).v2.artifacts.at(-1).kind, 'RECORD'); assert.equal(f.closed, 1);
  }
});
test('OFFLINE Save dispatch is not persistence: absent/wrong/duplicate identity, wrong field/readback, denied approval and uncertain response never complete/replay Save', async () => {
  for (const options of [{ noPersistence: true }, { wrongId: true }, { duplicate: true }, { wrongField: true }, { wrongReadback: true }, { denied: true }, { uncertainSave: true }, { noIdentity: true }, { ambiguous: true }, { existingEditor: true }]) {
    const f = await runForm(options);
    assert.notEqual(f.events.at(-1).status, 'COMPLETED', JSON.stringify(options));
    assert.equal(f.actions.filter(a => a === 'SAVE:').length <= 1, true);
    if (options.denied) assert.equal(f.actions.length, 0);
    if (options.noIdentity || options.ambiguous || options.wrongField) assert.equal(f.actions.includes('SAVE:'), false);
    assert.equal(f.closed, 1);
  }
});
test('field hints are observed and fingerprinted; model/JSON cannot change candidate scope or dispatch after hint/field changes', () => {
  const xml = '<hierarchy><node class="android.widget.EditText" package="org.test.records" hint-text="Title" bounds="[0,0][100,100]" /></hierarchy>';
  assert.equal(parseUiHierarchy(xml)[0].hint, 'Title');
  const s = snapshot('org.test.records', [{ description: 'record-id: rec-123' }, { text: '', hint: 'Title', className: 'android.widget.EditText', resourceId: 'org.test.records:id/a' }]);
  const node = compileOutcomes('Mo org.test.records va tao record title "Report", body "Meet at ten"', 'A', 'exec-a').nodes[1]; node.packageName = 'org.test.records';
  const state = { phase: 'FIELD', field: 'title', identity: 'rec-123' };
  const c = generateGroundedCandidates(node, s, 'exec-a', 'session-a', false, 0, '', false, state).candidates[0]; assert.ok(c);
  assert.equal(revalidateGroundedCandidate({ ...c }, node, s, 'exec-a', 'session-a', false, '', false, false, state), undefined);
  const old = geometryFingerprint(s); s.nodes[1].hint = 'Body'; assert.notEqual(geometryFingerprint(s), old);
  assert.equal(revalidateGroundedCandidate(c, node, s, 'exec-a', 'session-a', false, '', false, false, state), undefined);
});
test('OFFLINE structured alarm form verifies 24h hour/minute/enabled before Save and after identity-bound reopen on varied values/apps', async () => {
  for (const options of [{ alarm: true }, { alarm: true, pkg: 'net.unseen.timer', time: '13:27' }]) {
    const f = await runForm(options);
    assert.equal(f.events.at(-1).status, 'COMPLETED', f.events.at(-1).reason);
    assert.equal(f.events.at(-1).v2.graph.nodes.at(-1).capability, 'SET_STRUCTURED_STATE');
    assert.deepEqual(f.actions, ['CREATE:', 'FIELD:hour', 'FIELD:minute', 'FIELD:enabled', 'SAVE:', 'REOPEN:']);
    assert.equal(f.events.at(-1).v2.artifacts.at(-1).kind, 'RECORD');
  }
});
test('OFFLINE alarm disabled after Save, ambiguous 12h picker, existing editor and missing persistence never complete', async () => {
  for (const options of [{ disabledAfterSave: true }, { ambiguousTime: true }, { existingEditor: true }, { noPersistence: true }]) {
    const f = await runForm({ ...options, alarm: true });
    assert.notEqual(f.events.at(-1).status, 'COMPLETED');
    assert.equal(f.actions.filter(a => a === 'SAVE:').length <= 1, true);
    if (options.ambiguousTime || options.existingEditor) assert.equal(f.actions.includes('SAVE:'), false);
  }
  assert.notEqual(compileOutcomes('Mo timer va dat bao thuc 24:75', 'A', 'exec-a').coverage, 'COMPLETE');
});
test('OFFLINE exact-URI view verifies the active intent, not the latest thumbnail; forged/wrong/replayed grants and mismatched URI fail', async () => {
  const { createHash } = require('node:crypto');
  const { MediaStoreReader } = require('../lib/android/agent/media-evidence.ts');
  const { verifyCapturedMedia, verifyMediaView } = require('../lib/android/agent/verification-registry.ts');
  const { ArtifactStore } = require('../lib/android/agent/artifact-store.ts');
  const { openMediaView, observedTopMediaIntent } = require('../lib/android/media-view.ts');
  const owner = 'org.test.capture', viewer = 'net.unseen.viewer', uri = 'content://media/external/images/media/41';
  const physicalId = 'android:' + createHash('sha256').update(JSON.stringify(['SERIAL1234','Acme','Device'])).digest('hex');
  const props = '[ro.serialno]: [SERIAL1234]\n[ro.boot.serialno]: [SERIAL1234]\n[ro.product.manufacturer]: [Acme]\n[ro.product.model]: [Device]\n';
  let created = false, wrongUri = false;
  const run = async args => ({ stdout: args.includes('getprop') ? props : args.includes('query') ? created ? `Row: 0 _id=41, date_added=${Math.floor(Date.now()/1000)}, _size=100, mime_type=image/jpeg, owner_package_name=${owner}` : 'No result found.' : args.includes('resolve-activity') ? viewer + '/.View' : args.includes('dumpsys') ? `ACTIVITY ${viewer}/.View token pid=1\n  mIntent=Intent { act=android.intent.action.VIEW dat=${wrongUri ? uri + '0' : uri} typ=image/jpeg }\n` : 'Status: ok\n', stderr: '' });
  const reader = new MediaStoreReader('A', run), before = await reader.read(physicalId); created = true; const after = await reader.read(physicalId);
  const proof = verifyCapturedMedia(before, after, snapshot(owner, [{ text: 'Camera' }]), { deviceId: 'A', executionId: 'exec-a', nodeId: 'capture', packageName: owner }, physicalId);
  const store = new ArtifactStore('A', physicalId, 'exec-a'), ref = store.put(proof, ['find']);
  const session = { serial: 'A', sessionId: 'session-a', async ensureActive() {} };
  const observer = { async waitUntil(predicate) { const s = snapshot(viewer, [{ className: 'android.widget.ImageView', bounds: [0,0,400,700] }]); if (!predicate(s)) throw Error('not rendered'); return s; } };
  const grant = store.issueView(ref.id, 'find', viewer, 'session-a');
  await assert.rejects(openMediaView(session, observer, run, { ...grant }), /untrusted/);
  const receipt = await openMediaView(session, observer, run, grant);
  const context = { deviceId: 'A', executionId: 'exec-a', nodeId: 'find', packageName: viewer };
  assert.ok(verifyMediaView(receipt, context, physicalId));
  assert.equal(verifyMediaView({ ...receipt }, context, physicalId), undefined);
  assert.equal(verifyMediaView(receipt, { ...context, deviceId: 'B' }, physicalId), undefined);
  assert.equal(verifyMediaView(receipt, context, 'wrong'), undefined);
  await assert.rejects(openMediaView(session, observer, run, grant), /replayed/);
  wrongUri = true; await assert.rejects(openMediaView(session, observer, run, store.issueView(ref.id, 'find', viewer, 'session-a')), /URI cannot/);
  assert.throws(() => store.issueView(ref.id, 'other-node', viewer, 'session-a'));
  assert.equal(observedTopMediaIntent(`ACTIVITY other.app/.View token\n mIntent=Intent { dat=${uri} }`, viewer, uri), false);
  assert.equal(observedTopMediaIntent(`ACTIVITY ${viewer}/.View token\n mIntent=Intent { dat=${uri} }\nACTIVITY other.app/.View token`, viewer, uri), false);
});
test('OFFLINE graph keeps the capture producer across an intervening app launch; unbound or explicit Gallery UI-search goals stay blocked', () => {
  const graph = compileOutcomes('Chup anh roi mo viewer va tim anh vua chup', 'A', 'exec-a');
  assert.equal(graph.coverage, 'COMPLETE');
  const last = graph.nodes.at(-1); assert.deepEqual(last.inputs, [graph.nodes[0].id]); assert.equal(last.dependencies.includes(graph.nodes[0].id), true);
  assert.notEqual(compileOutcomes('Mo viewer va tim anh vua chup', 'A', 'exec-a').coverage, 'COMPLETE');
  assert.notEqual(compileOutcomes('Chup anh roi mo viewer va tim anh vua chup trong giao dien Gallery', 'A', 'exec-a').coverage, 'COMPLETE');
});
test('OFFLINE complete capture -> different app -> exact-URI verification stays in one Session and retains one media identity', async () => {
  const { createHash } = require('node:crypto');
  const { MediaStoreReader } = require('../lib/android/agent/media-evidence.ts');
  const { openMediaView } = require('../lib/android/media-view.ts');
  const camera = 'org.test.capture', viewer = 'net.other.viewer', uri = 'content://media/external/images/media/77';
  const physicalId = 'android:' + createHash('sha256').update(JSON.stringify(['SERIAL1234','Acme','Device'])).digest('hex');
  const props = '[ro.serialno]: [SERIAL1234]\n[ro.boot.serialno]: [SERIAL1234]\n[ro.product.manufacturer]: [Acme]\n[ro.product.model]: [Device]\n';
  let current = camera, captured = false, opens = 0, closed = 0, clicks = 0; const events = [];
  const observe = () => snapshot(current, current === camera ? [{ className: 'android.view.View', resourceId: camera + ':id/viewfinder', bounds: [0,0,400,650] },
    { description: 'Take photo', className: 'android.widget.Button', clickable: true }] : [{ className: 'android.widget.ImageView', bounds: [0,0,400,700] }]);
  const run = async args => ({ stdout: args.includes('getprop') ? props : args.includes('query') ? captured ? `Row: 0 _id=77, date_added=${Math.floor(Date.now()/1000)}, _size=50, mime_type=image/jpeg, owner_package_name=${camera}` : 'No result found.' : args.includes('resolve-activity') ? viewer + '/.View' : args.includes('dumpsys') ? `ACTIVITY ${viewer}/.View token\n mIntent=Intent { act=android.intent.action.VIEW dat=${uri} }\n` : 'Status: ok\n', stderr: '' });
  const adapter = { media: new MediaStoreReader('A', run), catalog: { async resolve(name) { return { app: { serial: 'A', packageName: name === 'viewer' ? viewer : camera }, choices: [] }; } }, async open() {
    opens++; return { backend: 'appium', sessionId: () => 'session-a', observe: async () => observe(), execute: async action => { current = action.app; }, close: async () => { closed++; },
      interactV2: async grant => { consumeEffectGrant(grant, 'A', 'session-a'); assert.equal(grant.candidate.capture, true); clicks++; captured = true; return observe(); },
      viewMediaV2: async grant => openMediaView({ serial: 'A', sessionId: 'session-a', async ensureActive() {} }, { async waitUntil(predicate) { const s = observe(); assert.ok(predicate(s)); return s; } }, run, grant) };
  } };
  await runAgentV2('Chup anh roi mo viewer va tim anh vua chup', 'A', 'exec-a', physicalId, new AgentBudget(), adapter, e => {
    events.push(e); if (e.v2?.assistance) { const a = e.v2.assistance; submitAssistanceV2({ token: a.token, deviceId: 'A', executionId: 'exec-a', approved: true, choice: a.choices[0].id }); }
  }, undefined, noAI);
  assert.equal(events.at(-1).status, 'COMPLETED', events.at(-1).reason); assert.equal(opens, 1); assert.equal(closed, 1); assert.equal(clicks, 1);
  const graph = events.at(-1).v2.graph; assert.equal(graph.nodes.every(n => n.status === 'VERIFIED'), true);
  assert.deepEqual(graph.nodes.at(-1).outputs, graph.nodes[0].outputs);
  assert.equal(events.at(-1).v2.artifacts.filter(a => a.kind === 'SAVED_MEDIA').length, 1);
  assert.equal(events.at(-1).v2.artifactResolution, 'EXACT_URI_VIEW');
});
test('OFFLINE approval expiry is single-use, and RPC diagnostics expose no arguments or selector content', async () => {
  const { waitForAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
  const { AppiumClient } = require('../lib/android/appium/client.ts');
  let pending;
  await assert.rejects(waitForAssistanceV2({ deviceId: 'A', executionId: 'exec-a', category: 'EFFECT_CONFIRMATION', choices: [{ id: 'allow', label: 'One scoped write' }], reason: 'approval', sessionRetained: true }, 15, undefined, a => { pending = a; }), /expired/);
  assert.equal(submitAssistanceV2({ deviceId: 'A', executionId: 'exec-a', token: pending.token, approved: true, choice: 'allow' }), false);
  const measurements = [];
  const client = new AppiumClient('http://127.0.0.1:4723', async () => Response.json({ value: [] }), row => { measurements.push(row); throw Error('diagnostic failed'); });
  assert.deepEqual(await client.request('POST', '/session/private-id/elements', { value: 'private selector' }), []);
  assert.equal(measurements.length, 1); assert.equal(measurements[0].kind, 'ELEMENT');
  assert.deepEqual(Object.keys(measurements[0]).sort(), ['elapsedMs', 'kind', 'outcome']);
  assert.equal(JSON.stringify(measurements).includes('private'), false);
});
test('OFFLINE reviewed write proposals require exact supported values and preserve verifier/capability bounds', () => {
  const { validateOutcomeProposal, compileReviewedProposal } = require('../lib/android/agent/outcome-proposal.ts');
  const request = 'Please create record title "A", body "B"', start = request.indexOf('record');
  const raw = { nodes: [{ kind: 'CREATE_RECORD', span: { start: 0, end: request.length }, valueSpan: { start, end: request.length }, dependencies: [] }] };
  const reviewed = validateOutcomeProposal(request, raw);
  const graph = compileReviewedProposal(reviewed, 'A', 'exec-a');
  assert.equal(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes[0].capability, 'CREATE_RECORD');
  assert.equal(graph.original.request, request); assert.equal(graph.nodes[0].outcome.value, 'record title "A", body "B"');
  const unsupported = 'Please create record title "A"';
  assert.throws(() => validateOutcomeProposal(unsupported, { nodes: [{ ...raw.nodes[0], span: { start: 0, end: unsupported.length }, valueSpan: { start: unsupported.indexOf('record'), end: unsupported.length } }] }));
  assert.throws(() => validateOutcomeProposal(request, { nodes: [{ ...raw.nodes[0], predicate: 'always true' }] }));
  assert.throws(() => validateOutcomeProposal(request, { nodes: [{ ...raw.nodes[0], kind: 'LAUNCH' }] }));
});
