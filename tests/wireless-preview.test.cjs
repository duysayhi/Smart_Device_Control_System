/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), path = require('node:path');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
let reads = 0, screenshots = 0, trusted = true, changed = false;
const serial = '192.168.50.9:5555', load = Module._load;
Module._load = function (name, parent, main) {
  if (name === '@/lib/android/adb') return { isValidAndroidSerial: () => true, runAdb: () => assert.fail('No real ADB in preview simulation'),
    listAndroidDevices: async () => [{ serial, status: 'device', connectionType: 'Wi-Fi', identityVerified: true }] };
  if (name === '@/lib/android/screen-previews') return { androidPreview: async () => { screenshots++; return Buffer.from('PNG_SIMULATED'); } };
  if (name === '@/lib/android/transport-identity') return { readTransportIdentity: async () => ({ physicalId: ++reads > 1 && changed ? 'replacement' : 'original' }) };
  if (name === '@/lib/android/wireless-store') return { wirelessIdentityAllowed: async () => trusted };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
const { GET } = require('../app/api/devices/[serial]/screenshot/route.ts');
const request = () => GET(new Request('http://localhost:3000/api/devices/' + serial + '/screenshot'), { params: Promise.resolve({ serial }) });
test('SIMULATED wireless screenshot uses the selected transport and verifies identity before returning bytes', async () => {
  const response = await request(); assert.equal(response.status, 200); assert.equal(screenshots, 1); assert.equal(reads, 2);
  assert.equal(await response.text(), 'PNG_SIMULATED');
});
test('untrusted endpoint or mid-capture identity change cannot return another phone preview', async () => {
  reads = 0; screenshots = 0; trusted = false;
  assert.equal((await request()).status, 409); assert.equal(screenshots, 0);
  reads = 0; trusted = true; changed = true;
  const response = await request(); assert.equal(response.status, 409); assert.equal(screenshots, 1);
  assert.equal((await response.text()).includes('PNG_SIMULATED'), false);
});
