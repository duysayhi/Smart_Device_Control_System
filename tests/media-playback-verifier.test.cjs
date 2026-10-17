/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { readPlayingSession, createMediaPlaybackVerifier } = require('../lib/android/media-playback-verifier.ts');
const { ConditionExecutor } = require('../lib/android/condition-executor.ts');
const { verifyDiscoveredSelection } = require('../lib/android/action-verifier.ts');
const pkg = 'com.google.android.youtube';
const dump = (position = 1000, title = 'Any video title', state = 3, active = true, packageName = pkg) =>
  `    package=${packageName}\n    active=${active}\n    state=PlaybackState {state=${state}, position=${position}, buffered position=10000, speed=1.0, updated=${position}, actions=1}\n    metadata: size=6, description=${title}, Channel, Channel\n`;
const before = { screen: 'SEARCH_RESULTS', foregroundPackage: pkg, snapshotId: 'before' };
const after = (id = 'after') => ({ screen: 'VIDEO_PLAYER', foregroundPackage: pkg, observationStatus: 'OBSERVED', deviceSerial: 'serial', snapshotId: id });
const selection = { itemType: 'video', title: 'Any video title', ordinal: 1 };
test('parses only a unique active playing package session, including titles with commas', () => {
  assert.equal(readPlayingSession(dump(1000, 'Hello, world'), pkg).title, 'Hello, world');
  for (const output of [dump(0, undefined, 1), dump(0, undefined, 2), dump(0, undefined, 3, false), dump(0, undefined, 3, true, 'other.app'), dump() + dump()]) {
    assert.equal(readPlayingSession(output, pkg), undefined);
  }
});
test('requires two distinct post-click snapshots and advancing playback, preserving evidence', async () => {
  let position = 1000;
  const verify = createMediaPlaybackVerifier(async (args, timeout) => {
    assert.deepEqual(args, ['-s', 'serial', 'shell', 'dumpsys', 'media_session']); assert.ok(timeout <= 3000);
    return { stdout: dump(position), stderr: '' };
  }, 'serial');
  assert.equal(await verify(selection, before, after(), 5000), false);
  assert.equal(await verify(selection, before, after('second'), 5000), false);
  position = 2000;
  const s = after('third');
  assert.equal(await verify(selection, before, s, 5000), true);
  assert.equal(s.playback.source, 'ADB_MEDIA_SESSION'); assert.equal(s.playback.previousPositionMs, 1000);
});
test('wrong title, package, stale snapshot, inline preview, paused and unavailable metadata fail closed', async () => {
  for (const [output, old, current] of [
    [dump(2000, 'Wrong video'), before, after()], [dump(), before, { ...after(), foregroundPackage: 'other.app' }],
    [dump(), before, after('before')], [dump(), before, { ...after(), screen: 'SEARCH_RESULTS' }],
    [dump(), { ...before, screen: 'VIDEO_PLAYER' }, after()], [dump(2000, undefined, 2), before, after()],
    ['', before, after()], [dump(), before, { ...after(), deviceSerial: 'other' }],
  ]) {
    const verify = createMediaPlaybackVerifier(async () => ({ stdout: output }), 'serial');
    assert.equal(await verify(selection, old, current, 5000), false);
    assert.equal(await verify(selection, old, { ...current, snapshotId: 'second' }, 5000), false);
  }
  const failed = createMediaPlaybackVerifier(async () => { throw new Error('offline'); }, 'serial');
  assert.equal(await failed(selection, before, after(), 5000), false);
});

test('executor verifies fallback after click and refreshes playback proof for the agent next observation', async () => {
  let position = 0, clicks = 0, reads = 0;
  const executor = new ConditionExecutor({ serial: 'serial', path: '/session/test', ensureActive: async () => {},
    client: { request: async () => { clicks++; } } }, async () => ({ stdout: dump(position += 1000), stderr: '' }));
  const node = { resourceId: '', text: selection.title, description: '', className: 'android.view.ViewGroup', bounds: [0, 0, 300, 200] };
  const origin = { ...before, nodes: [], deviceSerial: 'serial' };
  executor.explorer = { find: async () => ({ status: 'FOUND', selection, found: { snapshot: origin, node, id: 'element' }, metrics: { snapshotCount: 1 } }), reset: () => {} };
  const read = async () => ({ ...after(`snapshot-${++reads}`), nodes: [] });
  executor.observer = { read, waitUntil: async condition => {
    for (let i = 0; i < 3; i++) { const s = await read(); const result = await condition(s, 10000); if (result) return result; }
    throw new Error('Not verified');
  } };
  const outcome = await executor.execute({ type: 'CLICK', target: 'video_card_1' });
  assert.equal(clicks, 1); assert.equal(outcome.verification, 'VERIFIED');
  assert.equal(outcome.evidence.playback.title, selection.title);
  const refreshed = await executor.observe();
  assert.equal(verifyDiscoveredSelection(selection, refreshed, refreshed), true);
  executor.dispose();
  assert.equal((await executor.observe()).playback, undefined);
});

test('an explicit accounting verification rejection cannot be overridden by media fallback', async () => {
  let mediaReads = 0;
  const executor = new ConditionExecutor({ serial: 'serial', path: '/session/test', ensureActive: async () => {}, client: { request: async () => {} } },
    async () => { mediaReads++; return { stdout: dump() }; }, { verifyAction: () => false });
  const node = { resourceId: '', text: selection.title, description: '', className: 'android.view.ViewGroup', bounds: [0, 0, 300, 200] };
  executor.explorer = { find: async () => ({ status: 'FOUND', selection, found: { snapshot: before, node, id: 'element' }, metrics: { snapshotCount: 1 } }) };
  executor.observer = { waitUntil: async condition => { assert.equal(await condition(after(), 5000), false); throw new Error('Rejected'); } };
  await assert.rejects(executor.execute({ type: 'CLICK', target: 'video_card_1' }), /Rejected/);
  assert.equal(mediaReads, 0);
});
