/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { transportMode, readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { acquireDeviceLock, readDeviceOwnership, ManagedAppiumSession } = require('../lib/android/appium/session-manager.ts');
const { addressAllowed, wirelessEndpoint } = require('../lib/android/wireless-endpoint.ts');
const { WirelessCommand, manageWireless, discoverWirelessEndpoints } = require('../lib/android/wireless-manager.ts');
const { resolveLiveDeviceSelection } = require('../lib/android/device-selection.ts');
const { readWirelessRecords } = require('../lib/android/wireless-store.ts');
const { StateObserver } = require('../lib/android/state-observer.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const id = 'SIM-HYBRID-' + randomUUID();
const props = (hardware = id) => `[ro.serialno]: [${hardware}]\n[ro.boot.serialno]: [${hardware}]\n[ro.product.manufacturer]: [SIMULATED]\n[ro.product.model]: [SIM-HYBRID]\n`;
test('transport detection covers USB, IPv4 endpoints and Android TLS/mDNS serials', () => {
  assert.equal(transportMode('R58MA78W6QK'), 'USB');
  assert.equal(transportMode('192.168.1.2:5555'), 'Wi-Fi');
  assert.equal(transportMode('adb-R58-code._adb-tls-connect._tcp'), 'Wi-Fi');
});
test('State Observer refuses a changed physical device before requesting any hierarchy', async () => {
  let checked = 0;
  const observer = new StateObserver({ serial: 'SIM-WIFI', path: '/session/sim',
    assertPhysicalIdentity: async () => { checked++; throw new AndroidExecutionError('DEVICE_ERROR', 'Physical identity changed'); },
    client: { request: async () => assert.fail('No Appium read permitted after identity mismatch') },
  }, async () => ({ stdout: 'device' }));
  await assert.rejects(observer.read(), e => e.code === 'DEVICE_ERROR'); assert.equal(checked, 1);
});
test('endpoint validation rejects public, loopback, other LANs, shell injection, invalid ports and raw commands', () => {
  const allow = ['192.168.50.0/24'];
  assert.equal(addressAllowed('192.168.50.9', allow), true);
  for (const ip of ['8.8.8.8', '127.0.0.1', '169.254.169.254', '192.168.51.9', '192.168.50.0', '192.168.50.255', '192.168.50.9;whoami']) assert.equal(addressAllowed(ip, allow), false);
  assert.equal(wirelessEndpoint('192.168.50.9', 39817, allow), '192.168.50.9:39817');
  for (const port of [0, -1, 80, 65536, 1.5]) assert.throws(() => wirelessEndpoint('192.168.50.9', port, allow));
  assert.equal(WirelessCommand.safeParse({ type: 'CONNECT', ip: '192.168.50.9', port: 5555, command: 'whoami' }).success, false);
  assert.equal(WirelessCommand.safeParse({ type: 'PAIR', code: '123456' }).success, false);
});
test('physical identity requires consistent manufacturer/model/hardware evidence, not IP', async () => {
  const run = async () => ({ stdout: props() });
  const a = await readTransportIdentity(run, id, true), b = await readTransportIdentity(run, '192.168.50.9:5555', true);
  assert.equal(a.physicalId, b.physicalId);
  assert.equal(await readTransportIdentity(async () => ({ stdout: props().replace('[ro.boot.serialno]', '[missing]') }), 'SIM-UNKNOWN', true), undefined);
});
test('slow identity observation reports TIMEOUT, while discovery does not hide other devices', async () => {
  const run = async () => { throw new Error('ADB timed out', { cause: { killed: true } }); };
  await assert.rejects(readTransportIdentity(run, 'SIM-SLOW', true, 20, true), e => e.code === 'TIMEOUT');
  assert.equal(await readTransportIdentity(run, 'SIM-SLOW', true), undefined);
});
test('SIMULATED USB/Wi-Fi alias locks exclude a second Session cross-process key while an independent device remains available', async () => {
  const run = async args => ({ stdout: props(args[1] === 'SIM-INDEPENDENT' ? 'SIM-INDEPENDENT' : id) });
  const usb = await acquireDeviceLock(id, run);
  try {
    await usb.recordSession('session-usb', 'execution-usb');
    await assert.rejects(acquireDeviceLock('192.168.50.9:5555', run), e => e.code === 'SESSION_ERROR');
    assert.equal((await readDeviceOwnership('192.168.50.9:5555', run)).sessionId, 'session-usb');
    const other = await acquireDeviceLock('SIM-INDEPENDENT', run); await other();
  } finally { await usb(); }
  const wifi = await acquireDeviceLock('192.168.50.9:5555', run); await wifi();
});
test('Dashboard deduplicates physical aliases, retains Wi-Fi selection and accepts Wi-Fi after USB is absent', () => {
  const usb = { serial: id, physicalId: 'same', identityVerified: true, model: 'SIM', connectionType: 'USB', status: 'device' };
  const wifi = { ...usb, serial: '192.168.50.9:5555', connectionType: 'Wi-Fi' };
  const selected = resolveLiveDeviceSelection([usb, wifi], wifi.serial, [usb.serial, wifi.serial]);
  assert.equal(selected.devices.length, 1); assert.equal(selected.selectedAndroidSerial, wifi.serial);
  assert.deepEqual(selected.selectedDeviceIds, [wifi.serial]);
  assert.equal(resolveLiveDeviceSelection([wifi], usb.serial).selectedAndroidSerial, wifi.serial);
});
test('SIMULATED Appium Wi-Fi uses endpoint UDID and unique port lease; identity loss stops new actions and cleanup is explicit', async () => {
  const serial = '192.168.50.9:5555', calls = []; let changed = false, released = 0;
  const run = async args => ({ stdout: args.includes('getprop') ? props(changed ? 'SIM-REPLACED' : id) : args.includes('--list') ? '' : 'device' });
  const client = { request: async (method, url, body) => { calls.push({ method, url, body });
    if (url === '/session') return { sessionId: 'sim-wifi-session' };
    if (url.endsWith('/appium/capabilities')) return { udid: serial };
    return null;
  } };
  const session = new ManagedAppiumSession(client, serial, run, async () => {}, async () => ({ systemPort: 8208, chromedriverPort: 9508, mjpegServerPort: 7808, release: async () => { released++; } }));
  await session.open();
  const caps = calls.find(call => call.url === '/session').body.capabilities.alwaysMatch;
  assert.equal(caps['appium:udid'], serial); assert.equal(caps['appium:skipServerInstallation'], true);
  changed = true; await assert.rejects(session.ensureActive(), e => e.code === 'DEVICE_ERROR');
  await assert.rejects(session.close(), e => e.code === 'SESSION_ERROR');
  assert.equal(released, 0); assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
  changed = false;
  await session.close(); assert.equal(calls.filter(call => call.method === 'DELETE').length, 1); assert.equal(released, 1);
});
test('SIMULATED USB conversion verifies identity, reconnect is bounded, busy disconnect is blocked and no raw command or action resumes', async () => {
  const cwd = process.cwd(), old = process.env.ANDROID_WIRELESS_ALLOWED_CIDRS;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-wireless-test-'));
  process.chdir(workspace); process.env.ANDROID_WIRELESS_ALLOWED_CIDRS = '192.168.50.0/24';
  const commands = []; let failures = 0, changed = false;
  const run = async args => { commands.push(args);
    if (args.includes('getprop')) return { stdout: props(changed ? 'SIM-CHANGED-PHONE' : id) };
    if (args.includes('--list')) return { stdout: '' };
    if (args.includes('get-state')) return { stdout: 'device' };
    if (args.includes('wlan0')) return { stdout: '8: wlan0 inet 192.168.50.9/24 scope global wlan0' };
    if (args[0] === 'connect' && failures-- > 0) return { stdout: 'failed to connect', stderr: '' };
    return { stdout: 'connected', stderr: '' };
  };
  try {
    const converted = await manageWireless({ type: 'USB_TO_WIFI', serial: id, port: 5555 }, run);
    assert.equal(converted.connection.state, 'CONNECTED'); assert.equal(commands.filter(c => c.includes('tcpip')).length, 1);
    assert.ok(converted.connection.physicalId);
    const planning = await acquireDeviceLock('device-reservation:' + converted.connection.physicalId);
    try {
      await planning.recordSession('', 'sim-planning', id);
      assert.equal((await readDeviceOwnership(converted.connection.serial, run)).executionId, 'sim-planning');
      await assert.rejects(manageWireless({ type: 'DISCONNECT', serial: converted.connection.serial }, run), /BUSY/);
      await assert.rejects(manageWireless({ type: 'USB_TO_WIFI', serial: id, port: 5555 }, run), /locked|active execution/);
    } finally { await planning(); }
    const owner = await acquireDeviceLock(id, run);
    try { await assert.rejects(manageWireless({ type: 'DISCONNECT', serial: converted.connection.serial }, run), /BUSY/); }
    finally { await owner(); }
    failures = 2;
    const attempts = commands.filter(c => c[0] === 'connect').length;
    const reconnected = await manageWireless({ type: 'RECONNECT', serial: converted.connection.serial }, run);
    assert.equal(reconnected.connection.state, 'CONNECTED');
    assert.equal(commands.filter(c => c[0] === 'connect').length - attempts, 3);
    failures = 100;
    const beforeFailure = commands.filter(c => c[0] === 'connect').length;
    await assert.rejects(manageWireless({ type: 'RECONNECT', serial: converted.connection.serial }, run), /failed to connect/);
    assert.equal(commands.filter(c => c[0] === 'connect').length - beforeFailure, 3);
    failures = 0;
    await manageWireless({ type: 'DISCONNECT', serial: converted.connection.serial }, run);
    assert.equal((await readWirelessRecords())[0].state, 'DISCONNECTED');
    changed = true; await assert.rejects(manageWireless({ type: 'RECONNECT', serial: converted.connection.serial }, run), /identity changed/);
    assert.equal((await readWirelessRecords())[0].state, 'ERROR');
    assert.ok(!commands.some(c => c.includes('install') || c.includes('uninstall') || c.includes('input')));
  } finally { process.chdir(cwd); if (old === undefined) delete process.env.ANDROID_WIRELESS_ALLOWED_CIDRS; else process.env.ANDROID_WIRELESS_ALLOWED_CIDRS = old; }
});
test('discovery accepts ADB TLS connect service on allowed LAN, never pairing/public endpoints', async () => {
  const old = process.env.ANDROID_WIRELESS_ALLOWED_CIDRS; process.env.ANDROID_WIRELESS_ALLOWED_CIDRS = '192.168.50.0/24';
  try {
    const result = await discoverWirelessEndpoints(async args => { assert.deepEqual(args, ['mdns', 'services']);
      return { stdout: 'phone _adb-tls-connect._tcp. 192.168.50.9:39817\npair _adb-tls-pairing._tcp. 192.168.50.9:37123\npublic _adb-tls-connect._tcp. 8.8.8.8:39817' }; });
    assert.equal(result.length, 1); assert.equal(result[0].port, 39817);
  } finally { if (old === undefined) delete process.env.ANDROID_WIRELESS_ALLOWED_CIDRS; else process.env.ANDROID_WIRELESS_ALLOWED_CIDRS = old; }
});
