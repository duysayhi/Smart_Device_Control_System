/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), Module = require('node:module');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
let sessions = 0, actions = 0, closed = 0;
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === '@/lib/android/adb') return { isValidAndroidSerial: () => true, listAndroidDevices: async () => ['A', 'B'].map(serial => ({ serial, connectionType: 'USB', status: 'device' })), runAdb: async () => assert.fail('Unexpected real ADB') };
  if (name === '@/lib/android/condition-executor') return {
    assertNonSensitivePlan: plan => require('../lib/android/security-policy.ts').assertPlanPolicy(plan),
    createExecutionContext: async (_serial, _actions, _run, _signal, accounting) => {
      if (_actions[1].target.startsWith('wifi_connect:')) {
        assert.equal(accounting.wifiNetworkConfirmed, _actions[1].target.slice('wifi_connect:'.length));
        assert.equal(accounting.wifiOnConfirmed, undefined); assert.equal(accounting.wifiOffConfirmed, undefined);
      } else {
      const enabled = _actions[1].target === 'wifi_on';
      assert.equal(enabled ? accounting.wifiOnConfirmed : accounting.wifiOffConfirmed, true);
      assert.equal(enabled ? accounting.wifiOffConfirmed : accounting.wifiOnConfirmed, undefined);
      }
      sessions++;
      return { execute: async () => { actions++; return { verification: 'VERIFIED' }; }, close: async () => { closed++; } };
    },
  };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
const { POST } = require('../app/api/executions/route.ts');
const { planWifiOff, planWifiOn, planWifiConnection } = require('../lib/android/wifi-plan.ts');
const plan = planWifiOff('tắt wifi');
const request = (payload, origin = 'http://127.0.0.1:3000') => new Request('http://localhost:3000/api/executions', {
  method: 'POST', headers: { Host: '127.0.0.1:3000', ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 'A', actionPlan: plan, ...payload }),
});

test('enable confirmation is explicit, bound to ON and cannot authorize OFF', async () => {
  const old = process.env.ANDROID_EXECUTOR_BACKEND; process.env.ANDROID_EXECUTOR_BACKEND = 'appium';
  const initialSessions = sessions;
  try {
    const on = planWifiOn('mở wifi và bật');
    const response = await POST(request({ actionPlan: on })); assert.equal(response.status, 409);
    const challenge = await response.json(); assert.equal(challenge.wifiEnabled, true); assert.equal(sessions, initialSessions);
    assert.equal((await POST(request({ confirmationToken: challenge.confirmationToken }))).status, 409);
    const accepted = await POST(request({ actionPlan: on, confirmationToken: challenge.confirmationToken }));
    assert.equal(accepted.status, 200); await accepted.text(); assert.equal(sessions, initialSessions + 1);
    assert.equal((await POST(request({ actionPlan: on, confirmationToken: challenge.confirmationToken }))).status, 409);
  } finally { if (old === undefined) delete process.env.ANDROID_EXECUTOR_BACKEND; else process.env.ANDROID_EXECUTOR_BACKEND = old; }
});
test('route never opens Session before confirmation; confirmed request runs once on the bound device', async () => {
  const old = process.env.ANDROID_EXECUTOR_BACKEND; process.env.ANDROID_EXECUTOR_BACKEND = 'appium';
  const baseSessions = sessions, baseActions = actions, baseClosed = closed;
  try {
    for (const origin of ['http://evil.example', null]) assert.equal((await POST(request({}, origin))).status, 403);
    const first = await POST(request({})); assert.equal(first.status, 409);
    const challenge = await first.json(); assert.equal(challenge.confirmationRequired, true); assert.equal(sessions, baseSessions);
    const token = challenge.confirmationToken;
    assert.equal((await POST(request({ deviceId: 'B', confirmationToken: token }))).status, 409); assert.equal(sessions, baseSessions);
    const accepted = await POST(request({ confirmationToken: token })); assert.equal(accepted.status, 200);
    const events = (await accepted.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).success, true); assert.equal(sessions, baseSessions + 1); assert.equal(actions, baseActions + 2); assert.equal(closed, baseClosed + 1);
    assert.equal((await POST(request({ confirmationToken: token }))).status, 409); assert.equal(sessions, baseSessions + 1);
  } finally { if (old === undefined) delete process.env.ANDROID_EXECUTOR_BACKEND; else process.env.ANDROID_EXECUTOR_BACKEND = old; }
});

test('connection confirmation authorizes one exact SSID, not other networks or general input actions', async () => {
  const old = process.env.ANDROID_EXECUTOR_BACKEND; process.env.ANDROID_EXECUTOR_BACKEND = 'appium';
  const baseSessions = sessions;
  try {
    const join = planWifiConnection('kết nối wifi với tên mạng là oreo');
    const first = await POST(request({ actionPlan: join })); assert.equal(first.status, 409);
    const challenge = await first.json(); assert.equal(challenge.wifiNetwork, 'oreo'); assert.equal(sessions, baseSessions);
    const token = challenge.confirmationToken;
    assert.equal((await POST(request({ actionPlan: planWifiConnection('kết nối wifi Other'), confirmationToken: token }))).status, 409);
    const injected = { ...join, actions: [...join.actions, { type: 'INPUT_TEXT', text: 'should-not-run' }] };
    assert.equal((await POST(request({ actionPlan: injected, confirmationToken: token }))).status, 422);
    const accepted = await POST(request({ actionPlan: join, confirmationToken: token })); assert.equal(accepted.status, 200);
    await accepted.text(); assert.equal(sessions, baseSessions + 1);
    assert.equal((await POST(request({ actionPlan: join, confirmationToken: token }))).status, 409);
  } finally { if (old === undefined) delete process.env.ANDROID_EXECUTOR_BACKEND; else process.env.ANDROID_EXECUTOR_BACKEND = old; }
});

test('local development skips Wi-Fi confirmation without disabling same-origin enforcement', async () => {
  const previous = { mode: process.env.ANDROID_POLICY_MODE, env: process.env.NODE_ENV, backend: process.env.ANDROID_EXECUTOR_BACKEND };
  process.env.ANDROID_POLICY_MODE = 'development'; process.env.NODE_ENV = 'development'; process.env.ANDROID_EXECUTOR_BACKEND = 'appium';
  const baseSessions = sessions;
  try {
    const on = planWifiOn('bật wifi');
    assert.equal((await POST(request({ actionPlan: on }, 'http://evil.example'))).status, 403);
    const response = await POST(request({ actionPlan: on })); assert.equal(response.status, 200);
    await response.text(); assert.equal(sessions, baseSessions + 1);
    const blocked = { ...plan, actions: [{ type: 'CLICK', target: 'uninstall' }] };
    assert.equal((await POST(request({ actionPlan: blocked }))).status, 422); assert.equal(sessions, baseSessions + 1);
  } finally {
    for (const [key, value] of [['ANDROID_POLICY_MODE', previous.mode], ['NODE_ENV', previous.env], ['ANDROID_EXECUTOR_BACKEND', previous.backend]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
