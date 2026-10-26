/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f,
}).outputText, f);
let state, calls;
const physicalId = 'offline-physical-A', serial = 'A';
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { proposeIntentOutcomes, approveIntentSource } = require('../lib/android/agent/intent-capabilities.ts');
const { registerReviewedOutcomes } = require('../lib/android/agent/outcome-spec.ts');
const { executeIntentCapability, settleIntentMutations, isIntentEvidence } = require('../lib/android/agent/intent-executor.ts');
const tick = () => new Promise(setImmediate);
function reset() {
  delete global.phoneCommanderUnifiedCatalog;
  calls = { worker: 0, context: 0, prepare: 0, start: 0, sessions: 0, cancel: 0, assist: 0, network: 0 };
  state = { devices: [{ serial, physicalId, identityVerified: true, status: 'device', model: 'OFFLINE', connectionType: 'USB' }],
    tasks: [], prepared: new Map(), controllers: new Map(), owner: new OwnerTestPolicy(), hash: 'a'.repeat(64), values: { wifi: 1 }, writes: [], proofs: [] };
}
async function mutate(task) {
  const source = task.request, session = { serial, sessionId: 'offline-session-' + task.executionId, ensureActive: async () => {}, assertPhysicalIdentity: async () => {} };
  const binding = proposeIntentOutcomes(source).outcomes[0], approval = approveIntentSource(source, serial, task.executionId, physicalId);
  const mode = state.owner.list()[0], scope = mode && state.owner.bind(serial, physicalId, task.executionId);
  const run = async args => {
    if (args.includes('resolve-activity')) return { stdout: 'org.generic.settings/.Main' };
    if (args.includes('policy')) return { stdout: 'mIsShowing=false\nscreenState=SCREEN_STATE_ON' };
    if (args.includes('getprop')) return { stdout: 'generic-os-v1' };
    if (args.includes('package')) return { stdout: 'versionCode=7' };
    if (args.includes('settings') && args.includes('get')) return { stdout: String(state.values.wifi) };
    if (args.includes('status')) return { stdout: 'Wifi is ' + (state.values.wifi ? 'enabled' : 'disabled') };
    if (args.includes('svc')) { state.writes.push(args.at(-1)); state.values.wifi = args.at(-1) === 'enable' ? 1 : 0; return { stdout: '' }; }
    assert.fail('Unexpected fake setting command');
  };
  const observer = { readNativeSnapshot: async () => ({ deviceSerial: serial, timestamp: Date.now(), observationStatus: 'OBSERVED' }) };
  try {
    const proof = await executeIntentCapability(session, observer, run, approval, binding.intent, binding.span, task.executionId, 'org.generic.settings', undefined, scope);
    assert.equal(isIntentEvidence(proof), true); state.proofs.push(proof);
    const settlement = await settleIntentMutations(session, true);
    task.status = 'COMPLETED'; task.latest = { reason: 'Offline typed mutation independently read back and restored', v2: { intent: proof, mutations: settlement } };
    await assert.rejects(executeIntentCapability(session, observer, run, approval, binding.intent, binding.span, task.executionId, 'org.generic.settings', undefined, scope), /never replayed/);
  } catch (error) { task.status = 'BLOCKED'; task.latest = { reason: error.message }; }
  finally { task.finishedAt = Date.now(); }
}
async function workerRequest(method, command, route = '/tasks') {
  calls.worker++;
  if (method === 'GET') { calls.context++; return Response.json({ devices: state.devices, tasks: state.tasks, ownerTestModes: state.owner.list() }); }
  if (route === '/planning' && command.type === 'PREPARE') {
    calls.prepare++; assert.equal(command.engine, 'V2');
    const proposal = proposeIntentOutcomes(command.source); if (proposal) registerReviewedOutcomes(proposal);
    const graph = compileOutcomes(proposal ?? command.source, command.deviceId, randomUUID()); assert.equal(graph.coverage, 'COMPLETE');
    const reference = randomUUID(); state.prepared.set(reference, { ...command, graph });
    return Response.json({ reference, expiresAt: Date.now() + 90000, summary: command.source, steps: graph.nodes.map(n => n.outcome.span.text), confirmations: ['Original V2 permission and verification remain enforced'] });
  }
  if (route === '/planning' && command.type === 'START_PREPARED') {
    calls.start++; calls.sessions++;
    const row = state.prepared.get(command.reference); assert.ok(row);
    const task = { executionId: randomUUID(), batchId: command.reference, deviceId: row.deviceId, physicalId, agentVersion: 2,
      request: row.source, createdAt: Date.now(), status: 'RUNNING', events: [], latest: { reason: 'Offline fixture running', v2: { sessionId: 'offline-session', graph: row.graph } } };
    state.tasks.push(task); state.controllers.set(task.executionId, new AbortController());
    if (row.source === 'set wifi 0') await mutate(task);
    if (state.loseResponse) throw Error('Offline response lost after scheduling');
    return Response.json({ tasks: [task] });
  }
  if (command.type === 'CANCEL') {
    calls.cancel++; const task = state.tasks.find(t => t.executionId === command.executionId && t.deviceId === command.deviceId);
    assert.ok(task); state.controllers.get(task.executionId).abort(); task.cancelRequested = true; task.status = 'CANCELLED'; task.finishedAt = Date.now();
    task.latest = { ...task.latest, reason: 'CANCELLED', v2: { ...task.latest.v2, evidence: 'original-evidence-retained' } }; return Response.json({ accepted: true });
  }
  if (command.type === 'ASSIST_V2' || command.type === 'ASSIST') { calls.assist++; return Response.json({ accepted: true }); }
  assert.fail('No other worker command is allowed');
}
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === '@/lib/android/agent/worker-client') return { workerRequest, runningWorkerTasks: async () => Response.json({ tasks: [] }) };
  if (name === '@/lib/android/agent/runtime-storage') return { androidRuntimeDigest: () => state.hash };
  if (name === '@/lib/android/adb') return { isValidAndroidSerial: value => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value), listAndroidDevices: async () => assert.fail('No real discovery'), runAdb: async () => assert.fail('No real ADB') };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
global.fetch = async () => { calls.network++; assert.fail('No real network/model/device allowed'); };
const unified = require('../app/api/unified-agent/route.ts');
const request = (body, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/unified-agent', {
  method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const api = async body => { const response = await unified.POST(request(body.type === 'EXECUTE' ? { ...body, clientRequestId: randomUUID() } : body)); return { ...(await response.json()), status: response.status }; };
const analyze = source => api({ type: 'ANALYZE', input: { source, deviceId: serial } });
const latest = async id => (await (await unified.GET(request())).json()).executions.find(e => e.id === id);
async function settled(id) {
  for (let i = 0; i < 500; i++) {
    const value = await latest(id); if (value?.finishedAt) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Offline execution did not settle within its test deadline');
}
for (const [name, source] of [
  ['SSID TODO', 'ket noi wifi ten oreo'], ['record TODO', 'tao record title "demo"'], ['ghi chu', 'tao ghi chu ten "demo", noi dung "offline"'],
  ['Gallery TODO', 'open Gallery'], ['URL TODO', 'open url https://example.com'], ['Maps TODO', 'open Maps'],
  ['Bluetooth TODO', 'set bluetooth 1'], ['rotation', 'set rotation 1'], ['media volume', 'set media_volume 1'], ['ring volume', 'set ring_volume 1'],
  ['flashlight', 'set flashlight 1'], ['airplane', 'set airplane 1'], ['YouTube ordinal', 'Mo YouTube, tim ocean va phat video thu hai'],
  ['Chrome ordinal > 1', 'M\u1edf Chrome, t\u00ecm ocean v\u00e0 m\u1edf b\u00e0i th\u1ee9 hai'],
  ['outside catalog', 'please arrange everything'], ['mixed disabled', 'read battery; open Maps'], ['mixed destructive', 'capture photo then delete old photos'],
]) test('OFFLINE Unified API denies whole request before context/prepare/start/Session: ' + name, async () => {
  reset(); const data = await analyze(source);
  assert.ok([403, 409].includes(data.status)); assert.ok(data.code); assert.equal(data.plan, undefined);
  assert.deepEqual(calls, { worker: 0, context: 0, prepare: 0, start: 0, sessions: 0, cancel: 0, assist: 0, network: 0 });
});
const demoCases = [
  ['M\u1edf YouTube', 'OPEN_APP', 'ENABLED'], ['M\u1edf C\u00e0i \u0111\u1eb7t', 'OPEN_SETTINGS', 'ENABLED'],
  ['Cho m\u00ecnh xem pin c\u00f2n bao nhi\u00eau', 'READ_STATE', 'ENABLED'], ['Cho m\u00ecnh bi\u1ebft Wi-Fi \u0111ang b\u1eadt hay t\u1eaft', 'READ_STATE', 'ENABLED'],
  ['Xem \u0111\u1ed9 s\u00e1ng', 'READ_STATE', 'ENABLED'], ['set wifi 0', 'SET_STATE', 'ENABLED'], ['set brightness 80', 'SET_STATE', 'ENABLED'], ['set dnd 0', 'SET_STATE', 'ENABLED'],
  ['M\u1edf Camera v\u00e0 ch\u1ee5p 1 t\u1ea5m \u1ea3nh', 'CAMERA', 'ENABLED'], ['M\u1edf b\u00e0n ph\u00edm quay s\u1ed1 5550100', 'DIAL_PREFILL', 'ENABLED'],
  ['M\u1edf m\u00e1y t\u00ednh v\u00e0 t\u00ednh 125 * 48', 'CALCULATE', 'ENABLED'], ['M\u1edf Drive v\u00e0 t\u00ecm b\u00e1o c\u00e1o th\u1ef1c t\u1eadp', 'SEARCH', 'ENABLED'],
  ['M\u1edf YouTube v\u00e0 t\u00ecm h\u1ea3i d\u01b0\u01a1ng h\u1ecdc', 'SEARCH', 'ENABLED'], ['M\u1edf My Files v\u00e0 t\u00ecm ocean', 'SEARCH', 'ENABLED'],
  ['M\u1edf Chrome, t\u00ecm ocean v\u00e0 m\u1edf b\u00e0i \u0111\u1ea7u ti\u00ean', 'BROWSER_FIRST', 'EXPERIMENTAL'],
  ['\u0110\u1eb7t b\u00e1o th\u1ee9c 7 gi\u1edd s\u00e1ng', 'ALARM', 'EXPERIMENTAL'], ['H\u1eb9n gi\u1edd 2 ph\u00fat', 'TIMER', 'EXPERIMENTAL'],
];
for (const [source, capability, status] of demoCases) test('OFFLINE real Unified ANALYZE returns only V2 and catalog label: ' + source, async () => {
  reset(); const data = await analyze(source); assert.equal(data.status, 200); assert.equal(data.plan.engine, 'V2');
  const row = data.plan.catalog.find(c => c.capability === capability); assert.ok(row); assert.equal(row.status, status); assert.ok(row.label);
  if (status === 'EXPERIMENTAL') assert.match(row.label, /UNVERIFIED/);
  assert.equal(calls.prepare, 1); assert.equal(calls.start, 0); assert.equal(calls.sessions, 0); assert.equal(calls.network, 0);
});
const phrasingHint = 'Ch\u01b0a h\u1ed7 tr\u1ee3 c\u00e1ch di\u1ec5n \u0111\u1ea1t n\u00e0y. H\u00e3y d\u00f9ng: set wifi 0 / set brightness 80 / set dnd 0';
for (const source of ['\u0110\u1eb7t wifi 0', '\u0110\u1eb7t brightness 80', '\u0110\u1eb7t dnd 0'])
  test('OFFLINE Unified ANALYZE rejects unsupported setting phrasing without effects: ' + source, async () => {
    reset(); const data = await analyze(source);
    assert.equal(data.status, 409); assert.equal(data.code, 'UNSUPPORTED_PHRASING'); assert.equal(data.error, 'UNSUPPORTED_PHRASING: ' + phrasingHint);
    assert.doesNotMatch(data.error, /record|ghi ch[u\u00fa]/i); assert.equal(data.plan, undefined);
    assert.deepEqual(calls, { worker: 0, context: 0, prepare: 0, start: 0, sessions: 0, cancel: 0, assist: 0, network: 0 });
  });
for (const source of [
  't\u1eaft wifi', '\u0111\u1eb7t \u0111\u1ed9 s\u00e1ng 80', 'ch\u1ec9nh brightness 80', 'b\u1eadt bluetooth',
  't\u1eaft kh\u00f4ng l\u00e0m phi\u1ec1n', 'ch\u1ec9nh \u00e2m l\u01b0\u1ee3ng chu\u00f4ng 1', 'bat wi-fi', 'tat den pin',
  'read battery; t\u1eaft wifi', 'M\u1edf YouTube v\u00e0 \u0111\u1eb7t \u0111\u1ed9 s\u00e1ng 80',
]) test('OFFLINE natural setting diagnostic refuses the whole source without preparation: ' + source, async () => {
  reset(); const data = await analyze(source);
  assert.equal(data.status, 409); assert.equal(data.code, 'UNSUPPORTED_PHRASING'); assert.equal(data.error, 'UNSUPPORTED_PHRASING: ' + phrasingHint);
  assert.equal(data.plan, undefined); assert.deepEqual(calls, { worker: 0, context: 0, prepare: 0, start: 0, sessions: 0, cancel: 0, assist: 0, network: 0 });
});
for (const source of [
  't\u1eaft wifi r\u1ed3i x\u00f3a h\u1ebft \u1ea3nh', '\u0111\u1eb7t \u0111\u1ed9 s\u00e1ng 80 r\u1ed3i g\u1ee1 c\u00e0i \u0111\u1eb7t YouTube',
  'ch\u1ec9nh dnd 0 r\u1ed3i ghi \u0111\u00e8 ghi ch\u00fa c\u0169', 'delete photos then tat wifi',
]) test('OFFLINE HARD_DENY takes priority over unsupported setting phrasing: ' + source, async () => {
  reset(); const data = await analyze(source);
  assert.equal(data.status, 403); assert.equal(data.code, 'HARD_DENY'); assert.equal(data.plan, undefined);
  assert.deepEqual(calls, { worker: 0, context: 0, prepare: 0, start: 0, sessions: 0, cancel: 0, assist: 0, network: 0 });
});
for (const engine of ['', 'ACTION_PLAN', 'V1', 'V2', null]) test('OFFLINE Unified API rejects removed engine selection: ' + engine, async () => {
  reset(); const data = await api({ type: 'ANALYZE', input: { source: 'Mo YouTube', deviceId: serial, debugEngine: engine } });
  assert.equal(data.status, 400); assert.equal(data.code, 'ENGINE_SELECTION_REMOVED'); assert.equal(calls.worker, 0);
});
test('OFFLINE Unified V2 counterpart: simultaneous execution and replay dispatch one source-bound task', async () => {
  reset(); const { plan } = await analyze('read battery');
  const replies = await Promise.all([api({ type: 'EXECUTE', reference: plan.reference }), api({ type: 'EXECUTE', reference: plan.reference })]); await tick();
  assert.equal(replies.filter(r => r.status === 200).length, 1); assert.equal(calls.start, 1); assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].request, plan.source); assert.equal(state.tasks[0].deviceId, plan.deviceId); assert.equal(state.tasks[0].physicalId, plan.physicalId);
  assert.equal(state.tasks[0].batchId, [...state.prepared.keys()][0]); assert.equal((await api({ type: 'EXECUTE', reference: plan.reference })).status, 409); assert.equal(calls.start, 1);
});
test('OFFLINE Unified V2 counterpart: CONFIRM cannot authorize typed Wi-Fi; full-control uses original journal and exact undo', async () => {
  reset(); state.owner.enable(serial, physicalId, undefined, { fullControl: true, rollbackOnFailure: true });
  try {
    const { plan } = await analyze('set wifi 0'); const rejected = await api({ type: 'CONFIRM', executionId: randomUUID() });
    assert.equal(rejected.code, 'LEGACY_CONFIRMATION_REMOVED'); assert.equal(calls.start, 0); assert.deepEqual(state.writes, []);
    const { execution } = await api({ type: 'EXECUTE', reference: plan.reference }); const result = await settled(execution.id);
    assert.equal(result.status, 'COMPLETED', result.reason); assert.equal(calls.start, 1); assert.equal(state.proofs.length, 1);
    assert.deepEqual(state.writes, ['disable', 'enable']); assert.equal(state.values.wifi, 1); assert.equal(result.task.latest.v2.mutations.restored, true);
    assert.equal(result.task.latest.v2.mutations.records[0].restoration, 'RESTORED');
    assert.equal((await api({ type: 'EXECUTE', reference: plan.reference })).status, 409); assert.deepEqual(state.writes, ['disable', 'enable']);
  } finally { const mode = state.owner.list()[0]; state.owner.disable(serial, mode.id); }
});
test('OFFLINE Unified V2 counterpart: normal mode does not gain setting permission', async () => {
  reset(); const { plan } = await analyze('set wifi 0'); const { execution } = await api({ type: 'EXECUTE', reference: plan.reference }); await tick();
  assert.equal((await latest(execution.id)).status, 'BLOCKED'); assert.deepEqual(state.writes, []); assert.equal(state.proofs.length, 0);
});
test('OFFLINE Unified V2 counterpart: cancellation reaches original execution and retains final evidence', async () => {
  reset(); const { plan } = await analyze('read battery'), { execution } = await api({ type: 'EXECUTE', reference: plan.reference }); await tick();
  const id = state.tasks[0].executionId; await api({ type: 'CANCEL', executionId: execution.id });
  assert.equal(state.controllers.get(id).signal.aborted, true); const result = await latest(execution.id);
  assert.equal(result.rawStatus, 'CANCELLED'); assert.equal(result.reason, 'CANCELLED'); assert.equal(result.task.latest.v2.evidence, 'original-evidence-retained'); assert.equal(calls.start, 1);
});
test('OFFLINE Unified V2 counterpart: same physical device cannot have two facade executions', async () => {
  reset(); const first = (await analyze('read battery')).plan, second = (await analyze('read wifi')).plan;
  await api({ type: 'EXECUTE', reference: first.reference }); await tick();
  assert.equal((await api({ type: 'EXECUTE', reference: second.reference })).status, 409); assert.equal(calls.start, 1);
});
for (const field of ['physicalId', 'runtimeHash', 'ownerId']) test('OFFLINE Unified API plan binding rejects changed ' + field, async () => {
  reset(); const { plan } = await analyze('read battery');
  if (field === 'physicalId') state.devices[0].physicalId = 'foreign';
  if (field === 'runtimeHash') state.hash = 'b'.repeat(64);
  if (field === 'ownerId') state.owner.enable(serial, physicalId);
  const result = await api({ type: 'EXECUTE', reference: plan.reference }); assert.equal(result.status, 409); assert.equal(calls.start, 0);
});
test('OFFLINE Unified API lost response never replays START and cancel reconciles original task', async () => {
  reset(); state.loseResponse = true; const { plan } = await analyze('read battery'); const { execution } = await api({ type: 'EXECUTE', reference: plan.reference }); await tick();
  await api({ type: 'CANCEL', executionId: execution.id }); const result = await settled(execution.id);
  assert.equal(result.workerExecutionId, state.tasks[0].executionId); assert.equal(calls.start, 1); assert.ok(calls.cancel >= 1); assert.equal(result.status, 'CANCELLED');
});
test('OFFLINE Unified API AM/PM question creates no plan or effect; selected answer prepares V2', async () => {
  reset(); const result = await analyze('Dat bao thuc 3:30'); assert.equal(result.plan, undefined); assert.equal(result.clarification.choices.length, 2);
  assert.equal(result.clarification.catalog[0].capability, 'ALARM_PERIOD'); assert.equal(calls.prepare, 0); assert.equal(calls.start, 0);
  const fresh = await api({ type: 'CLARIFY', reference: result.clarification.reference, choice: 'am' }); assert.equal(fresh.plan.engine, 'V2');
  assert.equal(fresh.plan.catalog[0].status, 'EXPERIMENTAL'); assert.equal(calls.start, 0);
});
test('OFFLINE legacy control plane still supports GET, CANCEL and assistance without reopening START', async () => {
  reset(); const legacy = require('../app/api/agent/runtime/route.ts');
  assert.equal((await legacy.GET(request())).status, 200);
  const task = { executionId: randomUUID(), deviceId: serial, status: 'WAITING_HUMAN', latest: { v2: {} } }; state.tasks.push(task); state.controllers.set(task.executionId, new AbortController());
  const body = { type: 'ASSIST_V2', executionId: task.executionId, deviceId: serial, token: randomUUID(), approved: false, choice: '' };
  assert.equal((await legacy.POST(request(body))).status, 200); assert.equal(calls.assist, 1);
  assert.equal((await legacy.POST(request({ type: 'CANCEL', executionId: task.executionId, deviceId: serial }))).status, 200); assert.equal(calls.cancel, 1);
});
test('OFFLINE Unified markup has one entry point, catalog labels and errors, no legacy or group start selectors', () => {
  reset(); const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), { UnifiedAgentPanel } = require('../components/commands/UnifiedAgentPanel.tsx');
  const real = React.useState; let index = 0;
  const source = 'Mo YouTube', plan = { source, deviceId: serial, engine: 'V2', expiresAt: Date.now() + 90000, summary: source, steps: [source], confirmations: [], catalog: [{ capability: 'BROWSER_FIRST', status: 'EXPERIMENTAL', label: 'EXPERIMENTAL / UNVERIFIED: P1' }] };
  React.useState = initial => real(++index === 1 ? plan : index === 4 ? 'CAPABILITY_DISABLED: Chua ho tro' : initial);
  let html;
  try { html = renderToStaticMarkup(React.createElement(UnifiedAgentPanel, { text: source, onText() {}, serial, onSerial() {}, onRefresh() {}, devices: state.devices, selectedDeviceIds: [], runtime: { tasks: [], ownerTestModes: [], command: async () => {} } })); }
  finally { React.useState = real; }
  assert.equal((html.match(/<textarea/g) || []).length, 1); assert.doesNotMatch(html, /command-tab-|group-agent-version|Engine ch\u1ea1y nh\u00f3m|Ch\u1ea1y nh\u00f3m/);
  assert.match(html, /EXPERIMENTAL/); assert.match(html, /UNVERIFIED/); assert.match(html, /CAPABILITY_DISABLED/); assert.match(html, /role="alert"/);
});
