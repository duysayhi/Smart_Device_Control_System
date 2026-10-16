/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { ExplorationConfigSchema, explorationGoal, explorationConfig } = require('../lib/android/exploration/types.ts');
const { detectScrollRegion } = require('../lib/android/exploration/scroll-regions.ts');
const { DiscoveredElementMemory, discoveryCandidates, videoResultTitle } = require('../lib/android/exploration/element-memory.ts');
const { UIExplorer } = require('../lib/android/exploration/ui-explorer.ts');
const { ScrollController } = require('../lib/android/exploration/scroll-controller.ts');
const { matchUiTarget } = require('../lib/android/ui-understanding.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { verifyDiscoveredSelection } = require('../lib/android/action-verifier.ts');
const { assertDeviceConnected } = require('../lib/android/appium/session-manager.ts');
const { StateObserver } = require('../lib/android/state-observer.ts');
const { classifyScreen, isNodeInteractable } = require('../lib/android/screen-state.ts');
const pkg = 'com.google.android.youtube';
const n = (v = {}) => ({ className: 'android.view.View', resourceId: '', text: '', description: '', packageName: pkg,
  clickable: true, enabled: true, displayed: true, focused: false, bounds: [0, 80, 400, 250], ...v });
function state(rows = [], extras = []) {
  const snapshotId = randomUUID();
  const nodes = [n({ className: 'androidx.recyclerview.widget.RecyclerView', resourceId: pkg + ':id/results', clickable: false, scrollable: true, bounds: [0, 50, 400, 650] }),
    ...rows.map((row, i) => typeof row === 'string' ? n({ description: `${row} - 3 minutes - Creator ${row} - Play video`, parentIndex: 0, bounds: [0, 80 + i * 220, 400, 260 + i * 220] }) : row),
    n({ resourceId: pkg + ':id/search_query', text: 'podcast', bounds: [0, 0, 400, 50], clickable: false }), ...extras];
  rows.forEach((row, i) => {
    if (typeof row !== 'string') return;
    const b = nodes[i + 1].bounds;
    nodes.push(n({ text: row, description: '', clickable: false, parentIndex: i + 1, bounds: [20, b[3] - 62, 380, b[3] - 12] }));
  });
  return { deviceSerial: 'test', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, activity: 'Main',
    source: 'APPIUM', evidenceSource: 'APPIUM', observationStatus: 'OBSERVED', screen: 'SEARCH_RESULTS', observedAt: new Date().toISOString(),
    nodes, viewport: { x: 0, y: 0, width: 400, height: 700 }, elements: nodes.map((node, i) => ({ ...node, contentDescription: node.description, elementId: `${snapshotId}:${i}` })) };
}
function harness(frames, options = {}) {
  let index = options.initialIndex ?? 0;
  const gestures = [], nativeSnapshots = [], progress = [];
  const observer = {
    read: async () => { if (options.readError) throw new AndroidExecutionError(options.readError, 'injected failure'); return frames[index]; },
    locate: async (snapshot, target, click) => {
      nativeSnapshots.push(snapshot.snapshotId);
      const match = matchUiTarget(snapshot, target, click);
      return match.status === 'MATCH' ? { id: 'native-' + randomUUID(), node: match.node, snapshot } : false;
    },
    locateDelegatedLabel: async (snapshot, label) => { nativeSnapshots.push(snapshot.snapshotId); return { id: 'label-' + randomUUID(), node: label, snapshot }; },
  };
  const controller = { scroll: async (snapshot, region, direction, percent) => {
    gestures.push({ direction, percent, snapshotId: snapshot.snapshotId, regionId: region.node.resourceId });
    if (options.scrollError) throw new AndroidExecutionError(options.scrollError, 'injected scroll failure');
    if (options.unchanged) return true;
    if (direction === 'up') { if (index > 0) index--; return index > 0; }
    if (index < frames.length - 1) index = Math.min(frames.length - 1, index + (options.skipLarge && percent > .5 ? 2 : 1));
    return options.falseAfterChanged ? false : index < frames.length - 1;
  } };
  const config = ExplorationConfigSchema.parse({ settleTimeoutMs: 100, ...options.config });
  const explorer = new UIExplorer(observer, controller, config);
  return { explorer, gestures, nativeSnapshots, progress, run: (target, click = true, signal) => explorer.find(target, 2000, click, signal, p => progress.push(p)) };
}

test('configuration bounds reject blind large jumps and unlimited exploration', () => {
  assert.throws(() => ExplorationConfigSchema.parse({ scrollPercent: .9 }));
  assert.throws(() => ExplorationConfigSchema.parse({ maxScrolls: Infinity }));
  assert.equal(explorationGoal('result_3').ordinal, 3);
});
test('already visible exact target verifies without scrolling', async () => {
  const h = harness([state(['Alpha'])]);
  const result = await h.run('accessibility_id:Alpha - 3 minutes - Creator Alpha - Play video');
  assert.equal(result.status, 'FOUND'); assert.equal(h.gestures.length, 0);
});
test('ordinal discovery rewinds to origin instead of numbering the current viewport', async () => {
  const h = harness([state(['Alpha', 'Bravo']), state(['Bravo', 'Charlie']), state(['Charlie', 'Delta'])], { initialIndex: 2 });
  const result = await h.run('video_card_2');
  assert.equal(result.status, 'FOUND'); assert.equal(result.selection.title, 'Bravo');
  assert.deepEqual(h.gestures.map(g => g.direction), ['up', 'up']);
});
test('partially visible second video is remembered then revalidated in the new viewport', async () => {
  const first = state(['Alpha', n({ description: 'Bravo - 3 minutes - Creator Bravo - Play video', parentIndex: 0, bounds: [0, 600, 400, 780] })]);
  const label = n({ text: 'Bravo', clickable: false, parentIndex: 2, bounds: [20, 718, 380, 768] });
  first.nodes.push(label); first.elements.push({ ...label, elementId: `${first.snapshotId}:${first.nodes.length - 1}` });
  const second = state(['Bravo', 'Charlie']);
  const h = harness([first, second]);
  const result = await h.run('video_card_2');
  assert.equal(result.status, 'FOUND'); assert.equal(result.selection.title, 'Bravo');
  assert.deepEqual(h.gestures.map(g => g.direction), ['up', 'down']);
  assert.equal(result.metrics.newElements, 3); assert.equal(result.metrics.duplicateElements, 1);
  assert.equal(h.nativeSnapshots.at(-1), second.snapshotId);
});
test('overlap deduplication preserves ordinal across virtualized viewports', async () => {
  const h = harness([state(['Alpha', 'Bravo']), state(['Bravo', 'Charlie']), state(['Charlie', 'Delta'])]);
  const result = await h.run('video_card_4');
  assert.equal(result.status, 'FOUND'); assert.equal(result.selection.title, 'Delta');
  assert.equal(result.metrics.newElements, 4); assert.equal(result.metrics.duplicateElements, 2);
});
test('ordinal goals in the same query reuse anchored memory without another origin rewind', async () => {
  const h = harness([state(['Alpha', 'Bravo']), state(['Bravo', 'Charlie'])]);
  assert.equal((await h.run('video_card_1', false)).selection.title, 'Alpha');
  const gestures = h.gestures.length;
  assert.equal((await h.run('video_card_2', false)).selection.title, 'Bravo');
  assert.equal(h.gestures.length, gestures);
});
test('sixth video is discovered across viewports without substituting a visible ordinal', async () => {
  const h = harness([state(['Alpha', 'Bravo']), state(['Bravo', 'Charlie']), state(['Charlie', 'Delta']),
    state(['Delta', 'Echo']), state(['Echo', 'Foxtrot'])]);
  const result = await h.run('video_card_6');
  assert.equal(result.status, 'FOUND');
  assert.equal(result.selection.title, 'Foxtrot');
  assert.equal(result.selection.ordinal, 6);
  assert.equal(result.metrics.newElements, 6);
  assert.equal(explorationGoal('video_card_99').ordinal, 99);
});
test('no overlap means AMBIGUOUS rather than treating skipped rows as adjacent', async () => {
  const h = harness([state(['Alpha']), state(['Charlie', 'Delta'])]);
  const result = await h.run('video_card_2');
  assert.equal(result.status, 'AMBIGUOUS'); assert.equal(h.nativeSnapshots.length, 0);
});
test('bounded backward refinement recovers ordinal overlap before counting the next video', async () => {
  const h = harness([state(['Alpha', 'Bravo']), state(['Bravo', 'Charlie']), state(['Charlie', 'Delta'])], { skipLarge: true });
  const result = await h.run('video_card_4', false);
  assert.equal(result.status, 'FOUND'); assert.equal(result.selection.title, 'Delta');
  assert.deepEqual(h.gestures.map(g => [g.direction, g.percent]), [['up', .35], ['down', 340 / 600], ['up', .2], ['down', .2]]);
  assert.equal(result.metrics.newElements, 4);
});
test('horizontal video shelves are not counted as ordinary vertical-list results', () => {
  const s = state([n({ className: 'android.widget.HorizontalScrollView', scrollable: true, clickable: false, parentIndex: 0, bounds: [0, 60, 400, 300] }),
    n({ description: 'Shelf first - 3 minutes - Channel Public - Play video', parentIndex: 1, bounds: [0, 80, 200, 280] }),
    n({ description: 'Shelf second - 3 minutes - Channel Public - Play video', parentIndex: 1, bounds: [210, 80, 400, 280] }),
    n({ description: 'Ordinary - 7 minutes - Channel Public - Play video', parentIndex: 0, bounds: [0, 320, 400, 600] })]);
  const goal = explorationGoal('video_card_1'), evidence = discoveryCandidates(s, detectScrollRegion(s, goal).region, goal);
  assert.equal(evidence.status, 'OBSERVED'); assert.deepEqual(evidence.candidates.map(candidate => candidate.title), ['Ordinary']);
});
test('ads and Shorts are not counted as ordinary video results', () => {
  const s = state([n({ description: 'Sponsored - Brand - Play video', parentIndex: 0 }),
    n({ description: 'A short - Creator - Play short', parentIndex: 0 }),
    n({ description: 'Ordinary - 3 minutes - Creator - Play video', parentIndex: 0 })]);
  const goal = explorationGoal('video_card_1');
  const result = discoveryCandidates(s, detectScrollRegion(s, goal).region, goal);
  assert.equal(result.status, 'OBSERVED'); assert.deepEqual(result.candidates.map(c => c.title), ['Ordinary']);
});
test('capitalized Vietnamese sponsored descriptions with an em dash never count as videos', () => {
  const s = state([n({ description: '\u0110\u01b0\u1ee3c t\u00e0i tr\u1ee3 \u2014 Public podcast \u2014 51 minutes \u2014 Channel Sponsor \u2014 Play video', parentIndex: 0, bounds: [0, 60, 400, 300] }),
    n({ description: 'First ordinary - 7 minutes - Channel Public - Play video', parentIndex: 0, bounds: [0, 310, 400, 550] })]);
  const goal = explorationGoal('video_card_2'), evidence = discoveryCandidates(s, detectScrollRegion(s, goal).region, goal);
  assert.equal(evidence.status, 'OBSERVED'); assert.deepEqual(evidence.candidates.map(candidate => candidate.title), ['First ordinary']);
});
test('a labeled ad thumbnail is excluded without rejecting the entire video list', () => {
  const s = state([n({ description: '', clickable: false, parentIndex: 0 }),
    n({ resourceId: pkg + ':id/thumbnail', description: '', parentIndex: 1 }),
    n({ text: '\u0110\u01b0\u1ee3c t\u00e0i tr\u1ee3', description: '', clickable: false, parentIndex: 1 }),
    n({ description: 'Ordinary - 3 minutes - Creator - Play video', parentIndex: 0 })]);
  const goal = explorationGoal('video_card_1');
  const evidence = discoveryCandidates(s, detectScrollRegion(s, goal).region, goal);
  assert.equal(evidence.status, 'OBSERVED');
  assert.deepEqual(evidence.candidates.map(c => c.title), ['Ordinary']);
});
test('an ad-only viewport is scrolled past before selecting the first ordinary video', async () => {
  const first = state([n({ text: 'Sponsored', description: '', clickable: false, parentIndex: 0 })]);
  const h = harness([first, state(['Ordinary', 'Second'])]);
  const result = await h.run('video_card_1', false);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.selection.title, 'Ordinary');
  assert.equal(result.metrics.newElements, 2);
  assert.deepEqual(h.gestures.map(g => g.direction), ['up', 'down']);
});
test('false canScrollMore with changed ad content is not proof of end of list', async () => {
  const first = state([n({ text: 'Sponsored', description: '', clickable: false, parentIndex: 0 })]);
  const middle = state([n({ text: 'Sponsored - channel card', description: '', clickable: false, parentIndex: 0 })]);
  const h = harness([first, middle, state(['Ordinary', 'Second'])], { falseAfterChanged: true });
  const result = await h.run('video_card_1', false);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.selection.title, 'Ordinary');
  assert.deepEqual(h.gestures.map(g => g.direction), ['up', 'down', 'down']);
});
test('empty video viewports use a larger bounded scroll then restore overlap scrolling', async () => {
  const first = state([n({ text: 'Sponsored', description: '', clickable: false, parentIndex: 0 })]);
  const h = harness([first, state(['Alpha', 'Bravo']), state(['Bravo', 'Charlie'])]);
  const result = await h.run('video_card_3', false);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.selection.title, 'Charlie');
  assert.deepEqual(h.gestures.filter(g => g.direction === 'down').map(g => g.percent), [.9, 340 / 600]);
  assert.equal(ExplorationConfigSchema.parse({ emptyVideoScrollPercent: .5 }).emptyVideoScrollPercent, .5);
  assert.equal(ExplorationConfigSchema.parse({ emptyVideoScrollPercent: .6 }).emptyVideoScrollPercent, .6);
  assert.equal(ExplorationConfigSchema.parse({ emptyVideoScrollPercent: .9 }).emptyVideoScrollPercent, .9);
  assert.throws(() => ExplorationConfigSchema.parse({ emptyVideoScrollPercent: .91 }));
  assert.throws(() => ExplorationConfigSchema.parse({ videoScrollPercent: .61 }));
});
test('same content in the same viewport cannot be counted twice', () => {
  const s = state(['Alpha', 'Alpha']), goal = explorationGoal('video_card_2');
  const memory = new DiscoveredElementMemory('scope', 20); memory.anchored = true;
  assert.equal(memory.ingest(s, discoveryCandidates(s, detectScrollRegion(s, goal).region, goal).candidates).status, 'AMBIGUOUS');
  assert.equal(memory.items.length, 0);
});
test('metadata mutation for the same title is ambiguity, not a new item', () => {
  const a = state(['Alpha']), b = state([n({ description: 'Alpha - 4 minutes - Creator Alpha - Play video', parentIndex: 0 })]);
  const goal = explorationGoal('video_card_1'), memory = new DiscoveredElementMemory('scope', 20); memory.anchored = true;
  memory.ingest(a, discoveryCandidates(a, detectScrollRegion(a, goal).region, goal).candidates);
  assert.equal(memory.ingest(b, discoveryCandidates(b, detectScrollRegion(b, goal).region, goal).candidates).status, 'AMBIGUOUS');
});
test('peer scroll containers remain ambiguous and no gesture is sent', async () => {
  const s = state([], [n({ className: 'androidx.recyclerview.widget.RecyclerView', scrollable: true, clickable: false, bounds: [0, 50, 400, 650] })]);
  const h = harness([s]);
  assert.equal((await h.run('text:Missing')).status, 'AMBIGUOUS'); assert.equal(h.gestures.length, 0);
});
test('horizontal carousel is excluded from vertical exploration', () => {
  const s = state(['Alpha'], [n({ resourceId: 'carousel', scrollable: true, bounds: [0, 100, 400, 210] })]);
  assert.equal(detectScrollRegion(s, explorationGoal('text:Missing')).region.index, 0);
});
test('nested region enclosing goal evidence wins over its parent', () => {
  const s = state([]);
  s.nodes = [n({ resourceId: 'outer', scrollable: true, bounds: [0, 50, 400, 650] }),
    n({ resourceId: 'inner', scrollable: true, parentIndex: 0, bounds: [0, 100, 400, 600] }),
    n({ text: 'Target', parentIndex: 1, bounds: [0, 620, 400, 680] })];
  assert.equal(detectScrollRegion(s, explorationGoal('text:Target')).region.node.resourceId, 'inner');
});
test('no region and end of list are NOT_FOUND, not success', async () => {
  const s = state([]); s.nodes[0].scrollable = false;
  assert.equal((await harness([s]).run('text:Missing')).status, 'NOT_FOUND');
  const h = harness([state(['Alpha'])]);
  assert.equal((await h.run('video_card_2')).status, 'NOT_FOUND');
});
test('scroll count limit is enforced before another gesture', async () => {
  const h = harness([state(['Alpha']), state(['Alpha', 'Bravo'])], { config: { maxScrolls: 1 } });
  assert.equal((await h.run('video_card_2')).status, 'SCROLL_LIMIT_REACHED'); assert.equal(h.gestures.length, 1);
});
test('unchanged UI triggers bounded observations, never repeated blind gestures', async () => {
  const h = harness([state([])], { unchanged: true });
  assert.equal((await h.run('text:Missing')).status, 'NOT_FOUND'); assert.equal(h.gestures.length, 1);
});
for (const code of ['DEVICE_ERROR', 'SESSION_ERROR', 'CANCELLED']) test(`${code} is preserved and no gesture is issued`, async () => {
  const h = harness([state([])], { readError: code });
  assert.equal((await h.run('text:Missing')).status, code); assert.equal(h.gestures.length, 0);
});
test('cancellation interrupts before exploration', async () => {
  const h = harness([state([])]), c = new AbortController(); c.abort();
  assert.equal((await h.run('text:Missing', true, c.signal)).status, 'CANCELLED'); assert.equal(h.gestures.length, 0);
});
test('scope changes abort exploration rather than leaking remembered ordinals', async () => {
  const next = state(['Alpha', 'Bravo']); next.nodes.find(n => n.resourceId.endsWith('/search_query')).text = 'different query';
  assert.equal((await harness([state(['Alpha']), next]).run('video_card_2')).status, 'UNKNOWN');
});
test('snapshot read exceeding deadline cannot return FOUND', async () => {
  const s = state(['Alpha']);
  const explorer = new UIExplorer({ read: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return s; }, locate: async () => false }, { scroll: async () => false });
  assert.equal((await explorer.find('text:Missing', 5, true)).status, 'TIMEOUT');
});
test('scroll controller validates region again and supports all directions', async () => {
  const s = state(['Alpha']), calls = [];
  const session = { path: '/session/test', client: { request: async (method, path, body) => {
    calls.push({ method, path, body }); return path.endsWith('/attribute/scrollable') ? 'true' : path.endsWith('/rect') ? { x: 0, y: 50, width: 400, height: 600 } : false;
  } } };
  const controller = new ScrollController(session, { locate: async () => ({ id: 'fresh-native' }) });
  const region = detectScrollRegion(s, explorationGoal('video_card_1')).region;
  for (const direction of ['up', 'down', 'left', 'right']) assert.equal(await controller.scroll(s, region, direction, .35, 1000), false);
  assert.deepEqual(calls.filter(c => c.body?.script).map(c => c.body.args[0].direction), ['up', 'down', 'left', 'right']);
  assert.ok(calls.filter(c => c.body?.script).every(c => c.body.script === 'mobile: scrollGesture' && c.body.args[0].percent <= .5));
  assert.ok(calls.filter(c => c.body?.script).every(c => c.body.args[0].speed === 700));
  assert.ok(calls.filter(c => c.body?.script).every(c => c.body.args[0].elementId === 'fresh-native' && c.body.args[0].left === undefined));
});
test('YouTube ordinal scrolling stays on the observed results list when a nested shelf appears', () => {
  const s = state([n({ scrollable: true, clickable: false, className: 'android.view.View', parentIndex: 0, bounds: [0, 80, 400, 600] }),
    n({ description: 'Ordinary - 3 minutes - Creator - Play video', parentIndex: 1, bounds: [0, 100, 300, 500] })]);
  const detected = detectScrollRegion(s, explorationGoal('video_card_1'));
  assert.equal(detected.status, 'FOUND');
  assert.equal(detected.region.node.resourceId, pkg + ':id/results');
});
test('scroll controller rejects stale region and non-boolean canScrollMore', async () => {
  const s = state(['Alpha']), region = detectScrollRegion(s, explorationGoal('video_card_1')).region;
  let actions = 0;
  const controller = new ScrollController({ path: '/session/test', client: { request: async () => { actions++; } } }, { locate: async () => false });
  await assert.rejects(controller.scroll(s, region, 'down', .35, 1000), e => e.code === 'UNKNOWN'); assert.equal(actions, 0);
});
test('video verifier requires selected title as well as player state', () => {
  const before = state(['Alpha']), after = state(['Other']); after.screen = 'VIDEO_PLAYER';
  const selection = { itemType: 'video', title: 'Alpha', identity: 'evidence', ordinal: 2 };
  assert.equal(verifyDiscoveredSelection(selection, before, after), false);
  after.nodes.push(n({ text: 'Alpha', description: '', resourceId: pkg + ':id/video_title' }));
  assert.equal(verifyDiscoveredSelection(selection, before, after), true);
});

test('YouTube title parsing preserves hyphens in the real title and uses duration as metadata boundary', () => {
  assert.equal(videoResultTitle('Podcast - Episode 2 - 11 minutes, 47 seconds - Channel - Play video'), 'Podcast - Episode 2');
  assert.equal(videoResultTitle('Unknown title - Channel - Play video'), undefined);
});

function browserState(titles) {
  const s = state(titles.map((title, i) => n({ description: `Recipe https://example.org/${title.toLowerCase()} ${title} verified recipe instructions`, parentIndex: 0,
    bounds: [0, 80 + i * 220, 400, 260 + i * 220] })));
  s.foregroundPackage = 'browser'; s.activity = 'Browser'; s.screen = 'OBSERVED';
  s.nodes.forEach(n => { n.packageName = 'browser'; }); s.nodes[0].className = 'android.webkit.WebView';
  s.nodes.at(-1).resourceId = 'browser:id/url_bar'; s.nodes.at(-1).text = 'search.example?q=recipe';
  return s;
}
test('browser ordinal uses the same explorer and deduplicates URL/title cards across pages', async () => {
  const h = harness([browserState(['Alpha', 'Bravo']), browserState(['Bravo', 'Charlie'])]);
  const result = await h.run('result_3');
  assert.equal(result.status, 'FOUND'); assert.equal(result.selection.url, 'https://example.org/charlie');
  assert.equal(result.selection.ordinal, 3); assert.equal(result.metrics.newElements, 3);
});
test('generic list ordinal uses descendant labels, not reused resource IDs', async () => {
  function list(labels) {
    const s = state([]); s.nodes.pop();
    labels.forEach((label, i) => {
      const parent = s.nodes.length;
      s.nodes.push(n({ resourceId: 'test:id/row', parentIndex: 0, bounds: [0, 80 + i * 220, 400, 260 + i * 220] }));
      s.nodes.push(n({ text: label, clickable: false, parentIndex: parent, bounds: [10, 90 + i * 220, 300, 130 + i * 220] }));
    });
    s.elements = s.nodes.map((n, i) => ({ ...n, elementId: `${s.snapshotId}:${i}` }));
    return s;
  }
  const result = await harness([list(['Alpha', 'Bravo']), list(['Bravo', 'Charlie'])]).run('list_item_3');
  assert.equal(result.status, 'FOUND'); assert.equal(result.selection.title, 'Charlie');
  assert.equal(verifyDiscoveredSelection(result.selection, state([]), state([])), undefined);
});
test('explicit Settings-like label outside the viewport is discovered after scrolling', async () => {
  const h = harness([state([]), state([n({ text: 'About phone', parentIndex: 0 })])]);
  const result = await h.run('text:About phone');
  assert.equal(result.status, 'FOUND'); assert.equal(h.gestures.length, 1);
});
test('loading data is observed before any next gesture', async () => {
  const before = state([]), after = state([n({ text: 'Ready', parentIndex: 0 })]);
  let reads = 0, gestures = 0;
  const explorer = new UIExplorer({ read: async () => ++reads < 3 ? before : after,
    locate: async snapshot => ({ id: 'fresh', node: snapshot.nodes[1], snapshot }) },
  { scroll: async () => { gestures++; return true; } }, ExplorationConfigSchema.parse({ settleTimeoutMs: 200 }));
  const result = await explorer.find('text:Ready', 1000, true);
  assert.equal(result.status, 'FOUND'); assert.equal(gestures, 1); assert.ok(reads >= 3);
});
test('unreliable ad boundaries produce ambiguity before counting ordinary results', () => {
  const s = state([]);
  s.nodes.splice(1, 0, n({ clickable: false, parentIndex: 0, bounds: [0, 50, 400, 650] }),
    n({ description: 'Alpha - 3 minutes - Creator - Play video', parentIndex: 1 }),
    n({ description: 'Bravo - 3 minutes - Creator - Play video', parentIndex: 1 }), n({ text: 'Sponsored', parentIndex: 1 }));
  const goal = explorationGoal('video_card_2');
  assert.equal(discoveryCandidates(s, detectScrollRegion(s, goal).region, goal).status, 'AMBIGUOUS');
});
test('memory does not invent identities for unlabeled thumbnail-only videos', () => {
  const s = state([n({ resourceId: pkg + ':id/thumbnail', parentIndex: 0 })]), goal = explorationGoal('video_card_2');
  assert.equal(discoveryCandidates(s, detectScrollRegion(s, goal).region, goal).status, 'AMBIGUOUS');
});
test('non-boolean scroll result is a backend failure, never an end-of-list assertion', async () => {
  const s = state(['Alpha']), region = detectScrollRegion(s, explorationGoal('video_card_1')).region;
  const controller = new ScrollController({ path: '/session/test', client: { request: async (method, path) =>
    path.endsWith('/attribute/scrollable') ? 'true' : path.endsWith('/rect') ? { x: 0, y: 50, width: 400, height: 600 } : 'false' } }, { locate: async () => ({ id: 'fresh' }) });
  await assert.rejects(controller.scroll(s, region, 'down', .35, 1000), e => e.code === 'BACKEND_ERROR');
});
test('ADB deadline expiration is TIMEOUT, not a fabricated USB disconnect', async () => {
  await assert.rejects(assertDeviceConnected(async () => { throw new Error('Command killed', { cause: { killed: true } }); }, 'test', 1), e => e.code === 'TIMEOUT');
});
test('memory storage is bounded', () => {
  const s = state(['Alpha', 'Bravo']), goal = explorationGoal('video_card_2'), memory = new DiscoveredElementMemory('scope', 1); memory.anchored = true;
  assert.equal(memory.ingest(s, discoveryCandidates(s, detectScrollRegion(s, goal).region, goal).candidates).status, 'LIMIT');
  assert.equal(memory.items.length, 0);
});

test('modern YouTube watch screen is distinguished from an inline search-preview player', () => {
  const nodes = ['watch_player', 'video_metadata_layout', 'modern_title'].map(id => n({ resourceId: pkg + ':id/' + id, text: id === 'modern_title' ? 'Selected title' : '' }));
  assert.equal(classifyScreen(pkg, nodes), 'VIDEO_PLAYER');
  assert.notEqual(classifyScreen(pkg, [n({ resourceId: pkg + ':id/player_view' })]), 'VIDEO_PLAYER');
});

test('reordered previously discovered rows cannot be silently appended', () => {
  const a = state(['Alpha', 'Bravo']), b = state(['Bravo', 'Alpha']), goal = explorationGoal('video_card_2');
  const memory = new DiscoveredElementMemory('scope', 10); memory.anchored = true;
  memory.ingest(a, discoveryCandidates(a, detectScrollRegion(a, goal).region, goal).candidates);
  assert.equal(memory.ingest(b, discoveryCandidates(b, detectScrollRegion(b, goal).region, goal).candidates).status, 'AMBIGUOUS');
});

test('invalid environment limits are a configuration error, not a device failure', () => {
  const previous = process.env.ANDROID_EXPLORATION_MAX_SCROLLS;
  process.env.ANDROID_EXPLORATION_MAX_SCROLLS = 'unlimited';
  try { assert.throws(explorationConfig, e => e.code === 'CONFIG_ERROR'); }
  finally { if (previous === undefined) delete process.env.ANDROID_EXPLORATION_MAX_SCROLLS; else process.env.ANDROID_EXPLORATION_MAX_SCROLLS = previous; }
});
test('ADB permission failure is CONFIG_ERROR, not a fabricated disconnect', async () => {
  await assert.rejects(assertDeviceConnected(async () => { throw new Error('spawn denied', { cause: { code: 'EACCES' } }); }, 'test'), e => e.code === 'CONFIG_ERROR');
});

test('a clickable control covering a group center prevents a misleading parent click', () => {
  const group = n({ description: 'Video card', bounds: [0, 80, 400, 500] });
  const child = n({ text: 'Products', parentIndex: 0, bounds: [120, 220, 350, 400] });
  assert.equal(isNodeInteractable(group, [group, child], state([]).viewport, 'video_card_2'), false);
});
test('a video with nested product actions is ambiguous without a validated video activation control', async () => {
  const s = state([n({ description: 'Alpha - 3 minutes - Creator - 2 products - Play video', parentIndex: 0 })]);
  const h = harness([s]);
  assert.equal((await h.run('video_card_1')).status, 'AMBIGUOUS'); assert.equal(h.nativeSnapshots.length, 0);
});

test('accessible metadata may confirm the complete selected title but recommendations may not', () => {
  const before = state(['Alpha']), after = state([]); after.screen = 'VIDEO_PLAYER';
  const selection = { itemType: 'video', title: 'Full selected podcast title', identity: 'identity', ordinal: 2 };
  after.nodes = [n({ resourceId: pkg + ':id/video_metadata_layout', clickable: false }),
    n({ description: 'Full selected podcast title. Public channel, views and publication date', parentIndex: 0 })];
  assert.equal(verifyDiscoveredSelection(selection, before, after), true);
  after.nodes[1].parentIndex = undefined;
  assert.equal(verifyDiscoveredSelection(selection, before, after), false);
  after.nodes[1].text = selection.title;
  assert.equal(verifyDiscoveredSelection(selection, before, after), false);
});

test('delegated title activation requires current native text, clickable owner and containment', async () => {
  const s = state(['Alpha']), owner = s.nodes[1], label = s.nodes.at(-1);
  let text = 'Alpha', ownerClickable = 'true', outside = false;
  const session = { path: '/session/test', client: { request: async (method, path) => {
    if (path.endsWith('/attribute/clickable')) return ownerClickable;
    if (path.endsWith('/text')) return text;
    if (path.includes('/element/owner/')) return { x: 0, y: 80, width: 400, height: 180 };
    return { x: outside ? 450 : 20, y: 198, width: 360, height: 50 };
  } } };
  const observer = new StateObserver(session, async () => ({ stdout: 'device', stderr: '' }));
  observer.locate = async (snapshot, target) => ({ id: target.endsWith(':1') ? 'owner' : 'label', snapshot, node: target.endsWith(':1') ? owner : label });
  assert.ok(await observer.locateDelegatedLabel(s, label, owner, 1000));
  text = 'Different title'; assert.equal(await observer.locateDelegatedLabel(s, label, owner, 1000), false);
  text = 'Alpha'; ownerClickable = 'false'; assert.equal(await observer.locateDelegatedLabel(s, label, owner, 1000), false);
  ownerClickable = 'true'; outside = true; assert.equal(await observer.locateDelegatedLabel(s, label, owner, 1000), false);
});

test('invalid native geometry cannot be treated as an interactable target', () => {
  assert.equal(isNodeInteractable(n({ bounds: [NaN, 0, 100, 100] }), [], state([]).viewport, 'button'), false);
});

test('browser toolbar collapse does not reset scope when result continuity is preserved', async () => {
  const a = browserState(['Alpha', 'Bravo']), b = browserState(['Bravo', 'Charlie']);
  b.nodes.find(n => n.resourceId.endsWith('/url_bar')).text = '';
  assert.equal((await harness([a, b]).run('result_3')).status, 'FOUND');
});
