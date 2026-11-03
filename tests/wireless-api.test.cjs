/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), path = require('node:path'), Module = require('node:module');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { WirelessCommand } = require('../lib/android/wireless-manager.ts');
let operations = 0;
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === '@/lib/android/wireless-manager') return { WirelessCommand,
    manageWireless: async input => { operations++; return { connection: { serial: `${input.ip}:${input.port}`, state: 'CONNECTED' } }; },
    wirelessSnapshot: async () => ({ devices: [], connections: [], discovered: [], pairingMode: 'TERMINAL_ONLY' }),
  };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
const { POST, GET } = require('../app/api/devices/wireless/route.ts');
const request = (body, origin = 'http://127.0.0.1:3000') => new Request('http://localhost:3000/api/devices/wireless', {
  method: 'POST', headers: { Host: '127.0.0.1:3000', ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const connect = { type: 'CONNECT', ip: '192.168.50.9', port: 39817 };
test('wireless API requires local same origin even with development policy; no raw shell or pairing-code payloads', async () => {
  globalThis.wirelessRequests = [];
  const old = process.env.ANDROID_POLICY_MODE; process.env.ANDROID_POLICY_MODE = 'development';
  try {
    for (const origin of [null, 'http://evil.example']) assert.equal((await POST(request(connect, origin))).status, 403);
    assert.equal(operations, 0);
    for (const body of [{ ...connect, rawCommand: 'adb kill-server' }, { ...connect, pairingCode: '123456' }, { type: 'PAIR', code: '123456' }, { ...connect, port: '39817' }]) {
      assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal(operations, 0);
    assert.equal((await POST(request(connect))).status, 200); assert.equal(operations, 1);
    const state = await GET(new Request('http://127.0.0.1:3000/api/devices/wireless'));
    assert.equal((await state.json()).pairingMode, 'TERMINAL_ONLY');
  } finally { if (old === undefined) delete process.env.ANDROID_POLICY_MODE; else process.env.ANDROID_POLICY_MODE = old; }
});
test('wireless mutation API rate limit is bounded and does not issue a ninth ADB operation', async () => {
  globalThis.wirelessRequests = []; const baseline = operations;
  for (let i = 0; i < 8; i++) assert.equal((await POST(request(connect))).status, 200);
  assert.equal((await POST(request(connect))).status, 429); assert.equal(operations - baseline, 8);
});
