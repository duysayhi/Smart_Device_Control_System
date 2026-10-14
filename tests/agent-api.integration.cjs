/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto');
const serial = process.argv[2];
if (!serial) { console.error('Opt-in: node.exe tests/agent-api.integration.cjs DEVICE_SERIAL'); process.exit(2); }
const base = process.env.PHONE_COMMANDER_TEST_URL ?? 'http://localhost:3000';
const lock = path.join(os.tmpdir(), 'phone-commander-device-locks', createHash('sha256').update(serial).digest('hex'));
const results = [];
const streams = [];
const post = (body, signal) => fetch(base + '/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
async function check(name, fn) { const start = performance.now(); await fn(); const record = { name, status: 'PASS', elapsedMs: Math.round(performance.now() - start) }; results.push(record); console.log(JSON.stringify(record)); }
async function released() {
  const deadline = performance.now() + 30000;
  while (fs.existsSync(lock) && performance.now() < deadline) await new Promise(r => setTimeout(r, 150));
  assert.equal(fs.existsSync(lock), false, 'Original Session cleanup must release the serial lock');
}
(async () => {
  assert.equal(fs.existsSync(lock), false, 'Run sequentially without another device execution');
  await check('strict input rejects injected action payload before Session creation', async () => {
    const response = await post({ deviceId: serial, goal: 'Mở Settings', action: { type: 'SHELL' } }); assert.equal(response.status, 400); assert.equal(fs.existsSync(lock), false);
  });
  await check('sensitive goal is blocked without creating a Session', async () => {
    const response = await post({ deviceId: serial, goal: 'Mở YouTube và đăng ký kênh' }); assert.equal(response.status, 422); assert.equal(fs.existsSync(lock), false);
  });
  await check('Agent streams verified goal completion and cleans up its Session', async () => {
    const response = await post({ deviceId: serial, goal: 'Mở Settings' }); assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    streams.push(events.map(e => ({ status: e.status, reason: e.reason, screen: e.screen, subgoal: e.subgoal, counters: e.counters })));
    const final = events.at(-1); assert.equal(final.type, 'complete'); assert.equal(final.status, 'COMPLETED');
    assert.ok(events.some(e => e.status === 'OBSERVING')); await released();
  });
  await check('overlap returns409 and cancellation releases the original execution lock', async () => {
    const controller = new AbortController();
    const response = await post({ deviceId: serial, goal: 'Mở Settings và tìm mục Phone Commander Test Element Missing' }, controller.signal);
    assert.equal(response.status, 200); const reader = response.body.getReader(); await reader.read();
    assert.equal(fs.existsSync(lock), true);
    const overlap = await post({ deviceId: serial, goal: 'Mở Settings' }); assert.equal(overlap.status, 409);
    controller.abort(); await reader.cancel().catch(() => {}); await released();
  });
})().catch(error => { results.push({ status: 'FAIL', message: error.message }); console.error(error.message); process.exitCode = 1; })
.finally(() => { const file = path.join(os.tmpdir(), `phone-commander-m3-api-${Date.now()}.json`); fs.writeFileSync(file, JSON.stringify({ mode: 'REAL_DEVICE_API', results, streams }, null, 2)); console.log('REPORT', file); });
