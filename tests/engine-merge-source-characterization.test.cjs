/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { criterionSatisfied, goalRequiresPlayback } = require('../lib/android/agent/evaluator.ts');
const { runAgent } = require('../lib/android/agent/agent-loop.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { verifyDiscoveredSelection, verifyBrowserSearch } = require('../lib/android/action-verifier.ts');
const { createMediaPlaybackVerifier } = require('../lib/android/media-playback-verifier.ts');
const { READ_WEB_DOCUMENT } = require('../lib/android/hybrid-context-observer.ts');
const { discoveryCandidates, DiscoveredElementMemory } = require('../lib/android/exploration/element-memory.ts');
const { explorationGoal } = require('../lib/android/exploration/types.ts');
const { detectScrollRegion } = require('../lib/android/exploration/scroll-regions.ts');
const originalFetch = global.fetch;
global.fetch = async () => assert.fail('Offline characterization must not use network/model/device APIs');
test.after(() => { global.fetch = originalFetch; });
const noModel = { generate: async () => assert.fail('Source rule should preserve this explicit goal without inference') };
const query = 'marine research notes';
const requests = {
  P1: 'M\u1edf Chrome, t\u00ecm ' + query + ' v\u00e0 m\u1edf b\u00e0i \u0111\u1ea7u ti\u00ean',
  P2: 'M\u1edf YouTube, t\u00ecm ' + query + ' v\u00e0 ph\u00e1t video \u0111\u1ea7u ti\u00ean',
};
const title = 'Marine research methods', url = 'https://example.org/research';
const document = () => ({ url, title, headings: [title], canonicalUrls: [url], navigationType: 'navigate',
  navigationUrl: url, readyState: 'complete', alternateUrls: [] });
const scene = (pkg, extra = {}) => ({ foregroundPackage: pkg, deviceSerial: 'offline', snapshotId: randomUUID(),
  timestamp: Date.now(), observationStatus: 'OBSERVED', screen: 'OBSERVED', nodes: [], elements: [],
  viewport: { x: 0, y: 0, width: 400, height: 800 }, ...extra });

for (const [name, source] of Object.entries(requests)) {
  test('OFFLINE source ' + name + ' preserves first ordinal, query and final criterion with zero model calls', async () => {
    const budget = new AgentBudget(), { goal } = await planGoal(source, budget, noModel);
    assert.equal(goal.spec.operation, 'OPEN_RESULT');
    assert.equal(goal.spec.query, query); assert.equal(goal.spec.ordinal, 1);
    assert.equal(goal.spec.resultType, name === 'P1' ? 'browser' : 'video');
    assert.equal(goal.subgoals.length, 3);
    assert.equal(goal.subgoals[1].criterion.query, query);
    assert.deepEqual(goal.subgoals[2].criterion, { kind: 'DESTINATION', resultType: goal.spec.resultType,
      ordinal: 1, target: name === 'P1' ? 'first_result' : 'video_card_1' });
    assert.equal(goalRequiresPlayback(goal), name === 'P2');
    assert.equal(budget.reasoningMeasurements.length, 0);
  });
}

test('OFFLINE P1 organic DOM collection skips sponsored product/video cards and keeps article URL identity', () => {
  const body = { tagName: 'BODY', nodeType: 1, children: [] }, root = { tagName: 'HTML', nodeType: 1, children: [body] };
  body.parentElement = root;
  const anchor = (name, source, ad) => ({ tagName: 'A', nodeType: 1, parentElement: body,
    href: 'https://example.org/' + name, children: [], querySelector: () => ({ textContent: name }),
    matches: selector => ad && selector.includes('[data-impdclcc]'),
    querySelectorAll: selector => selector === '[role="text"],cite' && source ? [{ textContent: 'https://example.org' }] : [],
    getBoundingClientRect: () => ({ left: 0, top: 100, right: 400, bottom: 200, x: 0, y: 100, width: 400, height: 100 }),
    contains: top => top === current });
  const anchors = [anchor('sponsored-product', true, true), anchor('video-card', false, false),
    anchor('first-article', true, false), anchor('second-article', true, false)];
  body.children = anchors; let current;
  const doc = { documentElement: root, body, title: 'Search', readyState: 'complete',
    querySelectorAll: selector => selector === 'a[href]' ? anchors : [], elementFromPoint: () => current };
  const result = vm.runInNewContext(`(()=>{${READ_WEB_DOCUMENT}})()`, { document: doc, URL,
    location: { href: 'https://www.google.com/search?q=marine', hostname: 'www.google.com', pathname: '/search' },
    innerWidth: 400, innerHeight: 800, getComputedStyle: a => { current = a; return { display: 'block', visibility: 'visible' }; },
    performance: { getEntriesByType: () => [] } });
  assert.deepEqual(Array.from(result.links, a => [a.title, a.href]), [
    ['first-article', 'https://example.org/first-article'], ['second-article', 'https://example.org/second-article'],
  ]);
  assert.equal(result.ambiguousAds, false);
});

test('OFFLINE P1 destination requires prior verified search and exact first selection; title alone is insufficient', async () => {
  const { goal } = await planGoal(requests.P1, new AgentBudget(), noModel);
  const selected = { itemType: 'browser', ordinal: 1, identity: 'observed-first-link', title, url };
  const after = scene(goal.packageName, { web: { status: 'DOM_AVAILABLE', document: document() } });
  const criterion = goal.subgoals[2].criterion;
  assert.equal(criterionSatisfied(goal, criterion, after, selected), false);
  goal.subgoals[1].status = 'VERIFIED';
  assert.equal(criterionSatisfied(goal, criterion, after, selected), true);
  assert.equal(criterionSatisfied(goal, criterion, after, { ...selected, ordinal: 2 }), false);
  for (const change of [{ url: url + '/different' }, { title: 'Other article', headings: ['Other article'] },
    { readyState: 'loading' }, { title: 'Captcha' }]) {
    const bad = { ...after, web: { status: 'DOM_AVAILABLE', document: { ...document(), ...change } } };
    assert.equal(verifyDiscoveredSelection(selected, after, bad), false);
    assert.equal(criterionSatisfied(goal, criterion, bad, selected), false);
  }
  assert.equal(criterionSatisfied(goal, criterion, { ...after, observationStatus: 'ERROR' }, selected), false);
  assert.equal(criterionSatisfied(goal, criterion, { ...after, foregroundPackage: 'other.browser' }, selected), false);
  const search = scene(goal.packageName, { web: { status: 'DOM_AVAILABLE', document: {
    ...document(), url: 'https://www.google.com/search?q=' + encodeURIComponent(query), links: [selected], ambiguousAds: false,
  } } });
  assert.equal(verifyBrowserSearch(search, query), true);
  assert.equal(verifyBrowserSearch(search, 'other query'), false);
});

function videos(descriptions) {
  const pkg = 'com.google.android.youtube';
  const node = extra => ({ packageName: pkg, className: 'android.view.View', resourceId: '', text: '', description: '',
    bounds: [0, 100, 400, 220], enabled: true, displayed: true, clickable: true, ...extra });
  const nodes = [node({ className: 'androidx.recyclerview.widget.RecyclerView', scrollable: true,
    clickable: false, bounds: [0, 50, 400, 750] }),
    ...descriptions.map((description, i) => node({ description, parentIndex: 0, bounds: [0, 60 + i * 140, 400, 190 + i * 140] })),
    node({ resourceId: pkg + ':id/search_query', text: query, clickable: false, bounds: [0, 0, 400, 50] })];
  return scene(pkg, { nodes, screen: 'SEARCH_RESULTS' });
}
test('OFFLINE P2 counts ordinary video identity, not sponsored products or Shorts', () => {
  const s = videos(['Sponsored - Product - 3 minutes - Channel Ad - Play video',
    'Short clip - Creator - Play short', title + ' - 4 minutes - Channel Research - Play video']);
  const goal = explorationGoal('video_card_1'), region = detectScrollRegion(s, goal).region;
  const evidence = discoveryCandidates(s, region, goal);
  assert.equal(evidence.status, 'OBSERVED');
  assert.deepEqual(evidence.candidates.map(c => c.title), [title]);
  const memory = new DiscoveredElementMemory('same-query-origin', 20);
  assert.equal(memory.ingest(s, evidence.candidates).status, 'AMBIGUOUS');
  memory.anchored = true;
  assert.equal(memory.ingest(s, evidence.candidates).status, 'OBSERVED');
  assert.equal(memory.items[0].observationOrder, 1);
  const changed = videos([title + ' - 4 minutes - Channel Impostor - Play video']);
  const other = discoveryCandidates(changed, detectScrollRegion(changed, goal).region, goal);
  assert.notEqual(other.candidates[0].identity, evidence.candidates[0].identity);
  assert.equal(memory.ingest(changed, other.candidates).status, 'AMBIGUOUS');
});

test('OFFLINE P2 first-video proof requires matching MediaSession PLAYING and distinct advancing samples', async () => {
  const { goal } = await planGoal(requests.P2, new AgentBudget(), noModel);
  goal.subgoals[1].status = 'VERIFIED';
  const before = videos([title + ' - 4 minutes - Channel Research - Play video']);
  const selection = { itemType: 'video', ordinal: 1, title, identity: 'first-video-identity' };
  let position = 1000, state = 3, calls = 0;
  const verify = createMediaPlaybackVerifier(async args => {
    calls++; assert.ok(args.includes('dumpsys'));
    return { stdout: `package=${goal.packageName}\nactive=true\nstate=PlaybackState {state=${state}, position=${position}, buffered position=10000, speed=1.0, updated=1000}\nmetadata: size=3, description=${title}, Channel Research, Channel Research\n` };
  }, 'offline');
  const player = () => scene(goal.packageName, { screen: 'VIDEO_PLAYER' });
  assert.equal(await verify(selection, before, player(), 5000), false);
  position = 2000;
  const advancing = player();
  assert.equal(await verify(selection, before, advancing, 5000), true);
  assert.equal(criterionSatisfied(goal, goal.subgoals[2].criterion, advancing, selection), true);
  assert.equal(await verify(selection, before, advancing, 5000), false);
  assert.equal(await verify(selection, before, player(), 5000), false);
  state = 2; position = 3000;
  assert.equal(await verify(selection, before, player(), 5000), false);
  assert.equal(criterionSatisfied(goal, goal.subgoals[2].criterion, player(), selection), false);
  assert.ok(calls >= 4);
});

for (const name of ['P1', 'P2']) {
  test('OFFLINE source ' + name + ' uncertain first-result click is BLOCKED once, never replayed or completed', async () => {
    const budget = new AgentBudget(), { goal } = await planGoal(requests[name], budget, noModel);
    goal.subgoals[0].status = goal.subgoals[1].status = 'VERIFIED'; goal.currentSubgoal = 2;
    const before = name === 'P2' ? videos([title + ' - 4 minutes - Channel Research - Play video']) :
      scene(goal.packageName, { web: { status: 'DOM_AVAILABLE', document: { ...document(),
        url: 'https://www.google.com/search?q=' + encodeURIComponent(query), links: [{ title, url }], ambiguousAds: false } } });
    let clicks = 0, closed = 0; const events = [];
    const out = await runAgent(goal, budget, { backend: 'appium', deviceId: 'offline', observe: async () => before,
      discoveryMemory: () => ({ anchored: true, items: [] }),
      execute: async action => {
        assert.deepEqual(action, { type: 'CLICK', target: name === 'P1' ? 'first_result' : 'video_card_1' });
        clicks++; const error = new AndroidExecutionError('TIMEOUT', 'Sent result click has no independent destination proof');
        error.interactionSent = true; throw error;
      }, close: async () => { closed++; } }, undefined, undefined, e => events.push(e));
    assert.equal(out.result.status, 'BLOCKED'); assert.equal(clicks, 1); assert.equal(closed, 1);
    assert.equal(events.some(e => e.status === 'COMPLETED'), false);
    assert.equal(budget.reasoningMeasurements.length, 0);
  });
}
