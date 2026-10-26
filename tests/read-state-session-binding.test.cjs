/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => {
  const original = m.require.bind(m);
  m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { androidV2Adapter, runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { assertIntentApproval, approveIntentSource } = require('../lib/android/agent/intent-capabilities.ts');
const { executeIntentCapability, isIntentEvidence } = require('../lib/android/agent/intent-executor.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const noAI = { generate() { throw Error('Unexpected model call'); } };
const battery = 'Cho m\u00ecnh xem pin c\u00f2n bao nhi\u00eau';
const wifi = 'Cho m\u00ecnh bi\u1ebft Wi-Fi \u0111ang b\u1eadt hay t\u1eaft';

test('OFFLINE Android READ_STATE adapter performs no handler resolution or ADB discovery', async () => {
  const budget = new AgentBudget(), adapter = androidV2Adapter('A', budget);
  for (const state of ['battery', 'wifi'])
    assert.equal(await adapter.resolveIntentApp({ name: 'READ_STATE', args: { state } }), undefined);
  assert.equal(budget.profiling.adbCount, 0);
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(adapter.resolveIntentApp({ name: 'READ_STATE', args: { state: 'battery' } }, cancel.signal));
  assert.equal(budget.profiling.adbCount, 0);
});

function bindingFixture(source, options = {}) {
  const calls = { resolve: 0, catalog: 0, open: 0, close: 0, intent: 0, readiness: 0 }, events = [], budget = new AgentBudget();
  const adapter = {
    catalog: { resolve: async () => { calls.catalog++; throw Error('Unexpected catalog lookup'); } },
    readiness: async () => { calls.readiness++; return options.readiness ?? 'READY'; },
    ...(options.resolver ? { resolveIntentApp: async () => { calls.resolve++; throw Error('Unexpected READ_STATE handler lookup'); } } : {}),
    open: async apps => {
      calls.open++; assert.deepEqual(apps, []); options.onOpen?.();
      return {
        backend: options.backend ?? 'appium', sessionId: () => options.noSession ? undefined : 'S',
        close: async () => { calls.close++; },
        intentV2: async (approval, binding, span, executionId, packageName) => {
          calls.intent++;
          assert.equal(packageName, undefined); assert.equal(binding.request.name, 'READ_STATE');
          assert.equal(approval.physicalId, 'P'); assert.equal(approval.source, source);
          assertIntentApproval(approval, 'A', executionId, span, binding);
          if (options.proof) return options.proof;
          throw Error('TEST_BINDING_REACHED: no read dispatched by this binding-only fixture.');
        },
      };
    },
  };
  async function run(prepared = false, scope) {
    const plan = prepared ? { graph: compileOutcomes(source, 'A', 'prepare'), review: false, summary: source } : undefined;
    await runAgentV2(source, 'A', 'E', 'P', budget, adapter, event => {
      events.push(event);
      if (event.v2?.assistance) assert.equal(submitAssistanceV2({ token: event.v2.assistance.token,
        deviceId: 'A', executionId: 'E', approved: true, choice: event.v2.assistance.choices[0].id }), true);
    }, undefined, noAI, scope, plan);
    return events.at(-1);
  }
  return { run, calls, events };
}

for (const source of [battery, wifi]) for (const resolver of [false, true]) for (const prepared of [false, true])
  test('OFFLINE READ_STATE reaches source/device-bound executor with an owned Session and no app: ' + source + ', resolver=' + resolver + ', prepared=' + prepared, async () => {
    const f = bindingFixture(source, { resolver }), result = await f.run(prepared);
    assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /TEST_BINDING_REACHED/);
    assert.equal(result.v2.sessionId, 'S'); assert.equal(result.v2.graph.nodes[0].packageName, undefined);
    assert.deepEqual([f.calls.resolve, f.calls.catalog, f.calls.open, f.calls.intent, f.calls.close], [0, 0, 1, 1, 1]);
    assert.ok(f.calls.readiness >= 2);
  });

for (const options of [{ noSession: true }, { backend: 'adb' }])
  test('OFFLINE READ_STATE still requires an Appium Session: ' + JSON.stringify(options), async () => {
    const f = bindingFixture(battery, options), result = await f.run();
    assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /valid owned Appium Session/);
    assert.equal(f.calls.intent, 0); assert.equal(f.calls.close, 1);
  });

test('OFFLINE unknown device readiness blocks READ_STATE before Session creation', async () => {
  const f = bindingFixture(wifi, { readiness: 'UNKNOWN' }), result = await f.run();
  assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /DEVICE_READINESS_UNKNOWN/);
  assert.equal(f.calls.open, 0); assert.equal(f.calls.intent, 0);
});

test('OFFLINE a revoked owner device grant cannot reach READ_STATE dispatch', async () => {
  const policy = new OwnerTestPolicy(), mode = policy.enable('A', 'P'), scope = policy.bind('A', 'P', 'E');
  const f = bindingFixture(battery, { onOpen: () => policy.disable('A', mode.id) });
  try {
    const result = await f.run(false, scope);
    assert.notEqual(result.status, 'COMPLETED'); assert.equal(f.calls.intent, 0); assert.equal(f.calls.close, 1);
  } finally { policy.disable('A', mode.id); }
});

test('OFFLINE app-free READ_STATE rejects fabricated evidence and still closes its Session', async () => {
  const f = bindingFixture(battery, { proof: { id: 'invented', deviceId: 'A', executionId: 'E', sessionId: 'S',
    name: 'READ_STATE', evidenceClass: 'INDEPENDENT_STATE_READBACK', observedAt: Date.now(), value: '68' } });
  const result = await f.run();
  assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /unissued intent evidence/);
  assert.equal(result.verifiedSubgoals, 0); assert.equal(f.calls.close, 1);
});

test('OFFLINE unresolved mixed READ_STATE never invokes a model or opens a Session', async () => {
  const f = bindingFixture(battery + ' roi mo Tool va lam viec chua hieu'), result = await f.run();
  assert.equal(result.status, 'BLOCKED'); assert.match(result.reason, /UNSUPPORTED_OUTCOME|NEEDS_CLARIFICATION/);
  assert.equal(f.calls.open, 0); assert.equal(f.calls.intent, 0);
});

// Exercise the existing executor separately from binding. Its handler preflight
// remains parent-owned; all actual state reads and evidence checks run here.
function executorFixture(source, options = {}) {
  const outcome = compileOutcomes(source, 'A', 'E').nodes[0].outcome, calls = [], checks = { active: 0, physical: 0 };
  const session = {
    serial: 'A', sessionId: 'S',
    ensureActive: async () => { checks.active++; if (options.inactive) throw Error('Session inactive'); },
    assertPhysicalIdentity: async () => { checks.physical++; if (options.foreign) throw Error('Physical device mismatch'); },
  };
  const run = async args => {
    calls.push(args); assert.deepEqual(args.slice(0, 3), ['-s', 'A', 'shell']);
    if (args.includes('resolve-activity')) return { stdout: 'org.example.settings/.Settings' };
    if (args.includes('policy')) return { stdout: options.locked ? 'mIsShowing=true\nscreenState=SCREEN_STATE_OFF' : 'mIsShowing=false\nscreenState=SCREEN_STATE_ON' };
    if (args.includes('battery') && args.includes('dumpsys')) return { stdout: 'level: 68' };
    if (args.includes('/sys/class/power_supply/battery/capacity')) return { stdout: options.disagree ? '67' : '68' };
    if (args.includes('wifi_on')) return { stdout: '1' };
    if (args.includes('wifi') && args.includes('status')) return { stdout: options.disagree ? 'Wifi is disabled' : 'Wifi is enabled' };
    throw Error('Unexpected command: ' + args.join(' '));
  };
  const approval = approveIntentSource(source, 'A', 'E', 'P');
  const execute = () => executeIntentCapability(session, {}, run, approval, outcome.intent, outcome.span, 'E', 'org.example.settings');
  const reads = () => calls.filter(args => args.includes('battery') && args.includes('dumpsys') || args.includes('/sys/class/power_supply/battery/capacity') || args.includes('wifi_on') || args.includes('wifi') && args.includes('status'));
  return { execute, calls, checks, reads };
}

for (const [source, value] of [[battery, '68'], [wifi, '1']])
  test('OFFLINE existing READ_STATE requires two agreeing independent device reads: ' + source, async () => {
    const f = executorFixture(source), proof = await f.execute();
    assert.equal(isIntentEvidence(proof), true); assert.equal(proof.evidenceClass, 'INDEPENDENT_STATE_READBACK');
    assert.equal(proof.value, value); assert.equal(proof.deviceId, 'A'); assert.equal(proof.sessionId, 'S');
    assert.equal(f.reads().length, 2); assert.equal(f.checks.active, 1); assert.equal(f.checks.physical, 2);
    assert.equal(f.calls.some(args => args.includes('start') || args.includes('put') || args.includes('input')), false);
    await assert.rejects(f.execute(), /never replayed/); assert.equal(f.reads().length, 2);
    const disagreement = executorFixture(source, { disagree: true });
    await assert.rejects(disagreement.execute(), /independent state paths unavailable or disagree/);
  });

for (const options of [{ inactive: true }, { foreign: true }, { locked: true }])
  test('OFFLINE READ_STATE executor rejects inactive Session, foreign device or lock before state reads: ' + JSON.stringify(options), async () => {
    const f = executorFixture(battery, options); await assert.rejects(f.execute()); assert.equal(f.reads().length, 0);
  });
