/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { createMediaPlaybackVerifier } = require('../lib/android/media-playback-verifier.ts');
const { verifyDiscoveredSelection } = require('../lib/android/action-verifier.ts');
const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { runAgent } = require('../lib/android/agent/agent-loop.ts');
const pkg = 'org.example.player', serial = 'offline-test';
const selection = { itemType: 'video', identity: 'observed-second-result', title: 'Selected title, with comma', ordinal: 2 };
const before = { screen: 'SEARCH_RESULTS', foregroundPackage: pkg, snapshotId: 'results', deviceSerial: serial };
const after = id => ({ screen: 'VIDEO_PLAYER', foregroundPackage: pkg, observationStatus: 'OBSERVED', deviceSerial: serial,
  snapshotId: id, timestamp: Date.now(), nodes: [] });
const dump = (position, state = 3) => `  package=${pkg}\n  active=true\n` +
  `  state=PlaybackState {state=${state}, position=${position}, buffered position=10000, speed=1.0, updated=1000, actions=1}\n` +
  `  metadata: size=6, description=${selection.title}, Channel, Channel\n`;
function media() {
  let position = 1000, state = 3;
  const verify = createMediaPlaybackVerifier(async args => {
    if (!args.includes('dumpsys')) throw Error('No clock sample');
    return { stdout: dump(position, state), stderr: '' };
  }, serial);
  return { verify, set position(v) { position = v; }, set state(v) { state = v; } };
}

test('progress proof expires when the next distinct sample stops advancing', async () => {
  const m = media();
  assert.equal(await m.verify(selection, before, after('one'), 5000), false);
  m.position = 2000;
  const advancing = after('two');
  assert.equal(await m.verify(selection, before, advancing, 5000), true);
  assert.equal(advancing.playback.previousPositionMs, 1000);
  const frozen = after('three');
  assert.equal(await m.verify(selection, before, frozen, 5000), false);
  assert.equal(frozen.playback, undefined);
  m.position = 3000;
  const resumed = after('four');
  assert.equal(await m.verify(selection, before, resumed, 5000), true);
  assert.equal(resumed.playback.previousPositionMs, 2000);
});

test('reusing a verified snapshot cannot reuse its proof, even if the session advances', async () => {
  const m = media();
  await m.verify(selection, before, after('one'), 5000);
  m.position = 2000;
  const current = after('two');
  assert.equal(await m.verify(selection, before, current, 5000), true);
  m.position = 3000;
  assert.equal(await m.verify(selection, before, current, 5000), false);
  assert.equal(current.playback, undefined);
});

test('paused or unavailable samples remove earlier proof from a reused observation', async () => {
  for (const paused of [true, false]) {
    let position = 1000, failed = false;
    const verify = createMediaPlaybackVerifier(async args => {
      if (!args.includes('dumpsys') || failed && !paused) throw Error('Unavailable');
      return { stdout: dump(position, failed ? 2 : 3) };
    }, serial);
    await verify(selection, before, after('one'), 5000);
    position = 2000;
    const current = after('two');
    assert.equal(await verify(selection, before, current, 5000), true);
    failed = true;
    current.snapshotId = 'three';
    assert.equal(await verify(selection, before, current, 5000), false);
    assert.equal(current.playback, undefined);
  }
});

test('playback samples cannot cross ordinal, result identity, or origin bindings', async () => {
  for (const [selected, origin] of [
    [{ ...selection, ordinal: 1 }, before],
    [{ ...selection, identity: 'different-result-with-same-title' }, before],
    [selection, { ...before, snapshotId: 'different-results' }],
  ]) {
    const m = media();
    await m.verify(selection, before, after('one'), 5000);
    m.position = 2000;
    assert.equal(await m.verify(selected, origin, after('two'), 5000), false);
  }
});

test('matching destination text cannot override contradictory playback evidence', () => {
  const current = after('current');
  current.nodes = [{ resourceId: pkg + ':id/video_title', text: selection.title, description: '', enabled: true, displayed: true }];
  for (const change of [
    { positionMs: 1000 }, { title: 'Wrong title' }, { packageName: 'other.player' },
    { positionMs: Infinity }, { previousPositionMs: -1 },
  ]) {
    current.playback = { source: 'ADB_MEDIA_SESSION', packageName: pkg, title: selection.title,
      previousPositionMs: 1000, positionMs: 2000, ...change };
    assert.equal(verifyDiscoveredSelection(selection, before, current), false);
  }
});

function executorFixture(verifyAction, output = () => dump(1000)) {
  let clicks = 0, mediaReads = 0, reads = 0;
  const executor = new ConditionExecutor({ serial, path: '/session/offline', ensureActive: async () => {},
    client: { request: async () => { clicks++; } } }, async args => {
    if (!args.includes('dumpsys')) throw Error('No clock sample');
    mediaReads++;
    return { stdout: output(mediaReads), stderr: '' };
  }, { requirePlayback: true, verifyAction });
  const node = { resourceId: '', text: selection.title, description: '', className: 'android.view.ViewGroup', bounds: [0, 0, 300, 200] };
  executor.explorer = { find: async () => ({ status: 'FOUND', selection, found: { snapshot: before, node, id: 'observed-element' },
    metrics: { snapshotCount: 1 } }), reset: () => {} };
  const read = async () => ({ ...after(`player-${++reads}`), nodes: [
    { ...node, resourceId: pkg + ':id/video_title', text: selection.title, enabled: true, displayed: true },
  ] });
  executor.observer = { read, waitUntil: async condition => {
    for (let i = 0; i < 3; i++) {
      const result = await condition(await read(), 5000);
      if (result) return result;
    }
    throw new AndroidExecutionError('TIMEOUT', 'Offline postcondition not verified');
  } };
  return { executor, get clicks() { return clicks; }, get mediaReads() { return mediaReads; } };
}

test('requirePlayback preserves an explicit accounting veto without querying media', async () => {
  const f = executorFixture(() => false, n => dump(n * 1000));
  await assert.rejects(f.executor.execute({ type: 'CLICK', target: 'video_card_2' }), /postcondition not verified/);
  assert.equal(f.clicks, 1);
  assert.equal(f.mediaReads, 0);
});

test('accounting approval still requires bound advancing playback and preserves ordinal two', async () => {
  const f = executorFixture(() => true, n => dump(n * 1000));
  const outcome = await f.executor.execute({ type: 'CLICK', target: 'video_card_2' });
  assert.equal(outcome.verification, 'VERIFIED');
  assert.deepEqual(outcome.selection, selection);
  assert.equal(outcome.evidence.playback.title, selection.title);
  assert.equal(f.mediaReads, 2);
  assert.equal(f.clicks, 1);
});

test('title-only or frozen playback leaves the sent click unverified without replay', async () => {
  for (const output of [() => '', () => dump(1000)]) {
    const f = executorFixture(undefined, output);
    await assert.rejects(f.executor.execute({ type: 'CLICK', target: 'video_card_2' }), error => {
      assert.equal(error.interactionSent, true);
      assert.deepEqual(error.selection, selection);
      return error.code === 'TIMEOUT';
    });
    assert.equal(f.clicks, 1);
  }
});

test('E2-shaped missing title/progress evidence keeps V1 BLOCKED after one uncertain click', async () => {
  const budget = new AgentBudget();
  const goal = buildGoal('Mo YouTube, tim science va mo video thu hai',
    { app: 'youtube', operation: 'OPEN_RESULT', query: 'science', resultType: 'video', ordinal: 2, isSensitive: false }, budget);
  goal.subgoals.slice(0, 2).forEach(sub => { sub.status = 'VERIFIED'; });
  goal.currentSubgoal = 2;
  let clicked = false, clicks = 0, closed = 0, reads = 0;
  const events = [];
  const result = await runAgent(goal, budget, {
    backend: 'appium',
    discoveryMemory: () => ({ anchored: true, items: [] }),
    observe: async () => ({ ...after(`read-${++reads}`), deviceSerial: 'offline-test', foregroundPackage: goal.packageName,
      screen: clicked ? 'VIDEO_PLAYER' : 'SEARCH_RESULTS',
      nodes: clicked ? [] : [{ resourceId: goal.packageName + ':id/search_query', text: 'science', description: '', enabled: true, displayed: true,
        packageName: goal.packageName, className: 'android.widget.TextView', bounds: [0, 0, 400, 80] }],
      elements: [], viewport: { x: 0, y: 0, width: 400, height: 700 } }),
    execute: async action => {
      assert.deepEqual(action, { type: 'CLICK', target: 'video_card_2' });
      clicks++; clicked = true;
      const error = new AndroidExecutionError('TIMEOUT', 'postcondition:video_card_2');
      error.interactionSent = true;
      throw error;
    },
    close: async () => { closed++; },
  }, undefined, undefined, e => events.push(e));
  assert.equal(result.result.status, 'BLOCKED');
  assert.equal(clicks, 1);
  assert.equal(closed, 1);
  assert.equal(events.some(e => e.status === 'COMPLETED'), false);
});
