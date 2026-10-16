/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { discoverApplication, discoveredApplication } = require('../lib/android/agent/application-discovery.ts');
const { planGoal, buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { generateActionCandidates, revalidateCandidate } = require('../lib/android/agent/action-candidates.ts');
const { policyForAgentAction, runAgent } = require('../lib/android/agent/agent-loop.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { AgentMemory } = require('../lib/android/agent/memory.ts');
const { criterionSatisfied } = require('../lib/android/agent/evaluator.ts');
const { verifyCandidateOutcome } = require('../lib/android/agent/candidate-verifier.ts');
const { nativePageVerified } = require('../lib/android/agent/native-navigation.ts');
const { RecoveryManager } = require('../lib/android/agent/recovery.ts');
const serial = 'TEST_PHONE_A', pkg = 'org.example.gallery';
function runner(packages = [pkg], defaultPackage = pkg) {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args.includes('query-activities')) return { stdout: packages.map(p => p + '/.Main').join('\n'), stderr: '' };
    const target = args.includes('android.intent.category.LAUNCHER') ? args.at(-1) : defaultPackage;
    return { stdout: packages.includes(target) ? target + '/.Main' : 'No activity found', stderr: '' };
  };
  return { run, calls };
}
async function planned(request = 'Mở gallery và mở trang Albums', device = serial) {
  const fake = runner(), budget = new AgentBudget();
  const { goal, source } = await planGoal(request, budget, undefined, undefined, name => discoverApplication(device, name, fake.run));
  return { goal, source, budget, fake };
}
function snapshot(rows = ['Albums'], packageName = pkg, deviceSerial = serial) {
  const snapshotId = randomUUID();
  const node = fields => ({ resourceId: '', packageName, className: 'android.widget.TextView', text: '', description: '', enabled: true, displayed: true, focused: false, clickable: false, scrollable: false, bounds: [0, 0, 400, 800], ...fields });
  const nodes = [node({ className: 'android.widget.FrameLayout' }), node({ className: 'androidx.recyclerview.widget.RecyclerView', resourceId: packageName + ':id/list', scrollable: true, parentIndex: 0, bounds: [0, 100, 400, 800] }),
    ...rows.map((text, i) => node({ text, resourceId: packageName + ':id/navigation_tab', clickable: true, parentIndex: 1, bounds: [0, 120 + i * 80, 400, 190 + i * 80] }))];
  return { snapshotId, timestamp: Date.now(), deviceSerial, foregroundPackage: packageName, observationStatus: 'OBSERVED', screen: 'OBSERVED', nodes,
    elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })), viewport: { x: 0, y: 0, width: 400, height: 800 } };
}
function heading() {
  const s = snapshot(); s.nodes[2].clickable = false; s.nodes[2].resourceId = pkg + ':id/toolbar_title';
  s.elements[2] = { ...s.nodes[2], elementId: s.snapshotId + ':2' }; return s;
}
test('camera intent resolves different vendor packages without launching or installing', async () => {
  for (const name of ['com.vendor.one.camera', 'com.vendor.two.camera']) {
    const fake = runner([name], name), app = await discoverApplication(serial, 'camera', fake.run);
    assert.equal(app.packageName, name); assert.equal(app.serial, serial); assert.equal(fake.calls.length, 2);
    assert.ok(fake.calls[0].includes('android.media.action.STILL_IMAGE_CAMERA'));
    assert.ok(fake.calls.every(c => !c.includes('am') && !c.includes('install') && c[1] === serial));
  }
});
test('app names use exact package tokens; missing and ambiguous names never use partial guesses', async () => {
  const fake = runner(['org.example.spotify', 'org.example.spotifylite']);
  assert.equal((await discoverApplication(serial, 'spotify', fake.run)).packageName, 'org.example.spotify');
  assert.equal((await discoverApplication(serial, 'org.example.spotifylite', fake.run)).packageName, 'org.example.spotifylite');
  await assert.rejects(discoverApplication(serial, 'spot', fake.run), /missing or ambiguous/);
  await assert.rejects(discoverApplication(serial, 'spotify', runner(['one.spotify', 'two.spotify']).run), /ambiguous/);
});
test('missing launcher, chooser, injection and cancellation reject before any actions', async () => {
  await assert.rejects(discoverApplication(serial, 'camera', runner([], 'android.resolver').run), /no unambiguous/);
  await assert.rejects(discoverApplication(serial, 'org.missing.app', runner().run), /no unique/);
  const fake = runner();
  for (const name of ['gallery; reboot', 'gallery\n--user 10', '../gallery']) await assert.rejects(discoverApplication(serial, name, fake.run));
  await assert.rejects(discoverApplication('bad;serial', 'gallery', fake.run)); assert.equal(fake.calls.length, 0);
  const controller = new AbortController(); controller.abort(); await assert.rejects(discoverApplication(serial, 'gallery', fake.run, controller.signal)); assert.equal(fake.calls.length, 0);
});
test('generic planner preserves app, native outcome and process-owned per-device evidence', async () => {
  const { goal, source } = await planned();
  assert.equal(source, 'RULES'); assert.equal(goal.spec.app, pkg); assert.equal(goal.spec.operation, 'OPEN_PAGE');
  assert.equal(goal.subgoals[1].criterion.kind, 'NATIVE_PAGE'); assert.equal(discoveredApplication(goal).serial, serial);
  assert.equal(discoveredApplication(structuredClone(goal)), undefined);
  assert.throws(() => buildGoal('Mở gallery', { app: 'gallery', operation: 'OPEN_APP', isSensitive: false }, new AgentBudget(), { serial, packageName: pkg, requestedName: 'gallery', component: pkg + '/.Main' }), /Untrusted/);
});
test('discovered app opening stays device-bound and cannot authorize other apps or later mutations', async () => {
  const { goal } = await planned('Mở gallery'), action = { type: 'OPEN_APP', app: pkg };
  assert.doesNotThrow(() => policyForAgentAction(goal, action, snapshot()));
  assert.throws(() => policyForAgentAction(goal, action, snapshot([], pkg, 'TEST_PHONE_B')));
  assert.throws(() => policyForAgentAction(goal, { type: 'OPEN_APP', app: 'evil.app' }, snapshot()));
  assert.throws(() => policyForAgentAction(goal, { type: 'CLICK', target: 'text:Albums' }, snapshot()));
  assert.equal(criterionSatisfied(goal, goal.subgoals[0].criterion, snapshot([], pkg, 'TEST_PHONE_B')), false);
  goal.spec.app = 'evil.app';
  assert.throws(() => policyForAgentAction(goal, { type: 'OPEN_APP', app: 'evil.app' }, snapshot()));
});
test('planner does not drop unsupported capture, send and delete outcomes or invent the app', async () => {
  for (const request of ['Mở gallery và chụp 1 ảnh', 'Mở gallery và gửi ảnh', 'Mở gallery và xóa ảnh']) {
    await assert.rejects(planGoal(request, new AgentBudget(), { generate: async () => ({ app: 'gallery', operation: 'OPEN_APP', isSensitive: false }) }, undefined, name => discoverApplication(serial, name, runner().run)));
  }
  await assert.rejects(planGoal('Xem nhạc', new AgentBudget(), { generate: async () => ({ app: 'gallery', operation: 'OPEN_APP', isSensitive: false }) }, undefined,
    name => discoverApplication(serial, name, runner().run)), /changed the requested application/);
  await assert.rejects(planned('Mở gallery và mở trang Albums rồi gửi ảnh'), /not supported by native read navigation/);
});
test('native candidates require observed unique read navigation; sensitive descendants stay blocked', async () => {
  const { goal } = await planned(); goal.currentSubgoal = 1;
  const s = snapshot(['Albums', 'Delete', 'Purchase']), candidates = generateActionCandidates(goal, s), click = candidates.find(c => c.action.type === 'CLICK');
  assert.ok(click); assert.equal(click.action.target, 'text:Albums'); assert.ok(candidates.every(c => c.action.type !== 'CLICK' || c.action.target === 'text:Albums'));
  assert.doesNotThrow(() => policyForAgentAction(goal, click.action, s, click)); assert.throws(() => policyForAgentAction(goal, click.action, s));
  for (const cls of ['android.widget.Switch', 'android.widget.CheckBox', 'android.webkit.WebView']) {
    const unsafe = snapshot(); unsafe.nodes.push({ ...unsafe.nodes[2], className: cls, text: '', parentIndex: 2 });
    assert.equal(generateActionCandidates(goal, unsafe).some(c => c.action.type === 'CLICK'), false);
  }
});
test('duplicates, stale evidence, foreign phone/package and WebView cannot authorize a native click', async () => {
  const { goal } = await planned(); goal.currentSubgoal = 1;
  const s = snapshot(), click = generateActionCandidates(goal, s).find(c => c.action.type === 'CLICK');
  assert.equal(generateActionCandidates(goal, snapshot(['Albums', 'Albums'])).some(c => c.action.type === 'CLICK'), false);
  assert.equal(revalidateCandidate(click, goal, { ...s, timestamp: Date.now() - 10000 }), false);
  for (const bad of [snapshot([], pkg, 'TEST_PHONE_B'), snapshot([], 'evil.app')]) assert.deepEqual(generateActionCandidates(goal, bad), []);
  const bad = snapshot(); bad.nodes[0].className = 'android.webkit.WebView'; assert.deepEqual(generateActionCandidates(goal, bad), []);
});
test('native page completion requires matching destination heading, not a visible tab or arbitrary change', async () => {
  const { goal } = await planned(); goal.currentSubgoal = 1;
  const before = snapshot(), click = generateActionCandidates(goal, before).find(c => c.action.type === 'CLICK');
  assert.equal(nativePageVerified(goal, before), false); assert.equal(nativePageVerified(goal, heading()), true);
  assert.equal(verifyCandidateOutcome(goal, click, before, heading()), true);
  const wrong = heading(); wrong.nodes[2].text = 'History'; assert.equal(verifyCandidateOutcome(goal, click, before, wrong), false);
  assert.equal(criterionSatisfied(goal, goal.subgoals[1].criterion, before), false); assert.equal(criterionSatisfied(goal, goal.subgoals[1].criterion, heading()), true);
});
test('generic find only checks visibility and offers grounded scrolling when the target is absent', async () => {
  const { goal } = await planned('Mở gallery và tìm Albums'); goal.currentSubgoal = 1;
  assert.equal(criterionSatisfied(goal, goal.subgoals[1].criterion, snapshot()), true);
  const s = snapshot(['History']), candidates = generateActionCandidates(goal, s);
  assert.ok(candidates.length); assert.ok(candidates.every(c => c.action.type === 'SWIPE'));
  assert.doesNotThrow(() => policyForAgentAction(goal, candidates[0].action, s, candidates[0]));
});
test('reasoning can choose supplied native IDs but cannot invent selectors or claim completion', async () => {
  const { goal, budget } = await planned('Mở gallery và mở trang Albums Library'); goal.currentSubgoal = 1;
  const s = snapshot(['Albums', 'Library']), engine = new AgentDecisionEngine({ generate: async (_schema, _prompt, input) => ({
    choice: input.candidates.find(c => c.role === 'read_navigation').id, snapshotId: input.snapshotId, subgoalId: input.subgoalId, reason: 'Observed Albums navigation matches the goal' }) });
  const decision = await engine.decide(goal, s, new AgentMemory(), {}, budget); assert.equal(decision.type, 'EXECUTE_ACTION'); assert.equal(decision.action.target, 'text:Albums');
  const bad = new AgentDecisionEngine({ generate: async () => ({ choice: 'CLICK', target: 'guess' }) });
  assert.equal((await bad.decide(goal, s, new AgentMemory(), {}, new AgentBudget())).type, 'REQUEST_HUMAN_ASSISTANCE');
});
test('one exact native read control does not need a model call but still returns revalidatable grounding', async () => {
  const { goal, budget } = await planned(); goal.currentSubgoal = 1;
  const s = snapshot(), engine = new AgentDecisionEngine({ generate: async () => { throw Error('Model must not be called for exact navigation'); } });
  const decision = await engine.decide(goal, s, new AgentMemory(), {}, budget);
  assert.equal(decision.type, 'EXECUTE_ACTION'); assert.equal(revalidateCandidate(decision.grounding, goal, s), true); assert.equal(budget.counters.reasoning, 0);
});
test('simulated full native loop verifies app and page then closes the original execution', async () => {
  const { goal, budget } = await planned(); let current = snapshot([], 'org.launcher.app'), closed = 0, verified;
  const engine = new AgentDecisionEngine({ generate: async (_schema, _prompt, input) => ({ choice: input.candidates.find(c => c.role === 'read_navigation').id, snapshotId: input.snapshotId, subgoalId: input.subgoalId, reason: 'Open observed Albums' }) });
  const execution = { backend: 'appium', observe: async () => ({ ...current, snapshotId: randomUUID(), timestamp: Date.now() }), discoveryMemory: () => ({}), close: async () => { closed++; },
    verificationSnapshot: () => verified, execute: async action => { current = action.type === 'OPEN_APP' ? snapshot() : heading(); verified = current; return { verification: 'VERIFIED', elapsedMs: 1 }; } };
  const result = await runAgent(goal, budget, execution, engine);
  assert.equal(result.result.status, 'COMPLETED'); assert.equal(result.memory.actions.length, 2); assert.equal(closed, 1);
});
test('generic recovery leaves absent targets to grounded candidates instead of opaque legacy exploration', async () => {
  const { goal, budget } = await planned('Mở gallery và tìm Albums'); goal.currentSubgoal = 1;
  const recovery = new RecoveryManager(), s = snapshot(['History']);
  assert.equal(recovery.next(goal, s, budget, () => {}), undefined); assert.equal(recovery.active, undefined);
  assert.ok(generateActionCandidates(goal, s).every(c => c.action.type === 'SWIPE'));
});
test('heading ancestry proves native page but a clickable container or tab title cannot', async () => {
  const { goal } = await planned(); goal.currentSubgoal = 1;
  const s = heading(); s.nodes[2].resourceId = ''; s.nodes[1].resourceId = pkg + ':id/toolbar';
  assert.equal(nativePageVerified(goal, s), true);
  s.nodes[1].clickable = true; assert.equal(nativePageVerified(goal, s), false);
  s.nodes[1].clickable = false; s.nodes[1].resourceId = pkg + ':id/tabs'; assert.equal(nativePageVerified(goal, s), false);
});
test('foreground package behind keyguard or absent native content does not prove a ready app', async () => {
  const { goal, budget } = await planned('Mở gallery');
  const s = snapshot(); s.nodes.push({ ...s.nodes[0], packageName: 'com.android.systemui', resourceId: 'com.android.systemui:id/keyguard_indication_text', text: 'Unlock' });
  assert.equal(criterionSatisfied(goal, goal.subgoals[0].criterion, s), false);
  assert.throws(() => policyForAgentAction(goal, { type: 'OPEN_APP', app: pkg }, s), /locked or covered/);
  const decision = await new AgentDecisionEngine().decide(goal, s, new AgentMemory(), {}, budget);
  assert.equal(decision.type, 'REQUEST_HUMAN_ASSISTANCE'); assert.match(decision.reason, /locked or covered/);
  assert.equal(criterionSatisfied(goal, goal.subgoals[0].criterion, { ...s, nodes: [] }), false);
});
