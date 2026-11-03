/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { randomUUID, createHash } = require('node:crypto');
require.extensions['.ts'] = (m, f) => {
  const original = m.require.bind(m);
  m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { prepareV2 } = require('../lib/android/agent/prepared-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { ManagedAppiumSession } = require('../lib/android/appium/session-manager.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { approveIntentSource } = require('../lib/android/agent/intent-capabilities.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { executeIntentCapability, isIntentEvidence } = require('../lib/android/agent/intent-executor.ts');
const noAI = { generate() { throw Error('Unexpected model call'); } };
const battery = 'Cho m\u00ecnh xem pin c\u00f2n bao nhi\u00eau';
const wifi = 'Cho m\u00ecnh bi\u1ebft Wi-Fi \u0111ang b\u1eadt hay t\u1eaft';

// Production Session, Appium protocol client, ConditionExecutor and intent
// executor; every transport is injected and rejects unexpected operations.
function fixture(source, options = {}) {
  const serial = 'READSTATE-' + randomUUID(), executionId = randomUUID(), hardware = 'HW-' + randomUUID();
  const physicalId = 'android:' + createHash('sha256').update(JSON.stringify([hardware, 'fixture', 'fixture-device'])).digest('hex');
  const props = value => '[ro.serialno]: [' + value + ']\n[ro.boot.serialno]: [' + value + ']\n[ro.product.manufacturer]: [fixture]\n[ro.product.model]: [fixture-device]';
  const controller = new AbortController(), budget = new AgentBudget(), events = [], adb = [], rpc = [], proofs = [], grants = [];
  const state = { opened: 0, released: 0, reads: 0, resolver: 0, catalog: 0, foreign: false, caps: undefined, sessionId: undefined };
  let executor, session;
  const run = async args => {
    adb.push(args);
    if (args[0] === 'forward' && args[1] === '--list') return { stdout: '', stderr: '' };
    assert.deepEqual(args.slice(0, 2), ['-s', serial]);
    if (args[2] === 'get-state') return { stdout: 'device', stderr: '' };
    if (args[3] === 'getprop') return { stdout: props(state.foreign ? 'FOREIGN-HARDWARE' : hardware), stderr: '' };
    if (args.includes('policy')) return { stdout: options.locked ? 'mIsShowing=true\nscreenState=SCREEN_STATE_OFF' : 'mIsShowing=false\nscreenState=SCREEN_STATE_ON', stderr: '' };
    let stdout;
    if (args.includes('dumpsys') && args.includes('battery')) stdout = options.ambiguous ? 'level: 68\nlevel: 67' : 'level: 68';
    else if (args.includes('/sys/class/power_supply/battery/capacity')) stdout = options.unavailable ? 'permission denied' : options.disagree ? '67' : '68';
    else if (args.includes('wifi_on')) stdout = '1';
    else if (args.includes('wifi') && args.includes('status')) stdout = options.unavailable ? 'permission denied' : options.ambiguous ? 'Wifi is enabled\nWifi is disabled' : options.disagree ? 'Wifi is disabled' : 'Wifi is enabled';
    else throw Error('Unexpected ADB operation in app-free read: ' + args.join(' '));
    state.reads++;
    options.afterRead?.(state.reads, { state, session, controller });
    return { stdout, stderr: options.stderr ? 'read failed' : '' };
  };
  const client = new AppiumClient('http://offline.invalid', async (url, init) => {
    const endpoint = new URL(url).pathname; rpc.push([init.method, endpoint]);
    let value = null;
    if (init.method === 'POST' && endpoint === '/session') {
      state.opened++; state.caps = JSON.parse(init.body).capabilities.alwaysMatch;
      state.sessionId = 'session-' + randomUUID(); value = { sessionId: state.sessionId };
    } else if (endpoint.endsWith('/appium/capabilities')) value = { 'appium:udid': options.foreignSession && state.opened && executor ? 'OTHER' : serial };
    else if (!(endpoint.endsWith('/timeouts') || endpoint.endsWith('/appium/settings') || init.method === 'DELETE')) throw Error('Unexpected Appium operation: ' + endpoint);
    return Response.json({ value });
  });
  const adapter = {
    catalog: { resolve: async () => { state.catalog++; throw Error('Unexpected app catalog lookup'); } },
    readiness: async () => 'READY',
    ...(options.resolver ? { resolveIntentApp: async () => { state.resolver++; throw Error('Unexpected intent handler lookup'); } } : {}),
    open: async apps => {
      assert.deepEqual(apps, []);
      assert.deepEqual(budget.runtimeIdentity, { executionId, deviceId: serial, physicalId });
      session = new ManagedAppiumSession(client, serial, run, async () => {}, async () => ({
        systemPort: 8200, chromedriverPort: 9200, mjpegServerPort: 10200, release: async () => { state.released++; },
      }), budget.runtimeIdentity.physicalId);
      await session.open(controller.signal);
      executor = new ConditionExecutor(session, run);
      if (options.foreignDevice) state.foreign = true;
      return {
        backend: 'appium', sessionId: () => session.sessionId,
        intentV2: async (...args) => {
          assert.equal(args[4], undefined); grants.push(args);
          const proof = await executor.intentV2(...args); proofs.push(proof);
          if (options.replay) await assert.rejects(executor.intentV2(...args), /never replayed/);
          return proof;
        },
        close: async () => { executor.dispose(); await session.close(); },
      };
    },
  };
  async function execute(prepared = false) {
    const plan = prepared ? await prepareV2(source, serial, adapter, budget, controller.signal) : undefined;
    assert.equal(state.opened, 0);
    try {
      await runAgentV2(source, serial, executionId, physicalId, budget, adapter, event => {
        events.push(event);
        if (event.v2?.assistance) assert.equal(submitAssistanceV2({ token: event.v2.assistance.token,
          deviceId: serial, executionId, approved: true, choice: event.v2.assistance.choices[0].id }), true);
      }, controller.signal, noAI, undefined, plan);
      return events.at(-1);
    } finally {
      state.foreign = false;
      if (session?.sessionId) await session.close();
    }
  }
  return { execute, state, adb, rpc, proofs, grants, serial, executionId, physicalId };
}

for (const source of [battery, wifi]) for (const resolver of [false, true]) for (const prepared of [false, true])
  test('OFFLINE full READ_STATE execution uses production Session and independent readback, resolver=' + resolver + ', prepared=' + prepared + ': ' + source, async () => {
    const f = fixture(source, { resolver, replay: true }), result = await f.execute(prepared);
    assert.equal(result.status, 'COMPLETED', result.reason); assert.equal(result.verifiedSubgoals, 1);
    assert.equal(result.v2.completion, 'ALL_VERIFIED'); assert.equal(f.state.reads, 2);
    assert.equal(f.state.opened, 1); assert.equal(f.state.released, 1);
    assert.equal(f.state.resolver, 0); assert.equal(f.state.catalog, 0);
    assert.equal(f.state.caps['appium:udid'], f.serial); assert.equal(f.state.caps['appium:autoLaunch'], false);
    assert.equal(f.state.caps['appium:appPackage'], undefined);
    const proof = f.proofs[0]; assert.equal(isIntentEvidence(proof), true); assert.equal(isIntentEvidence({ ...proof }), false);
    assert.equal(proof.sessionId, f.state.sessionId); assert.equal(proof.deviceId, f.serial); assert.equal(proof.executionId, f.executionId);
    assert.equal(proof.evidenceClass, 'INDEPENDENT_STATE_READBACK'); assert.equal(proof.value, source === battery ? '68' : '1');
    assert.equal(result.v2.graph.nodes[0].packageName, undefined);
    assert.equal(f.adb.some(args => args.includes('resolve-activity') || args.includes('start') || args.includes('put') || args.includes('input')), false);
    assert.ok(f.rpc.filter(([method, endpoint]) => method === 'GET' && endpoint.endsWith('/appium/capabilities')).length >= 2);
    assert.deepEqual(f.rpc.filter(([method]) => method === 'DELETE'), [['DELETE', '/session/' + f.state.sessionId]]);
  });

test('OFFLINE two READ_STATE goals share the original Appium Session and verify every source clause', async () => {
  const f = fixture(battery + ' roi ' + wifi, { resolver: true }), result = await f.execute(true);
  assert.equal(result.status, 'COMPLETED', result.reason); assert.equal(result.verifiedSubgoals, 2);
  assert.equal(f.state.reads, 4); assert.equal(f.state.opened, 1); assert.equal(f.state.released, 1);
  assert.deepEqual(f.proofs.map(p => p.value), ['68', '1']);
  assert.ok(f.proofs.every(p => isIntentEvidence(p) && p.sessionId === f.state.sessionId));
});

for (const source of [battery, wifi]) for (const option of ['disagree', 'unavailable', 'stderr', 'ambiguous'])
  test('OFFLINE full READ_STATE cannot complete on ' + option + ': ' + source, async () => {
    const f = fixture(source, { [option]: true }), result = await f.execute();
    assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /independent state paths/);
    assert.equal(result.verifiedSubgoals, 0); assert.equal(f.proofs.length, 0); assert.equal(f.state.released, 1);
  });

for (const option of ['locked', 'foreignDevice', 'foreignSession'])
  test('OFFLINE production Session rejects ' + option + ' before READ_STATE dispatch', async () => {
    const f = fixture(battery, { [option]: true }), result = await f.execute();
    assert.notEqual(result.status, 'COMPLETED'); assert.equal(result.verifiedSubgoals, 0);
    assert.equal(f.state.reads, 0); assert.equal(f.proofs.length, 0); assert.equal(f.state.released, 1);
  });

test('OFFLINE cancellation between independent reads produces no evidence and closes the same Session', async () => {
  const f = fixture(battery, { afterRead: (count, { controller }) => { if (count === 1) controller.abort(); } });
  const result = await f.execute();
  assert.equal(result.status, 'CANCELLED'); assert.equal(f.state.reads, 1); assert.equal(f.proofs.length, 0); assert.equal(f.state.released, 1);
});

for (const expireAfter of [1, 2]) test('OFFLINE readback exceeding the five-second grant cannot mint fresh evidence after read ' + expireAfter, async () => {
  const now = Date.now; let offset = 0;
  Date.now = () => now() + offset;
  try {
    const f = fixture(battery, { afterRead: count => { if (count === expireAfter) offset = 6000; } }), result = await f.execute();
    assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /readback is stale/);
    assert.equal(f.state.reads, expireAfter); assert.equal(f.proofs.length, 0); assert.equal(f.state.released, 1);
  } finally { Date.now = now; }
});

test('OFFLINE changed physical identity after the read pair cannot produce evidence', async () => {
  const f = fixture(wifi, { afterRead: (count, { state }) => { if (count === 2) state.foreign = true; } }), result = await f.execute();
  assert.notEqual(result.status, 'COMPLETED'); assert.equal(f.state.reads, 2); assert.equal(f.proofs.length, 0); assert.equal(f.state.released, 1);
});

test('OFFLINE absent package still blocks non-read intents before effects', async () => {
  const source = 'open app org.example.app', outcome = compileOutcomes(source, 'A', 'E').nodes[0].outcome;
  const binding = { request: { name: 'OPEN_APP', args: { packageName: 'org.example.app' } }, slots: { packageName: 1 } };
  const { matchIntentSource } = require('../lib/android/agent/intent-capabilities.ts');
  const exact = matchIntentSource(source, outcome.span.start, outcome.span.end);
  assert.deepEqual(exact.request, binding.request);
  const session = { serial: 'A', sessionId: 'S', ensureActive: async () => {}, assertPhysicalIdentity: async () => {} }, calls = [];
  const run = async args => { calls.push(args); assert.ok(args.includes('resolve-activity')); return { stdout: 'org.example.app/.Main', stderr: '' }; };
  await assert.rejects(executeIntentCapability(session, {}, run, approveIntentSource(source, 'A', 'E', 'P'), exact, outcome.span, 'E', undefined), /resolved handler changed/);
  assert.equal(calls.length, 1);
});
