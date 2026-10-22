/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates, revalidateGroundedCandidate } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant, revokeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { verifyPredicate } = require('../lib/android/agent/verification-registry.ts');
const { ArtifactStore } = require('../lib/android/agent/artifact-store.ts');
const { waitForAssistanceV2, submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const { RuntimeCommand } = require('../lib/android/agent/runtime-schema.ts');
const { arithmeticOracle } = require('../lib/android/agent/goal-compiler.ts');

function scene(device = 'A', pkg = 'org.sample.math', expression = '', result = '', alternative = false) {
  const rows = [
    { text: expression, resourceId: pkg + ':id/' + (alternative ? 'formula' : 'input'), className: 'android.widget.EditText', focused: true },
    ...['0', '1', '2', '+', '='].map(text => ({ text, clickable: true, className: 'android.widget.Button' })),
    { text: result || 'Ready', className: 'android.widget.TextView', resourceId: pkg + ':id/value' },
  ];
  const snapshotId = randomUUID(), nodes = rows.map((row, i) => ({ text: '', description: '', resourceId: '', enabled: true, displayed: true, focused: false, clickable: false, packageName: pkg,
    bounds: [10, 20 + i * 70, 380, 70 + i * 70], ...row }));
  return { deviceSerial: device, snapshotId, timestamp: Date.now(), foregroundPackage: pkg, activity: 'ObservedActivity', observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}
function fakeAdapter(device = 'A', options = {}) {
  let pkg = 'launcher', expression = '', result = '', closed = 0, opens = 0;
  const actions = [], events = [];
  const session = 'session-' + device;
  const adapter = { catalog: { async resolve(name) { return { app: { serial: device, requestedName: name, packageName: name, component: name + '/.Main' }, choices: [] }; }, async select() { throw new Error('not needed'); } },
    async open() { opens++; return { backend: 'appium', sessionId: () => session, async observe() { return scene(options.foreign ? 'OTHER' : device, pkg, expression, result, options.alternative); },
      async execute(action) { actions.push(action); pkg = action.app; expression = ''; result = ''; },
      async interactV2(grant) {
        consumeEffectGrant(grant, device, session); const c = grant.candidate; actions.push(c.action);
        if (options.uncertain) throw new Error('Response lost after dispatch');
        if (c.action === 'SET_VALUE') expression = c.value;
        else if (c.action === 'CLICK') result = options.wrongResult ? '999' : arithmeticOracle(expression).result;
        return scene(device, pkg, expression, result, options.alternative);
      }, async close() { closed++; } }; } };
  return { adapter, actions, events, get closed() { return closed; }, get opens() { return opens; } };
}
const noAI = { generate() { throw new Error('Unique observed controls should not call a model'); } };

test('SIMULATED V2: graph, generic field/button actions, independent arithmetic outcome and cross-app metadata all run in one Session', async () => {
  for (const app of ['org.sample.math', 'net.unseen.numeric']) {
    const f = fakeAdapter('A', { alternative: app.startsWith('net') });
    await runAgentV2(`Mở ${app} và tính (17 + 3) × 6 rồi mở org.sample.viewer`, 'A', 'execution-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI);
    const final = f.events.at(-1);
    assert.equal(final.status, 'COMPLETED'); assert.equal(final.v2.result, 'AUTO_COMPLETED');
    assert.equal(final.v2.graph.nodes.length, 3); assert.equal(final.v2.graph.nodes.every(n => n.evidenceIds.length > 0), true);
    assert.equal(f.opens, 1); assert.equal(f.closed, 1);
    assert.deepEqual(f.actions, [{ type: 'OPEN_APP', app }, 'SET_VALUE', 'CLICK', { type: 'OPEN_APP', app: 'org.sample.viewer' }]);
  }
});
test('unsupported persisted outcomes block before Session or side effects; all requested outcomes remain visible', async () => {
  const examples = ['Mở Camera và chụp một tấm hình', 'Mở Đồng hồ và đặt báo thức 07:00', 'Mở Ghi chú và tạo ghi chú "Meeting"', 'Chụp ảnh rồi mở Thư viện tìm ảnh vừa chụp'];
  for (const request of examples) {
    const f = fakeAdapter();
    await runAgentV2(request, 'A', 'execution-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e));
    assert.equal(f.events.at(-1).v2.result, 'SAFE_BLOCKED'); assert.equal(f.opens, 0); assert.equal(f.actions.length, 0);
  }
});
test('uncertain mutation and incorrect displayed result never complete or replay the effect', async () => {
  for (const options of [{ uncertain: true }, { wrongResult: true }]) {
    const f = fakeAdapter('A', options);
    await runAgentV2('Mở org.sample.math và tính 8 + 9', 'A', 'execution-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI);
    assert.equal(f.events.at(-1).v2.result, 'SAFE_BLOCKED');
    assert.equal(f.actions.filter(action => action === 'SET_VALUE').length, 1);
    assert.equal(f.actions.filter(action => action === 'CLICK').length <= 1, true);
    assert.equal(f.closed, 1);
  }
});
test('candidate and effect grants reject foreign/stale/invented/modified targets and cannot be replayed or revoked', () => {
  const graph = compileOutcomes('Mở org.sample.math và tính 2 + 5', 'A', 'execution-a'), node = graph.nodes[1];
  node.packageName = 'org.sample.math'; const s = scene();
  const c = generateGroundedCandidates(node, s, 'execution-a', 'session-A', false).candidates[0];
  assert.ok(c);
  assert.equal(revalidateGroundedCandidate(c, node, { ...s, deviceSerial: 'B' }, 'execution-a', 'session-A', false), undefined);
  assert.equal(revalidateGroundedCandidate(c, node, { ...s, timestamp: Date.now() - 6000 }, 'execution-a', 'session-A', false), undefined);
  assert.throws(() => issueEffectGrant({ ...c }, node));
  const grant = issueEffectGrant(c, node);
  assert.throws(() => consumeEffectGrant(grant, 'OTHER', 'session-A'));
  consumeEffectGrant(grant, 'A', 'session-A'); assert.throws(() => consumeEffectGrant(grant, 'A', 'session-A'));
  const revoked = issueEffectGrant(c, node); revokeEffectGrant(revoked); assert.throws(() => consumeEffectGrant(revoked, 'A', 'session-A'));
  c.value = 'malicious text'; assert.throws(() => issueEffectGrant(c, node));
});
test('artifact store accepts registered evidence only and denies wrong device/execution/physical identity/consumer and stale artifacts', () => {
  const s = scene(), context = { deviceId: 'A', executionId: 'execution-a', nodeId: 'first', packageName: s.foregroundPackage };
  const proof = verifyPredicate({ kind: 'FOREGROUND_IS', packageName: s.foregroundPackage }, s, context).evidence;
  const store = new ArtifactStore('A', 'physical-a', 'execution-a');
  assert.throws(() => store.put({ ...proof }, ['next']));
  const ref = store.put(proof, ['next']);
  assert.equal(store.read(ref.id, 'A', 'execution-a', 'next').id, ref.id);
  for (const args of [[ref.id, 'B', 'execution-a', 'next'], [ref.id, 'A', 'other-execution', 'next'], [ref.id, 'A', 'execution-a', 'other'], [ref.id, 'A', 'execution-a', 'next', 'physical-b']]) assert.throws(() => store.read(...args));
  assert.equal(verifyPredicate({ kind: 'ARTIFACT_EXISTS', artifactId: 'invented-photo' }, s, context).evidence, undefined);
  assert.equal(verifyPredicate({ kind: 'VALUE_EQUALS', expression: '2+5', value: '7' }, scene('A', s.foregroundPackage, '', '7'), context).evidence, undefined);
  store.dispose(); assert.throws(() => store.read(ref.id, 'A', 'execution-a', 'next'));
});
test('typed assistance binds device/execution, denial, expiry/cancel and single-use choices', async () => {
  let pending;
  const task = waitForAssistanceV2({ deviceId: 'A', executionId: 'execution-a', category: 'APP_SELECTION', choices: [{ id: 'a', label: 'Installed A' }], reason: 'ambiguous', sessionRetained: false }, 2000, undefined, q => { pending = q; });
  assert.equal(submitAssistanceV2({ token: pending.token, deviceId: 'B', executionId: 'execution-a', approved: true, choice: 'a' }), false);
  assert.equal(submitAssistanceV2({ token: pending.token, deviceId: 'A', executionId: 'execution-a', approved: true, choice: 'invented' }), false);
  assert.equal(submitAssistanceV2({ token: pending.token, deviceId: 'A', executionId: 'execution-a', approved: false, choice: '' }), true);
  assert.equal((await task).approved, false);
  assert.equal(submitAssistanceV2({ token: pending.token, deviceId: 'A', executionId: 'execution-a', approved: true, choice: 'a' }), false);
  const abort = new AbortController();
  const cancelled = waitForAssistanceV2({ deviceId: 'A', executionId: 'execution-a', category: 'PERMISSION', choices: [{ id: 'continue', label: 'Handled' }], reason: 'permission', sessionRetained: true }, 2000, abort.signal, q => { pending = q; });
  abort.abort(); await assert.rejects(cancelled);
  assert.equal(submitAssistanceV2({ token: pending.token, deviceId: 'A', executionId: 'execution-a', approved: true, choice: 'continue' }), false);
});
test('runtime V2 is opt-in; two simulated devices retain separate graph/session/action state and legacy command shape remains accepted', async () => {
  const adapters = new Map(), adapter = {
    async discover() { return ['A', 'B'].map(serial => ({ serial, status: 'device', connectionType: 'USB' })); },
    async plan() { throw new Error('V1 planner must not be called for V2'); }, async open() { throw new Error('V1 executor must not be called for V2'); },
    v2(serial) { const f = fakeAdapter(serial, { wrongResult: serial === 'B' }); adapters.set(serial, f); return f.adapter; },
  };
  assert.equal(RuntimeCommand.safeParse({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId: 'A', goal: 'Mở Settings' }] }).success, true);
  const registry = new DeviceRuntimeRegistry(adapter);
  const tasks = await registry.start({ type: 'START', requestId: randomUUID(), jobs: ['A', 'B'].map(deviceId => ({ deviceId, agentVersion: 2, goal: 'Mở org.sample.math và tính 8 × 7' })) });
  await Promise.all(tasks.map(task => registry.settled(task.executionId)));
  const finished = registry.list();
  assert.equal(finished.find(t => t.deviceId === 'A').status, 'COMPLETED');
  assert.equal(finished.find(t => t.deviceId === 'B').status, 'BLOCKED');
  assert.equal(finished.every(t => t.latest.v2.graph.deviceId === t.deviceId), true);
  assert.equal([...adapters.values()].every(f => f.closed === 1), true);
  const restored = new DeviceRuntimeRegistry(adapter);
  restored.restore([{ ...tasks[0], status: 'RUNNING' }]);
  assert.equal(restored.list()[0].status, 'BLOCKED');
});

test('playback intent requires advancing media evidence while open-only video remains supported', async () => {
  const { planGoal } = require('../lib/android/agent/goal-planner.ts');
  const { criterionSatisfied } = require('../lib/android/agent/evaluator.ts');
  const { goal } = await planGoal('Mở YouTube, tìm sample và phát video thứ hai.', new AgentBudget());
  goal.subgoals[1].status = 'VERIFIED';
  const pkg = goal.packageName, selection = { itemType: 'video', ordinal: 2, title: 'Observed sample', identity: 'actual' };
  const s = scene('A', pkg); s.screen = 'VIDEO_PLAYER';
  s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/video_metadata_layout', text: '', clickable: false });
  s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/video_title', text: selection.title, parentIndex: s.nodes.length - 1 });
  const criterion = goal.subgoals.at(-1).criterion;
  assert.equal(criterionSatisfied(goal, criterion, s, selection), false);
  s.playback = { source: 'ADB_MEDIA_SESSION', packageName: pkg, title: selection.title, positionMs: 2000, previousPositionMs: 1000 };
  assert.equal(criterionSatisfied(goal, criterion, s, selection), true);
  s.playback.title = 'Advertisement'; assert.equal(criterionSatisfied(goal, criterion, s, selection), false);
  delete s.playback; goal.originalRequest = 'Mở YouTube, tìm sample và mở video thứ hai.';
  assert.equal(criterionSatisfied(goal, criterion, s, selection), true);
});

test('V2 permission handoff retains one execution/session; cancel/deny never authorizes permission clicks', async () => {
  for (const deny of [false, true]) {
    const f = fakeAdapter(), originalOpen = f.adapter.open; let covered = true;
    f.adapter.open = async (...args) => {
      const execution = await originalOpen(...args), observe = execution.observe;
      execution.observe = async () => {
        const s = await observe();
        if (covered) s.nodes.push({ ...s.nodes[0], packageName: 'com.android.permissioncontroller' });
        return s;
      };
      return execution;
    };
    let token;
    await runAgentV2('Mở org.sample.math', 'A', 'execution-a', 'physical-a', new AgentBudget(), f.adapter, e => {
      f.events.push(e);
      if (e.v2?.assistance) {
        token = e.v2.assistance.token; assert.equal(e.v2.assistance.sessionRetained, true); covered = false;
        assert.equal(submitAssistanceV2({ deviceId: 'A', executionId: 'execution-a', token, approved: !deny, choice: 'continue' }), true);
      }
    }, undefined, noAI);
    assert.equal(f.events.at(-1).v2.result, deny ? 'SAFE_BLOCKED' : 'ASSISTED_COMPLETED');
    assert.equal(f.actions.every(action => typeof action === 'object' && action.type === 'OPEN_APP'), true);
    assert.equal(f.opens, 1); assert.equal(f.closed, 1);
    assert.equal(submitAssistanceV2({ deviceId: 'A', executionId: 'execution-a', token, approved: true, choice: 'continue' }), false);
  }
});

test('queue reports queue/service time separately, rejects expired admission and preserves ownership when diagnostics fail', async () => {
  const { ReasoningScheduler } = require('../lib/android/agent/reasoning-scheduler.ts');
  const q = new ReasoningScheduler(), measurements = [];
  await assert.rejects(q.run('expired', async () => {}, undefined, 0));
  assert.equal(q.summary().running, 0);
  await q.run('a', async () => 'ok', undefined, 1000, m => measurements.push(m));
  assert.ok(measurements[0].queueWaitMs >= 0); assert.ok(measurements[0].serviceMs >= 0);
  assert.equal(await q.run('b', async () => 'ok', undefined, 1000, () => { throw new Error('diagnostic failure'); }), 'ok');
  assert.equal(q.summary().running, 0);
  const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts'), { z } = require('zod');
  const budget = new AgentBudget(); let calls = 0;
  await assert.rejects(new OllamaAgentReasoner(async () => { calls++; }, true).generate(z.object({ choice: z.string() }), 'x'.repeat(1600), {}, budget));
  assert.equal(calls, 0); assert.equal(budget.reasoningMeasurements[0].status, 'CONTEXT_LIMIT');
});

test('generic navigation uses constrained candidate IDs or same-session human choice; malformed/invented output sends no click', async () => {
  for (const mode of ['choose', 'abstain', 'invent']) {
    let page = false, clicks = 0, closed = 0;
    const pkg = 'org.unseen.reader', events = [];
    function state() {
      const s = scene('A', pkg);
      s.nodes = page ? [{ ...s.nodes[0], text: 'Account overview', className: 'android.widget.TextView', focused: false, clickable: false, resourceId: pkg + ':id/page_title' }] :
        ['Account overview details', 'Account overview summary'].map((text, i) => ({ ...s.nodes[0], text, className: 'android.widget.Button', focused: false, clickable: true, resourceId: pkg + ':id/menu_' + i, bounds: [0, i * 90, 400, i * 90 + 70] }));
      // Use non-sensitive information labels for the actual generic read navigation.
      s.nodes.forEach(n => { n.text = n.text.replace('Account overview', 'Public information'); });
      s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i })); return s;
    }
    const adapter = { catalog: { async resolve() { return { app: { serial: 'A', requestedName: pkg, packageName: pkg, component: pkg + '/.Main' }, choices: [] }; }, async select() { throw new Error('unused'); } },
      async open() { return { backend: 'appium', sessionId: () => 'session-A', observe: async () => state(), execute: async () => {},
        interactV2: async grant => { consumeEffectGrant(grant, 'A', 'session-A'); clicks++; page = true; return state(); }, close: async () => { closed++; } }; } };
    const reasoner = { async generate(_schema, _system, input) {
      assert.equal('selector' in input, false); assert.equal('image' in input, false);
      return { choice: mode === 'invent' ? 'unobserved-selector' : mode === 'abstain' ? 'ABSTAIN' : input.candidates[0].id, reason: 'supplied control' };
    } };
    await runAgentV2('Mở org.unseen.reader và xem Public information', 'A', 'execution-a', 'physical-a', new AgentBudget(), adapter, event => {
      events.push(event);
      if (event.v2?.assistance) {
        assert.equal(event.v2.assistance.sessionRetained, true);
        assert.equal(submitAssistanceV2({ deviceId: 'A', executionId: 'execution-a', token: event.v2.assistance.token, approved: true, choice: event.v2.assistance.choices[0].id }), true);
      }
    }, undefined, reasoner);
    assert.equal(events.at(-1).v2.result, mode === 'invent' ? 'SAFE_BLOCKED' : mode === 'abstain' ? 'ASSISTED_COMPLETED' : 'AUTO_COMPLETED');
    assert.equal(clicks, mode === 'invent' ? 0 : 1); assert.equal(closed, 1);
  }
});

test('the production grounded executor enforces grant, native reference and password guard before clear/value RPC', async () => {
  const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
  for (const password of ['true', 'false']) {
    const graph = compileOutcomes('Mở org.sample.math và tính 9 + 4', 'A', 'execution-a'), node = graph.nodes[1];
    node.packageName = 'org.sample.math'; const before = scene(); let typed = ''; const calls = [];
    const c = generateGroundedCandidates(node, before, 'execution-a', 'session-A', false).candidates[0], grant = issueEffectGrant(c, node);
    const session = { serial: 'A', sessionId: 'session-A', path: '/session/session-A', ensureActive: async () => {}, client: { async request(_method, path, body) {
      calls.push([path, body]); if (path.endsWith('/password')) return password; if (path.endsWith('/value')) typed = body.text;
    } } };
    const observer = { readNativeSnapshot: async () => scene(), locate: async () => ({ id: 'native-element', interaction: { method: 'ELEMENT_CLICK' } }),
      waitUntil: async condition => { const after = scene('A', 'org.sample.math', typed); if (!condition(after)) throw new Error('not verified'); return after; } };
    if (password === 'true') {
      await assert.rejects(executeGroundedInteraction(session, observer, grant), /secret/);
      assert.equal(calls.some(([path]) => path.endsWith('/clear') || path.endsWith('/value')), false);
    } else {
      const after = await executeGroundedInteraction(session, observer, grant);
      assert.equal(after.nodes[0].text, '9 + 4');
      assert.equal(calls.filter(([path]) => path.endsWith('/value')).length, 1);
      assert.equal(calls.find(([path]) => path.endsWith('/value'))[1].text, '9 + 4');
      await assert.rejects(executeGroundedInteraction(session, observer, grant));
    }
  }
});

test('benign dialog recovery is grounded, verified and bounded; sensitive overlays never offer BACK', async () => {
  const f = fakeAdapter(), originalOpen = f.adapter.open; let dialog = true;
  f.adapter.open = async (...args) => {
    const execution = await originalOpen(...args), observe = execution.observe, interact = execution.interactV2;
    execution.observe = async () => {
      const s = await observe();
      if (dialog && s.foregroundPackage !== 'launcher') {
        s.nodes.push({ ...s.nodes[0], text: 'Information', focused: false, clickable: false, className: 'android.app.Dialog', resourceId: 'android:id/alertTitle', bounds: [0, 0, 400, 800] });
        s.elements.push({ ...s.nodes.at(-1), elementId: s.snapshotId + ':' + (s.nodes.length - 1) });
      }
      return s;
    };
    execution.interactV2 = async grant => {
      if (grant.candidate.action === 'BACK') { consumeEffectGrant(grant, 'A', 'session-A'); dialog = false; f.actions.push('BACK'); return observe(); }
      return interact(grant);
    };
    return execution;
  };
  await runAgentV2('Mở org.sample.math', 'A', 'execution-a', 'physical-a', new AgentBudget(), f.adapter, e => f.events.push(e), undefined, noAI);
  assert.equal(f.events.at(-1).v2.result, 'AUTO_COMPLETED'); assert.equal(f.actions.filter(x => x === 'BACK').length, 1);
  const graph = compileOutcomes('Mở org.sample.math', 'A', 'execution-a'); graph.nodes[0].packageName = 'org.sample.math';
  const s = scene(); s.nodes.push({ ...s.nodes[0], className: 'android.app.Dialog', text: 'Delete all records', resourceId: 'android:id/alertTitle' });
  s.elements.push({ ...s.nodes.at(-1), elementId: s.snapshotId + ':last' });
  assert.equal(generateGroundedCandidates(graph.nodes[0], s, 'execution-a', 'session-A', false).candidates.length, 0);
});

test('device catalog is bounded/cached and never invents display labels or chooses ambiguous package matches', async () => {
  const { AppCatalog } = require('../lib/android/agent/app-catalog.ts'); let reads = 0;
  const run = async args => {
    if (args.includes('query-activities')) { reads++; return { stdout: 'org.one.reader/.Main\norg.two.reader/.Main', stderr: '' }; }
    return { stdout: args.includes('org.one.reader') ? 'org.one.reader/.Main' : '', stderr: '' };
  };
  const catalog = new AppCatalog('A', run), entries = await catalog.inventory();
  assert.equal(entries.length, 2); assert.equal(entries.every(row => row.label === undefined && row.deviceId === 'A'), true);
  await catalog.inventory(); assert.equal(reads, 1);
  const ambiguous = await catalog.resolve('reader', 'LAUNCH');
  assert.equal(ambiguous.app, undefined); assert.equal(ambiguous.choices.length, 2);
  assert.equal((await catalog.select('org.one.reader')).serial, 'A');
  await assert.rejects(catalog.select('org.invented.app'));
});

test('V2 UI renders outcome coverage and typed assistance without claiming blocked tasks completed', () => {
  const Module = require('node:module'), originalResolve = Module._resolveFilename;
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f }).outputText, f);
  Module._resolveFilename = function(request, ...args) { return originalResolve.call(this, request.startsWith('@/') ? require('node:path').resolve(request.slice(2)) : request, ...args); };
  try {
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const { AgentGoalPanel } = require('../components/commands/AgentGoalPanel.tsx');
    const graph = compileOutcomes('Mở Sample và tạo bản ghi mới', 'A', 'execution-a');
    const task = { executionId: 'execution-a', batchId: 'batch', deviceId: 'A', request: graph.original.request, status: 'BLOCKED', createdAt: Date.now(), finishedAt: Date.now(), events: [],
      latest: { type: 'complete', status: 'BLOCKED', reason: 'No persistence provider', v2: { version: 2, graph, result: 'SAFE_BLOCKED' } } };
    const html = renderToStaticMarkup(React.createElement(AgentGoalPanel, { text: task.request, onText() {}, devices: [], serial: 'A', onSerial() {}, onRefresh() {}, selectedDeviceIds: [], runtime: { tasks: [task], command: async () => {} } }));
    assert.match(html, /Agent V2/); assert.match(html, /SAFE_BLOCKED/); assert.match(html, /CREATE_RECORD/);
    assert.doesNotMatch(html, /AUTO_COMPLETED/);
  } finally { Module._resolveFilename = originalResolve; }
});
