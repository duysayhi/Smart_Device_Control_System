/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
}).outputText, file);
const { resolveLiveDeviceSelection } = require('../lib/android/device-selection.ts');
const device = (serial, status = 'device') => ({
  serial, physicalId: 'physical-' + serial, identityVerified: true, model: 'SIM-' + serial,
  connectionType: 'USB', status,
});
const history = (...devices) => resolveLiveDeviceSelection(devices, '').knownLiveSerials;

test('C17 OFFLINE: retain explicit A when A is offline and B remains READY', () => {
  const selected = resolveLiveDeviceSelection([device('A', 'offline'), device('B')], 'A', undefined, history(device('A')));
  assert.equal(selected.selectedAndroidSerial, 'A');
  assert.equal(selected.devices.find(d => d.serial === 'A').status, 'OFFLINE');
  assert.deepEqual(selected.selectedDeviceIds, ['A']);
});

test('C17 OFFLINE: unauthorized A does not redirect selection to READY B', () => {
  const selected = resolveLiveDeviceSelection([device('A', 'unauthorized'), device('B')], 'A', undefined, history(device('A')));
  assert.equal(selected.selectedAndroidSerial, 'A');
  assert.equal(selected.devices.find(d => d.serial === 'A').status, 'UNAUTHORIZED');
});

test('C17 OFFLINE: disappearance of A does not make B an implicit replacement', () => {
  const selected = resolveLiveDeviceSelection([device('B')], 'A', undefined, history(device('A')));
  assert.equal(selected.selectedAndroidSerial, 'A');
  assert.equal(selected.devices.find(d => d.serial === 'A').status, 'OFFLINE');
});

test('C17 OFFLINE: an empty discovery keeps the explicit serial without inventing a live device', () => {
  const selected = resolveLiveDeviceSelection([], 'A', undefined, history(device('A')));
  assert.equal(selected.selectedAndroidSerial, 'A');
  assert.equal(selected.devices.find(d => d.serial === 'A').status, 'OFFLINE');
  assert.equal(selected.androidDevices[0].identityVerified, false);
});

test('C17 OFFLINE: initial auto-selection requires exactly one READY device', () => {
  assert.equal(resolveLiveDeviceSelection([device('A')], '').selectedAndroidSerial, 'A');
  assert.equal(resolveLiveDeviceSelection([device('A'), device('B')], '').selectedAndroidSerial, '');
  assert.equal(resolveLiveDeviceSelection([device('A', 'offline')], '').selectedAndroidSerial, '');
  assert.equal(resolveLiveDeviceSelection([], '').selectedAndroidSerial, '');
});

test('C17 OFFLINE: initial choice ignores offline devices when exactly one is READY', () => {
  const selected = resolveLiveDeviceSelection([device('A', 'offline'), device('B')], '');
  assert.equal(selected.selectedAndroidSerial, 'B');
});

test('C17 OFFLINE: verified physical alias may replace a disconnected transport of the same device', () => {
  const usb = device('USB', 'offline');
  const wifi = { ...usb, serial: '192.168.50.9:5555', connectionType: 'Wi-Fi', status: 'device' };
  const selected = resolveLiveDeviceSelection([usb, wifi], usb.serial, undefined, history({ ...usb, status: 'device' }));
  assert.equal(selected.devices.length, 1);
  assert.equal(selected.devices[0].serial, wifi.serial);
  assert.equal(selected.devices[0].status, 'READY');
  assert.equal(selected.selectedAndroidSerial, wifi.serial);
});

test('C17 OFFLINE: recovery does not change the selected serial', () => {
  const offline = resolveLiveDeviceSelection([device('A', 'offline'), device('B')], 'A', undefined, history(device('A')));
  const recovered = resolveLiveDeviceSelection([device('A'), device('B')], offline.selectedAndroidSerial);
  assert.equal(recovered.selectedAndroidSerial, 'A');
});

test('C17 OFFLINE: demo IDs absent from verified discovery history are discarded', () => {
  const selected = resolveLiveDeviceSelection([], 'dev-001', undefined, history(device('A')));
  assert.equal(selected.selectedAndroidSerial, '');
  assert.deepEqual(selected.selectedDeviceIds, []);
  assert.deepEqual(selected.devices, []);
});

test('C17 OFFLINE: verified USB history permits same-physical Wi-Fi fallback after USB disappears', () => {
  const usb = device('USB');
  const wifi = { ...usb, serial: '192.168.50.9:5555', connectionType: 'Wi-Fi' };
  const selected = resolveLiveDeviceSelection([wifi], usb.serial, undefined, history(usb));
  assert.equal(selected.selectedAndroidSerial, wifi.serial);
  assert.equal(selected.devices.length, 1);
  assert.equal(selected.devices[0].physicalId, usb.physicalId);
});

test('C17 OFFLINE: an unverified alias cannot replace known A even if physicalId is copied', () => {
  const a = device('A');
  const alias = { ...a, serial: '192.168.50.9:5555', connectionType: 'Wi-Fi', identityVerified: false };
  const selected = resolveLiveDeviceSelection([alias], a.serial, undefined, history(a));
  assert.equal(selected.selectedAndroidSerial, a.serial);
  assert.equal(selected.devices[0].status, 'OFFLINE');
});

test('C17 OFFLINE: discovery history records only live identity-verified devices and is not mutated', () => {
  const known = history(device('A'));
  const selected = resolveLiveDeviceSelection([device('B', 'offline'), { ...device('C'), identityVerified: false }, device('D')], 'A', undefined, known);
  assert.deepEqual([...known.keys()], ['A']);
  assert.deepEqual([...selected.knownLiveSerials.keys()], ['A', 'D']);
  assert.equal(selected.selectedAndroidSerial, 'A');
});

test('C17 OFFLINE: explicitly selecting B is honored rather than retaining A', () => {
  const selected = resolveLiveDeviceSelection([device('A'), device('B')], 'B');
  assert.equal(selected.selectedAndroidSerial, 'B');
});
