/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { videoChannelEvidence, videoIdentityEvidence, videoResultTitle } = require('../lib/android/exploration/element-memory.ts');
const actual = 'OpenAI DevDay 2026 Keynote (FULL) - 53 phút, 35 giây - Chuyển đến kênh OpenAI - Kênh OpenAI, Đã xác minh - 689 nghìn lượt xem - Phát trực tiếp 4 tuần trước - phát video';
test('REAL_UI_REGRESSION agreeing navigation/channel badge labels are one channel, never two competing identities', () => {
  assert.deepEqual(videoChannelEvidence(actual), { channel: 'OpenAI', ambiguous: false });
  assert.equal(videoIdentityEvidence(actual), videoIdentityEvidence(actual.replace('689 nghìn', '690 nghìn')));
});
test('OFFLINE channel labels genuinely disagreeing remain ambiguous', () => {
  assert.deepEqual(videoChannelEvidence(actual.replace('Kênh OpenAI,', 'Kênh Impostor,')), { channel: undefined, ambiguous: true });
  assert.notEqual(videoIdentityEvidence(actual), videoIdentityEvidence(actual.replaceAll('OpenAI', 'Other')));
});
test('OFFLINE do not erase arbitrary comma-bearing channel names while removing known badge suffix', () => {
  assert.deepEqual(videoChannelEvidence('Title - 3 minutes - Channel Ocean, Research - Channel Ocean, Research, Verified - Play video'), { channel: 'Ocean, Research', ambiguous: false });
});
const { randomUUID } = require('node:crypto');
const { readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { observeYouTubeState, videoSeconds } = require('../lib/android/agent/youtube-state.ts');
const { videoWaitLimits } = require('../lib/android/agent/video-result-contract.ts');
const { beginSearch, closeSearch, beforeSearchDispatch, noteSearchSubmitted, searchTransitionSatisfied, noteSearchNavigation } = require('../lib/android/agent/generic-search.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { verifySearchOutcome, verifyVideoResultOutcome } = require('../lib/android/agent/verification-registry.ts');
const { beginVideoResult, beforeVideoResultDispatch, acknowledgeVideoResult, createVideoPlaybackReader, createPausedVideoIdentityReader, videoPlaybackStatus } = require('../lib/android/agent/video-result.ts');
const { executeGroundedInteraction, consumeNotSentReceipt } = require('../lib/android/grounded-interactions.ts');
const { UIExplorer } = require('../lib/android/exploration/ui-explorer.ts');
const { ExplorationConfigSchema, explorationGoal } = require('../lib/android/exploration/types.ts');
const { discoveryCandidates } = require('../lib/android/exploration/element-memory.ts');
const { detectScrollRegion } = require('../lib/android/exploration/scroll-regions.ts');
const pkg = 'com.google.android.youtube';
function view(stage, query = '', current = 10) {
  let nodes = stage === 'player' ? [
    { resourceId: pkg + ':id/watch_player', bounds: [0, 0, 400, 300] },
    { resourceId: pkg + ':id/player_view', parentIndex: 0, bounds: [0, 0, 400, 300] },
    { resourceId: pkg + ':id/video_metadata_layout', bounds: [0, 300, 400, 800] },
    { description: 'Ocean 2,1 Tr người đăng ký', parentIndex: 2, bounds: [0, 320, 200, 380] },
    { resourceId: pkg + ':id/watch_while_time_bar_view', bounds: [0, 0, 400, 320] },
    { className: 'android.widget.SeekBar', description: current + ' giây / 3 phút', parentIndex: 4, bounds: [0, 290, 400, 320] },
  ] : [{ resourceId: pkg + ':id/search_query', text: query, description: stage === 'input' ? '' : 'Search', className: stage === 'input' ? 'android.widget.EditText' : 'android.widget.TextView', focused: stage === 'input', clickable: true, bounds: [0, 0, 400, 50] },
    ...(stage === 'results' ? [{ resourceId: pkg + ':id/results', className: 'androidx.recyclerview.widget.RecyclerView', scrollable: true, bounds: [0, 50, 400, 800] },
      { description: 'Alpha - 3 minutes - Channel Ocean - Play video', parentIndex: 1, clickable: true, bounds: [0, 80, 400, 300] }] : [])];
  nodes = nodes.map(n => ({ resourceId: '', className: 'android.view.View', text: '', description: '', packageName: pkg, bounds: [0, 0, 100, 50], enabled: true, displayed: true, focused: false, clickable: false, ...n }));
  const snapshotId = randomUUID();
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', screen: stage === 'player' ? 'VIDEO_PLAYER' : stage === 'results' ? 'SEARCH_RESULTS' : 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}
const source = 'Mở YouTube, tìm OpenAI và phát video đầu tiên';
async function scopeFixture(beforeSelection = false) {
  const g = compileOutcomes(source, 'A', 'E'); g.nodes.forEach(n => n.packageName = pkg);
  const n = g.nodes[1], search = beginSearch(n, 'A', 'E', 'S');
  try {
    require('./fixtures/search-protocol.cjs').enter(n, search, view('input'), view('input', 'OpenAI'));
    const before = view('input', 'OpenAI'), c = generateGroundedCandidates(n, before, 'E', 'S', false, 0, '', false, undefined, false, search).candidates[0];
    consumeEffectGrant(issueEffectGrant(c, n), 'A', 'S'); beforeSearchDispatch(c, before); noteSearchSubmitted(c);
    const context = { deviceId: 'A', executionId: 'E', nodeId: n.id, packageName: pkg };
    verifySearchOutcome(search, view('results', 'OpenAI'), context);
    const proof = verifySearchOutcome(search, view('results', 'OpenAI'), context); assert.ok(proof);
    const explorer = new UIExplorer({ read: async () => view('results', 'OpenAI'), locate: async s => ({ id: 'native', snapshot: s }) }, { scroll: async () => false }, ExplorationConfigSchema.parse({ maxScrolls: 2 }));
    assert.equal((await explorer.find('video_card_1', 1000, false)).status, 'FOUND');
    const v = view('results', 'OpenAI'), scope = beginVideoResult(g.nodes[2], v, proof, 'S', explorer.memorySummary());
    const candidate = generateGroundedCandidates(g.nodes[2], v, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, scope).candidates[0];
    if (!beforeSelection) { beforeVideoResultDispatch(candidate, view('results', 'OpenAI')); acknowledgeVideoResult(candidate); }
    const node = g.nodes[beforeSelection ? 2 : 3];
    return { scope, node, context: { ...context, nodeId: node.id } };
  } finally { closeSearch(search); }
}
test('REAL_UI_REGRESSION nested player without accessible title needs independent UI channel/duration/advance AND matching MediaSession title/channel/advance', async () => {
  const f = await scopeFixture(); let position = 9000;
  const reader = createVideoPlaybackReader(async args => ({ stdout: args.includes('dumpsys') ? `package=${pkg}\nactive=true\nstate=PlaybackState {state=3, position=${position += 1000}, buffered position=0, speed=1.0, updated=${position}, actions=1}\nmetadata: size=6, description=Alpha, Ocean, Ocean\n` : 'unsupported' }), 'A');
  assert.equal(await reader(f.scope, view('player', '', 10), 2000), undefined);
  const receipt = await reader(f.scope, view('player', '', 11), 2000); assert.ok(receipt);
  const proof = verifyVideoResultOutcome(f.scope, receipt.snapshot, f.context, receipt); assert.ok(proof);
  assert.equal(proof.videoResult.identityTier, 'UI_CHANNEL_DURATION_PROGRESS');
});
for (const mode of ['channel', 'duration', 'frozen-ui', 'desynchronized', 'duplicate-player', 'missing-seekbar', 'contradictory-title', 'paused', 'wrong-media', 'stale-media']) test('OFFLINE composite native proof rejects ' + mode, async () => {
  const f = await scopeFixture(); let position = 9000;
  const reader = createVideoPlaybackReader(async args => ({ stdout: args.includes('dumpsys') ? `package=${pkg}\nactive=true\nstate=PlaybackState {state=3, position=${mode === 'stale-media' ? 10000 : position += 1000}, buffered position=0, speed=1.0, updated=1000, actions=1}\nmetadata: size=6, description=${mode === 'wrong-media' ? 'Other video' : 'Alpha'}, Ocean, Ocean\n` : 'unsupported' }), 'A');
  function sample(current) {
    const s = view('player', '', mode === 'frozen-ui' ? 10 : mode === 'desynchronized' ? current + 50 : current);
    if (mode === 'channel') s.nodes[3].description = 'Other 2,1 Tr người đăng ký';
    if (mode === 'duration') s.nodes[5].description = current + ' giây / 7 phút';
    if (mode === 'duplicate-player') s.nodes.push({ ...s.nodes[0], parentIndex: undefined });
    if (mode === 'missing-seekbar') s.nodes[5].displayed = false;
    if (mode === 'contradictory-title') s.nodes.push({ ...s.nodes[3], resourceId: pkg + ':id/video_title', text: 'Wrong video', description: '' });
    if (mode === 'paused') s.nodes.push({ ...s.nodes[3], description: 'Play video', clickable: true });
    return s;
  }
  assert.equal(await reader(f.scope, sample(10), 2000), undefined); assert.equal(await reader(f.scope, sample(11), 2000), undefined);
});
for (const [clause, n] of [['phát video thứ nhất', 1], ['phat video thu nhat', 1], ['phát video số 3', 3], ['phát video thứ ba', 3], ['mở video đầu tiên', 1]]) test('OFFLINE source-preserving grammar ' + clause, () => {
  const g = compileOutcomes('Mở YouTube, tìm hải dương học và ' + clause, 'A', 'E'); assert.equal(g.coverage, 'COMPLETE');
  const select = g.nodes.find(n => n.capability === 'SELECT_RESULT'); assert.equal(select.outcome.videoResult.ordinal, n); assert.equal(select.outcome.videoResult.play, true);
});
test('OFFLINE app-qualified search keeps two original clauses, exact query, implied foreground guard and mandatory playback child', () => {
  const source = 'Tìm nhạc không lời trên YouTube và phát video thứ hai', g = compileOutcomes(source, 'A', 'E');
  assert.equal(g.coverage, 'COMPLETE'); assert.equal(g.original.outcomes.length, 2);
  assert.deepEqual(g.nodes.map(n => n.capability), ['SEARCH', 'SELECT_RESULT', 'VERIFY_PLAYBACK']);
  assert.equal(g.nodes[0].app, 'YouTube'); assert.equal(g.nodes[0].outcome.value, 'nhạc không lời');
  assert.equal(g.nodes[1].outcome.videoResult.ordinal, 2);
  for (const node of g.nodes) assert.equal(source.slice(node.outcome.span.start, node.outcome.span.end), node.outcome.span.text);
});
test('OFFLINE current livestream excluded; archived live with a finite duration remains an ordinary replay', () => {
  const s = view('results', 'OpenAI'); s.nodes[2].description = 'Live stream - live - Channel Ocean - Play video';
  const goal = explorationGoal('video_card_1'); assert.equal(discoveryCandidates(s, detectScrollRegion(s, goal).region, goal).candidates.length, 0);
  s.nodes[2].description = actual; assert.equal(discoveryCandidates(s, detectScrollRegion(s, goal).region, goal).candidates.length, 1);
});
test('OFFLINE player controls are revealed only from an observed safe overlay, then exit by a fresh explicit navigation target', () => {
  const g = compileOutcomes(source, 'A', 'E'), node = g.nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const initial = view('player'); initial.nodes[1] = { ...initial.nodes[1], resourceId: pkg + ':id/player_overlays', clickable: true };
    initial.elements = initial.nodes.map((n, i) => ({ ...n, elementId: initial.snapshotId + ':' + i }));
    const c = generateGroundedCandidates(node, initial, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    assert.equal(c.search.phase, 'REVEAL'); consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, initial); noteSearchNavigation(c);
    const after = view('player'); after.nodes.push({ ...after.nodes[3], description: 'Thu nhỏ', clickable: true }); after.elements = after.nodes.map((n, i) => ({ ...n, elementId: after.snapshotId + ':' + i }));
    assert.equal(searchTransitionSatisfied(c, after), true);
    const next = generateGroundedCandidates(node, after, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    assert.equal(next.search.phase, 'RESET'); assert.equal(next.action, 'CLICK'); assert.equal(next.target.label, 'Thu nhỏ');
  } finally { closeSearch(scope); }
});
test('OFFLINE state and clock parsing stay deterministic and do not confuse search results/mini-player with a watch destination', () => {
  const s = view('results', 'OpenAI'); s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/miniplayer' });
  assert.equal(observeYouTubeState(s).state, 'SEARCH_RESULTS'); assert.equal(observeYouTubeState(s).miniPlayer, true);
  assert.equal(observeYouTubeState({ ...s, foregroundPackage: 'launcher' }).state, 'APP_NOT_OPEN');
  assert.equal(videoSeconds('53 phút, 35 giây'), 3215); assert.equal(videoSeconds('00:00'), 0); assert.equal(videoSeconds('1:99'), undefined);
});
test('OFFLINE resume Play requires an acknowledged selection, explicit matching UI title/channel and a unique scoped native Play button; one shot only', async () => {
  const f = await scopeFixture(), s = view('player');
  s.nodes.push({ ...s.nodes[3], resourceId: pkg + ':id/video_title', text: 'Alpha', description: '' },
    { ...s.nodes[3], resourceId: pkg + ':id/channel_name', text: 'Ocean', description: '' },
    { ...s.nodes[1], className: 'android.widget.ImageButton', description: 'Play video', clickable: true, parentIndex: 0 });
  s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
  const manifest = v => generateGroundedCandidates(f.node, v, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates;
  assert.equal(videoPlaybackStatus(f.scope, s), 'CORRECT_VIDEO_PAUSED');
  const c = manifest(s)[0]; assert.equal(c.videoResult.phase, 'PLAY');
  const wrong = structuredClone(s); wrong.nodes.at(-3).text = 'Wrong'; assert.equal(manifest(wrong).length, 0);
  const missingTitle = structuredClone(s); missingTitle.nodes.at(-3).resourceId = ''; missingTitle.nodes.at(-3).text = ''; assert.equal(manifest(missingTitle).length, 0);
  consumeEffectGrant(issueEffectGrant(c, f.node), 'A', 'S'); beforeVideoResultDispatch(c, s);
  assert.equal(manifest(s).length, 0, 'UNKNOWN Play dispatch cannot obtain another candidate');
  acknowledgeVideoResult(c); assert.equal(manifest(s).length, 0);
});
test('REAL_UI_REGRESSION close an observed mini-player only by its unique semantic native control, never an ad link or free BACK', () => {
  const g = compileOutcomes(source, 'A', 'E'), node = g.nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const s = view('results', 'OpenAI'); s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/modern_miniplayer_close', text: '', description: 'Đóng trình phát thu nhỏ', clickable: true });
    s.nodes.at(-1).bounds = [300, 350, 390, 430];
    s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
    const make = v => generateGroundedCandidates(node, v, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates;
    const c = make(s)[0]; assert.equal(c.search.phase, 'CLOSE_MINI'); assert.equal(c.action, 'CLICK');
    const wrong = structuredClone(s); wrong.nodes.at(-1).description = 'Visit sponsor'; assert.ok(make(wrong).every(c => c.search.phase !== 'CLOSE_MINI'));
    consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, s);
    assert.ok(make(s).every(c => c.search.phase !== 'CLOSE_MINI'), 'Unknown dispatch must not replay');
    assert.equal(searchTransitionSatisfied(c, view('results', 'OpenAI')), true);
  } finally { closeSearch(scope); }
});

test('REAL_UI_REGRESSION populated video_info_loading_layout is a metadata wrapper; an actual loading indicator still blocks playback proof', async () => {
  const f = await scopeFixture(); let position = 9000;
  const reader = createVideoPlaybackReader(async args => ({ stdout: args.includes('dumpsys') ? `package=${pkg}\nactive=true\nstate=PlaybackState {state=3, position=${position += 1000}, buffered position=0, speed=1.0, updated=${position}, actions=1}\nmetadata: size=6, description=Alpha, Ocean, Ocean\n` : 'unsupported' }), 'A');
  function native(current, indicator = false) {
    const s = view('player', '', current);
    s.nodes.push({ ...s.nodes[3], resourceId: pkg + ':id/video_info_loading_layout', text: '', description: '', parentIndex: 3 });
    if (indicator) s.nodes.push({ ...s.nodes[3], className: 'android.widget.ProgressBar', resourceId: pkg + ':id/loading', text: '', description: '' });
    return s;
  }
  assert.equal(await reader(f.scope, native(10), 2000), undefined);
  assert.ok(await reader(f.scope, native(11), 2000));
  assert.equal(await reader(f.scope, native(12, true), 2000), undefined);
});

function pausedView() {
  const s = view('player');
  s.nodes.push({ ...s.nodes[1], className: 'android.widget.ImageView', resourceId: pkg + ':id/player_control_play_pause_replay_button', description: 'Phát video', clickable: true });
  s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i })); return s;
}
function pausedMedia(mode = '') {
  const block = `package=${pkg}\nactive=true\nstate=PlaybackState {state=${mode === 'playing' ? 3 : 2}, position=${mode === 'position' ? 25000 : 10000}, buffered position=0, speed=1.0, updated=1000, actions=1}\nmetadata: size=6, description=${mode === 'title' ? 'Other video' : 'Alpha'}, ${mode === 'channel' ? 'Other channel' : 'Ocean'}, Ocean\n`;
  return mode === 'duplicate' ? block + block : mode === 'inactive' ? block.replace('active=true', 'active=false') : block;
}
test('OFFLINE paused native composite identity requires a fresh independent exact MediaSession before one Play, and cannot attest completion', async () => {
  const f = await scopeFixture(), s = pausedView();
  const make = v => generateGroundedCandidates(f.node, v, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates;
  assert.equal(make(s).length, 0, 'UI channel/duration alone cannot authorize Play');
  assert.equal(await createPausedVideoIdentityReader(async () => ({ stdout: pausedMedia() }), 'A')(f.scope, s, 2000), true);
  const c = make(s)[0]; assert.equal(c.videoResult.phase, 'PLAY');
  const changed = pausedView(); changed.nodes[5].description = '11 giây / 3 phút';
  assert.equal(make(changed).length, 0, 'Paused clock must remain identical at dispatch');
  assert.equal(verifyVideoResultOutcome(f.scope, s, f.context), undefined, 'Paused identity is never playback completion');
  consumeEffectGrant(issueEffectGrant(c, f.node), 'A', 'S'); beforeVideoResultDispatch(c, pausedView());
  assert.equal(make(s).length, 0, 'Lost Play acknowledgement cannot replay');
});
for (const mode of ['title', 'channel', 'position', 'playing', 'duplicate', 'inactive', 'stale', 'foreign-scope']) test('OFFLINE paused Play admission rejects ' + mode, async () => {
  const f = await scopeFixture(), s = pausedView(); if (mode === 'stale') s.timestamp -= 6000;
  const read = createPausedVideoIdentityReader(async () => ({ stdout: pausedMedia(mode) }), 'A');
  assert.equal(await read(mode === 'foreign-scope' ? { ...f.scope } : f.scope, s, 2000), false);
  assert.equal(generateGroundedCandidates(f.node, pausedView(), 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates.length, 0);
});
test('OFFLINE mini-player locate failure is NOT_SENT and does not consume its one dispatch; UNKNOWN still consumes it', async () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const s = view('results', 'OpenAI'); s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/modern_miniplayer_close', text: '', description: 'Đóng trình phát thu nhỏ', clickable: true });
    s.nodes.at(-1).bounds = [300, 350, 390, 430];
    s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
    const make = () => generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates;
    const session = { serial: 'A', sessionId: 'S', ensureActive: async () => {}, client: { request: async () => assert.fail('No RPC dispatch after locate failure') } };
    await assert.rejects(executeGroundedInteraction(session, { readNativeSnapshot: async () => s, locate: async () => undefined }, issueEffectGrant(make()[0], node)), e => e.dispatchState === 'NOT_SENT');
    const next = make()[0]; assert.equal(next.search.phase, 'CLOSE_MINI');
    beforeSearchDispatch(next, s); assert.ok(make().every(c => c.search.phase !== 'CLOSE_MINI'));
  } finally { closeSearch(scope); }
});

test('OFFLINE occluded mini-player close is omitted; an observed Search remains available with independent native exclusive-point validation', () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const s = view('results', 'OpenAI');
    s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/modern_miniplayer_close', text: '', description: 'Đóng trình phát thu nhỏ', bounds: [300, 0, 390, 50] });
    s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i }));
    const candidates = generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates;
    assert.ok(candidates.length); assert.ok(candidates.every(c => c.search.phase !== 'CLOSE_MINI'));
    assert.equal(candidates[0].search.phase, 'OPEN');
    const point = require('../lib/android/activation-point.ts').exclusiveActivationPoint(s, s.nodes[0]);
    assert.ok(point.x < 300, 'Proven point must avoid every overlapping control; no occlusion bypass');
  } finally { closeSearch(scope); }
});

test('OFFLINE native video discovery has a finite configurable budget while verification limits and the outer execution budget remain independent', () => {
  const name = 'AGENT_V2_VIDEO_DISCOVERY_MS', old = process.env[name];
  try {
    delete process.env[name]; assert.equal(videoWaitLimits().discoveryMs, 60000);
    process.env[name] = '1000'; assert.equal(videoWaitLimits().discoveryMs, 1000);
    process.env[name] = '90001'; assert.throws(videoWaitLimits, /Invalid bounded YouTube limit/);
    process.env[name] = 'Infinity'; assert.throws(videoWaitLimits, /Invalid bounded YouTube limit/);
  } finally { if (old === undefined) delete process.env[name]; else process.env[name] = old; }
});

test('OFFLINE numeric titles and duration-like title fragments never replace the exact duration metadata field', () => {
  for (const title of ['3 Giờ Nhạc Piano Thư Giãn', '20 Minutes English Podcast', 'Alpha - 10 minutes meditation']) {
    const description = title + ' - 2 giờ, 3 phút, 1 giây - Channel Ocean - Play video';
    assert.equal(videoResultTitle(description), title);
    assert.equal(videoIdentityEvidence(description), JSON.stringify([title, '2 giờ, 3 phút, 1 giây', 'Ocean']));
  }
  assert.equal(videoResultTitle('3 Hours Relaxation - Channel Ocean - Play video'), undefined);
  assert.equal(videoResultTitle('Alpha - 1:99 - Channel Ocean - Play video'), undefined);
});

for (const mode of ['direct-abort', 'wrapped-abort', 'strict-abort']) test('OFFLINE interrupted catalog identity read forces fresh transport validation: ' + mode, async () => {
  const serial = 'YT_ABORT_' + randomUUID(), props = hardware => ({ stdout: `[ro.serialno]: [${hardware}]\n[ro.boot.serialno]: [${hardware}]\n[ro.product.manufacturer]: [Fixture]\n[ro.product.model]: [FixtureModel]\n` });
  const before = await readTransportIdentity(async () => props('FAKEOWNER01'), serial, true);
  const aborted = async () => { const error = new DOMException('Fixture cancellation', 'AbortError'); throw mode === 'wrapped-abort' ? new Error('Interrupted read', { cause: error }) : error; };
  if (mode === 'strict-abort') await assert.rejects(readTransportIdentity(aborted, serial, true, 5000, true), /Unable to verify/);
  else assert.equal(await readTransportIdentity(aborted, serial, true), undefined);
  let reads = 0;
  const after = await readTransportIdentity(async () => { reads++; return props('FAKEOWNER02'); }, serial);
  assert.equal(reads, 1, 'No stale positive or negative identity may authorize admission after an interrupted read');
  assert.ok(after); assert.notEqual(after.physicalId, before.physicalId, 'A physical change remains visible for binding rejection');
});

test('OFFLINE a completed invalid identity read stays unverified; interruption fix does not relax malformed identity or hardware-serial agreement', async () => {
  const serial = 'YT_INVALID_' + randomUUID();
  assert.equal(await readTransportIdentity(async () => ({ stdout: '[ro.serialno]: [FAKEOWNER01]\n[ro.boot.serialno]: [FAKEOWNER02]\n[ro.product.manufacturer]: [Fixture]\n[ro.product.model]: [FixtureModel]\n' }), serial, true), undefined);
  assert.equal(await readTransportIdentity(async () => assert.fail('Completed failure cache remains fail-closed'), serial), undefined);
});

test('OFFLINE V2 reuses one still-valid post-Reveal snapshot instead of losing transient controls to a redundant source read; dispatch remains scoped', async () => {
  const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts'), { AgentBudget } = require('../lib/android/agent/budget.ts');
  let revealed = false, redundantReads = 0, closed = 0; const phases = [], events = [];
  const hidden = () => { const s = view('player'); s.nodes[1] = { ...s.nodes[1], resourceId: pkg + ':id/player_overlays', clickable: true }; s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i })); return s; };
  const execution = { backend: 'appium', sessionId: () => 'S', observe: async () => {
    if (revealed) { redundantReads++; throw Error('Transient controls lost during redundant source RPC'); } return hidden();
  }, execute: async () => assert.fail('No unrelated primitive expected'), close: async () => { closed++; }, interactV2: async grant => {
    const c = grant.candidate; consumeEffectGrant(grant, 'A', 'S'); phases.push(c.search.phase);
    if (c.search.phase === 'REVEAL') {
      beforeSearchDispatch(c, hidden()); noteSearchNavigation(c); revealed = true;
      const post = view('player'); post.nodes.push({ ...post.nodes[1], resourceId: pkg + ':id/minimize_button', description: 'Thu nhỏ', clickable: true });
      post.elements = post.nodes.map((n, i) => ({ ...n, elementId: post.snapshotId + ':' + i }));
      await new Promise(resolve => setTimeout(resolve, 1300)); return post;
    }
    assert.equal(c.search.phase, 'RESET'); assert.equal(c.action, 'CLICK'); assert.equal(c.target.label, 'Thu nhỏ');
    throw Error('TEST_STOP_BEFORE_NATIVE_RESET');
  } };
  await runAgentV2(source, 'A', 'E', 'physical-A', new AgentBudget(), {
    catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) }, open: async () => execution,
  }, e => events.push(e), undefined, async () => assert.fail('No model in scoped UI protocol'));
  assert.deepEqual(phases, ['REVEAL', 'RESET']); assert.equal(redundantReads, 0); assert.equal(closed, 1);
  assert.equal(events.at(-1).status, 'BLOCKED'); assert.match(events.at(-1).reason, /TEST_STOP_BEFORE_NATIVE_RESET/);
});

function adView(mode = '') {
  const s = mode === 'search-results' ? view('results', 'OpenAI') : view('player');
  s.nodes.push({ ...s.nodes[0], resourceId: pkg + ':id/ad_badge', description: '', text: 'Ad', clickable: false });
  const skip = { ...s.nodes[1], className: 'android.widget.Button', resourceId: pkg + ':id/' + (mode === 'advertiser-id' ? 'visit_advertiser' : 'skip_ad_button'),
    parentIndex: 1, clickable: true, description: mode === 'advertiser-label' ? 'Visit advertiser' : mode === 'localized-label' ? 'Bỏ qua' : '', text: '', bounds: [280, 210, 390, 270] };
  if (mode === 'foreign-package') skip.packageName = 'com.advertiser';
  s.nodes.push(skip); if (mode === 'duplicate') s.nodes.push({ ...skip });
  if (mode === 'dialog') s.nodes.push({ ...s.nodes[0], className: 'android.app.Dialog' });
  if (mode === 'stale') s.timestamp -= 6000;
  s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i })); return s;
}
test('REAL_UI_REGRESSION one unlabeled native skip_ad_button may dismiss an observed ad; ACK alone never proves requested playback', async () => {
  const f = await scopeFixture(), ad = adView(), manifest = s => generateGroundedCandidates(f.node, s, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates;
  const c = manifest(ad)[0]; assert.equal(c.videoResult.phase, 'SKIP_AD');
  const clicks = [], session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (method, target) => { assert.equal(method, 'POST'); assert.ok(target.endsWith('/native-skip/click')); clicks.push(target); } } };
  const post = view('player');
  const observer = { readNativeSnapshot: async () => ad, locate: async () => ({ id: 'native-skip', interaction: { method: 'ELEMENT_CLICK' } }), waitUntil: async predicate => { assert.ok(await predicate(post)); return post; } };
  await executeGroundedInteraction(session, observer, issueEffectGrant(c, f.node));
  assert.equal(clicks.length, 1); assert.equal(manifest(adView()).length, 0, 'One Skip per selection scope, across graph nodes');
  assert.equal(verifyVideoResultOutcome(f.scope, post, f.context), undefined, 'Skip ACK cannot settle playback');
  let position = 9000;
  const reader = createVideoPlaybackReader(async () => ({ stdout: `package=${pkg}\nactive=true\nstate=PlaybackState {state=3, position=${position += 1000}, buffered position=0, speed=1.0, updated=1000, actions=1}\nmetadata: size=6, description=Alpha, Ocean, Ocean\n` }), 'A');
  assert.equal(await reader(f.scope, view('player', '', 10), 2000), undefined);
  const receipt = await reader(f.scope, view('player', '', 11), 2000); assert.ok(receipt);
  assert.ok(verifyVideoResultOutcome(f.scope, receipt.snapshot, f.context, receipt));
});
for (const mode of ['advertiser-id', 'advertiser-label', 'foreign-package', 'duplicate', 'dialog', 'stale', 'search-results']) test('OFFLINE ad Skip excludes unsafe or ambiguous target: ' + mode, async () => {
  const f = await scopeFixture();
  const offered = generateGroundedCandidates(f.node, adView(mode), 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates;
  assert.ok(offered.every(c => c.videoResult?.phase !== 'SKIP_AD'));
  // The existing generic benign-dialog BACK candidate is outside this Skip
  // contract. Do not change that shared behavior to satisfy this new test.
  if (mode !== 'dialog') assert.equal(offered.length, 0);
});
test('OFFLINE localized Skip is one-shot after dispatch even without acknowledgement; no second ad click is offered', async () => {
  const f = await scopeFixture(), s = adView('localized-label');
  const make = v => generateGroundedCandidates(f.node, v, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates;
  const c = make(s)[0]; assert.equal(c.videoResult.phase, 'SKIP_AD');
  consumeEffectGrant(issueEffectGrant(c, f.node), 'A', 'S'); beforeVideoResultDispatch(c, s);
  assert.equal(make(adView('localized-label')).length, 0); assert.throws(() => beforeVideoResultDispatch(c, s), /STALE_OR_REPLAYED/);
});
test('OFFLINE video search can dismiss a pre-existing ad only once; it still needs a separately committed exact query/results proof', async () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const s = adView(), make = () => generateGroundedCandidates(node, s, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates;
    const c = make()[0]; assert.equal(c.search.phase, 'SKIP_AD');
    const session = { serial: 'A', sessionId: 'S', ensureActive: async () => {}, client: { request: async () => assert.fail('No dispatch without a located native target') } };
    await assert.rejects(executeGroundedInteraction(session, { readNativeSnapshot: async () => s, locate: async () => undefined }, issueEffectGrant(c, node)), e => e.dispatchState === 'NOT_SENT');
    const next = make()[0]; assert.equal(next.search.phase, 'SKIP_AD');
    consumeEffectGrant(issueEffectGrant(next, node), 'A', 'S'); beforeSearchDispatch(next, s);
    assert.ok(make().every(c => c.search.phase !== 'SKIP_AD'));
    assert.equal(searchTransitionSatisfied(next, adView()), false); assert.equal(searchTransitionSatisfied(next, view('player')), true);
    assert.equal(verifySearchOutcome(scope, view('player'), { deviceId: 'A', executionId: 'E', nodeId: node.id, packageName: pkg }), undefined);
  } finally { closeSearch(scope); }
});

function endedSuggestion(mode = '') {
  const s = view('player', '', 180); s.nodes[1] = { ...s.nodes[1], resourceId: pkg + ':id/player_overlays', clickable: true };
  s.nodes[5].description = (mode === 'not-ended' ? '10' : '180') + ' giây / 3 phút';
  s.nodes.push({ ...s.nodes[1], resourceId: pkg + ':id/touch_area', description: 'Video đề xuất - Other video - 4 phút - Ocean - Phát video', bounds: [0, 50, 400, 180], parentIndex: 1 });
  s.nodes.push({ ...s.nodes[1], resourceId: pkg + ':id/play_button', description: 'Phát ngay', bounds: [210, 190, 390, 270], parentIndex: 1 });
  s.nodes.push({ ...s.nodes[1], resourceId: pkg + ':id/cancel_button', description: mode === 'wrong-label' ? 'Install' : 'Đóng', bounds: [10, 190, 190, 270], parentIndex: mode === 'foreign-parent' ? 2 : 1 });
  if (mode === 'duplicate-cancel') s.nodes.push({ ...s.nodes.at(-1) });
  if (mode === 'missing-play') s.nodes = s.nodes.filter(n => !n.resourceId.endsWith(':id/play_button'));
  if (mode === 'duplicate-clock') s.nodes.push({ ...s.nodes[5] });
  s.nodes.push({ ...s.nodes[1], resourceId: pkg + ':id/close_button', description: 'Đóng', bounds: [350, 10, 390, 40], parentIndex: 1 });
  s.elements = s.nodes.map((n, i) => ({ ...n, elementId: s.snapshotId + ':' + i })); return s;
}
test('REAL_UI_REGRESSION dismiss an ended-video suggestion by its scoped Cancel, never Play now or an arbitrary Close; one shot with native readback', async () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const s = endedSuggestion(), make = v => generateGroundedCandidates(node, v, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates;
    const c = make(s)[0]; assert.equal(c.search.phase, 'DISMISS_RECOMMENDATION'); assert.ok(c.target.resourceId.endsWith(':id/cancel_button'));
    const clicks = [], post = view('player');
    const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (_method, target) => { assert.ok(target.endsWith('/native-cancel/click')); clicks.push(target); } } };
    const observer = { readNativeSnapshot: async () => s, locate: async () => ({ id: 'native-cancel', interaction: { method: 'ELEMENT_CLICK' } }), waitUntil: async predicate => { assert.ok(await predicate(post)); return post; } };
    await executeGroundedInteraction(session, observer, issueEffectGrant(c, node)); assert.equal(clicks.length, 1);
    assert.ok(make(endedSuggestion()).every(c => c.search.phase !== 'DISMISS_RECOMMENDATION'));
    assert.equal(searchTransitionSatisfied(c, endedSuggestion()), false); assert.equal(searchTransitionSatisfied(c, post), true);
  } finally { closeSearch(scope); }
});
for (const mode of ['not-ended', 'wrong-label', 'foreign-parent', 'duplicate-cancel', 'missing-play', 'duplicate-clock']) test('OFFLINE suggestion dismissal requires full independent end-card structure: ' + mode, () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try { assert.ok(generateGroundedCandidates(node, endedSuggestion(mode), 'E', 'S', false, 0, '', false, undefined, false, scope).candidates.every(c => c.search.phase !== 'DISMISS_RECOMMENDATION')); }
  finally { closeSearch(scope); }
});

test('OFFLINE a genuine NOT_SENT selection receipt permits only fresh grounding/new grant; an UNKNOWN selection never does', async () => {
  const f = await scopeFixture(true), make = s => generateGroundedCandidates(f.node, s, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, f.scope).candidates;
  let locates = 0, clicks = 0;
  const session = { serial: 'A', sessionId: 'S', path: '/session/S', ensureActive: async () => {}, client: { request: async (_method, target) => { assert.ok(target.endsWith('/native-card/click')); clicks++; } } };
  const observer = { readNativeSnapshot: async () => view('results', 'OpenAI'), locate: async () => ++locates === 1 ? undefined : ({ id: 'native-card', interaction: { method: 'ELEMENT_CLICK' } }), waitUntil: async predicate => { const post = view('player'); assert.ok(await predicate(post)); return post; } };
  const first = make(view('results', 'OpenAI'))[0]; let receipt;
  try { await executeGroundedInteraction(session, observer, issueEffectGrant(first, f.node)); assert.fail('Initial lookup must not dispatch'); } catch (e) { receipt = e; }
  assert.equal(receipt.dispatchState, 'NOT_SENT'); assert.equal(clicks, 0);
  assert.equal(consumeNotSentReceipt(receipt, first), true); assert.equal(consumeNotSentReceipt(receipt, first), false);
  const next = make(view('results', 'OpenAI'))[0]; assert.notEqual(next.snapshotId, first.snapshotId);
  await executeGroundedInteraction(session, observer, issueEffectGrant(next, f.node)); assert.equal(clicks, 1); assert.equal(locates, 2);
  assert.equal(make(view('results', 'OpenAI')).length, 0);
  const u = await scopeFixture(true), s = view('results', 'OpenAI'), c = generateGroundedCandidates(u.node, s, 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, u.scope).candidates[0];
  const uncertain = { ...session, client: { request: async () => { throw Error('Response lost after dispatch'); } } };
  let unknown;
  try { await executeGroundedInteraction(uncertain, { ...observer, locate: async () => ({ id: 'native-card', interaction: { method: 'ELEMENT_CLICK' } }) }, issueEffectGrant(c, u.node)); } catch (e) { unknown = e; }
  assert.equal(unknown.dispatchState, 'UNKNOWN'); assert.equal(consumeNotSentReceipt(unknown, c), false);
  assert.equal(generateGroundedCandidates(u.node, view('results', 'OpenAI'), 'E', 'S', false, 0, '', false, undefined, false, undefined, undefined, undefined, u.scope).candidates.length, 0);
});

for (const destination of ['paused', 'buffering', 'fullscreen', 'mini', 'search', 'unchanged']) test('OFFLINE video minimize postcondition requires navigation, never a playback-only state change: ' + destination, () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const before = view('player'); before.nodes.push({ ...before.nodes[3], resourceId: pkg + ':id/player_collapse_button', description: 'Thu nhỏ', clickable: true });
    before.elements = before.nodes.map((n, i) => ({ ...n, elementId: before.snapshotId + ':' + i }));
    const c = generateGroundedCandidates(node, before, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    assert.equal(c.search.phase, 'RESET'); consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, before); noteSearchNavigation(c);
    const after = destination === 'search' ? view('results', 'Old query') : view('player');
    if (destination === 'paused') after.nodes.push({ ...after.nodes[3], description: 'Phát video', clickable: true });
    if (destination === 'buffering') after.nodes.push({ ...after.nodes[3], className: 'android.widget.ProgressBar' });
    if (destination === 'fullscreen') after.nodes[0].bounds = [0, 0, 400, 800];
    if (destination === 'mini') after.nodes = [{ ...after.nodes[0], resourceId: pkg + ':id/modern_miniplayer' }];
    after.elements = after.nodes.map((n, i) => ({ ...n, elementId: after.snapshotId + ':' + i }));
    assert.equal(searchTransitionSatisfied(c, after), ['mini', 'search'].includes(destination));
  } finally { closeSearch(scope); }
});

test('OFFLINE explicit fullscreen exit may reach the normal player but cannot accept a paused fullscreen surface', () => {
  const node = compileOutcomes(source, 'A', 'E').nodes[1]; node.packageName = pkg;
  const scope = beginSearch(node, 'A', 'E', 'S', undefined, true);
  try {
    const before = view('player'); before.nodes[0].bounds = [0, 0, 400, 800];
    before.nodes.push({ ...before.nodes[3], description: 'Exit fullscreen', clickable: true });
    before.elements = before.nodes.map((n, i) => ({ ...n, elementId: before.snapshotId + ':' + i }));
    assert.equal(observeYouTubeState(before).state, 'FULLSCREEN_PLAYER');
    const c = generateGroundedCandidates(node, before, 'E', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, before); noteSearchNavigation(c);
    assert.equal(searchTransitionSatisfied(c, view('player')), true);
    const pausedFullscreen = view('player'); pausedFullscreen.nodes[0].bounds = [0, 0, 400, 800];
    pausedFullscreen.nodes.push({ ...pausedFullscreen.nodes[3], description: 'Phát video', clickable: true });
    assert.equal(searchTransitionSatisfied(c, pausedFullscreen), false);
  } finally { closeSearch(scope); }
});

const { parseUiHierarchy } = require('../lib/android/targets.ts');
const { selectorForNode } = require('../lib/android/state-observer.ts');
for (const [encoded, native] of [
  ['&#127911; Podcast &#127919;', '🎧 Podcast 🎯'],
  ['&#x1F393; &amp; &#65;', '🎓 & A'],
  ['Search &quot;Ocean&quot; &amp; Science', 'Search "Ocean" & Science'],
  ['&amp;#127911; &amp;copy;', '&#127911; &copy;'],
]) test('REAL_UI_REGRESSION native XML labels must round-trip once into native selectors: ' + encoded, () => {
  const xml = `<hierarchy><node package="${pkg}" class="android.view.View" enabled="true" clickable="true" bounds="[0,50][400,300]" content-desc="${encoded}" text="${encoded}" hint-text="${encoded}"/></hierarchy>`;
  const nodes = parseUiHierarchy(xml);
  assert.equal(nodes[0].description, native); assert.equal(nodes[0].text, native); assert.equal(nodes[0].hint, native);
  assert.deepEqual(selectorForNode(nodes[0], nodes), { using: 'accessibility id', value: native });
  assert.throws(() => parseUiHierarchy('<hierarchy>'), /invalid XML/);
});
