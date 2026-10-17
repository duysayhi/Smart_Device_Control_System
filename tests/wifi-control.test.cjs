/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { planWifiOff, isWifiOffPlan, planWifiOn, isWifiOnPlan, planWifiNavigation } = require('../lib/android/wifi-plan.ts');
const { issueWifiConfirmation, consumeWifiConfirmation } = require('../lib/android/wifi-confirmation.ts');
const { assessPlanPolicy, assertPlanPolicy, assertObservedControlSafe } = require('../lib/android/security-policy.ts');
const { wifiActivation, disableWifi, setWifiEnabled, waitForStableWifiActivation, openWifiSettings } = require('../lib/android/wifi-control.ts');
const { waitForObservation } = require('../lib/android/state-observer.ts');
const plan = planWifiOff('mở cài đặt wifi và tắt wifi');
test('enable request is bounded, requires confirmation and cannot reuse disable authorization', () => {
  for (const prompt of ['bật wifi', 'mở wifi và bật', 'mở Wi-Fi và bật wifi', 'mở cài đặt wifi và bật']) {
    const p = planWifiOn(prompt);
    assert.equal(isWifiOnPlan(p), true); assert.equal(p.actions.length, 2);
    assert.equal(assessPlanPolicy(p).decision, 'CONFIRM'); assert.throws(() => assertPlanPolicy(p));
    const token = issueWifiConfirmation('A', plan);
    assert.equal(consumeWifiConfirmation(token, 'A', p), false);
    assert.equal(consumeWifiConfirmation(token, 'A', plan), true);
  }
  for (const prompt of ['mở wifi', 'tắt wifi', 'bật wifi và xóa dữ liệu', 'bật bluetooth']) assert.equal(planWifiOn(prompt), undefined);
});
test('opening Wi-Fi is navigation only; enabling/disabling is never silently folded into it', () => {
  for (const prompt of ['mở wifi', 'mở Wi-Fi', 'mở cài đặt wifi', 'mở trang wi-fi']) {
    const p = planWifiNavigation(prompt);
    assert.equal(p.actions.length, 2); assert.equal(p.actions[1].target, 'wifi_settings');
    assert.equal(assessPlanPolicy(p).decision, 'ALLOW');
  }
  for (const prompt of ['bật wifi', 'tắt wifi', 'mở wifi và tắt wifi', 'mở bluetooth']) assert.equal(planWifiNavigation(prompt), undefined);
});
test('Wi-Fi navigation opens public settings intent and observes without clicking or changing state', async () => {
  const s = snapshot(); let commands = 0;
  const result = await openWifiSettings({ serial: 'A' }, { waitUntil: async condition => condition(s) }, async args => {
    commands++; assert.deepEqual(args, ['-s', 'A', 'shell', 'am', 'start', '-W', '-a', 'android.settings.WIFI_SETTINGS']); return { stdout: '' };
  });
  assert.equal(result, s); assert.equal(commands, 1);
});
function snapshot() {
  const base = { packageName: 'com.android.settings', enabled: true, displayed: true, text: '', description: '', resourceId: '', clickable: false, className: 'android.widget.TextView' };
  const nodes = [{ ...base, text: 'Wi-Fi', bounds: [0, 0, 200, 80] },
    { ...base, description: 'Wi-Fi, Bật, Nút', clickable: true, className: 'android.widget.LinearLayout', bounds: [0, 100, 400, 200] },
    { ...base, text: 'Wi-Fi, Bật', className: 'android.widget.Switch', bounds: [300, 120, 380, 180], parentIndex: 1 }];
  return { foregroundPackage: 'com.android.settings', observationStatus: 'OBSERVED', nodes, elements: nodes.map((_, i) => ({ elementId: `s:${i}` })), viewport: { x: 0, y: 0, width: 400, height: 800 } };
}
test('explicit Wi-Fi off request produces two steps, no repeated BACK or model hallucinations', () => {
  assert.equal(plan.actions.length, 2); assert.equal(isWifiOffPlan(plan), true);
  for (const prompt of ['tắt wifi và xóa dữ liệu', 'bật wifi', 'tắt bluetooth', 'mở wifi']) assert.equal(planWifiOff(prompt), undefined);
  assert.equal(assessPlanPolicy(plan).decision, 'CONFIRM'); assert.throws(() => assertPlanPolicy(plan));
  assert.equal(isWifiOffPlan({ ...plan, actions: [...plan.actions, { type: 'PRESS_KEY', key: 'BACK' }] }), false);
});
test('confirmation is device/plan-bound, expiring and single use', () => {
  const token = issueWifiConfirmation('A', plan);
  assert.equal(consumeWifiConfirmation(token, 'B', plan), false);
  assert.equal(consumeWifiConfirmation(token, 'A', { ...plan, intent: 'other' }), false);
  assert.equal(consumeWifiConfirmation(token, 'A', plan), true);
  assert.equal(consumeWifiConfirmation(token, 'A', plan), false);
  const expiring = issueWifiConfirmation('A', plan), now = Date.now;
  try { Date.now = () => now() + 120001; assert.equal(consumeWifiConfirmation(expiring, 'A', plan), false); } finally { Date.now = now; }
});
test('Samsung non-clickable switch resolves only to its measured Wi-Fi activation owner', () => {
  const s = snapshot(); assert.equal(wifiActivation(s).owner, s.nodes[1]);
  assert.throws(() => assertObservedControlSafe(s.nodes[2]));
  s.nodes.push({ ...s.nodes[2] }); assert.equal(wifiActivation(s), undefined);
  s.nodes.pop(); s.nodes[2].text = 'Bluetooth'; assert.equal(wifiActivation(s), undefined);
  s.nodes[2].text = 'Wi-Fi, Bật'; s.foregroundPackage = 'other.app'; assert.equal(wifiActivation(s), undefined);
});
test('sets desired state once and verifies switch plus OS; already at desired state never toggles', async () => {
  for (const desired of [true, false]) {
  for (const enabled of [true, false]) {
    const s = snapshot(); let checked = enabled, clicks = 0, osReads = 0;
    const session = { serial: 'A', path: '/session/test', client: { request: async (method, path) => {
      if (method === 'POST') { assert.ok(path.endsWith('/element/owner/click')); clicks++; checked = desired; return null; }
      assert.ok(path.endsWith('/element/state/attribute/checked')); return String(checked);
    } } };
    const observer = { waitUntil: async condition => { const result = await condition(s, 10000); assert.ok(result); return result; },
      locate: async (_, target) => ({ id: target.endsWith(':1') ? 'owner' : 'state', snapshot: s, node: target.endsWith(':1') ? s.nodes[1] : s.nodes[2] }),
      revalidateInteraction: async found => found };
    const result = await setWifiEnabled(session, observer, async args => {
      if (args.includes('wifi_on')) { osReads++; return { stdout: checked ? '1\n' : '0\n' }; }
      assert.ok(args.includes('android.settings.WIFI_SETTINGS')); return { stdout: '' };
    }, desired);
    assert.equal(result, s); assert.equal(clicks, enabled !== desired ? 1 : 0); assert.equal(osReads, 2);
  }
  }
});
test('changed owner or unknown checked state never dispatches a toggle', async () => {
  for (const changed of [true, false]) {
    const s = snapshot(); let clicks = 0;
    const observer = { waitUntil: async condition => { const result = await condition(s, 10000); if (!result) throw new Error('Not stable'); return result; },
      locate: async (_, target) => ({ id: target.endsWith(':1') ? 'owner' : 'state', snapshot: s, node: s.nodes[1] }),
      revalidateInteraction: async found => changed ? false : found };
    const session = { serial: 'A', path: '/session/test', client: { request: async method => { if (method === 'POST') clicks++; return 'unknown'; } } };
    await assert.rejects(disableWifi(session, observer, async () => ({ stdout: '' })));
    assert.equal(clicks, 0);
  }
});

test('transient Wi-Fi revalidation failure is observed again before any interaction', async () => {
  let attempts = 0, reads = 0;
  const observer = {
    waitUntil: (condition, label, timeout, signal) => waitForObservation(async () => { reads++; return snapshot(); }, condition, label, timeout, signal),
    locate: async s => ({ id: `owner-${reads}`, snapshot: s, node: s.nodes[1] }),
    revalidateInteraction: async found => ++attempts === 1 ? false : found,
  };
  const result = await waitForStableWifiActivation(observer);
  assert.equal(attempts, 2); assert.equal(reads, 2); assert.equal(result.id, 'owner-2');
});

test('permanent ambiguity times out, and cancellation stops stabilization without a click', async () => {
  const controller = new AbortController();
  const observer = {
    waitUntil: (condition, label, _timeout, signal) => waitForObservation(async () => snapshot(), condition, label, 10, signal),
    locate: async s => ({ snapshot: s, node: s.nodes[1] }), revalidateInteraction: async () => false,
  };
  await assert.rejects(waitForStableWifiActivation(observer), e => e.code === 'TIMEOUT');
  controller.abort(); await assert.rejects(waitForStableWifiActivation(observer, controller.signal), e => e.code === 'CANCELLED');
});
