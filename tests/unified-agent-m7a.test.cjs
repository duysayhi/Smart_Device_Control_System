/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => {
  const original = m.require.bind(m); m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { UnifiedAgentService, actionPlanCompletion } = require('../lib/android/unified-agent/service.ts');
const { UnifiedCommand, PreparedCommand } = require('../lib/android/unified-agent/contracts.ts');
const { routeCapability, legacyRecipe } = require('../lib/android/unified-agent/capability-router.ts');
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const { buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { InternalLegacyUnifiedService, internalLegacyTest, internalLegacyFixture } = require('./helpers/internal-legacy-unified-service.cjs');
const tick = () => new Promise(r => setImmediate(r));
const source = 'Mở Chrome và tìm công thức nấu phở';
function fake(extra = {}) {
  let now = Date.now(), dispatches = 0, preparations = 0, cancellations = 0;
  const context = { deviceId: 'A', physicalId: 'physical-A', backend: 'appium', runtimeHash: 'h1', policyMode: 'normal', busy: false };
  const tasks = [], plan = legacyRecipe(source), prepared = new Map();
  const adapters = {
    context: async () => ({ ...context }),
    interpret: async () => ({ actionPlan: plan, authorizationToken: randomUUID() }),
    prepare: async (request, deviceId, engine) => { preparations++; const reference = randomUUID(); prepared.set(reference, { request, deviceId, engine }); return { reference, expiresAt: now + 90000, summary: request, steps: [request], confirmations: ['Original policy remains enforced'] }; },
    start: async ref => { dispatches++; const row = prepared.get(ref); const task = { executionId: randomUUID(), batchId: ref, request: row.request, deviceId: row.deviceId, physicalId: context.physicalId, agentVersion: 2, createdAt: now, status: 'RUNNING', events: [] }; tasks.push(task); return task; },
    tasks: async () => tasks,
    cancel: async () => { cancellations++; },
    legacy: async () => {
      dispatches++;
      const steps = plan.actions.map((action, index) => ({ index, action, status: 'SUCCESS', verification: 'VERIFIED' }));
      return new Response(JSON.stringify({ type: 'complete', success: true, status: 'SUCCESS', steps }) + '\n');
    }, ...extra,
  };
  const Service = internalLegacyFixture() ? InternalLegacyUnifiedService : UnifiedAgentService;
  return { service: new Service(adapters, () => now), context, tasks, plan, adapters, advance: ms => { now += ms; }, counts: () => ({ dispatches, preparations, cancellations }) };
}
const input = (request = internalLegacyFixture() ? source : 'Mở YouTube', debugEngine) => ({ source: request, deviceId: 'A', ...(debugEngine ? { debugEngine } : {}) });

for (const [request, engine] of [
  ['Mở Chrome và tìm công thức nấu phở', null], ['Mở wifi', null], ['tắt wifi', null],
  ['mở cài đặt wifi và bật wifi', null], ['kết nối wifi tên oreo', null],
  ['Mở YouTube, tìm OpenAI và phát video thứ 4', null], ['Mở settings và xem RAM', null],
  ['Mở Camera và chụp 1 tấm ảnh', 'V2'], ['Đặt báo thức 7 giờ sáng', 'V2'], ['Hẹn giờ 10 phút', 'V2'],
  ['open settings android.settings.SETTINGS; read battery', 'V2'], ['Mở Drive và tìm báo cáo thực tập', 'V2'],
]) test('OFFLINE catalog routing: ' + request, () => {
  if (engine) assert.equal(routeCapability(request, 'appium').engine, engine);
  else assert.throws(() => routeCapability(request, 'appium'), /CAPABILITY_DISABLED|UNSUPPORTED_OUTCOME|NEEDS_CLARIFICATION|UNSUPPORTED_PHRASING/);
});

for (const request of ['Mở Camera và xóa mọi ảnh', 'Open Chrome then uninstall YouTube', 'Mở settings rồi factory reset'])
  test('OFFLINE mixed destructive source denied before every engine: ' + request, () => {
    for (const engine of [undefined, 'ACTION_PLAN', 'V1', 'V2']) assert.throws(() => routeCapability(request, 'appium', engine));
  });
test('OFFLINE unsupported debug engine and non-Appium V2 never fall back', () => {
  assert.throws(() => routeCapability('Chụp 1 tấm ảnh', 'appium', 'ACTION_PLAN'), /ENGINE_SELECTION_REMOVED/);
  assert.throws(() => routeCapability('Hẹn giờ 10 phút', 'adb'), /Appium/);
  assert.equal(legacyRecipe('kết nối wifi oreo và chụp ảnh'), undefined);
});
test('OFFLINE strict execute contract cannot accept source/plan/engine/grants', () => {
  const reference = randomUUID();
  for (const extra of [{ engine: 'V1' }, { source: 'other' }, { actionPlan: {} }, { ownerAuthorizedTest: true }]) assert.equal(UnifiedCommand.safeParse({ type: 'EXECUTE', reference, ...extra }).success, false);
  assert.equal(PreparedCommand.safeParse({ type: 'START_PREPARED', reference, source: 'new' }).success, false);
});
test('OFFLINE analyze is read-only, natural-language view contains no authorization or client plan', async () => {
  const f = fake(), view = await f.service.analyze(input());
  assert.ok(view.reference); assert.ok(view.steps[0].startsWith('Mở')); assert.equal(view.actionPlan, undefined); assert.equal(view.authorizationToken, undefined);
  assert.equal(f.counts().dispatches, 0);
});
internalLegacyTest('OFFLINE replay and simultaneous execute dispatch exactly once', async () => {
  const f = fake(), p = await f.service.analyze(input());
  const results = await Promise.allSettled([f.service.execute(p.reference), f.service.execute(p.reference)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); await tick(); assert.equal(f.counts().dispatches, 1);
  assert.equal((await f.service.list())[0].status, 'COMPLETED');
});
for (const [field, value] of [['physicalId', 'B'], ['backend', 'adb'], ['runtimeHash', 'h2'], ['policyMode', 'development'], ['ownerId', randomUUID()], ['busy', true]])
  test('OFFLINE execute rejects changed binding: ' + field, async () => {
    const f = fake(), p = await f.service.analyze(input()); f.context[field] = value;
    await assert.rejects(f.service.execute(p.reference)); assert.equal(f.counts().dispatches, 0);
  });
test('OFFLINE expiry and restart require analysis again with zero effects', async () => {
  const f = fake(), p = await f.service.analyze(input()); f.advance(90000);
  await assert.rejects(f.service.execute(p.reference), /expired/);
  await assert.rejects(new UnifiedAgentService(f.adapters).execute(p.reference), /unavailable/); assert.equal(f.counts().dispatches, 0);
});
internalLegacyTest('OFFLINE tampered interpreter recipe cannot obtain a reference', async () => {
  const f = fake({ interpret: async () => ({ actionPlan: { intent: 'search', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'chrome' }] }, authorizationToken: randomUUID() }) });
  await assert.rejects(f.service.analyze(input()), /recipe/); assert.equal(f.counts().dispatches, 0);
});
test('OFFLINE removed engine selection cannot authorize appended navigation', async () => {
  for (const extra of [{ type: 'PRESS_KEY', key: 'HOME' }, { type: 'OPEN_APP', app: 'camera' }]) {
    const f = fake({ interpret: async () => ({ actionPlan: { intent: 'open', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'youtube' }, extra] }, authorizationToken: randomUUID() }) });
    await assert.rejects(f.service.analyze(input('Mở YouTube', 'ACTION_PLAN')), /extra effects|scope/); assert.equal(f.counts().dispatches, 0);
  }
});
test('OFFLINE removed debug Action Plan cannot obtain an ordinal plan', async () => {
  const request = 'Mở YouTube, tìm OpenAI và phát video thứ 4';
  const actionPlan = { intent: 'search', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'youtube' }, { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 20000 }, { type: 'CLICK', target: 'search_button' }, { type: 'INPUT_TEXT', text: 'OpenAI' }, { type: 'PRESS_KEY', key: 'ENTER' }, { type: 'WAIT_FOR', target: 'video_card_4', timeoutMs: 20000 }, { type: 'CLICK', target: 'video_card_4' }] };
  const f = fake({ interpret: async () => ({ actionPlan, authorizationToken: randomUUID() }) });
  await assert.rejects(f.service.analyze(input(request, 'ACTION_PLAN')), /ENGINE_SELECTION_REMOVED/); assert.equal(f.counts().dispatches, 0);
});
test('OFFLINE unknown V2 coverage returns no executable plan and no alternate engine', async () => {
  const f = fake({ prepare: async () => { throw Error('NEEDS_CLARIFICATION: AM_PM_REQUIRED'); } });
  await assert.rejects(f.service.analyze(input('Đặt báo thức 3:30')), /AM_PM/); assert.equal(f.counts().dispatches, 0);
});
test('OFFLINE SENT, missing verification and failed postconditions cannot become COMPLETED', () => {
  const action = { type: 'OPEN_APP', app: 'chrome' }, step = { index: 0, action, status: 'SUCCESS', verification: 'VERIFIED' };
  assert.equal(actionPlanCompletion({ type: 'complete', success: true, status: 'SUCCESS', steps: [step] }), 'COMPLETED');
  assert.notEqual(actionPlanCompletion({ type: 'complete', success: true, status: 'SUCCESS', steps: [{ ...step, verification: 'DISPATCHED' }] }), 'COMPLETED');
  assert.equal(actionPlanCompletion({ type: 'complete', success: false, status: 'SENT', steps: [{ ...step, status: 'SENT' }] }), 'SENT');
  assert.equal(actionPlanCompletion({ type: 'complete', success: false, status: 'FAILED', steps: [{ ...step, status: 'FAILED' }] }), 'FAILED');
  assert.equal(actionPlanCompletion({ type: 'complete', success: false, status: 'FAILED', steps: [{ ...step, status: 'SENT' }] }), 'FAILED');
});
test('OFFLINE V2 raw assistance, verifier evidence and status survive facade; cancel stays native', async () => {
  const f = fake(), p = await f.service.analyze(input('Mở Camera và chụp 1 tấm ảnh')), e = await f.service.execute(p.reference); await tick();
  f.tasks[0].status = 'WAITING_HUMAN'; f.tasks[0].latest = { v2: { assistance: { token: 'original', category: 'EFFECT_CONFIRMATION' } } };
  let current = (await f.service.list())[0]; assert.equal(current.status, 'WAITING_HUMAN'); assert.equal(current.task.latest.v2.assistance.token, 'original');
  await f.service.cancel(e.id); assert.equal(f.counts().cancellations, 1); assert.equal((await f.service.list())[0].status, 'WAITING_HUMAN');
  f.tasks[0].status = 'CANCELLED'; f.tasks[0].finishedAt = Date.now(); current = (await f.service.list())[0]; assert.equal(current.status, 'CANCELLED');
});
test('OFFLINE lost worker response reconciles same execution and cancellation without START replay', async () => {
  const f = fake(); const original = f.adapters.start;
  f.adapters.start = async ref => { await original(ref); throw Error('Response lost'); };
  const p = await f.service.analyze(input('Mở Camera và chụp 1 tấm ảnh')), e = await f.service.execute(p.reference); await tick();
  await f.service.cancel(e.id); const current = (await f.service.list())[0];
  assert.equal(current.workerExecutionId, f.tasks[0].executionId); assert.equal(f.counts().dispatches, 1); assert.ok(f.counts().cancellations >= 1);
});
test('OFFLINE explicit worker admission rejection is NOT_SENT and does not become an endless unknown execution', async () => {
  const { UnifiedNotSentError } = require('../lib/android/unified-agent/service.ts');
  const f = fake({ start: async () => { throw new UnifiedNotSentError('Expired worker reference; no task scheduled.'); } });
  const p = await f.service.analyze(input('Mở Camera và chụp 1 tấm ảnh')); await f.service.execute(p.reference); await tick();
  const e = (await f.service.list())[0]; assert.equal(e.status, 'BLOCKED'); assert.ok(e.finishedAt); assert.equal(f.counts().dispatches, 0);
});
internalLegacyTest('OFFLINE only explicit pre-dispatch Wi-Fi challenge can retry same stored plan', async () => {
  let calls = 0, authorized = 0;
  const wifi = legacyRecipe('tắt wifi');
  const f = fake({ interpret: async () => ({ actionPlan: wifi, authorizationToken: 'private-token' }), legacy: async (_plan, _source, _device, token, _signal, confirmation) => {
    calls++; assert.equal(token, 'private-token');
    if (!confirmation) return Response.json({ confirmationRequired: true, confirmationToken: 'private-confirmation', error: 'Connectivity change' }, { status: 409 });
    assert.equal(confirmation, 'private-confirmation'); authorized++;
    return new Response(JSON.stringify({ type: 'complete', success: false, status: 'SENT', steps: [{ index: 0, action: wifi.actions[0], status: 'SENT', verification: 'DISPATCHED' }] }) + '\n');
  } });
  const p = await f.service.analyze(input('tắt wifi')), e = await f.service.execute(p.reference); await tick();
  assert.equal((await f.service.list())[0].status, 'WAITING_CONFIRMATION'); assert.equal(authorized, 0);
  await f.service.confirm(e.id); await tick(); assert.equal(calls, 2); assert.equal(authorized, 1); assert.equal((await f.service.list())[0].status, 'SENT');
  await assert.rejects(f.service.confirm(e.id));
});
internalLegacyTest('OFFLINE cancellation of legacy execution aborts original signal and retains final evidence', async () => {
  let observedSignal;
  const f = fake({ legacy: async (_p, _s, _d, _t, signal) => {
    observedSignal = signal;
    return new Response(new ReadableStream({ start(controller) { signal.addEventListener('abort', () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'complete', success: false, status: 'FAILED', error: 'CANCELLED', steps: [] }) + '\n')); controller.close(); }, { once: true }); } }));
  } });
  const p = await f.service.analyze(input()), e = await f.service.execute(p.reference); await tick(); await f.service.cancel(e.id); await tick();
  assert.equal(observedSignal.aborted, true); const current = (await f.service.list())[0]; assert.equal(current.rawStatus, 'FAILED'); assert.equal(current.reason, 'CANCELLED');
});
test('OFFLINE worker prepares V1 once, no Session in analyze, single-use prepared goal', async () => {
  let plans = 0, opens = 0;
  const devices = [{ serial: 'A', status: 'device', physicalId: 'physical-A', identityVerified: true, connectionType: 'USB' }];
  const registry = new DeviceRuntimeRegistry({ discover: async () => devices, plan: async (source, budget) => { plans++; return buildGoal(source, { app: 'youtube', operation: 'OPEN_APP', isSensitive: false }, budget); },
    open: async goal => { opens++; return { backend: 'appium', discoveryMemory: () => ({}), observe: async () => ({ deviceSerial: 'A', snapshotId: randomUUID(), timestamp: Date.now(), foregroundPackage: goal.packageName, observationStatus: 'OBSERVED', source: 'APPIUM', nodes: [], elements: [], viewport: { x: 0, y: 0, width: 400, height: 800 } }), execute: async () => { throw Error('Already foreground'); }, close: async () => {} }; } });
  const p = await registry.prepare('Mở YouTube', 'A', 'V1'); assert.equal(opens, 0);
  const [task] = await registry.startPrepared(p.reference); await registry.settled(task.executionId);
  assert.equal(plans, 1); assert.equal(opens, 1); assert.equal(registry.list()[0].status, 'COMPLETED'); await assert.rejects(registry.startPrepared(p.reference));
});
test('OFFLINE worker rejects prepared goal after owner scope changes without opening Session', async () => {
  let opens = 0;
  const registry = new DeviceRuntimeRegistry({ discover: async () => [{ serial: 'A', status: 'device', physicalId: 'P', identityVerified: true }], plan: async (source, budget) => buildGoal(source, { app: 'youtube', operation: 'OPEN_APP', isSensitive: false }, budget), open: async () => { opens++; throw Error('No'); } });
  const p = await registry.prepare('Mở YouTube', 'A', 'V1');
  await registry.setOwnerTestMode({ type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'P', enabled: true });
  await assert.rejects(registry.startPrepared(p.reference), /binding/); assert.equal(opens, 0);
  const mode = registry.ownerTestModes()[0]; await registry.setOwnerTestMode({ type: 'SET_OWNER_TEST_MODE', deviceId: 'A', physicalId: 'P', enabled: false, authorizationId: mode.id });
});
for (const request of ['Đặt báo thức 7 giờ sáng', 'Hẹn giờ 10 phút', 'Mở Camera và chụp 1 tấm ảnh', 'Mở máy tính và tính 125 * 48'])
  test('OFFLINE V2 typed capability/compiler parity: ' + request, () => assert.equal(compileOutcomes(request, 'A', 'E').coverage, 'COMPLETE'));
test('OFFLINE old API request schemas remain compatible and enforce original authorization', async () => {
  const { POST: execute } = require('../app/api/executions/route.ts'), { POST: interpret } = require('../app/api/commands/interpret/route.ts');
  const req = body => new Request('http://localhost:3000/api/test', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await execute(req({ deviceId: 'A', actionPlan: legacyRecipe(source), originalRequest: source }))).status, 400);
  assert.equal((await interpret(req({ prompt: '' }))).status, 400);
  assert.equal((await execute(new Request('http://localhost:3000', { method: 'POST' }))).status, 403);
});
test('OFFLINE Dashboard default has one command input without engine tabs', () => {
  const { renderToStaticMarkup } = require('react-dom/server'), React = require('react');
  const { UnifiedAgentPanel } = require('../components/commands/UnifiedAgentPanel.tsx');
  const html = renderToStaticMarkup(React.createElement(UnifiedAgentPanel, { text: '', onText() {}, serial: '', onSerial() {}, onRefresh() {}, devices: [], selectedDeviceIds: [], runtime: { tasks: [], ownerTestModes: [], command: async () => {} } }));
  assert.equal((html.match(/<textarea/g) || []).length, 1); assert.equal((html.match(/role="tab"/g) || []).length, 0);
  assert.doesNotMatch(html, /id="command-tab-plan"/); assert.doesNotMatch(html, /id="command-tab-goal"/);
  assert.match(html, /Phân tích/); assert.match(html, /Thực thi/); assert.match(html, /Dừng/);
});

test('OFFLINE unified assistance is bound to original engine, physical device and waiting execution', async () => {
  let forwarded = 0;
  const f = fake({ assist: async () => { forwarded++; } }), p = await f.service.analyze(input('Mở Camera và chụp 1 tấm ảnh')), e = await f.service.execute(p.reference); await tick();
  const reply = { kind: 'V2', token: randomUUID(), approved: true, choice: 'accept' };
  await assert.rejects(f.service.assist(e.id, reply), /pending/);
  f.tasks[0].status = 'WAITING_HUMAN'; await f.service.assist(e.id, reply); assert.equal(forwarded, 1);
  await assert.rejects(f.service.assist(e.id, { kind: 'V1', token: randomUUID(), evidenceId: randomUUID(), confirmed: true, x: 1, y: 1 }), /mismatch/);
  f.tasks[0].physicalId = 'foreign'; await assert.rejects(f.service.assist(e.id, reply), /pending/);
  assert.equal(forwarded, 1);
});
internalLegacyTest('OFFLINE physical-device isolation prevents two facade executions during legacy setup', async () => {
  let release;
  const f = fake({ legacy: async () => new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ type: 'complete', success: false, status: 'FAILED', steps: [] }) + '\n')); }) });
  const p1 = await f.service.analyze(input()), p2 = await f.service.analyze(input());
  await f.service.execute(p1.reference); await assert.rejects(f.service.execute(p2.reference), /check failed/);
  release(); await tick();
});
function v2Simulation(options = {}) {
  let opens = 0, closes = 0, effects = 0;
  const pkg = 'net.unprofiled.viewer';
  const nodes = [{ text: 'Viewer', description: '', packageName: pkg, resourceId: '', className: 'android.widget.TextView', enabled: true, displayed: true, clickable: false, focused: false, bounds: [10, 20, 390, 100] }];
  const adapter = { catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg, requestedName: pkg }, choices: [] }), select: async () => { throw Error('Ambiguous'); } },
    open: async () => { opens++; return { backend: 'appium', sessionId: () => 'S', observe: async () => ({ deviceSerial: options.foreign ? 'B' : 'A', snapshotId: randomUUID(), timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', nodes, elements: nodes.map((n, i) => ({ ...n, elementId: 'S:' + i })), viewport: { x: 0, y: 0, width: 400, height: 800 } }), execute: async () => { effects++; }, interactV2: async () => { throw Error('No arbitrary click'); }, close: async () => { closes++; } }; } };
  return { adapter, pkg, counts: () => ({ opens, closes, effects }) };
}
test('OFFLINE V2 prepare/execute preserves complete graph and independently verifies; no extra planner call', async () => {
  const f = v2Simulation(), registry = new DeviceRuntimeRegistry({ discover: async () => [{ serial: 'A', status: 'device', physicalId: 'P', identityVerified: true }], v2: () => f.adapter, plan: async () => { throw Error('No V1 fallback'); }, open: async () => { throw Error('No V1 fallback'); } });
  const p = await registry.prepare('Mở ' + f.pkg, 'A', 'V2'); assert.equal(f.counts().opens, 0);
  const [task] = await registry.startPrepared(p.reference); await registry.settled(task.executionId);
  const result = registry.list()[0]; assert.equal(result.status, 'COMPLETED', result.latest.reason); assert.ok(result.latest.v2.graph.nodes.every(n => n.evidenceIds.length));
  assert.deepEqual(f.counts(), { opens: 1, closes: 1, effects: 0 });
});
test('OFFLINE prepared V2 never bypasses fresh observation or invents completion on a foreign device', async () => {
  const f = v2Simulation({ foreign: true }), { runAgentV2 } = require('../lib/android/agent/agent-v2.ts'), { AgentBudget } = require('../lib/android/agent/budget.ts');
  const request = 'Mở ' + f.pkg, events = [], prepared = { graph: compileOutcomes(request, 'A', 'prepare'), review: false, summary: request };
  await runAgentV2(request, 'A', 'execute', 'P', new AgentBudget(), f.adapter, e => events.push(e), undefined, { generate() { throw Error('Unexpected model'); } }, undefined, prepared);
  assert.equal(events.at(-1).status, 'BLOCKED'); assert.equal(f.counts().effects, 0); assert.equal(f.counts().closes, 1);
});
test('OFFLINE prepared model interpretation still requires original V2 Human Assistance', async () => {
  const f = v2Simulation(), { runAgentV2 } = require('../lib/android/agent/agent-v2.ts'), { AgentBudget } = require('../lib/android/agent/budget.ts');
  const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
  const request = 'Mở ' + f.pkg, events = [], prepared = { graph: compileOutcomes(request, 'A', 'prepare'), review: true, summary: request }; let reviewed = 0;
  await runAgentV2(request, 'A', 'execute', 'P', new AgentBudget(), f.adapter, e => {
    events.push(e); if (e.v2?.assistance) { reviewed++; assert.equal(f.counts().opens, 0); assert.equal(e.v2.assistance.category, 'GOAL_INTERPRETATION'); submitAssistanceV2({ token: e.v2.assistance.token, executionId: 'execute', deviceId: 'A', approved: true, choice: 'accept' }); }
  }, undefined, { generate() { throw Error('Do not replan'); } }, undefined, prepared);
  assert.equal(reviewed, 1); assert.equal(events.at(-1).status, 'COMPLETED', events.at(-1).reason); assert.equal(events.at(-1).v2.analysis.source, 'MODEL_REVIEWED');
});
test('OFFLINE real loopback Worker /planning requires bearer, strict references and executes stored V1 goal', async () => {
  const { startWorker } = require('../lib/android/agent/worker-server.ts'), os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m7a-worker-')); let opens = 0;
  const worker = await startWorker({ directory, adapter: { discover: async () => [{ serial: 'A', status: 'device', physicalId: 'P', identityVerified: true }],
    plan: async (request, budget) => buildGoal(request, { app: 'youtube', operation: 'OPEN_APP', isSensitive: false }, budget),
    open: async goal => { opens++; return { backend: 'appium', discoveryMemory: () => ({}), observe: async () => ({ deviceSerial: 'A', snapshotId: randomUUID(), timestamp: Date.now(), foregroundPackage: goal.packageName, observationStatus: 'OBSERVED', source: 'APPIUM', nodes: [], elements: [], viewport: { x: 0, y: 0, width: 400, height: 800 } }), execute: async () => {}, close: async () => {} }; } } });
  try {
    const address = JSON.parse(fs.readFileSync(path.join(directory, 'address.json'), 'utf8')), url = 'http://127.0.0.1:' + address.port + '/planning';
    const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + address.token, ...headers }, body: JSON.stringify(body) });
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await post({ type: 'PREPARE', source: 'Mở YouTube', deviceId: 'A', engine: 'V1' }, { Origin: 'http://localhost:3000' })).status, 403);
    const response = await post({ type: 'PREPARE', source: 'Mở YouTube', deviceId: 'A', engine: 'V1' }); assert.equal(response.status, 200);
    const p = await response.json(); assert.equal(opens, 0);
    assert.equal((await post({ type: 'START_PREPARED', reference: p.reference, engine: 'V2' })).status, 409);
    const started = await post({ type: 'START_PREPARED', reference: p.reference }); assert.equal(started.status, 200);
    const { tasks } = await started.json(); await worker.registry.settled(tasks[0].executionId);
    assert.equal(worker.registry.list()[0].status, 'COMPLETED'); assert.equal(opens, 1);
    assert.equal((await post({ type: 'START_PREPARED', reference: p.reference })).status, 409);
  } finally { await worker.shutdown(); }
});
