/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { resolveInteractionTarget } = require('../lib/android/interaction-target-resolver.ts');
const { assessPlanPolicy, assertPlanPolicy, assertObservedControlSafe } = require('../lib/android/security-policy.ts');
const { HybridContextObserver, withSessionContextLock, matchesNativeAddress } = require('../lib/android/hybrid-context-observer.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { StateObserver, selectorForNode } = require('../lib/android/state-observer.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { ManagedAppiumSession } = require('../lib/android/appium/session-manager.ts');
const { videoIdentityEvidence } = require('../lib/android/exploration/element-memory.ts');
const { classifyScreen } = require('../lib/android/screen-state.ts');
const { ConditionExecutor } = require('../lib/android/condition-executor.ts');

const node = (v = {}) => ({ className: 'android.view.View', resourceId: '', text: '', description: '', packageName: 'test',
  enabled: true, clickable: true, displayed: true, focused: false, bounds: [0, 100, 300, 400], ...v });
function state(nodes) {
  const snapshotId = randomUUID();
  return { deviceSerial: 'test', snapshotId, timestamp: Date.now(), foregroundPackage: 'test', activity: 'Main', observationStatus: 'OBSERVED',
    nodes, elements: nodes.map((node, index) => ({ ...node, elementId: `${snapshotId}:${index}` })), viewport: { x: 0, y: 0, width: 400, height: 700 } };
}
const navigation = { intent: 'search_podcast', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'youtube' },
  { type: 'CLICK', target: 'search_button' }, { type: 'INPUT_TEXT', text: 'podcast' }, { type: 'PRESS_KEY', key: 'ENTER' },
  { type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 }, { type: 'CLICK', target: 'video_card_2' }] };

test('resolver accepts a visible uncovered semantic native target', () => {
  const s = state([node({ description: 'Open video' })]);
  assert.equal(resolveInteractionTarget(s, s.nodes[0]).target.method, 'ELEMENT_CLICK');
});
test('resolver delegates a measured label to its clickable ancestor, not the owner center', () => {
  const s = state([node(), node({ text: 'Wi-Fi', clickable: false, parentIndex: 0, bounds: [20, 300, 280, 350] })]);
  const result = resolveInteractionTarget(s, s.nodes[1]);
  assert.equal(result.status, 'RESOLVED'); assert.equal(result.target.method, 'LABEL_GESTURE'); assert.equal(result.target.owner, s.nodes[0]);
});
test('resolver rejects hidden disabled offscreen and ancestor-clipped targets', () => {
  for (const v of [{ displayed: false }, { enabled: false }, { bounds: [0, 800, 200, 900] }, { bounds: [NaN, 0, 200, 200] }]) {
    const s = state([node(v)]); assert.notEqual(resolveInteractionTarget(s, s.nodes[0]).status, 'RESOLVED');
  }
  const s = state([node({ bounds: [0, 100, 300, 150], clickable: false }), node({ parentIndex: 0 })]);
  assert.equal(resolveInteractionTarget(s, s.nodes[1]).status, 'NOT_INTERACTABLE');
});
test('resolver refuses covering controls and ambiguous duplicate activation labels', () => {
  const s = state([node(), node({ text: 'Play', clickable: false, parentIndex: 0, bounds: [20, 300, 280, 350] }),
    node({ text: 'Play', clickable: false, parentIndex: 0, bounds: [20, 150, 280, 200] })]);
  assert.equal(resolveInteractionTarget(s, s.nodes[1]).status, 'AMBIGUOUS');
  const covered = state([node(), node({ description: 'Products', parentIndex: 0, bounds: [80, 200, 220, 300] })]);
  assert.equal(resolveInteractionTarget(covered, covered.nodes[0]).status, 'AMBIGUOUS');
});
test('resolver does not guess activation for an unlabeled child or product card', () => {
  const s = state([node(), node({ clickable: false, parentIndex: 0, bounds: [20, 300, 280, 350] })]);
  assert.equal(resolveInteractionTarget(s, s.nodes[1]).status, 'AMBIGUOUS');
  const product = state([node({ description: 'A video - 10 minutes - 2 products - Play video' })]);
  assert.equal(resolveInteractionTarget(product, product.nodes[0], { video: true }).status, 'AMBIGUOUS');
});
test('fresh interaction validation rejects changed content, geometry, app and stale element references', async () => {
  const before = state([node({ text: 'Selected' })]);
  let after = state([{ ...before.nodes[0], text: 'Different' }]);
  const observer = new StateObserver({ serial: 'test', client: {}, path: '/session/test' }, async () => ({ stdout: 'device' }));
  observer.read = async () => after; observer.locate = async () => ({ id: 'fresh' });
  const found = { id: 'old', node: before.nodes[0], snapshot: before };
  assert.equal(await observer.revalidateInteraction(found), false);
  after = state([{ ...before.nodes[0], bounds: [0, 120, 300, 400] }]); assert.equal(await observer.revalidateInteraction(found), false);
  after = { ...before, foregroundPackage: 'other' }; assert.equal(await observer.revalidateInteraction(found), false);
  const native = new StateObserver({ serial: 'test', client: {}, path: '/session/test' }, async () => ({ stdout: 'device' }));
  await assert.rejects(native.locate({ ...before, timestamp: Date.now() - 10000 }, 'text:Selected', true, 1000), e => e.code === 'UNKNOWN');
});
test('explicit title duration channel identity ignores volatile views but not a different channel', () => {
  const a = 'Podcast - 10 minutes - Channel Example - 100 views - 1 day ago - Play video';
  assert.equal(videoIdentityEvidence(a), videoIdentityEvidence(a.replace('100 views', '101 views').replace('1 day ago', '2 days ago')));
  assert.notEqual(videoIdentityEvidence(a), videoIdentityEvidence(a.replace('Channel Example', 'Channel Different')));
  assert.notEqual(videoIdentityEvidence('Unknown - 10 minutes - 1 view - Play video'), videoIdentityEvidence('Unknown - 10 minutes - 2 views - Play video'));
});
test('merged watch metadata recognizes a video page without inventing a modern_title node', () => {
  const pkg = 'com.google.android.youtube';
  const nodes = [node({ packageName: pkg, resourceId: pkg + ':id/watch_player', clickable: false }),
    node({ packageName: pkg, resourceId: pkg + ':id/video_metadata_layout', clickable: false }),
    node({ packageName: pkg, description: 'Actual selected video title. Public channel', parentIndex: 1, clickable: false })];
  assert.equal(classifyScreen(pkg, nodes), 'VIDEO_PLAYER');
  assert.notEqual(classifyScreen(pkg, nodes.slice(0, 2)), 'VIDEO_PLAYER');
  assert.notEqual(classifyScreen(pkg, [...nodes, node({ packageName: pkg, resourceId: pkg + ':id/search_query', text: 'podcast' })]), 'VIDEO_PLAYER');
});
test('independent policy allows proven search navigation without changing the AI flag', () => {
  assert.equal(assessPlanPolicy(navigation).decision, 'ALLOW');
  const flagged = { ...navigation, isSensitive: true };
  const result = assessPlanPolicy(flagged);
  assert.equal(result.decision, 'CONFIRM'); assert.equal(result.llmDisagreement, true); assert.equal(flagged.isSensitive, true);
  assert.throws(() => assertPlanPolicy(flagged), e => e.code === 'CONFIG_ERROR');
  const playback = { ...flagged, actions: [...flagged.actions, { type: 'WAIT_FOR', target: 'play_button', timeoutMs: 20000 }, { type: 'CLICK', target: 'play_button' }] };
  assert.equal(assessPlanPolicy(playback).llmDisagreement, true);
});
test('HTML resource IDs in native Chrome hierarchy are located by observed XPath, not Android ID completion', () => {
  const heading = node({ text: 'Article heading', resourceId: '_observed_html_heading' });
  const selector = selectorForNode(heading, [heading]);
  assert.equal(selector.using, 'xpath'); assert.match(selector.value, /@text='Article heading'/); assert.match(selector.value, /@resource-id='_observed_html_heading'/);
});
test('navigation policy never treats executable URL schemes as a safe search', () => {
  for (const text of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>1</script>', 'intent://account', 'https://example.org/delete']) {
    const plan = { ...navigation, actions: [{ type: 'OPEN_APP', app: 'chrome' }, { type: 'CLICK', target: 'address_bar' }, { type: 'INPUT_TEXT', text }, { type: 'PRESS_KEY', key: 'ENTER' }] };
    assert.equal(assessPlanPolicy(plan).decision, 'BLOCK');
  }
  assert.equal(assessPlanPolicy({ ...navigation, actions: [{ type: 'OPEN_APP', app: 'com.android.settings' }, { type: 'CLICK', target: 'text:Wi-Fi' }] }).decision, 'ALLOW');
});
test('false-negative sensitive flag never bypasses policy; unknown and non-search input require control', () => {
  for (const target of ['subscribe_button', 'like_button', 'comment_button', 'text:Delete', 'text:Send']) {
    const plan = { ...navigation, actions: [{ type: 'CLICK', target }] };
    assert.equal(assessPlanPolicy(plan).decision, 'BLOCK'); assert.equal(assessPlanPolicy(plan).llmDisagreement, true);
  }
  assert.equal(assessPlanPolicy({ ...navigation, actions: [{ type: 'INPUT_TEXT', text: 'message' }] }).decision, 'BLOCK');
  assert.equal(assessPlanPolicy({ ...navigation, actions: [{ type: 'CLICK', target: 'text:Unknown' }] }).decision, 'CONFIRM');
  assert.throws(() => assertObservedControlSafe(node({ className: 'android.widget.Switch', text: 'Wi-Fi' })), e => e.code === 'CONFIG_ERROR');
});
test('password and unknown-password fields are rejected before clear or typing', async () => {
  for (const password of ['true', null]) {
    const calls = [], field = node({ resourceId: 'test:id/input', className: 'android.widget.EditText', focused: true }), s = state([field]);
    const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', ensureActive: async () => {}, client: { request: async (method, path) => {
      calls.push(path); return path.endsWith('/attribute/focused') ? 'true' : password;
    } } }, async () => ({ stdout: '', stderr: '' }));
    executor.observer = { waitUntil: async () => s, locate: async () => ({ id: 'field' }) };
    await assert.rejects(executor.execute({ type: 'INPUT_TEXT', text: 'not entered' }), e => e.code === 'CONFIG_ERROR');
    assert.equal(calls.some(path => path.endsWith('/clear') || path.endsWith('/value')), false);
  }
});

const document = { url: 'https://search.example/?q=recipe', title: 'Results', readyState: 'complete', viewport: { width: 400, height: 700 }, ambiguousAds: false,
  links: [{ selector: 'html > body:nth-of-type(1) > a:nth-of-type(1)', href: 'https://example.org/recipe', url: 'https://example.org/recipe',
    title: 'Recipe title', visible: true, covered: false, bounds: [0, 100, 300, 200] }] };
function hybridSession(options = {}) {
  let current = 'NATIVE_APP', clicked = false;
  const calls = [];
  const session = { path: '/session/test', client: { request: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith('/contexts')) return options.contexts ?? ['NATIVE_APP', 'WEBVIEW_com.android.chrome'];
    if (path.endsWith('/context') && method === 'GET') return current;
    if (path.endsWith('/context') && method === 'POST') {
      if (body.name !== 'NATIVE_APP' && options.switchError) throw options.switchError;
      if (body.name === 'NATIVE_APP' && options.restoreError) throw new AndroidExecutionError('BACKEND_ERROR', 'restore failed');
      current = body.name; return null;
    }
    if (path.endsWith('/execute/sync')) {
      if (body.script.startsWith('arguments')) return null;
      if (options.readError) throw options.readError;
      return clicked ? { ...document, url: 'https://example.org/recipe', title: 'Recipe title - Destination' } : document;
    }
    if (path.endsWith('/elements')) return [{ 'element-6066-11e4-a52e-4f735466cecf': 'web-element' }];
    if (path.endsWith('/displayed') || path.endsWith('/enabled')) return true;
    if (path.endsWith('/click')) { clicked = true; return null; }
    throw new Error(path);
  } } };
  return { session, calls, current: () => current };
}
test('Web Context reads real DOM and restores native on the same Session', async () => {
  const h = hybridSession(), observer = new HybridContextObserver(h.session);
  const result = await observer.observe('com.android.chrome');
  assert.equal(result.status, 'DOM_AVAILABLE'); assert.equal(result.source, 'WEB_CONTEXT'); assert.equal(h.current(), 'NATIVE_APP');
  assert.ok(h.calls.every(call => call.path.startsWith('/session/test/')));
});
test('Chrome DOM must match the observed native tab address rather than just its app package', () => {
  assert.equal(matchesNativeAddress('google.com/search?q=công+thức', 'https://www.google.com/search?q=c%C3%B4ng+th%E1%BB%A9c'), true);
  assert.equal(matchesNativeAddress('google.com/search?q=one', 'https://www.google.com/search?q=other'), false);
  assert.equal(matchesNativeAddress('example.org/page', 'https://other.org/page'), false);
  assert.equal(matchesNativeAddress('example.org/one', 'https://example.org/two'), false);
});
test('native-only and ambiguous contexts never claim DOM or select an arbitrary Web Context', async () => {
  for (const contexts of [['NATIVE_APP'], ['NATIVE_APP', 'WEBVIEW_com.android.chrome_1', 'WEBVIEW_com.android.chrome_2']]) {
    const h = hybridSession({ contexts }), result = await new HybridContextObserver(h.session).observe('com.android.chrome');
    assert.equal(result.source, 'NATIVE_ONLY'); assert.notEqual(result.status, 'DOM_AVAILABLE');
    assert.equal(h.calls.some(call => call.path.endsWith('/execute/sync')), false);
  }
});
test('Chromedriver incompatibility is diagnosed and native context is restored', async () => {
  const error = new AndroidExecutionError('BACKEND_ERROR', 'sanitized'); error.backendReason = 'CHROMEDRIVER_INCOMPATIBLE';
  const h = hybridSession({ switchError: error }), observer = new HybridContextObserver(h.session);
  const result = await observer.observe('com.android.chrome'); assert.equal(result.status, 'CHROMEDRIVER_INCOMPATIBLE'); assert.equal(h.current(), 'NATIVE_APP');
  const requests = h.calls.length; await observer.observe('com.android.chrome');
  assert.equal(h.calls.slice(requests).some(call => call.body?.name?.startsWith('WEBVIEW')), false);
});
test('session errors propagate and a failed context restore stops all fallback', async () => {
  const h = hybridSession({ readError: new AndroidExecutionError('SESSION_ERROR', 'socket hang up') });
  await assert.rejects(new HybridContextObserver(h.session).observe('com.android.chrome'), e => e.code === 'SESSION_ERROR');
  assert.equal(h.current(), 'NATIVE_APP');
  const broken = hybridSession({ restoreError: true });
  await assert.rejects(new HybridContextObserver(broken.session).observe('com.android.chrome'), e => e.code === 'SESSION_ERROR');
});
test('context timeout returns native fallback only after successful restore', async () => {
  const h = hybridSession({ readError: new AndroidExecutionError('TIMEOUT', 'deadline') });
  assert.equal((await new HybridContextObserver(h.session).observe('com.android.chrome')).source, 'NATIVE_ONLY');
  assert.equal(h.current(), 'NATIVE_APP');
});
test('Web Context safely scrolls, clicks and verifies a heading-link destination', async () => {
  const h = hybridSession(), observer = new HybridContextObserver(h.session), observation = await observer.observe('com.android.chrome');
  const result = await observer.clickOrdinal(observation, 1, 1000);
  assert.equal(result.finalUrl, 'https://example.org/recipe'); assert.equal(h.current(), 'NATIVE_APP');
  assert.equal(h.calls.filter(call => call.path.endsWith('/click')).length, 1);
});
test('covered DOM result is rejected before click', async () => {
  const h = hybridSession();
  const request = h.session.client.request;
  h.session.client.request = async (...args) => {
    const value = await request(...args);
    return args[1].endsWith('/execute/sync') && args[2].script.startsWith('return') ? { ...value, links: value.links.map(link => ({ ...link, covered: true })) } : value;
  };
  const observer = new HybridContextObserver(h.session), observation = await observer.observe('com.android.chrome');
  await assert.rejects(observer.clickOrdinal(observation, 1, 1000), e => e.code === 'AMBIGUOUS');
  assert.equal(h.calls.some(call => call.path.endsWith('/click')), false); assert.equal(h.current(), 'NATIVE_APP');
});
test('context operations serialize and release their gate after failure', async () => {
  const session = {}, order = [];
  const first = withSessionContextLock(session, async () => { order.push('first'); await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('failure'); });
  const second = withSessionContextLock(session, async () => { order.push('second'); });
  await assert.rejects(first); await second; assert.deepEqual(order, ['first', 'second']);
});
test('nested context verification is reentrant while independent native operations remain serialized', async () => {
  const session = {}, order = [];
  const first = withSessionContextLock(session, async () => {
    order.push('web');
    await withSessionContextLock(session, async () => { order.push('nested native'); });
    await new Promise(resolve => setTimeout(resolve, 10)); order.push('restore');
  });
  const second = withSessionContextLock(session, async () => { order.push('independent native'); });
  await first; await second;
  assert.deepEqual(order, ['web', 'nested native', 'restore', 'independent native']);
});
test('late callbacks cannot reuse a finished context-operation ownership token', async () => {
  const session = {}, order = [];
  let late;
  await withSessionContextLock(session, async () => {
    late = new Promise((resolve, reject) => setTimeout(() => {
      withSessionContextLock(session, async () => { order.push('late'); }).then(resolve, reject);
    }, 10));
  });
  const independent = withSessionContextLock(session, async () => {
    order.push('native start'); await new Promise(resolve => setTimeout(resolve, 25)); order.push('native end');
  });
  await independent; await late;
  assert.deepEqual(order, ['native start', 'native end', 'late']);
});
test('Appium classifies incompatible Chromedriver without exposing server messages', async () => {
  const client = new AppiumClient('http://localhost:4723', async () => new Response(JSON.stringify({ value: {
    error: 'unknown error', message: 'This version of ChromeDriver only supports Chrome version 125. private logs',
  } }), { status: 500 }));
  await assert.rejects(client.request('POST', '/session/test/context'), e => e.backendReason === 'CHROMEDRIVER_INCOMPATIBLE' && !e.message.includes('private logs'));
});
test('an invalid custom Chromedriver path is rejected before Session creation', async () => {
  const previous = process.env.APPIUM_CHROMEDRIVER_EXECUTABLE;
  process.env.APPIUM_CHROMEDRIVER_EXECUTABLE = 'relative-missing-driver.exe';
  let requests = 0;
  try {
    const session = new ManagedAppiumSession({ request: async () => { requests++; } }, 'test', async () => ({ stdout: 'device' }), async () => {});
    await assert.rejects(session.open(), e => e.code === 'CONFIG_ERROR'); assert.equal(requests, 0);
  } finally {
    if (previous === undefined) delete process.env.APPIUM_CHROMEDRIVER_EXECUTABLE;
    else process.env.APPIUM_CHROMEDRIVER_EXECUTABLE = previous;
  }
});
test('a loaded error page at the expected URL is never a successful destination', async () => {
  const h = hybridSession(), request = h.session.client.request;
  h.session.client.request = async (...args) => {
    const value = await request(...args);
    return args[1].endsWith('/execute/sync') && value?.url === 'https://example.org/recipe' ? { ...value, title: '404 Not Found' } : value;
  };
  const observer = new HybridContextObserver(h.session), observation = await observer.observe('com.android.chrome');
  await assert.rejects(observer.clickOrdinal(observation, 1, 25), e => e.code === 'TIMEOUT');
  assert.equal(h.current(), 'NATIVE_APP');
});
