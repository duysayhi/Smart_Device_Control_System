/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { planWifiConnection, wifiNetworkForPlan } = require('../lib/android/wifi-plan.ts');
const { issueWifiConfirmation, consumeWifiConfirmation } = require('../lib/android/wifi-confirmation.ts');
const { assessPlanPolicy, isSensitiveControl } = require('../lib/android/security-policy.ts');
const { connectedToWifi, networkLabel, connectWifiNetwork } = require('../lib/android/wifi-network.ts');
const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
const connected = ssid => `Wifi is enabled\nWifi is connected to "${ssid}"\nWifiInfo: SSID: ${ssid}, Supplicant state: COMPLETED, score: 60\n`;
function snapshot() {
  const n = { packageName: 'com.android.settings', enabled: true, displayed: true, text: '', description: '', resourceId: '', clickable: false, className: 'android.widget.TextView' };
  const nodes = [{ ...n, text: 'Wi-Fi', bounds: [0, 0, 200, 80] },
    { ...n, description: 'Wi-Fi, Bật, Nút', clickable: true, className: 'android.widget.LinearLayout', bounds: [0, 100, 400, 200] },
    { ...n, text: 'Wi-Fi, Bật', className: 'android.widget.Switch', bounds: [300, 120, 380, 180], parentIndex: 1 },
    { ...n, text: 'oreo', clickable: true, bounds: [0, 300, 400, 400] }];
  return { foregroundPackage: 'com.android.settings', observationStatus: 'OBSERVED', nodes, viewport: { x: 0, y: 0, width: 400, height: 800 } };
}
test('connection plan preserves arbitrary SSID and is strictly bound to exact two-step goal', () => {
  for (const [prompt, ssid] of [['kết nối wifi với tên mạng là oreo', 'oreo'], ['kết nối vào mạng Wi-Fi "Nhà tôi"', 'Nhà tôi'], ['ket noi wifi Office_5G', 'Office_5G']]) {
    const p = planWifiConnection(prompt); assert.equal(wifiNetworkForPlan(p), ssid); assert.equal(assessPlanPolicy(p).decision, 'CONFIRM');
    assert.equal(wifiNetworkForPlan({ ...p, actions: [...p.actions, { type: 'INPUT_TEXT', text: 'secret' }] }), undefined);
    const token = issueWifiConfirmation('A', p);
    assert.equal(consumeWifiConfirmation(token, 'B', p), false);
    assert.equal(consumeWifiConfirmation(token, 'A', planWifiConnection('kết nối wifi Other')), false);
    assert.equal(consumeWifiConfirmation(token, 'A', p), true);
    assert.equal(consumeWifiConfirmation(token, 'A', p), false);
  }
  assert.equal(planWifiConnection('kết nối wifi ' + 'a'.repeat(33)), undefined);
  assert.equal(planWifiConnection('kết nối wifi ' + 'é'.repeat(17)), undefined);
  for (const label of ['gỡ cài đặt', 'xóa dữ liệu', 'khôi phục cài đặt gốc', 'wipe data']) assert.equal(isSensitiveControl(label), true);
});
test('OS connection evidence requires exact case-sensitive SSID and completed supplicant, not scan results', () => {
  assert.equal(connectedToWifi(connected('oreo'), 'oreo'), true);
  assert.equal(connectedToWifi(connected('Oreo'), 'oreo'), false);
  assert.equal(connectedToWifi(connected('Other'), 'oreo'), false);
  assert.equal(connectedToWifi(connected('oreo').replace('COMPLETED', 'ASSOCIATING'), 'oreo'), false);
  assert.equal(connectedToWifi('Scan result SSID oreo COMPLETED', 'oreo'), false);
});
test('visible network label must be unique in observed Wi-Fi settings', () => {
  const s = snapshot(); assert.equal(networkLabel(s, 'oreo'), s.nodes[3]);
  s.nodes.push({ ...s.nodes[3] }); assert.throws(() => networkLabel(s, 'oreo'), e => e.code === 'AMBIGUOUS');
  s.nodes.pop(); s.foregroundPackage = 'other.app'; assert.equal(networkLabel(s, 'oreo'), undefined);
});
function harness({ already = false, duplicate = false, stale = false, wrong = false } = {}) {
  const s = snapshot(); if (duplicate) s.nodes.push({ ...s.nodes[3] });
  let clicks = 0, statusReads = 0, discoveries = 0, passwordWait = false;
  const session = { serial: 'A', path: '/session/test', client: { request: async (method, path) => {
    assert.equal(method, 'POST'); assert.equal(path, '/session/test/element/network/click'); clicks++;
  } } };
  const observer = {
    revalidateInteraction: async found => stale ? false : found,
    waitUntil: async (condition, label, timeout, signal, progress) => {
      if (timeout === 120000) { passwordWait = true; assert.ok(label.includes('mật khẩu')); progress?.({ waitingFor: label, elapsedMs: 0 }); }
      const result = await condition(s, 10000); if (!result) throw new Error('Not connected'); return result;
    },
  };
  const explorer = { find: async target => { discoveries++; assert.equal(target, 'text:oreo'); return { status: 'FOUND', found: { id: 'network', node: s.nodes[3], snapshot: s } }; } };
  const run = async args => {
    if (args.includes('wifi_on')) return { stdout: '1' };
    if (args.includes('status')) return { stdout: connected(already || (++statusReads > 1 && !wrong) ? 'oreo' : 'Other') };
    assert.ok(args.includes('android.settings.WIFI_SETTINGS')); return { stdout: '' };
  };
  return { execute: () => connectWifiNetwork(session, observer, explorer, run, 'oreo'), stats: () => ({ clicks, discoveries, passwordWait }) };
}
test('joining clicks grounded network once, waits for human credentials, and verifies real OS SSID', async () => {
  const h = harness(); assert.ok(await h.execute()); assert.deepEqual(h.stats(), { clicks: 1, discoveries: 1, passwordWait: true });
});
test('already connected is idempotent; duplicate/stale targets do not click; wrong network never completes', async () => {
  const same = harness({ already: true }); await same.execute(); assert.equal(same.stats().clicks, 0); assert.equal(same.stats().discoveries, 0);
  for (const options of [{ duplicate: true }, { stale: true }]) {
    const h = harness(options); await assert.rejects(h.execute()); assert.equal(h.stats().clicks, 0);
  }
  const wrong = harness({ wrong: true }); await assert.rejects(wrong.execute(), /Not connected/); assert.equal(wrong.stats().clicks, 1);
});
test('executor refuses connect without exact SSID authorization even when toggle ON is authorized', async () => {
  for (const scope of [{}, { wifiOnConfirmed: true }, { wifiNetworkConfirmed: 'Other' }]) {
    const executor = new ConditionExecutor({ ensureActive: async () => {} }, async () => assert.fail('No ADB allowed'), scope);
    await assert.rejects(executor.execute({ type: 'CLICK', target: 'wifi_connect:oreo' }), e => e.code === 'CONFIG_ERROR');
  }
});
