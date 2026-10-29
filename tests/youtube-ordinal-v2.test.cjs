/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { GoalGraphV2Schema, allOutcomesVerified } = require('../lib/android/agent/goal-graph.ts');
const { prepareV2 } = require('../lib/android/agent/prepared-v2.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { UIExplorer } = require('../lib/android/exploration/ui-explorer.ts');
const { ExplorationConfigSchema } = require('../lib/android/exploration/types.ts');
const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
const { beginVideoResult, createVideoPlaybackReader, beforeVideoResultDispatch, acknowledgeVideoResult } = require('../lib/android/agent/video-result.ts');
const { beginSearch, closeSearch, beforeSearchDispatch, noteSearchSubmitted } = require('../lib/android/agent/generic-search.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { verifySearchOutcome, verifyVideoResultOutcome, isVerifiedEvidence } = require('../lib/android/agent/verification-registry.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { routeCapability } = require('../lib/android/unified-agent/capability-router.ts');
const { UnifiedAgentService } = require('../lib/android/unified-agent/service.ts');
const { DeviceRuntimeRegistry } = require('../lib/android/agent/device-runtime.ts');
const pkg = 'com.google.android.youtube';
const commands = ['Mở YouTube, tìm OpenAI và phát video đầu tiên', 'Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2', 'Mở YouTube, tìm nhạc piano và phát video thứ 3'];
const item = (title, top, parentIndex = 1) => ({ resourceId: pkg + ':id/video_card', description: `${title} - 3 minutes - Channel Ocean - Play video`,
  text: '', clickable: true, bounds: [0, top, 400, top + 170], parentIndex });
function scene(stage, query = '', frame = 0, options = {}) {
  let nodes;
  const field = { resourceId: pkg + ':id/search_query', className: stage === 'input' ? 'android.widget.EditText' : 'android.widget.TextView',
    text: query, description: stage === 'input' ? '' : 'Search', clickable: true, focused: stage === 'input', bounds: [0, 0, 400, 50] };
  if (stage === 'results') {
    nodes = [field, { resourceId: pkg + ':id/results', className: 'androidx.recyclerview.widget.RecyclerView', clickable: false, scrollable: true, bounds: [0, 50, 400, 750] },
      ...(frame === 0 ? [item('Sponsored - Brand', 65), { ...item('Short', 245), resourceId: pkg + ':id/shorts_shelf', description: 'Short - Play short' },
        item('Alpha', 390), item('Bravo', 570)] : [item('Bravo', 70), item('Charlie', 260)])];
    if (options.gap && frame) nodes = [field, nodes[1], item('Charlie', 70)];
    if (options.duplicate) nodes.push(item('Alpha', 590));
    if (options.unknownType) nodes.push({ resourceId: pkg + ':id/thumbnail', parentIndex: 1, bounds: [0, 70, 400, 240] });
    if (options.empty) nodes = [field, { resourceId: pkg + ':id/empty_results', text: 'No results found', bounds: [0, 80, 400, 150] }];
  } else if (stage === 'player') {
    nodes = [{ resourceId: pkg + ':id/watch_player', bounds: [0, 0, 400, 330] },
      { resourceId: pkg + ':id/video_title', text: options.wrongTitle ? 'Other video' : options.title || 'Alpha', bounds: [0, 340, 400, 390] },
      { resourceId: pkg + ':id/channel_name', text: options.wrongChannel ? 'Other channel' : 'Ocean', bounds: [0, 400, 400, 440] }];
    if (options.searchAvailable) nodes.push({ resourceId: pkg + ':id/search', description: 'Search', clickable: true, bounds: [340, 0, 400, 50] });
    if (options.ad) nodes.push({ resourceId: pkg + ':id/ad_badge', text: 'Ad', bounds: [0, 25, 50, 50] });
    if (options.loading) nodes.push({ className: 'android.widget.ProgressBar', bounds: [100, 100, 140, 140] });
    if (options.unavailable) nodes.push({ resourceId: pkg + ':id/error_message', text: 'Video unavailable', bounds: [0, 100, 400, 150] });
  } else nodes = [field];
  if (options.overlay) nodes.push({ className: 'android.app.Dialog', text: 'Options', bounds: [0, 0, 400, 800] });
  nodes = nodes.map(n => ({ text: '', description: '', resourceId: '', className: 'android.view.View', packageName: pkg,
    clickable: false, enabled: true, displayed: true, focused: false, ...n }));
  const snapshotId = randomUUID();
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: stage === 'closed' ? 'launcher' : pkg,
    activity: 'Main', observationStatus: 'OBSERVED', source: 'APPIUM', screen: stage === 'player' ? 'VIDEO_PLAYER' : stage === 'results' ? 'SEARCH_RESULTS' : 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}
function runtimeFixture(request = commands[0], mode = 'success', initial = 'home') {
  const graph = compileOutcomes(request, 'A', 'E'), query = graph.nodes[1].outcome.value, ordinal = graph.nodes[2].outcome.videoResult.ordinal;
  let stage = initial, text = ['old-search', 'playing-other'].includes(initial) ? 'old query' : '', frame = 0;
  if (initial === 'old-search') stage = 'results';
  if (initial === 'playing-other') stage = 'player';
  let selected = initial === 'playing-other' ? 'Other video' : undefined, position = 0, clicks = 0, closed = 0, modelCalls = 0, sessions = 0, sessionId = 'S';
  const events = [], rpc = [], adb = [], actions = [], gestures = [], controller = new AbortController();
  const view = () => scene(stage, text, frame, { title: selected, overlay: stage === 'menu', searchAvailable: initial === 'playing-other' && mode !== 'no-search', ...(mode === 'empty' && stage === 'results' ? { empty: true } : {}),
    ...(stage === 'results' ? { gap: mode === 'gap', duplicate: mode === 'duplicate', unknownType: mode === 'unknown-type' } : {}),
    ...(stage === 'player' && selected ? { wrongTitle: mode === 'wrong-title', wrongChannel: mode === 'wrong-channel', ad: mode === 'ad', loading: mode === 'loading', unavailable: mode === 'unavailable' } : {}) });
  const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async signal => {
    signal?.throwIfAborted(); if (sessionId !== 'S') throw new AndroidExecutionError('SESSION_ERROR', 'Session lost');
  }, client: { request: async (method, path, body, _timeout, signal) => {
    signal?.throwIfAborted(); rpc.push({ method, path, body });
    if (path.endsWith('/attribute/password')) return 'false';
    if (path.endsWith('/clear')) { text = ''; return; }
    if (path.endsWith('/value')) { text = body.text; return; }
    if (path.endsWith('/click')) {
      if (path.includes('/element/video-')) {
        clicks++; selected = decodeURIComponent(path.split('/element/video-')[1].split('/click')[0]); stage = mode === 'ack-only' ? 'results' : 'player';
        if (mode === 'unknown' || mode === 'timeout') throw new AndroidExecutionError('TIMEOUT', 'Reply lost after video click');
        if (mode === 'cancel') controller.abort();
        if (mode === 'session-loss') sessionId = undefined;
      } else stage = 'input';
      return;
    }
    if (body?.script === 'mobile: performEditorAction') { stage = 'results'; frame = 0; return; }
    if (path.endsWith('/appium/device/press_keycode') && body.keycode === 4) { stage = 'home'; return; }
    throw Error('Unexpected fixture RPC ' + path);
  } } };
  const observer = { read: async () => view(), readNativeSnapshot: async () => {
    const v = view(); if (mode === 'stale' && stage === 'results' && selected === undefined && actions.some(a => a.type === 'WAIT_FOR')) v.nodes[0].text = 'unrelated query'; return v;
  }, locate: async (s, target) => {
    const n = s.nodes[Number(target.split(':').at(-1))];
    return { id: n?.resourceId.endsWith('/video_card') ? 'video-' + encodeURIComponent(n.description.split(' - ')[0]) : 'search-field',
      node: n, snapshot: s, interaction: { method: 'ELEMENT_CLICK' } };
  }, waitUntil: async condition => {
    for (let i = 0; i < 3; i++) { const result = await condition(view()); if (result) return result; }
    throw new AndroidExecutionError('TIMEOUT', 'Fixture transition not verified');
  } };
  const explorer = new UIExplorer(observer, { scroll: async (_s, _r, direction) => {
    controller.signal.throwIfAborted(); gestures.push(direction);
    if (direction === 'up') { frame = 0; return false; }
    frame = 1; return false;
  } }, ExplorationConfigSchema.parse({ maxScrolls: 5, timeoutMs: 1500, settleTimeoutMs: 100 }));
  const reader = createVideoPlaybackReader(async args => {
    adb.push(args);
    if (!args.includes('dumpsys')) return { stdout: 'unsupported', stderr: '' };
    const value = mode === 'frozen' ? 1000 : position += 1000;
    return { stdout: `package=${pkg}\nactive=true\nstate=PlaybackState {state=${mode === 'paused' ? 2 : 3}, position=${value}, buffered position=10000, speed=1.0, updated=${value}, actions=1}\nmetadata: size=6, description=${mode === 'wrong-media' ? 'Wrong media' : selected}, ${mode === 'wrong-media-channel' ? 'Other channel' : 'Ocean'}, Ocean\n`, stderr: '' };
  }, 'A');
  const adapter = { catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) }, open: async () => {
    sessions++; return { backend: 'appium', sessionId: () => sessionId, observe: observer.read,
      execute: async action => {
        actions.push(action);
        if (action.type === 'OPEN_APP') { stage = 'home'; return; }
        assert.equal(action.type, 'WAIT_FOR', 'No legacy CLICK/engine fallback');
        const result = await explorer.find(action.target, 1500, false, controller.signal);
        if (result.status !== 'FOUND') throw Error(result.status + ': ' + result.reason);
      }, discoveryMemory: () => explorer.memorySummary(), videoPlaybackV2: reader,
      interactV2: grant => executeGroundedInteraction(session, observer, grant, controller.signal), close: async () => { closed++; sessionId = undefined; } };
  } };
  return { adapter, events, controller, rpc, adb, actions, gestures, ordinal, query,
    reasoner: { generate: async () => { modelCalls++; assert.fail('No model/cloud permitted in offline ordinal path'); } },
    get clicks() { return clicks; }, get closed() { return closed; }, get modelCalls() { return modelCalls; }, get sessions() { return sessions; }, get activeSession() { return sessionId; } };
}
async function run(f, request = commands[0]) {
  await runAgentV2(request, 'A', 'E', 'physical-A', new AgentBudget({ iterations: 50 }), f.adapter, e => f.events.push(e), f.controller.signal, f.reasoner);
  const last = f.events.at(-1);
  console.log('OFFLINE_EVIDENCE ' + JSON.stringify({ request, status: last.status, reason: last.reason, video: last.v2.videoResult,
    nodes: last.v2.graph.nodes.map(n => ({ capability: n.capability, status: n.status, evidenceIds: n.evidenceIds })),
    timings: last.timings, appiumRpc: f.rpc.length, adbRead: f.adb.length, modelCalls: f.modelCalls, clicks: f.clicks, sessions: f.sessions, closed: f.closed }));
  return last;
}
for (const [i, request] of commands.entries()) test('OFFLINE exact source/query/ordinal graph ' + (i + 1), async () => {
  const prepared = await prepareV2(request, 'A', {}, new AgentBudget(), new AbortController().signal), g = prepared.graph;
  assert.equal(prepared.review, false); assert.equal(g.coverage, 'COMPLETE');
  assert.deepEqual(g.nodes.map(n => n.capability), ['LAUNCH', 'SEARCH', 'SELECT_RESULT', 'VERIFY_PLAYBACK']);
  assert.equal(g.nodes[2].outcome.videoResult.ordinal, i + 1); assert.equal(g.nodes[2].outcome.videoResult.query, g.nodes[1].outcome.value);
  assert.deepEqual(g.nodes[2].dependencies, [g.nodes[1].id]); assert.deepEqual(g.nodes[3].dependencies, [g.nodes[2].id]);
  for (const node of g.nodes) assert.equal(g.original.request.slice(node.outcome.span.start, node.outcome.span.end), node.outcome.span.text);
  const dropped = structuredClone(g); dropped.nodes.pop(); assert.equal(GoalGraphV2Schema.safeParse(dropped).success, false);
  const bypass = structuredClone(g); bypass.nodes[3].dependencies = [g.nodes[1].id]; assert.equal(GoalGraphV2Schema.safeParse(bypass).success, false);
  const changed = structuredClone(g); changed.nodes[2].outcome.videoResult.ordinal = 1 + (i + 1) % 3; assert.equal(GoalGraphV2Schema.safeParse(changed).success, false);
  assert.equal(allOutcomesVerified(g), false);
});
for (const [request, ordinal] of [['Open YouTube, search marine biology and play the first video', 1], ['Open YouTube, search deep ocean and play the second video', 2],
  ['Mo YouTube, tim podcast va phat video thu ba', 3]]) test('OFFLINE parser language: ' + request, () => {
  const g = compileOutcomes(request, 'A', 'E'); assert.equal(g.coverage, 'COMPLETE'); assert.equal(g.nodes[2].outcome.videoResult.ordinal, ordinal);
});
for (const [i, request] of commands.entries()) test('OFFLINE production V2/search/grounded executor/discovery/MediaSession complete ordinal ' + (i + 1), async () => {
  const f = runtimeFixture(request), last = await run(f, request);
  assert.equal(last.status, 'COMPLETED', last.reason); assert.equal(last.v2.completion, 'ALL_VERIFIED');
  assert.equal(last.v2.videoResult.ordinal, i + 1); assert.equal(last.v2.videoResult.title, ['Alpha', 'Bravo', 'Charlie'][i]);
  assert.ok(last.v2.videoResult.positionMs > last.v2.videoResult.previousPositionMs);
  assert.ok(last.v2.videoResult.searchEvidenceId); assert.ok(last.v2.videoResult.playbackEvidenceId);
  assert.equal(f.clicks, 1); assert.equal(f.sessions, 1); assert.equal(f.closed, 1); assert.equal(f.activeSession, undefined); assert.equal(f.modelCalls, 0);
  assert.ok(f.adb.filter(a => a.includes('dumpsys')).length >= 2);
  if (i === 2) assert.deepEqual(f.gestures, ['up', 'down']);
});
for (const initial of ['closed', 'home', 'old-search', 'playing-other']) test('OFFLINE starts from observed state ' + initial, async () => {
  const f = runtimeFixture(commands[0], 'success', initial), last = await run(f);
  assert.equal(last.status, 'COMPLETED', last.reason); assert.equal(last.v2.search.query, 'OpenAI'); assert.equal(f.clicks, 1); assert.equal(f.closed, 1);
});
test('OFFLINE existing LAUNCH recovery blocks an unresolved menu without guessing or looping actions', async () => {
  const f = runtimeFixture(commands[0], 'success', 'menu'), last = await run(f);
  assert.equal(last.status, 'BLOCKED'); assert.match(last.reason, /EXPLORATION_EPOCH_LOOP/);
  assert.equal(f.clicks, 0); assert.equal(f.rpc.length, 0); assert.equal(f.closed, 1);
});
for (const mode of ['wrong-title', 'wrong-channel', 'ad', 'loading', 'unavailable', 'paused', 'frozen', 'wrong-media', 'wrong-media-channel', 'unknown', 'timeout', 'stale', 'session-loss', 'cancel', 'duplicate', 'unknown-type', 'empty', 'ack-only']) {
  test('OFFLINE no false completion/replay: ' + mode, async () => {
    const f = runtimeFixture(commands[0], mode), last = await run(f);
    assert.equal(last.status, mode === 'cancel' ? 'CANCELLED' : 'BLOCKED', last.reason);
    assert.notEqual(last.v2.completion, 'ALL_VERIFIED'); assert.equal(f.closed, 1); assert.equal(f.activeSession, undefined); assert.equal(f.modelCalls, 0);
    assert.ok(f.clicks <= 1);
    if (['unknown', 'timeout', 'session-loss', 'cancel'].includes(mode)) assert.equal(f.clicks, 1);
    if (['stale', 'duplicate', 'unknown-type', 'empty'].includes(mode)) assert.equal(f.clicks, 0);
  });
}
test('OFFLINE scroll without overlap never substitutes an ordinal', async () => {
  const f = runtimeFixture(commands[2], 'gap'), last = await run(f, commands[2]);
  assert.equal(last.status, 'BLOCKED'); assert.equal(f.clicks, 0); assert.equal(f.closed, 1);
});
test('OFFLINE playing screen without search/navigation evidence stays BLOCKED without HOME/BACK guessing', async () => {
  const f = runtimeFixture(commands[0], 'no-search', 'playing-other'), last = await run(f);
  assert.equal(last.status, 'BLOCKED'); assert.equal(f.clicks, 0); assert.equal(f.actions.length, 0); assert.equal(f.rpc.length, 0); assert.equal(f.closed, 1);
});

async function scopedFixture() {
  const g = compileOutcomes(commands[0], 'A', 'E'); g.nodes.forEach(n => n.packageName = pkg);
  const node = g.nodes[1], scope = beginSearch(node, 'A', 'E', 'S');
  try {
    require('./fixtures/search-protocol.cjs').enter(node, scope, scene('input'), scene('input', 'OpenAI'));
    const before = scene('input', 'OpenAI'), c = generateGroundedCandidates(node, before, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, before); noteSearchSubmitted(c);
    const context = { deviceId: 'A', executionId: 'E', nodeId: node.id, packageName: pkg };
    verifySearchOutcome(scope, scene('results', 'OpenAI'), context);
    const proof = verifySearchOutcome(scope, scene('results', 'OpenAI'), context); assert.ok(proof);
    const explorer = new UIExplorer({ read: async () => scene('results', 'OpenAI'), locate: async (s) => ({ id: 'native', snapshot: s }) },
      { scroll: async () => false }, ExplorationConfigSchema.parse({ maxScrolls: 2, settleTimeoutMs: 100 }));
    assert.equal((await explorer.find('video_card_1', 1000, false)).status, 'FOUND');
    const view = scene('results', 'OpenAI'), resultScope = beginVideoResult(g.nodes[2], view, proof, 'S', explorer.memorySummary());
    const candidate = generateGroundedCandidates(g.nodes[2], view, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, resultScope).candidates[0];
    return { g, proof, scope: resultScope, candidate, memory: explorer.memorySummary(), view,
      context: { ...context, nodeId: g.nodes[2].id }, ack() { beforeVideoResultDispatch(candidate, scene('results', 'OpenAI')); acknowledgeVideoResult(candidate); } };
  } finally { closeSearch(scope); }
}
test('OFFLINE provenance/candidate/grant binding cannot be cloned, changed, replayed or moved between Sessions/devices', async () => {
  const f = await scopedFixture(); assert.ok(f.candidate);
  for (const [proof, view, session, memory] of [[{ ...f.proof }, f.view, 'S', f.memory], [f.proof, { ...f.view, deviceSerial: 'B' }, 'S', f.memory],
    [f.proof, f.view, 'other', f.memory], [f.proof, scene('results', 'other'), 'S', f.memory], [f.proof, f.view, 'S', { ...f.memory, anchored: false }]]) {
    assert.throws(() => beginVideoResult(f.g.nodes[2], view, proof, session, memory), /UNPROVEN/);
  }
  assert.throws(() => issueEffectGrant({ ...f.candidate }, f.g.nodes[2]), /issued|authorized/);
  const grant = issueEffectGrant(f.candidate, f.g.nodes[2]);
  assert.throws(() => consumeEffectGrant(grant, 'B', 'S'), /another Session\/device/);
  assert.throws(() => consumeEffectGrant(grant, 'A', 'other'), /another Session\/device/);
  consumeEffectGrant(grant, 'A', 'S'); assert.throws(() => consumeEffectGrant(grant, 'A', 'S'), /replayed/);
  assert.equal(verifyVideoResultOutcome(f.scope, scene('player'), f.context), undefined, 'ACK is required before readback');
  f.ack(); assert.ok(isVerifiedEvidence(verifyVideoResultOutcome(f.scope, scene('player'), f.context)));
  assert.throws(() => issueEffectGrant(f.candidate, f.g.nodes[2]), /issued/);
});
test('OFFLINE fabricated playback/clone receipt and unsafe metadata cannot attest completion', async () => {
  const f = await scopedFixture(); f.ack(); const context = { ...f.context, nodeId: f.scope.nodeId + ':playback' };
  const snapshot = scene('player'); snapshot.playback = { source: 'ADB_MEDIA_SESSION', title: 'Alpha', packageName: pkg, previousPositionMs: 1, positionMs: 2 };
  const fake = { scopeId: f.scope.id, sessionId: 'S', snapshot, positionMs: 2, previousPositionMs: 1 };
  assert.equal(verifyVideoResultOutcome(f.scope, snapshot, context, fake), undefined);
  assert.equal(verifyVideoResultOutcome({ ...f.scope }, snapshot, f.context), undefined);
  const overlay = scene('player', '', 0, { overlay: true }); assert.equal(verifyVideoResultOutcome(f.scope, overlay, f.context), undefined);
});

for (const request of commands) test('OFFLINE Unified ANALYZE -> actual runtime preparation preserves four steps and experimental V2 label: ' + request, async () => {
  let sessions = 0, legacy = 0;
  const registry = new DeviceRuntimeRegistry({
    discover: async () => [{ serial: 'A', physicalId: 'physical-A', status: 'device', identityVerified: true }],
    v2: () => ({ catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) }, open: async () => { sessions++; assert.fail('ANALYZE cannot open Session'); } }),
    plan: async () => { legacy++; assert.fail('No V1'); }, open: async () => { legacy++; assert.fail('No legacy engine'); },
  });
  const service = new UnifiedAgentService({ context: async () => ({ deviceId: 'A', physicalId: 'physical-A', backend: 'appium', runtimeHash: 'offline', policyMode: 'normal', busy: false }),
    prepare: (source, deviceId, engine) => registry.prepare(source, deviceId, engine), start: async () => assert.fail('No START on analyze'), tasks: async () => [], cancel: async () => {} });
  const { plan } = await service.analyzeForDashboard({ source: request, deviceId: 'A' });
  assert.equal(plan.engine, 'V2'); assert.equal(plan.source, request); assert.equal(plan.steps.length, 4);
  assert.match(plan.steps[3], /hai lần đọc/); assert.ok(plan.catalog.some(c => c.capability === 'VIDEO_PLAYBACK' && c.status === 'EXPERIMENTAL'));
  assert.equal(sessions, 0); assert.equal(legacy, 0);
});
test('OFFLINE catalog bounds, no dropped clauses, hard deny and no legacy reactivation', () => {
  for (const source of [commands[0].replace('đầu tiên', 'thứ 4'), commands[0].replace('đầu tiên', 'thứ 99'),
    'Mở YouTube và phát video đầu tiên', 'Mở YouTube, tìm OpenAI và mở video thứ hai']) assert.throws(() => routeCapability(source, 'appium'), /CAPABILITY_DISABLED/);
  assert.throws(() => routeCapability(commands[0] + ' rồi xóa ảnh cũ', 'appium'), /HARD_DENY/);
  assert.throws(() => routeCapability(commands[0], 'appium', 'V1'), /ENGINE_SELECTION_REMOVED/);
  assert.throws(() => routeCapability(commands[0], 'adb'), /BACKEND_UNSUPPORTED/);
});
test('OFFLINE stale order, hidden player title and reused/forged playback receipt fail closed', async () => {
  const f = await scopedFixture();
  const reordered = scene('results', 'OpenAI');
  [reordered.nodes[4].description, reordered.nodes[5].description] = [reordered.nodes[5].description, reordered.nodes[4].description];
  assert.equal(generateGroundedCandidates(f.g.nodes[2], reordered, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates.length, 0);
  f.ack(); const hidden = scene('player'); hidden.nodes[1].displayed = false;
  assert.equal(verifyVideoResultOutcome(f.scope, hidden, f.context), undefined);
  let position = 0;
  const reader = createVideoPlaybackReader(async args => ({ stdout: args.includes('dumpsys') ? `package=${pkg}\nactive=true\nstate=PlaybackState {state=3, position=${position += 1000}, buffered position=10000, speed=1.0, updated=${position}, actions=1}\nmetadata: size=6, description=Alpha, Ocean, Ocean\n` : 'unsupported' }), 'A');
  const first = scene('player'); assert.equal(await reader(f.scope, first, 2000), undefined);
  assert.equal(await reader(f.scope, first, 2000), undefined, 'Repeated snapshot is not a fresh sample');
  const second = scene('player'), receipt = await reader(f.scope, second, 2000); assert.ok(receipt);
  const context = { ...f.context, nodeId: f.scope.nodeId + ':playback' };
  assert.ok(verifyVideoResultOutcome(f.scope, receipt.snapshot, context, receipt));
  assert.equal(verifyVideoResultOutcome(f.scope, receipt.snapshot, context, { ...receipt }), undefined);
  receipt.snapshot.nodes[1].text = 'Other video'; assert.equal(verifyVideoResultOutcome(f.scope, receipt.snapshot, context, receipt), undefined);
});
