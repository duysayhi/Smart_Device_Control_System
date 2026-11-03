/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const { assertFullControl, fullControlHardBlock, designatedRecipient, SettingMutation } = require('../lib/android/agent/full-control-policy.ts');
const { SettingMutationController, verifySettingPair, settingCommand, statePair } = require('../lib/android/agent/setting-mutations.ts');
const { reflectStrategies, StrategyFailure, strategyHint } = require('../lib/android/agent/strategy-reflection.ts');
const { proposeIntentOutcomes } = require('../lib/android/agent/intent-capabilities.ts');
const { approveIntentSource } = require('../lib/android/agent/intent-capabilities.ts');
const { executeIntentCapability } = require('../lib/android/agent/intent-executor.ts');
const { RuntimeCommand } = require('../lib/android/agent/runtime-schema.ts');
function scope(full = true) { const p = new OwnerTestPolicy(); p.enable('D', 'P', undefined, { fullControl: full, rollbackOnFailure: true }); return { p, owner: p.bind('D', 'P', 'E') }; }
for (const source of ['delete photos', 'erase all messages', 'uninstall unused apps', 'clear app data', 'clear cache', 'factory reset', 'format storage', 'overwrite existing files', 'replace my old note', 'remove account', 'change password', 'change PIN', 'buy a subscription', 'make this folder empty', 'open settings then delete alarms', 'leave my storage empty', 'free up storage', 'grant permission', 'enable developer debugging', 'xóa ảnh', 'gỡ cài đặt ứng dụng', 'xóa bộ nhớ đệm', 'khôi phục máy', 'ghi đè tệp cũ', 'đổi mật khẩu', 'thanh toán đơn hàng', 'mở app rồi xóa dữ liệu']) test('M4d hard block with both owner/full-control enabled: ' + source, () => {
  const { owner } = scope(); assert.equal(fullControlHardBlock(source), true); assert.throws(() => assertFullControl(owner, 'D', 'P', 'E', source), /HARD_BLOCKED/);
});
test('M4d opt-in, physical isolation, copied scopes, revocation and per-effect allowlist', () => {
  const plain = scope(false); assert.throws(() => assertFullControl(plain.owner, 'D', 'P', 'E', 'set wifi 0'));
  const { p, owner } = scope(); assert.doesNotThrow(() => assertFullControl(owner, 'D', 'P', 'E', 'set wifi 0'));
  for (const [d, p, e] of [['OTHER', 'P', 'E'], ['D', 'OTHER', 'E'], ['D', 'P', 'OTHER']]) assert.throws(() => assertFullControl(owner, d, p, e, 'set wifi 0'));
  assert.throws(() => assertFullControl({ ...owner }, 'D', 'P', 'E', 'set wifi 0'));
  assert.throws(() => assertFullControl(owner, 'D', 'P', 'E', 'set wifi 0', 'DELETE'));
  p.disable('D', owner.id); assert.throws(() => assertFullControl(owner, 'D', 'P', 'E', 'set wifi 0'));
});
for (const state of ['wifi', 'bluetooth', 'dnd', 'rotation', 'brightness', 'media_volume', 'ring_volume', 'flashlight', 'airplane']) test('M4d closed source-bound domain ' + state, () => {
  assert.equal(proposeIntentOutcomes('set ' + state + ' 1').outcomes[0].intent.request.name, 'SET_DEVICE_STATE');
  assert.equal(SettingMutation.safeParse({ state, value: -1 }).success, false);
  assert.equal(SettingMutation.safeParse({ state, value: 256 }).success, false);
  assert.equal(SettingMutation.safeParse({ state, value: 1, shell: 'command' }).success, false);
});
test('M4d source preserves compound dependency arguments, rejects mutation injection', () => {
  const p = proposeIntentOutcomes('open settings android.settings.SETTINGS; set wifi 0; read wifi'); assert.equal(p.outcomes.length, 3); assert.equal(p.outcomes[1].effect, 'LOCAL_WRITE');
  assert.equal(proposeIntentOutcomes('set wifi 0 && reboot'), undefined); assert.equal(proposeIntentOutcomes('set brightness 0'), undefined);
});
test('M4d state corroboration rejects histories, transitions, default brightness, ambiguity and unsupported settings', () => {
  assert.deepEqual(statePair('bluetooth')[1], ['dumpsys', 'bluetooth_manager', '|', 'head', '-n', '12']);
  assert.equal(verifySettingPair('bluetooth', '0', 'enabled: false\nstate: BLE_ON'), 0);
  assert.equal(verifySettingPair('bluetooth', '1', 'enabled: true\nstate: TURNING_ON'), undefined);
  assert.equal(verifySettingPair('bluetooth', '1', 'enabled: true\nstate: ON'), 1);
  assert.equal(verifySettingPair('dnd', '1', 'mZenMode=ZEN_MODE_IMPORTANT_INTERRUPTIONS\nhistory zenMode=ZEN_MODE_OFF'), 1);
  assert.equal(verifySettingPair('rotation', '1', 'free'), 1); assert.equal(verifySettingPair('rotation', '1', 'Unknown command'), undefined);
  assert.equal(verifySettingPair('brightness', '64', 'mScreenBrightness=0.2509804'), 64);
  assert.equal(verifySettingPair('brightness', '64', 'mScreenBrightnessDefaultFloat=0.2509804'), undefined);
  for (const state of ['flashlight', 'airplane', 'ring_volume', 'media_volume']) assert.throws(() => settingCommand({ state, value: 1 }), /SAFE_BLOCKED/);
});
test('M4d fallback is bounded and only NOT_SENT permits another strategy', async () => {
  const records = []; const value = await reflectStrategies('new capability', { INTENT: async () => { throw new StrategyFailure('No handler'); }, UI_NAVIGATION: async () => 42 }, records, () => {});
  assert.equal(value, 42); assert.deepEqual(records.map(r => r.outcome), ['BLOCKED', 'VERIFIED']);
  let fallback = 0; await assert.rejects(reflectStrategies('state', { INTENT: async () => { throw new StrategyFailure('transport unknown', 'UNKNOWN'); }, UI_NAVIGATION: async () => fallback++ }, [], () => {})); assert.equal(fallback, 0);
});
function fake(options = {}) {
  const { owner } = scope(), values = { wifi: 1 }, writes = [], session = { serial: 'D', sessionId: 'S', ensureActive: async () => {}, assertPhysicalIdentity: async () => {} };
  const run = async args => {
    if (args.includes('policy')) return { stdout: 'mIsShowing=false\nscreenState=SCREEN_STATE_ON' };
    if (args.includes('getprop')) return { stdout: 'generic-os-v1' };
    if (args.includes('package')) return { stdout: 'versionCode=7' };
    if (args.includes('settings') && args.includes('get')) return { stdout: String(values.wifi) };
    if (args.includes('status')) return { stdout: options.disagree ? 'unavailable' : 'Wifi is ' + (values.wifi ? 'enabled' : 'disabled') };
    if (args.includes('svc')) { writes.push(args.at(-1)); if (!options.noChange) values.wifi = args.at(-1) === 'enable' ? 1 : 0; if (options.unknown && writes.length === 1) throw Error('UNKNOWN network outcome'); return { stdout: '' }; }
    throw Error('Unexpected read');
  };
  const observer = { readNativeSnapshot: async () => ({ deviceSerial: 'D', timestamp: Date.now(), observationStatus: 'OBSERVED' }) };
  return { c: new SettingMutationController(session, observer, run, owner, 'set wifi 0', 'E', 'org.generic.settings'), values, writes };
}
test('M4d mutation has pre/post proof, audit file, single inverse and restored exact previous value', async () => {
  const { c, writes, values } = fake(); assert.equal(await c.apply({ state: 'wifi', value: 0 }), 0); assert.equal(values.wifi, 0);
  const result = await c.settle(true); assert.equal(result.restored, true); assert.equal(values.wifi, 1); assert.deepEqual(writes, ['disable', 'enable']);
  assert.equal(result.records[0].restoration, 'RESTORED'); assert.equal(strategyHint('P|org.generic.settings', 'generic-os-v1:7', 'wifi'), 'INTENT');
  await assert.rejects(c.settle(true)); assert.deepEqual(writes, ['disable', 'enable']);
  const rows = fs.readFileSync(require('node:path').join(require('node:os').tmpdir(), 'phone-commander-mutations', c.journalId + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(rows.find(r => r.event === 'PREPARED_WITH_EXACT_UNDO')); assert.ok(rows.find(r => r.event === 'RESTORATION_VERIFIED'));
});
test('M4d missing independent pre-state cannot write; UNKNOWN original is not replayed but may be undone from fresh evidence', async () => {
  const bad = fake({ disagree: true }); await assert.rejects(bad.c.apply({ state: 'wifi', value: 0 })); assert.deepEqual(bad.writes, []);
  const uncertain = fake({ unknown: true }); await assert.rejects(uncertain.c.apply({ state: 'wifi', value: 0 })); const result = await uncertain.c.settle(false);
  assert.equal(result.restored, true); assert.deepEqual(uncertain.writes, ['disable', 'enable']);
});
test('M4d intervening state is never overwritten during undo; missing recipient cannot authorize a send', async () => {
  const x = fake(); await x.c.apply({ state: 'wifi', value: 0 }); x.values.wifi = 2;
  const result = await x.c.settle(true); assert.equal(result.restored, false); assert.deepEqual(x.writes, ['disable']);
  assert.equal(designatedRecipient('not-a-phone'), false);
});
test('M4d an unchanged baseline after UNKNOWN dispatch is not a claimed restoration', async () => {
  const x = fake({ unknown: true, noChange: true }); await assert.rejects(x.c.apply({ state: 'wifi', value: 0 }));
  const result = await x.c.settle(false); assert.equal(result.restored, false); assert.equal(result.records[0].restoration, 'MANUAL_REQUIRED'); assert.deepEqual(x.writes, ['disable']);
});
test('M4d operator API cannot supply a custom effect allowlist and a regular owner mode cannot dispatch a typed mutation', async () => {
  const mode = { type: 'SET_OWNER_TEST_MODE', deviceId: 'D', physicalId: 'P', enabled: true, fullControl: true, rollbackOnFailure: true };
  assert.equal(RuntimeCommand.safeParse(mode).success, true); assert.equal(RuntimeCommand.safeParse({ ...mode, effects: ['DELETE'] }).success, false);
  const source = 'set wifi 0', o = proposeIntentOutcomes(source).outcomes[0], plain = scope(false);
  let calls = 0;
  await assert.rejects(executeIntentCapability({ serial: 'D', sessionId: 'S' }, {}, async () => { calls++; }, approveIntentSource(source, 'D', 'E', 'P'), o.intent, o.span, 'E', 'org.generic.settings', undefined, plain.owner));
  assert.equal(calls, 0);
});
