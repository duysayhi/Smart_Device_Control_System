/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const index = process.argv.indexOf('--serial');
const serial = index < 0 ? undefined : process.argv[index + 1];
if (!serial || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(serial)) {
  console.error('Opt-in real-device API test: node tests/android-observer-api.integration.cjs --serial DEVICE_SERIAL');
  process.exit(2);
}
const base = process.env.PHONE_COMMANDER_TEST_URL ?? 'http://localhost:3000';
const lock = path.join(os.tmpdir(), 'phone-commander-device-locks', createHash('sha256').update(serial).digest('hex'));
const results = [];
async function request(actions, sensitive = false) {
  return fetch(base + '/api/executions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: serial, actionPlan: { intent: 'integration_test', isSensitive: sensitive, actions } }), signal: AbortSignal.timeout(150000) });
}
async function stream(actions) {
  const response = await request(actions);
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(fs.existsSync(lock), false, 'Device lock must be released before complete');
  return events;
}
async function test(name, run) {
  const start = performance.now();
  try { await run(); results.push({ name, status: 'PASS', elapsedMs: Math.round(performance.now() - start) }); }
  catch (error) { results.push({ name, status: 'FAIL', message: error.message }); throw error; }
  console.log(JSON.stringify(results.at(-1)));
}
(async () => {
  await test('sensitive plan rejected without session', async () => {
    const response = await request([{ type: 'OPEN_APP', app: 'settings' }], true);
    const result = await response.json();
    assert.equal(response.status, 422); assert.equal(result.errorCode, 'CONFIG_ERROR');
    assert.equal(result.policy.decision, 'CONFIRM'); assert.equal(result.policy.llmDisagreement, true);
    assert.equal(fs.existsSync(lock), false);
  });
  await test('sensitive semantics are blocked despite a false AI flag, without session', async () => {
    const response = await request([{ type: 'OPEN_APP', app: 'settings' }, { type: 'CLICK', target: 'id:com.phonecommander.test:id/delete_button' }]);
    const result = await response.json();
    assert.equal(response.status, 422); assert.equal(result.policy.decision, 'BLOCK'); assert.equal(result.policy.llmDisagreement, true);
    assert.equal(fs.existsSync(lock), false);
  });
  await test('unknown click semantics require confirmation, without session', async () => {
    const response = await request([{ type: 'OPEN_APP', app: 'settings' }, { type: 'CLICK', target: 'id:com.phonecommander.test:id/does_not_exist' }]);
    const result = await response.json();
    assert.equal(response.status, 422); assert.equal(result.policy.decision, 'CONFIRM'); assert.equal(fs.existsSync(lock), false);
  });
  await test('foreground verified and streamed SUCCESS', async () => {
    const events = await stream([{ type: 'OPEN_APP', app: 'settings' }]);
    assert.equal(events.at(-1).status, 'SUCCESS');
    assert.equal(events.at(-1).steps[0].verification, 'VERIFIED');
    assert.equal(events.at(-1).steps[0].evidence.deviceSerial, serial);
  });
  await test('unverified key is SENT, not SUCCESS', async () => {
    const events = await stream([{ type: 'OPEN_APP', app: 'settings' }, { type: 'PRESS_KEY', key: 'BACK' }]);
    assert.equal(events.at(-1).status, 'SENT'); assert.equal(events.at(-1).success, false);
    assert.equal(events.at(-1).steps[1].status, 'SENT');
  });
  await test('missing target TIMEOUT stops later actions and closes session', async () => {
    const events = await stream([{ type: 'OPEN_APP', app: 'settings' },
      { type: 'WAIT_FOR', target: 'id:com.phonecommander.test:id/does_not_exist', timeoutMs: 3000 }, { type: 'PRESS_KEY', key: 'BACK' }]);
    const complete = events.at(-1);
    assert.equal(complete.status, 'FAILED'); assert.equal(complete.errorCode, 'TIMEOUT');
    assert.equal(complete.steps[2].status, 'PENDING');
    assert.ok(events.some(event => event.steps.some(step => step.phase === 'WAITING')));
  });
  await test('overlapping execution rejected; cancellation releases lock', async () => {
    const response = await request([{ type: 'OPEN_APP', app: 'settings' },
      { type: 'WAIT_FOR', target: 'id:com.phonecommander.test:id/does_not_exist', timeoutMs: 30000 }]);
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    try {
      await reader.read();
      const overlap = await request([{ type: 'OPEN_APP', app: 'settings' }]);
      assert.equal(overlap.status, 409); assert.equal((await overlap.json()).errorCode, 'SESSION_ERROR');
    } finally { await reader.cancel(); }
    const deadline = performance.now() + 40000;
    while (fs.existsSync(lock) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fs.existsSync(lock), false, 'Cancellation must finish session cleanup');
  });
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  const reportPath = path.join(os.tmpdir(), `phone-commander-api-integration-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ mode: 'REAL_DEVICE_API', serial, results }, null, 2));
  console.log('REPORT', reportPath);
});
