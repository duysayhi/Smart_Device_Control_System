/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
const pkg = 'org.unprofiled.optics';
function scene(extra = {}) {
  const snapshotId = randomUUID(), base = { text: '', description: '', resourceId: '', packageName: pkg, enabled: true, displayed: true, clickable: false, focused: false };
  const nodes = [{ ...base, className: 'android.view.SurfaceView', bounds: [0, 0, 400, 600], text: extra.preview || 'frame 1' },
    { ...base, className: 'android.widget.Button', resourceId: pkg + ':id/shutter', description: 'Take photo', clickable: true, bounds: [160, 700, 240, 780], ...extra.target }, ...(extra.overlay || [])];
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((r, i) => ({ ...r, elementId: snapshotId + ':' + i })) };
}
function capture(s) {
  const node = compileOutcomes('Mo ' + pkg + ' va chup 1 tam anh', 'A', 'E').nodes[1]; node.packageName = pkg;
  return { node, candidate: generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', true).candidates[0] };
}
function hardware(view) {
  let clicks = 0;
  const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (_method, path) => { if (path.endsWith('/click')) clicks++; } } };
  const observer = { readNativeSnapshot: async () => view(), locate: async () => ({ id: 'observed-shutter', interaction: { method: 'ELEMENT_CLICK' } }), waitUntil: async fn => { const s = view(); assert.equal(await fn(s), s); return s; } };
  return { session, observer, get clicks() { return clicks; } };
}
test('M6a animated unrelated preview must not invalidate the identical grounded shutter', async () => {
  const { node, candidate } = capture(scene()), h = hardware(() => scene({ preview: 'frame 2' }));
  assert.ok(candidate);
  await executeGroundedInteraction(h.session, h.observer, issueEffectGrant(candidate, node));
  assert.equal(h.clicks, 1);
});

for (const [name, change] of [
  ['moved beyond four native pixels', { target: { bounds: [170, 700, 250, 780] } }],
  ['replaced resource identity', { target: { resourceId: pkg + ':id/replacement' } }],
  ['changed description', { target: { description: 'Record video' } }],
  ['disabled shutter', { target: { enabled: false } }],
  ['non-clickable shutter', { target: { clickable: false } }],
  ['new permission overlay', { overlay: [{ packageName: 'com.android.permissioncontroller', className: 'android.widget.Button', resourceId: 'allow', text: 'Allow', description: '', enabled: true, displayed: true, clickable: true, bounds: [0, 0, 400, 900] }] }],
]) test('M6a target rebind denies ' + name + ' with zero clicks', async () => {
  const { node, candidate } = capture(scene()), h = hardware(() => scene(change));
  await assert.rejects(() => executeGroundedInteraction(h.session, h.observer, issueEffectGrant(candidate, node)), e => e.dispatchState === 'NOT_SENT');
  assert.equal(h.clicks, 0);
});
test('M6a duplicated shutter is not unique and cannot obtain a candidate', () => {
  const s = scene(); s.nodes.push({ ...s.nodes[1], bounds: [50, 700, 130, 780] }); s.elements.push({ ...s.nodes[2], elementId: s.snapshotId + ':2' });
  const { node } = capture(scene());
  assert.equal(generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', true).candidates.length, 0);
});
test('M6a absent shutter never invents a coordinate', () => {
  const s = scene(); s.nodes.pop(); s.elements.pop(); const { node } = capture(scene());
  assert.equal(generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', true).candidates.length, 0);
});
const { OwnerTestPolicy, ownerEffectAllowed } = require('../lib/android/agent/owner-test-policy.ts');
const { decidePermission } = require('../lib/android/agent/permission-decision.ts');
const { LocalEffectJournal } = require('../lib/android/agent/local-effect-journal.ts');
function owner(full = true, physicalId = 'P') { const policy = new OwnerTestPolicy(); const mode = policy.enable('A', physicalId, undefined, { fullControl: full }); return { policy, mode, scope: policy.bind('A', physicalId, 'E') }; }
test('M6a camera full-control requires issued journal ticket, auto-effect then matches ordinary owner', async () => {
  const m = mediaFixture(), before = await m.reader.readCapture(m.physicalId);
  const { node, candidate } = capture(scene()), full = owner(true, m.physicalId), ordinary = owner(false);
  assert.equal(ownerEffectAllowed(ordinary.scope, node.outcome, 'A', 'P', 'E'), true);
  assert.throws(() => issueEffectGrant(candidate, node, full.scope), /journal/);
  const source = 'Mo ' + pkg + ' va chup 1 tam anh', journal = await LocalEffectJournal.begin(full.scope, source, node, scene(), before);
  assert.equal(decidePermission({ source, stage: 'EFFECT', owner: full.scope, deviceId: 'A', physicalId: m.physicalId, executionId: 'E', outcome: node.outcome, journal: journal.authorization }).decision, 'ALLOW');
  assert.throws(() => issueEffectGrant(candidate, node, full.scope, { authorization: {}, candidate, journalId: journal.id }), /foreign|modified|used/);
  const grant = issueEffectGrant(candidate, node, full.scope, await journal.prepare(candidate)), h = hardware(() => scene({ preview: 'moving' }));
  await executeGroundedInteraction(h.session, h.observer, grant); assert.equal(h.clicks, 1);
  await assert.rejects(() => executeGroundedInteraction(h.session, h.observer, grant)); assert.equal(h.clicks, 1);
  assert.equal(journal.records[0].dispatch, 'ACKNOWLEDGED'); assert.equal(journal.records[0].verified, false);
  await assert.rejects(() => journal.verified({ id: 'fake', deviceId: 'A', executionId: 'E', nodeId: node.id }), /issued evidence/);
  full.policy.disable('A', full.mode.id);
  assert.equal(decidePermission({ source, stage: 'EFFECT', owner: full.scope, deviceId: 'A', physicalId: m.physicalId, executionId: 'E', outcome: node.outcome, journal: journal.authorization }).reason, 'FOREIGN_SCOPE');
});
for (const source of ['take a photo then delete old photos', 'chụp 1 tấm ảnh rồi xóa ảnh cũ', 'chup 1 tam anh roi xoa anh cu', 'open camera then change PIN', 'open camera then enable developer debugging', 'take a photo then buy a subscription']) {
  test('M6a whole-source hard deny on all stages: ' + source, () => {
    for (const stage of ['REQUEST', 'INTERPRETATION', 'EFFECT', 'LEGACY']) assert.equal(decidePermission({ source, stage, legacy: 'ALLOW' }).decision, 'DENY');
  });
}
test('M6a normal confirmation, backend-only auto-review flag and foreign scope retain their boundaries', () => {
  const source = 'Mo ' + pkg + ' va chup 1 tam anh', plan = compileOutcomes(source, 'A', 'E').original, outcome = plan.outcomes[1];
  assert.equal(decidePermission({ source, stage: 'EFFECT', outcome }).decision, 'ASK');
  const previous = process.env.AGENT_V2_FULL_CONTROL_AUTO_REVIEW;
  try {
    delete process.env.AGENT_V2_FULL_CONTROL_AUTO_REVIEW; const off = owner();
    assert.equal(decidePermission({ source, stage: 'INTERPRETATION', owner: off.scope, deviceId: 'A', physicalId: 'P', executionId: 'E', plan }).decision, 'ASK');
    process.env.AGENT_V2_FULL_CONTROL_AUTO_REVIEW = 'true'; const on = owner();
    assert.equal(decidePermission({ source, stage: 'INTERPRETATION', owner: on.scope, deviceId: 'A', physicalId: 'P', executionId: 'E', plan }).decision, 'ALLOW');
    assert.equal(decidePermission({ source, stage: 'INTERPRETATION', owner: { ...on.scope }, deviceId: 'A', physicalId: 'P', executionId: 'E', plan }).decision, 'DENY');
    assert.equal(decidePermission({ source, stage: 'INTERPRETATION', owner: on.scope, deviceId: 'B', physicalId: 'P', executionId: 'E', plan }).decision, 'DENY');
    const forged = structuredClone(plan); forged.outcomes[1].value = 'two photos';
    assert.equal(decidePermission({ source, stage: 'INTERPRETATION', owner: on.scope, deviceId: 'A', physicalId: 'P', executionId: 'E', plan: forged }).decision, 'DENY');
    on.policy.disable('A', on.mode.id);
    assert.equal(decidePermission({ source, stage: 'INTERPRETATION', owner: on.scope, deviceId: 'A', physicalId: 'P', executionId: 'E', plan }).decision, 'DENY');
  } finally { if (previous === undefined) delete process.env.AGENT_V2_FULL_CONTROL_AUTO_REVIEW; else process.env.AGENT_V2_FULL_CONTROL_AUTO_REVIEW = previous; }
});
test('M6a ambiguous default camera resolver is rejected without label fallback', async () => {
  const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
  let labels = 0;
  const catalog = new AppCatalog('A', async () => ({ stdout: 'android/com.android.internal.app.ResolverActivity', stderr: '' }), async () => { labels++; return new Map(); });
  const r = await catalog.resolve('camera', 'CAPTURE_MEDIA'); assert.equal(r.app, undefined); assert.equal(labels, 0); assert.match(r.reason, /AMBIGUOUS/);
});
const { MediaStoreReader, capturedMediaDelta, mediaDeltaReason } = require('../lib/android/agent/media-evidence.ts');
function mediaFixture() {
  let rows = [];
  const props = '[ro.serialno]: [TEST12345]\n[ro.boot.serialno]: [TEST12345]\n[ro.product.manufacturer]: [unprofiled]\n[ro.product.model]: [optics]';
  const physicalId = 'android:' + require('node:crypto').createHash('sha256').update(JSON.stringify(['TEST12345', 'unprofiled', 'optics'])).digest('hex');
  const run = async args => ({ stdout: args.includes('getprop') ? props : args.includes('date') ? String(Math.floor(Date.now() / 1000)) :
    !rows.length ? 'No result found.' : rows.map((r, i) => 'Row: ' + i + ' _id=' + r.id + ', date_added=' + r.date +
      (args.includes('_id:date_added:_size:mime_type:owner_package_name') ? ', _size=100, mime_type=image/jpeg, owner_package_name=' + pkg : '')).join('\n'), stderr: '' });
  return { reader: new MediaStoreReader('A', run), run, physicalId, set: next => { rows = next; } };
}
for (const [delta, stale] of [[0, false], [1, false], [2, false], [1, true]]) test('M6a complete MediaStore inventory delta ' + delta + ' stale=' + stale, async () => {
  const m = mediaFixture(), before = await m.reader.readCapture(m.physicalId);
  m.set(Array.from({ length: delta }, (_, i) => ({ id: String(i + 1), date: Math.floor(Date.now() / 1000) - (stale ? 30 : 0) })));
  const after = await m.reader.readCapture(m.physicalId), evidence = capturedMediaDelta(before, after, 'A', m.physicalId, pkg);
  assert.equal(Boolean(evidence), delta === 1 && !stale);
  assert.equal(after.summary.count, delta);
  if (delta === 0) assert.equal(mediaDeltaReason(before, after), 'MEDIA_DELTA_ZERO');
  if (delta === 2) assert.equal(mediaDeltaReason(before, after), 'MEDIA_DELTA_MULTIPLE_OR_REMOVED');
  if (stale) assert.equal(mediaDeltaReason(before, after), 'MEDIA_STALE_TIMESTAMP');
});

const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts'), { AgentBudget } = require('../lib/android/agent/budget.ts');
for (const failure of ['none', 'not-sent-once', 'always-not-sent', 'unknown']) test('M6a full-control capture real executor simulation: ' + failure, async () => {
  const m = mediaFixture(), policy = new OwnerTestPolicy(); policy.enable('A', m.physicalId, undefined, { fullControl: true });
  const scope = policy.bind('A', m.physicalId, 'E'), events = []; let clicks = 0, locations = 0, closed = 0;
  const h = hardware(() => scene({ preview: 'animated frame ' + locations }));
  h.observer.locate = async () => { locations++; return failure === 'always-not-sent' || failure === 'not-sent-once' && locations === 1 ? undefined : { id: 'live', interaction: { method: 'ELEMENT_CLICK' } }; };
  h.session.client.request = async (_method, path) => { if (path.endsWith('/click')) { clicks++; m.set([{ id: '1', date: Math.floor(Date.now() / 1000) }]); if (failure === 'unknown') throw Error('Reply lost after dispatch'); } };
  const adapter = { readiness: async () => 'READY', media: m.reader, catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) },
    open: async () => ({ backend: 'appium', sessionId: () => 'S', observe: async () => scene(), execute: async () => {},
      interactV2: grant => executeGroundedInteraction(h.session, h.observer, grant), close: async () => { closed++; } }) };
  try {
    await runAgentV2('Mo ' + pkg + ' va chup 1 tam anh', 'A', 'E', m.physicalId, new AgentBudget(), adapter, e => { events.push(e); assert.notEqual(e.status, 'NEED_HUMAN_ASSISTANCE'); }, undefined, { generate() { throw Error('No model for unique shutter'); } }, scope);
    const last = events.at(-1);
    assert.equal(last.status, ['none', 'not-sent-once'].includes(failure) ? 'COMPLETED' : 'BLOCKED');
    assert.equal(clicks, failure === 'always-not-sent' ? 0 : 1); assert.equal(closed, 1);
    if (failure === 'not-sent-once') assert.equal(last.counters.retries, 1);
    if (failure === 'always-not-sent') { assert.equal(locations, 3, JSON.stringify({ reason: last.reason, counters: last.counters })); assert.equal(last.counters.retries, 2); assert.match(last.reason, /SOFT_RETRYABLE_NOT_SENT/); }
    if (failure === 'unknown') { assert.equal(locations, 1); assert.equal(last.counters.retries, 0); assert.match(last.reason, /UNKNOWN_EFFECT/); }
    if (last.status === 'COMPLETED') assert.ok(last.v2.localEffects.some(r => r.verified && r.disposition === 'LEFT_IN_PLACE'));
  } finally { policy.disable('A', scope.id); }
});
test('M6a a duplicate target appearing after grant is NOT_SENT even without a preview change', async () => {
  const before = scene(), { node, candidate } = capture(before), after = scene();
  after.nodes.push({ ...after.nodes[1], bounds: [50, 700, 130, 780] }); after.elements.push({ ...after.nodes[2], elementId: after.snapshotId + ':2' });
  const h = hardware(() => after);
  await assert.rejects(() => executeGroundedInteraction(h.session, h.observer, issueEffectGrant(candidate, node)), e => e.dispatchState === 'NOT_SENT');
  assert.equal(h.clicks, 0);
});
test('M6a journaled exact calculation and new record acquire typed grants without full-control blanket LOCAL_WRITE', async () => {
  for (const command of ['calculate 2+3', 'tao note title "M6a new", body "independent readback required"']) {
    const source = 'Mo ' + pkg + ' va ' + command, graph = compileOutcomes(source, 'A', 'E'), node = graph.nodes[1]; node.packageName = pkg;
    const s = scene();
    s.nodes = [{ ...s.nodes[1], description: '', text: command.startsWith('calculate') ? '' : 'New', resourceId: pkg + ':id/control', className: command.startsWith('calculate') ? 'android.widget.EditText' : 'android.widget.Button', hint: command.startsWith('calculate') ? 'Expression' : undefined }];
    if (command.startsWith('calculate')) {
      s.nodes[0].hint = undefined;
      for (const [i, text] of ['0', '1', '2', '+', '='].entries()) s.nodes.push({ ...s.nodes[0], className: 'android.widget.Button', text, clickable: true, bounds: [10, 10 + i * 70, 90, 60 + i * 70] });
    }
    s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
    const candidates = generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', false, node.capability === 'CREATE_RECORD' ? { phase: 'CREATE' } : undefined).candidates;
    assert.equal(candidates.length, 1, command);
    const full = owner(), journal = await LocalEffectJournal.begin(full.scope, source, node, s, { snapshotId: s.snapshotId });
    assert.ok(issueEffectGrant(candidates[0], node, full.scope, await journal.prepare(candidates[0])));
    full.policy.disable('A', full.mode.id);
  }
});
for (const source of ['chụp 1 tấm ảnh', 'chup 1 tam anh', 'take a photo']) test('M6a exact one-photo grammar: ' + source, () => {
  const graph = compileOutcomes(source, 'A', 'E'); assert.equal(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes[0].capability, 'CAPTURE_MEDIA');
});
test('M6a closed camera fallback rejects fabricated receipts, ordinary owner and cloned permit', async () => {
  const { issueCameraFallback, consumeCameraFallback } = require('../lib/android/agent/camera-fallback.ts');
  const { GroundedInteractionFailure } = require('../lib/android/grounded-interactions.ts');
  const m = mediaFixture(), before = await m.reader.readCapture(m.physicalId), { node, candidate } = capture(scene());
  const policy = new OwnerTestPolicy(); policy.enable('A', m.physicalId, undefined, { fullControl: true }); const full = policy.bind('A', m.physicalId, 'E');
  assert.throws(() => issueCameraFallback(new GroundedInteractionFailure('NOT_SENT', 'TARGET_LOCATE', Error('fake')), candidate, full, before), /authentic/);
  const h = hardware(() => scene()); h.observer.locate = async () => undefined;
  let receipt; try { await executeGroundedInteraction(h.session, h.observer, issueEffectGrant(candidate, node)); } catch (e) { receipt = e; }
  const permit = issueCameraFallback(receipt, candidate, full, before);
  const journal = await LocalEffectJournal.begin(full, 'Mo ' + pkg + ' va chup 1 tam anh', node, scene(), before);
  const grant = issueEffectGrant(candidate, node, full, await journal.prepare(candidate));
  assert.throws(() => consumeCameraFallback({ ...permit }, grant), /stale|foreign|replayed/);
  assert.equal(consumeCameraFallback(permit, grant), before);
  assert.throws(() => consumeCameraFallback(permit, grant), /replayed/);
  assert.throws(() => issueCameraFallback(receipt, candidate, owner(false).scope, before), /authentic|scope|foreign/);
  policy.disable('A', full.id);
});
for (const changed of [false, true]) test('M6a fixed backend camera key requires zero delta before dispatch; changed=' + changed, async () => {
  const { issueCameraFallback } = require('../lib/android/agent/camera-fallback.ts');
  const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
  const m = mediaFixture(), before = await m.reader.readCapture(m.physicalId), full = owner(true, m.physicalId), { node, candidate } = capture(scene());
  const h = hardware(() => scene()); h.observer.locate = async () => undefined;
  let receipt; try { await executeGroundedInteraction(h.session, h.observer, issueEffectGrant(candidate, node)); } catch (e) { receipt = e; }
  const permit = issueCameraFallback(receipt, candidate, full.scope, before), journal = await LocalEffectJournal.begin(full.scope, 'Mo ' + pkg + ' va chup 1 tam anh', node, scene(), before);
  const grant = issueEffectGrant(candidate, node, full.scope, await journal.prepare(candidate));
  let keys = 0;
  h.session.client.request = async (_method, path, body) => { assert.ok(path.endsWith('/appium/device/press_keycode')); assert.equal(body.keycode, 27); keys++; };
  const executor = Object.assign(Object.create(ConditionExecutor.prototype), { session: h.session, observer: h.observer,
    run: async args => args.includes('resolve-activity') ? { stdout: pkg + '/.Camera', stderr: '' } : m.run(args) });
  if (changed) m.set([{ id: '1', date: Math.floor(Date.now() / 1000) }]);
  try {
    if (changed) await assert.rejects(() => executor.captureKeyV2(grant, permit), /media changed/);
    else { await executor.captureKeyV2(grant, permit); assert.equal(journal.records[0].dispatch, 'ACKNOWLEDGED'); }
    assert.equal(keys, changed ? 0 : 1);
    await assert.rejects(() => executor.captureKeyV2(grant, permit), /replayed/); assert.equal(keys, changed ? 0 : 1);
  } finally { full.policy.disable('A', full.mode.id); }
});
