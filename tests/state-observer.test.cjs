/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { ManagedAppiumSession, acquireDeviceLock } = require('../lib/android/appium/session-manager.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { waitForObservation, selectorForNode, xpathLiteral } = require('../lib/android/state-observer.ts');
const { parseUiHierarchy } = require('../lib/android/targets.ts');
const { classifyScreen, isNodeInteractable } = require('../lib/android/screen-state.ts');
const { ScreenSnapshotSchema } = require('../lib/android/snapshot.ts');
const { matchUiTarget, nodeForSelection } = require('../lib/android/ui-understanding.ts');
const { assertNonSensitivePlan, ConditionExecutor } = require('../lib/android/condition-executor.ts');
const { verifyClickTransition, verifyBrowserSearch } = require('../lib/android/action-verifier.ts');

const node = (values = {}) => ({ resourceId: 'test:id/button', description: 'Search', text: '', packageName: 'test', className: 'android.widget.Button',
  enabled: true, clickable: true, focused: false, displayed: true, bounds: [0, 0, 100, 100], ...values });
function snapshot(nodes = [node()], screen = 'OBSERVED') {
  const snapshotId = randomUUID();
  return { deviceSerial: 'test', snapshotId, timestamp: Date.now(), foregroundPackage: 'test', evidenceSource: 'APPIUM', observationStatus: screen === 'UNKNOWN' ? 'UNKNOWN' : 'OBSERVED',
    elements: nodes.map((n, i) => ({ elementId: `${snapshotId}:${i}`, text: n.text, resourceId: n.resourceId, contentDescription: n.description,
      className: n.className, packageName: n.packageName, bounds: n.bounds, enabled: n.enabled })),
    observedAt: new Date().toISOString(), source: 'APPIUM', screen, nodes, viewport: { x: 0, y: 0, width: 1080, height: 1920 } };
}
function mockExplorer(executor) {
  executor.explorer = { reset() {}, find: async (target, timeout, click, signal) => ({ status: 'FOUND',
    found: await executor.observer.waitFor(target, timeout, signal, undefined, click),
    metrics: { phase: 'FOUND', scrollCount: 0, snapshotCount: 1, newElements: 0, duplicateElements: 0, elapsedMs: 0, aiCalls: 0, aiElapsedMs: 0 } }) };
}

test('snapshot schema validates structured UI without inventing missing booleans', () => {
  const parsed = ScreenSnapshotSchema.parse(snapshot());
  assert.equal(parsed.elements[0].focusable, undefined);
  assert.equal(parsed.deviceSerial, 'test');
  assert.throws(() => ScreenSnapshotSchema.parse({ ...parsed, snapshotId: 'invented' }));
});
test('YouTube search results can render ads and a channel before any ordinary video', () => {
  const pkg = 'com.google.android.youtube';
  const nodes = [node({ packageName: pkg, resourceId: pkg + ':id/search_query', text: 'OpenAI', description: '', clickable: false }),
    node({ packageName: pkg, resourceId: pkg + ':id/results', className: 'android.support.v7.widget.RecyclerView', text: '', description: '', scrollable: true }),
    node({ packageName: pkg, resourceId: '', text: '\u0110\u01b0\u1ee3c t\u00e0i tr\u1ee3', description: '', parentIndex: 1, clickable: false }),
    node({ packageName: pkg, resourceId: '', text: 'OpenAI', description: '', parentIndex: 1 })];
  assert.equal(classifyScreen(pkg, nodes), 'SEARCH_RESULTS');
  assert.notEqual(classifyScreen(pkg, nodes.slice(0, 2)), 'SEARCH_RESULTS');
  assert.notEqual(classifyScreen(pkg, [nodes[1], { ...nodes[2], parentIndex: 0 }]), 'SEARCH_RESULTS');
  assert.equal(classifyScreen(pkg, [...nodes, node({ packageName: pkg, resourceId: pkg + ':id/search_edit_text', className: 'android.widget.EditText' })]), 'SEARCH_INPUT');
  assert.notEqual(classifyScreen(pkg, [nodes[0], nodes[1], { ...nodes[2], parentIndex: undefined }]), 'SEARCH_RESULTS');
});
test('condition already present returns on first probe', async () => {
  let reads = 0;
  const result = await waitForObservation(async () => { reads++; return snapshot(); }, (s) => s.nodes[0], 'Search', 1000);
  assert.equal(reads, 1); assert.equal(result.description, 'Search');
});
test('condition appearing late succeeds at the first matching observation', async () => {
  let reads = 0;
  await waitForObservation(async () => snapshot(++reads >= 3 ? [node()] : []), (s) => s.nodes[0] ?? false, 'Search', 1000);
  assert.equal(reads, 3);
});
test('absent target times out and never becomes success', async () => {
  await assert.rejects(waitForObservation(async () => snapshot(), () => false, 'missing', 25), (e) => e.code === 'TIMEOUT');
});
test('unrecognized UI returns UNKNOWN at deadline', async () => {
  await assert.rejects(waitForObservation(async () => snapshot([], 'UNKNOWN'), () => false, 'missing', 25), (e) => e.code === 'UNKNOWN');
});
for (const code of ['DEVICE_ERROR', 'SESSION_ERROR']) test(`${code} stops polling immediately`, async () => {
  let reads = 0;
  await assert.rejects(waitForObservation(async () => { reads++; throw new AndroidExecutionError(code, 'failure'); }, () => false, 'target', 1000), (e) => e.code === code);
  assert.equal(reads, 1);
});
test('cancellation ends polling and prevents later condition evaluation', async () => {
  const controller = new AbortController();
  let evaluations = 0;
  await assert.rejects(waitForObservation(async () => { controller.abort(); return snapshot(); }, () => { evaluations++; return true; }, 'target', 1000, controller.signal), (e) => e.code === 'CANCELLED');
  assert.equal(evaluations, 0);
});
test('Appium errors distinguish invalid session and socket hang up without exposing stack traces', async () => {
  for (const message of ['invalid session id', 'socket hang up']) {
    const client = new AppiumClient('http://localhost:4723', async () => new Response(JSON.stringify({ value: {
      error: message === 'invalid session id' ? message : 'unknown error', message, stacktrace: 'private stack',
    } }), { status: 500 }));
    await assert.rejects(client.request('GET', '/session/test/source'), (e) => e.code === 'SESSION_ERROR' && !e.message.includes('private stack'));
  }
});
test('session is reused and cleanup executes DELETE once', async () => {
  const calls = [];
  const client = new AppiumClient('http://localhost:4723', async (url, options) => {
    calls.push([options.method, new URL(url).pathname]);
    const value = options.method === 'POST' && url.endsWith('/session') ? { sessionId: 'test-session' } :
      url.endsWith('/appium/capabilities') ? { capabilities: { udid: 'test' } } : null;
    return new Response(JSON.stringify({ value }));
  });
  const session = new ManagedAppiumSession(client, 'test', async (args) => ({ stdout: args.includes('--list') ? '' : 'device', stderr: '' }), async () => {});
  await session.open(); await session.ensureActive(); await session.ensureActive(); await session.close(); await session.close();
  assert.equal(calls.filter(([method, path]) => method === 'POST' && path === '/session').length, 1);
  assert.equal(calls.filter(([method]) => method === 'DELETE').length, 1);
});
test('device lock prevents overlapping contexts and releases after cleanup', async () => {
  const serial = randomUUID();
  const release = await acquireDeviceLock(serial);
  try { await assert.rejects(acquireDeviceLock(serial), (e) => e.code === 'SESSION_ERROR'); }
  finally { await release(); }
  const next = await acquireDeviceLock(serial); await next();
});
test('generic UI understanding recognizes an address field from Chrome-like attributes, not YouTube IDs', () => {
  const field = node({ resourceId: 'browser:id/url_bar', description: '', text: 'Search or type web address', className: 'android.widget.EditText' });
  const s = snapshot([field]);
  assert.equal(matchUiTarget(s, 'address_bar', true).node, field);
  assert.equal(classifyScreen('browser', s.nodes), 'OBSERVED');
});
test('Settings text resolves to its clickable parent and cannot toggle a control by ambiguity', () => {
  const row = node({ description: '', resourceId: 'settings:id/row' });
  const label = node({ resourceId: 'settings:id/title', text: 'Wi-Fi', description: '', clickable: false, parentIndex: 0 });
  const s = snapshot([row, label]);
  assert.equal(matchUiTarget(s, 'text:Wi-Fi', true).node, row);
  assert.equal(matchUiTarget(snapshot([label, { ...label }]), 'text:Wi-Fi').status, 'AMBIGUOUS');
});
test('duplicate IDs require disambiguation; accessibility label wins for a validated node', () => {
  const rows = [node({ description: 'Notifications' }), node({ description: 'Search' })];
  assert.equal(matchUiTarget(snapshot(rows), 'id:test:id/button').status, 'AMBIGUOUS');
  assert.deepEqual(selectorForNode(rows[1], rows), { using: 'accessibility id', value: 'Search' });
});

test('semantic registry matches cannot silently choose one of duplicate search buttons', () => {
  const search = node({ packageName: 'com.google.android.youtube', description: 'Search' });
  const s = snapshot([search, { ...search }]); s.foregroundPackage = 'com.google.android.youtube';
  assert.equal(matchUiTarget(s, 'search_button', true).status, 'AMBIGUOUS');
});
test('stale or invented snapshot element selection cannot resolve', () => {
  const s = snapshot();
  assert.equal(nodeForSelection(s, { snapshotId: randomUUID(), elementId: s.elements[0].elementId }), undefined);
  assert.equal(nodeForSelection(s, { snapshotId: s.snapshotId, elementId: 'made-up' }), undefined);
  assert.equal(nodeForSelection(s, { snapshotId: s.snapshotId, elementId: s.elements[0].elementId }), s.nodes[0]);
});
test('disabled, offscreen and clipped video elements cannot be clicked', () => {
  const viewport = { x: 0, y: 0, width: 1080, height: 1920 };
  assert.equal(isNodeInteractable(node({ enabled: false }), [], viewport, 'button'), false);
  assert.equal(isNodeInteractable(node({ bounds: [0, 1900, 100, 2000] }), [], viewport, 'button'), false);
  assert.equal(isNodeInteractable(node({ bounds: [0, 100, 1080, 140] }), [], viewport, 'video_card_2'), false);
});
test('loading container alone never proves YouTube search results', () => {
  const nodes = [node({ packageName: 'com.google.android.youtube', resourceId: 'com.google.android.youtube:id/results', description: '' }),
    node({ packageName: 'com.google.android.youtube', resourceId: 'com.google.android.youtube:id/load_progress', description: '' })];
  assert.equal(classifyScreen('com.google.android.youtube', nodes), 'LOADING');
});
test('sensitive plan is refused before any execution', () => {
  assert.throws(() => assertNonSensitivePlan({ isSensitive: false, intent: 'test', actions: [{ type: 'CLICK', target: 'subscribe_button' }] }), (e) => e.code === 'CONFIG_ERROR');
});
test('XPath literal handles both quote types as data', () => {
  assert.match(xpathLiteral('a\'"b'), /^concat\(/);
});
test('parser retains hierarchy and only attributes actually provided', () => {
  const nodes = parseUiHierarchy('<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][100,100]" enabled="false"><node class="android.widget.EditText" bounds="[0,0][50,50]" enabled="true" focused="true"/></node></hierarchy>');
  assert.equal(nodes[1].parentIndex, 0); assert.equal(nodes[1].enabled, false); assert.equal(nodes[1].scrollable, undefined);
});
test('Appium class-name XML tags are parsed as actual elements, like ADB node tags', () => {
  const nodes = parseUiHierarchy('<hierarchy><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][100,100]"><android.widget.EditText class="android.widget.EditText" bounds="[0,0][50,50]" enabled="true" focused="true"/></android.widget.FrameLayout></hierarchy>');
  assert.equal(nodes.length, 2); assert.equal(nodes[1].parentIndex, 0); assert.equal(nodes[1].focused, true);
});
test('browser results use URL-bearing WebView cards and exclude ambiguous sponsored groups', () => {
  const web = node({ className: 'android.webkit.WebView', resourceId: '', clickable: false, description: '', bounds: [0, 0, 1080, 1920] });
  const link = node({ resourceId: '', description: 'Example https://example.org A verified recipe title', className: 'android.view.View', parentIndex: 0, bounds: [0, 120, 100, 260] });
  const s = snapshot([web, link]);
  assert.equal(matchUiTarget(s, 'first_result', true).node, link);
  const ad = node({ text: 'Sponsored', description: '', parentIndex: 0 });
  assert.equal(matchUiTarget(snapshot([web, link, ad]), 'first_result').status, 'MISSING');
});
test('browser search and page-open postconditions need URL and real content evidence', () => {
  const web = node({ className: 'android.webkit.WebView', resourceId: '', clickable: false, description: '' });
  const link = node({ resourceId: '', description: 'Example https://example.org A verified recipe title', className: 'android.view.View', parentIndex: 0, bounds: [0, 120, 100, 260] });
  const url = node({ resourceId: 'browser:id/url_bar', text: 'search.example/search?q=recipe', description: '' });
  const before = snapshot([web, link, url]);
  assert.equal(verifyBrowserSearch(before, 'recipe'), true);
  assert.equal(verifyBrowserSearch(before, 'different'), false);
  const after = snapshot([web, { ...url, text: 'example.org/recipe' }, node({ text: 'A verified recipe title', description: '' })]);
  assert.equal(verifyClickTransition(before, after, 'first_result'), true);
  assert.equal(verifyClickTransition(before, snapshot([web, url]), 'first_result'), false);
});
test('known connection refusal during session creation does not leave an uncertain session', async () => {
  const client = new AppiumClient('http://localhost:4723', async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; });
  const session = new ManagedAppiumSession(client, 'test', async args => ({ stdout: args.includes('--list') ? '' : 'device', stderr: '' }), async () => {});
  await assert.rejects(session.open(), e => e.code === 'BACKEND_ERROR');
  await session.close();
});

test('socket hang up during DELETE retains the session for explicit cleanup retry', async () => {
  let deletes = 0;
  const client = new AppiumClient('http://localhost:4723', async (url, options) => {
    if (options.method === 'DELETE' && ++deletes === 1) return new Response(JSON.stringify({ value: { error: 'unknown error', message: 'socket hang up' } }), { status: 500 });
    const value = options.method === 'POST' && url.endsWith('/session') ? { sessionId: 'test-session' } :
      url.endsWith('/appium/capabilities') ? { udid: 'test' } : null;
    return new Response(JSON.stringify({ value }));
  });
  const session = new ManagedAppiumSession(client, 'test', async args => ({ stdout: args.includes('--list') ? '' : 'device', stderr: '' }), async () => {});
  await session.open();
  await assert.rejects(session.close(), e => e.code === 'SESSION_ERROR');
  assert.equal(session.path, '/session/test-session');
  await session.close(); assert.equal(deletes, 2);
});

test('invalid session response during DELETE proves the session is already closed', async () => {
  const client = new AppiumClient('http://localhost:4723', async (url, options) => {
    if (options.method === 'DELETE') return new Response(JSON.stringify({ value: { error: 'invalid session id', message: 'No session' } }), { status: 404 });
    return new Response(JSON.stringify({ value: url.endsWith('/session') ? { sessionId: 'test-session' } : url.endsWith('/appium/capabilities') ? { udid: 'test' } : null }));
  });
  const session = new ManagedAppiumSession(client, 'test', async args => ({ stdout: args.includes('--list') ? '' : 'device', stderr: '' }), async () => {});
  await session.open(); await session.close(); await session.close();
});

test('CLICK without a trusted postcondition is dispatched, never VERIFIED', async () => {
  const calls = [];
  const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', ensureActive: async () => {},
    client: { request: async (...args) => { calls.push(args); } } }, async () => ({ stdout: '', stderr: '' }));
  const state = snapshot();
  executor.observer = { waitFor: async () => ({ id: 'button', snapshot: state, node: state.nodes[0] }), read: async () => state };
  mockExplorer(executor);
  const result = await executor.execute({ type: 'CLICK', target: 'id:test:id/button' });
  assert.equal(result.verification, 'DISPATCHED');
  assert.equal(calls.length, 1);
});
test('video_list uses a configurable exploration budget, other waits retain their deadline', async () => {
  const previous = process.env.ANDROID_EXPLORATION_TIMEOUT_MS;
  process.env.ANDROID_EXPLORATION_TIMEOUT_MS = '120000';
  try {
    const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', ensureActive: async () => {} }, async () => ({ stdout: '', stderr: '' }));
    const calls = [], state = snapshot();
    executor.explorer = { find: async (target, timeout) => {
      calls.push({ target, timeout });
      return { status: 'FOUND', found: { id: 'observed', node: state.nodes[0], snapshot: state },
        metrics: { phase: 'FOUND', scrollCount: 0, snapshotCount: 1, newElements: 1, duplicateElements: 0, elapsedMs: 0, aiCalls: 0, aiElapsedMs: 0 } };
    } };
    await executor.execute({ type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 });
    await executor.execute({ type: 'WAIT_FOR', target: 'search_button', timeoutMs: 20000 });
    assert.deepEqual(calls, [{ target: 'video_card_1', timeout: 120000 }, { target: 'search_button', timeout: 20000 }]);
  } finally {
    if (previous === undefined) delete process.env.ANDROID_EXPLORATION_TIMEOUT_MS;
    else process.env.ANDROID_EXPLORATION_TIMEOUT_MS = previous;
  }
});

test('CLICK precondition failure never dispatches an action', async () => {
  let dispatches = 0;
  const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', ensureActive: async () => {},
    client: { request: async () => { dispatches++; } } }, async () => ({ stdout: '', stderr: '' }));
  executor.observer = { waitFor: async () => { throw new AndroidExecutionError('UNKNOWN', 'Ambiguous target'); } };
  mockExplorer(executor);
  await assert.rejects(executor.execute({ type: 'CLICK', target: 'text:Duplicate' }), e => e.code === 'UNKNOWN');
  assert.equal(dispatches, 0);
});

test('observed sensitive control is refused even when the supplied target is innocuous', async () => {
  let dispatches = 0;
  const control = node({ description: 'Đăng ký' });
  const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', ensureActive: async () => {},
    client: { request: async () => { dispatches++; } } }, async () => ({ stdout: '', stderr: '' }));
  const state = snapshot([control]);
  executor.observer = { waitFor: async () => ({ id: 'button', snapshot: state, node: control }) };
  mockExplorer(executor);
  await assert.rejects(executor.execute({ type: 'CLICK', target: 'id:test:id/button' }), e => e.code === 'CONFIG_ERROR');
  assert.equal(dispatches, 0);
});

test('INPUT_TEXT must verify committed text after dispatch', async () => {
  const field = node({ className: 'android.widget.EditText', focused: true, text: 'old' });
  const state = snapshot([field]);
  const executor = new ConditionExecutor({ serial: 'test', path: '/session/test', ensureActive: async () => {},
    client: { request: async (method, url) => url.endsWith('/attribute/focused') ? 'true' : url.endsWith('/attribute/password') ? 'false' : null } }, async () => ({ stdout: '', stderr: '' }));
  executor.observer = { locate: async () => ({ id: 'input' }), waitUntil: async (condition, label) => {
    const result = condition(state);
    if (!result) throw new AndroidExecutionError('TIMEOUT', label);
    return result;
  } };
  await assert.rejects(executor.execute({ type: 'INPUT_TEXT', text: 'new' }), e => e.code === 'TIMEOUT');
});
