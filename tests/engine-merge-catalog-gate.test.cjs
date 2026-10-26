/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const load = Module._load;
let workerCalls = 0, discoveryCalls = 0, inferenceCalls = 0;
const executionId = randomUUID(), assistanceToken = randomUUID();
Module._load = function (name, parent, main) {
  if (name === '@/lib/android/agent/worker-client') return {
    workerRequest: async (method, command) => { workerCalls++; return Response.json(method === 'GET' ? { devices: [], tasks: [], ownerTestModes: [] } : { accepted: true, command: command.type }); },
    queuedOllamaFetch: async () => { inferenceCalls++; assert.fail('No model call allowed'); },
    runningWorkerTasks: async () => Response.json({ tasks: [{ executionId, deviceId: 'A', latest: { assistance: { token: assistanceToken } } }] }),
  };
  if (name === '@/lib/android/adb') return {
    isValidAndroidSerial: serial => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(serial),
    listAndroidDevices: async () => { discoveryCalls++; assert.fail('No real device discovery allowed'); },
    runAdb: async () => assert.fail('No real ADB allowed'),
  };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
global.fetch = async () => assert.fail('No real network allowed');
const request = (url, body, origin = 'http://localhost:3000') => new Request('http://localhost:3000' + url, {
  method: body ? 'POST' : 'GET', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const safePlan = { intent: 'open_settings', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'settings' }] };
const cases = [
  ['/api/commands/interpret', { prompt: 'Open Settings', deviceId: 'A' }],
  ['/api/executions', { deviceId: 'A', originalRequest: 'Open Settings', actionPlan: safePlan, authorizationToken: randomUUID() }],
  ['/api/agent', { deviceId: 'A', goal: 'Open Settings' }],
  ...[false, true].map(v2 => ['/api/agent/runtime', { type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal: 'Open Settings', ...(v2 ? { agentVersion: 2 } : {}) }] }]),
];
for (const [url, body] of cases) test('OFFLINE production public legacy gate rejects before discovery/inference/start: ' + url + JSON.stringify(body), async () => {
  workerCalls = discoveryCalls = inferenceCalls = 0;
  const { POST } = require('../app' + url + '/route.ts');
  const response = await POST(request(url, body));
  assert.equal(response.status, 410); assert.equal((await response.json()).code, 'LEGACY_ENTRY_DISABLED');
  assert.equal(workerCalls, 0); assert.equal(discoveryCalls, 0); assert.equal(inferenceCalls, 0);
  assert.equal((await POST(request(url, body, 'https://foreign.example'))).status, 403);
  assert.equal((await POST(request(url, {}))).status, 400);
  assert.equal((await POST(request(url, { ...body, legacyEntryEnabled: true }))).status, 400);
});
for (const [url, safe] of cases) test('OFFLINE source DENY takes precedence over availability: ' + url + JSON.stringify(safe), async () => {
  workerCalls = discoveryCalls = inferenceCalls = 0;
  const body = structuredClone(safe);
  if (body.prompt) body.prompt = 'delete all photos';
  else if (body.originalRequest) body.originalRequest = 'delete all photos';
  else if (body.jobs) body.jobs[0].goal = 'delete all photos';
  else body.goal = 'delete all photos';
  const response = await require('../app' + url + '/route.ts').POST(request(url, body));
  assert.equal(response.status, 403); assert.notEqual((await response.json()).code, 'LEGACY_ENTRY_DISABLED');
  assert.equal(workerCalls + discoveryCalls + inferenceCalls, 0);
});
test('OFFLINE legacy gate is one source constant, not an environment/client/test switch', () => {
  const gate = require('../lib/android/unified-agent/legacy-entry.ts');
  assert.equal(gate.LEGACY_ENTRY_ENABLED, false);
  const source = fs.readFileSync(path.resolve(__dirname, '../lib/android/unified-agent/legacy-entry.ts'), 'utf8');
  assert.doesNotMatch(source, /process\.env|NODE_ENV|request\.|testMode/);
});
test('OFFLINE production runtime GET/CANCEL/ASSIST remain available with legacy START disabled', async () => {
  const route = require('../app/api/agent/runtime/route.ts'); workerCalls = 0;
  assert.equal((await route.GET(request('/api/agent/runtime'))).status, 200);
  for (const command of [
    { type: 'CANCEL', executionId, deviceId: 'A' },
    { type: 'CANCEL_BATCH', batchId: randomUUID() },
    { type: 'ASSIST_V2', executionId, deviceId: 'A', token: randomUUID(), approved: false, choice: '' },
  ]) assert.equal((await route.POST(request('/api/agent/runtime', command))).status, 200);
  assert.equal(workerCalls, 4);
});
test('OFFLINE production legacy assistance STOP/CONFIRM/CANCEL still forwards to owned tasks', async () => {
  const { POST } = require('../app/api/agent/assistance/route.ts'); workerCalls = 0;
  for (const body of [
    { type: 'STOP', token: executionId },
    { type: 'CONFIRM', token: assistanceToken, evidenceId: randomUUID(), x: 1, y: 1, confirmed: true },
    { type: 'CANCEL', token: assistanceToken },
  ]) assert.equal((await POST(request('/api/agent/assistance', body))).status, 200);
  assert.equal(workerCalls, 3);
});
const { requireDemoCapabilities } = require('../lib/android/unified-agent/demo-catalog.ts');
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
for (const [capability, source, diagnostic = /CAPABILITY_DISABLED/] of [
  ['SSID TODO', 'ket noi wifi ten oreo'],
  ['record TODO', 'tao record title "audit"'],
  ['Gallery TODO', 'open gallery'],
  ['URL TODO', 'open url https://example.com'],
  ['URL app slot', 'open app url https://example.com'],
  ['bare URL', 'open https://example.com'],
  ['quoted URL', 'open "https://example.com"'],
  ['domain app slot', 'open example.com'],
  ['subdomain app slot', 'open www.example.com'],
  ['reverse namespace domain', 'open org.example.com'],
  ['network path app slot', 'open //example.com/path'],
  ['unknown app alias', 'open arbitrary unknown target', /UNSUPPORTED_OUTCOME/],
  ['Maps TODO', 'open maps'],
  ['Bluetooth TODO', 'set bluetooth 1'],
  ['rotation', 'set rotation 1'], ['volume', 'set media_volume 1'],
  ['flashlight', 'set flashlight 1'], ['airplane', 'set airplane 1'],
  ['YouTube ordinal', 'Mo YouTube, tim podcast va phat video thu hai'],
  ['ordinal > 1', 'Mo Chrome, tim ocean va mo bai thu hai'],
  ['outside catalog', 'please arrange everything', /NEEDS_CLARIFICATION: UNSUPPORTED_OUTCOME/],
  ['P1 unaccented outside existing grammar', 'Mo Chrome, tim ocean va mo bai dau tien', /UNSUPPORTED_OUTCOME/],
  ['unresolved mixed diagnostic', 'read battery roi mo Tool va lam viec chua hieu', /NEEDS_CLARIFICATION: UNPARSED_COMPOUND/],
  ['mixed with unknown app', 'read wifi; open unknown target', /UNSUPPORTED_OUTCOME/],
  ['unbound DND value', 'set dnd 9', /NEEDS_CLARIFICATION: UNSUPPORTED_OUTCOME/],
  ['extra setting clause', 'set dnd 0 do something else', /NEEDS_CLARIFICATION: UNSUPPORTED_OUTCOME/],
  ['unbound camera value', 'capture arbitrary data', /UNSUPPORTED_OUTCOME/],
  ['unbound arithmetic', 'calculate arbitrary data', /UNSUPPORTED_OUTCOME/],
  ['mixed', 'Open Settings; open maps'],
]) test('OFFLINE runtime catalog rejects before discovery/prepare/start/Session: ' + capability, async () => {
  let calls = 0;
  const registry = new DeviceRuntimeRegistry({ discover: async () => { calls++; throw Error('No discovery authorized'); }, plan: async () => { calls++; throw Error('No planner authorized'); }, open: async () => { calls++; throw Error('No Session authorized'); } });
  assert.throws(() => requireDemoCapabilities(source), diagnostic);
  await assert.rejects(registry.prepare(source, 'A', 'V2'), diagnostic);
  await assert.rejects(registry.start({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal: source, agentVersion: 2 }] }), diagnostic);
  assert.equal(calls, 0); assert.equal(registry.list().length, 0);
});
for (const [source, id, status] of [
  ['Open YouTube', 'OPEN_APP', 'ENABLED'], ['Open Chrome', 'OPEN_APP', 'ENABLED'],
  ['Mo Camera', 'OPEN_APP', 'ENABLED'], ['Mo clock', 'OPEN_APP', 'ENABLED'],
  ['open app com.google.android.youtube', 'OPEN_APP', 'ENABLED'],
  ['Mo org.unprofiled.display', 'OPEN_APP', 'ENABLED'],
  ['open net.unprofiled.viewer', 'OPEN_APP', 'ENABLED'],
  ['Open Settings', 'OPEN_SETTINGS', 'ENABLED'],
  ['open settings android.settings.SETTINGS', 'OPEN_SETTINGS', 'ENABLED'],
  ['read battery', 'READ_STATE', 'ENABLED'], ['read wifi', 'READ_STATE', 'ENABLED'], ['read brightness', 'READ_STATE', 'ENABLED'],
  ['Cho m\u00ecnh xem pin c\u00f2n bao nhi\u00eau', 'READ_STATE', 'ENABLED'],
  ['Cho m\u00ecnh bi\u1ebft Wi-Fi \u0111ang b\u1eadt hay t\u1eaft', 'READ_STATE', 'ENABLED'],
  ['set dnd 0', 'SET_STATE', 'ENABLED'], ['set wifi 0', 'SET_STATE', 'ENABLED'],
  ['set wifi 1', 'SET_STATE', 'ENABLED'], ['set brightness 80', 'SET_STATE', 'ENABLED'],
  ['open dialer 5550100', 'DIAL_PREFILL', 'ENABLED'],
  ['calculate 125 * 48', 'CALCULATE', 'ENABLED'], ['capture photo', 'CAMERA', 'ENABLED'],
  ['Mo Camera va chup 1 tam anh', 'CAMERA', 'ENABLED'],
  ['Mo Drive va tim ocean', 'SEARCH', 'ENABLED'],
  ['Mo YouTube va tim podcast', 'SEARCH', 'ENABLED'],
  ['Mo My Files va tim ocean', 'SEARCH', 'ENABLED'],
  ['Vao Drive tim giup minh tai lieu ten bao cao thuc tap', 'SEARCH', 'ENABLED'],
  ['Dat bao thuc 3:30', 'ALARM_PERIOD', 'ENABLED'],
  ['M\u1edf Chrome, t\u00ecm ocean v\u00e0 m\u1edf b\u00e0i \u0111\u1ea7u ti\u00ean', 'BROWSER_FIRST', 'EXPERIMENTAL'],
  ['Hen gio 2 phut', 'TIMER', 'EXPERIMENTAL'], ['Dat bao thuc 7 gio sang', 'ALARM', 'EXPERIMENTAL'],
]) test('OFFLINE catalog status, not an execution grant: ' + source, () => {
  const row = requireDemoCapabilities(source).find(c => c.id === id);
  assert.ok(row); assert.equal(row.status, status);
  if (status === 'EXPERIMENTAL') { assert.equal(row.evidence, 'UNVERIFIED'); assert.match(row.message, /UNVERIFIED/); }
});
