/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { beginSearch, closeSearch, beforeSearchDispatch, noteSearchSubmitted } = require('../lib/android/agent/generic-search.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { issueEffectGrant, consumeEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { beginBrowserResult, beforeBrowserResultDispatch, acknowledgeBrowserResult } = require('../lib/android/agent/browser-result.ts');
const { verifySearchOutcome, verifyBrowserResultOutcome, isVerifiedEvidence } = require('../lib/android/agent/verification-registry.ts');
const { executeGroundedInteraction } = require('../lib/android/grounded-interactions.ts');
const { HybridContextObserver, READ_WEB_DOCUMENT, READ_WEB_DESTINATION } = require('../lib/android/hybrid-context-observer.ts');
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const { prepareV2 } = require('../lib/android/agent/prepared-v2.ts');
const { routeCapability } = require('../lib/android/unified-agent/capability-router.ts');
const originalFetch = global.fetch;
global.fetch = async () => assert.fail('P1 offline tests must not use network, real models or devices');
test.after(() => { global.fetch = originalFetch; });
const pkg = 'com.android.chrome', query = 'marine research notes', title = 'Marine research methods', url = 'https://example.org/research';
const request = 'M\u1edf Chrome, t\u00ecm ' + query + ' v\u00e0 m\u1edf b\u00e0i \u0111\u1ea7u ti\u00ean';
const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
const document = (article = false) => ({ url: article ? url : searchUrl, title: article ? title : 'Search', readyState: 'complete',
  headings: article ? [title] : [], canonicalUrls: article ? [url] : [], navigationType: 'navigate', navigationUrl: article ? url : searchUrl,
  alternateUrls: [], viewport: { width: 400, height: 800 }, ambiguousAds: false,
  links: article ? [] : [{ href: url, url, title, selector: 'a:nth-of-type(1)', visible: true, covered: false, bounds: [0, 100, 400, 220] }] });
function scene(stage = 'results', text = '', options = {}) {
  const nodes = [{ text, description: '', hint: '', resourceId: pkg + ':id/url_bar', className: stage === 'input' ? 'android.widget.EditText' : 'android.widget.TextView',
    focused: stage === 'input', clickable: true, bounds: [0, 0, 400, 70] },
  { text: '', description: '', hint: '', resourceId: pkg + ':id/content', className: 'android.webkit.WebView', focused: false, clickable: false, bounds: [0, 70, 400, 800] }]
    .map(n => ({ ...n, packageName: pkg, enabled: true, displayed: true }));
  const snapshotId = randomUUID();
  return { deviceSerial: 'A', snapshotId, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'OBSERVED',
    viewport: { x: 0, y: 0, width: 400, height: 800 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })),
    ...(['results', 'article'].includes(stage) ? { web: { status: 'DOM_AVAILABLE', source: 'WEB_CONTEXT', context: 'WEBVIEW_chrome', contexts: ['NATIVE_APP', 'WEBVIEW_chrome'], document: document(stage === 'article') } } : {}), ...options };
}
function resultFixture() {
  const graph = compileOutcomes(request, 'A', 'p1-unit'); graph.nodes.forEach(n => { n.packageName = pkg; });
  const node = graph.nodes[1], scope = beginSearch(node, 'A', 'p1-unit', 'S', 'BROWSER_ORGANIC');
  try {
    require('./fixtures/search-protocol.cjs').enter(node, scope, scene('input', ''), scene('input', query));
    const before = scene('input', query), c = generateGroundedCandidates(node, before, 'p1-unit', 'S', false, 0, '', false, undefined, false, scope).candidates[0];
    consumeEffectGrant(issueEffectGrant(c, node), 'A', 'S'); beforeSearchDispatch(c, before); noteSearchSubmitted(c);
    const context = { deviceId: 'A', executionId: 'p1-unit', nodeId: node.id, packageName: pkg };
    assert.equal(verifySearchOutcome(scope, scene(), context), undefined);
    const proof = verifySearchOutcome(scope, scene(), context); assert.ok(proof);
    const resultNode = graph.nodes[2], view = scene(), resultScope = beginBrowserResult(resultNode, view, proof, 'S');
    const candidate = generateGroundedCandidates(resultNode, view, 'p1-unit', 'S', false, 0, '', false, undefined, false, undefined, undefined, resultScope).candidates[0];
    assert.ok(candidate);
    return { graph, node: resultNode, proof, scope: resultScope, candidate, view,
      context: { ...context, nodeId: resultNode.id }, acknowledge() { beforeBrowserResultDispatch(candidate, scene(), url); acknowledgeBrowserResult(candidate); } };
  } finally { closeSearch(scope); }
}

test('OFFLINE V2 P1 preserves every clause, exact query, browser surface and first ordinal with no model preparation', async () => {
  const prepared = await prepareV2(request, 'A', {}, new AgentBudget(), new AbortController().signal);
  assert.equal(prepared.review, false);
  assert.deepEqual(prepared.graph.nodes.map(n => n.capability), ['LAUNCH', 'SEARCH', 'OPEN_RESULT']);
  assert.equal(prepared.graph.nodes[1].outcome.value, query);
  assert.deepEqual(prepared.graph.nodes[2].outcome.browserResult, { surface: 'BROWSER_ORGANIC', ordinal: 1, query });
  assert.deepEqual(prepared.graph.nodes[2].dependencies, [prepared.graph.nodes[1].id]);
  assert.throws(() => compileOutcomes({ ...prepared.graph.original, outcomes: prepared.graph.original.outcomes.slice(0, 2) }, 'A', 'E'), /coverage/);
});
test('OFFLINE V2 deeper browser ordinals stop in preparation without a model or Session', async () => {
  const source = request.replace('b\u00e0i \u0111\u1ea7u ti\u00ean', 'b\u00e0i th\u1ee9 hai');
  assert.notEqual(compileOutcomes(source, 'A', 'E').coverage, 'COMPLETE');
  await assert.rejects(prepareV2(source, 'A', {}, new AgentBudget(), new AbortController().signal), /BROWSER_RESULT_UNSUPPORTED/);
});
test('OFFLINE P1 router uses only V2 and rejects client engine selection and cut capabilities', () => {
  assert.throws(() => routeCapability(request, 'appium', 'V2'), /ENGINE_SELECTION_REMOVED/);
  assert.equal(routeCapability(request, 'appium').engine, 'V2');
  assert.throws(() => routeCapability(request, 'appium', 'V1'), /ENGINE_SELECTION_REMOVED/);
  assert.throws(() => routeCapability(request, 'adb'), /Appium/);
  assert.throws(() => routeCapability(request.replace('b\u00e0i \u0111\u1ea7u ti\u00ean', 'b\u00e0i th\u1ee9 hai'), 'appium'), /CAPABILITY_DISABLED/);
  assert.throws(() => routeCapability('M\u1edf YouTube, t\u00ecm marine research v\u00e0 ph\u00e1t video \u0111\u1ea7u ti\u00ean', 'appium'), /CAPABILITY_DISABLED/);
});
test('OFFLINE V2 prior search must be issued, bound to the parent query, and not a clone', () => {
  const f = resultFixture();
  for (const invalid of [undefined, { ...f.proof }, { ...f.proof, search: { query: 'other', status: 'RESULTS', count: 1 } }]) {
    assert.throws(() => beginBrowserResult(f.node, scene(), invalid, 'S'), /SEARCH_SCOPE_UNPROVEN/);
  }
  assert.throws(() => beginBrowserResult({ ...f.node, outcome: { ...f.node.outcome, browserResult: { surface: 'BROWSER_ORGANIC', ordinal: 2, query } } }, scene(), f.proof, 'S'), /SEARCH_SCOPE_UNPROVEN/);
  assert.throws(() => beginBrowserResult(f.node, scene('results', '', { deviceSerial: 'B' }), f.proof, 'S'), /SEARCH_SCOPE_UNPROVEN/);
  assert.throws(() => beginBrowserResult(f.node, scene(), f.proof, 'different-session'), /SEARCH_SCOPE_UNPROVEN/);
  assert.equal(verifyBrowserResultOutcome(f.scope, scene('article'), f.context), undefined);
});
test('OFFLINE V2 registered proof contains exact URL/title and authentic search provenance, never dispatch alone', () => {
  const f = resultFixture(); f.acknowledge();
  const proof = verifyBrowserResultOutcome(f.scope, scene('article'), f.context);
  assert.ok(isVerifiedEvidence(proof)); assert.equal(proof.provider, 'BROWSER_RESULT_V2');
  assert.deepEqual(proof.browserResult, { query, ordinal: 1, surface: 'BROWSER_ORGANIC', url, title, searchEvidenceId: f.proof.id });
  assert.equal(verifyBrowserResultOutcome({ ...f.scope }, scene('article'), f.context), undefined);
});
for (const mode of ['wrong-url', 'wrong-title', 'title-only', 'loading', 'captcha', 'foreground', 'observation', 'stale', 'same-snapshot', 'foreign-device']) {
  test('OFFLINE V2 independent destination proof rejects ' + mode, () => {
    const f = resultFixture(); f.acknowledge(); const after = scene('article');
    if (mode === 'wrong-url') after.web.document.url = url + '/different';
    if (mode === 'wrong-title') { after.web.document.title = 'Other article'; after.web.document.headings = ['Other article']; }
    if (mode === 'title-only') { delete after.web; after.nodes.push({ ...after.nodes[0], text: title }); }
    if (mode === 'loading') after.web.document.readyState = 'loading';
    if (mode === 'captcha') after.web.document.title = 'Captcha';
    if (mode === 'foreground') after.foregroundPackage = 'other.browser';
    if (mode === 'observation') after.observationStatus = 'UNKNOWN';
    if (mode === 'stale') after.timestamp -= 6000;
    if (mode === 'same-snapshot') after.snapshotId = f.scope.beforeId;
    if (mode === 'foreign-device') after.deviceSerial = 'B';
    assert.equal(verifyBrowserResultOutcome(f.scope, after, f.context), undefined);
  });
}
test('OFFLINE V2 candidate identity rejects changed first URL, duplicate browser containers and foreign grants before effect', () => {
  const f = resultFixture(), changed = scene(); changed.web.document.links[0].url += '/other';
  const generate = view => generateGroundedCandidates(f.node, view, 'p1-unit', 'S', false, 0, '', false, undefined, false, undefined, undefined, f.scope).candidates;
  assert.equal(generate(changed).length, 0);
  const duplicate = scene(); duplicate.nodes.push({ ...duplicate.nodes[1] }); duplicate.elements.push({ ...duplicate.elements[1] });
  assert.equal(generate(duplicate).length, 0);
  const grant = issueEffectGrant(f.candidate, f.node);
  assert.throws(() => consumeEffectGrant(grant, 'B', 'S'), /another Session\/device/);
  assert.throws(() => consumeEffectGrant(grant, 'A', 'other-session'), /another Session\/device/);
  consumeEffectGrant(grant, 'A', 'S'); assert.throws(() => consumeEffectGrant(grant, 'A', 'S'), /replayed/);
});

function runtimeFixture(mode = 'success') {
  let stage = 'start', text = '', context = 'NATIVE_APP', clicks = 0, closed = 0, sessions = 0, modelCalls = 0;
  const controller = new AbortController(), events = [], requests = [];
  const view = () => scene(stage, text);
  const session = { serial: mode === 'foreign-device' ? 'B' : 'A', sessionId: mode === 'foreign-session' ? 'other-S' : 'S', path: '/session/S', ensureActive: async signal => signal?.throwIfAborted(),
    client: { request: async (method, path, body, _timeout, signal) => {
      signal?.throwIfAborted(); requests.push({ method, path, body });
      if (path.endsWith('/contexts')) return ['NATIVE_APP', 'WEBVIEW_chrome'];
      if (path.endsWith('/context')) { if (method === 'POST') context = body.name; return context; }
      if (path.endsWith('/elements')) return [{ 'element-6066-11e4-a52e-4f735466cecf': 'article-link' }];
      if (/\/(displayed|enabled)$/.test(path)) return true;
      if (path.endsWith('/attribute/password')) return 'false';
      if (path.endsWith('/clear')) { text = ''; return; }
      if (path.endsWith('/value')) { text = body.text; return; }
      if (path.endsWith('/click')) {
        if (path.includes('article-link')) {
          clicks++; stage = 'article';
          if (mode === 'unknown') throw Error('Reply lost after click dispatch');
          if (mode === 'timeout') throw new AndroidExecutionError('TIMEOUT', 'Unknown click completion');
          if (mode === 'cancel') controller.abort();
        } else stage = 'input';
        return;
      }
      if (body?.script === READ_WEB_DOCUMENT || body?.script === READ_WEB_DESTINATION) return document(stage === 'article');
      if (body?.script === 'mobile: performEditorAction') { stage = 'results'; return; }
      if (body?.script?.includes('scrollIntoView')) return;
      throw Error('Unexpected fixture RPC');
    } } };
  const observer = { read: async () => view(), readNativeSnapshot: async () => view(),
    locate: async () => ({ id: 'address-field', interaction: { method: 'ELEMENT_CLICK' } }),
    waitUntil: async condition => {
      for (let i = 0; i < 3; i++) { const result = await condition(view()); if (result) return result; }
      throw new AndroidExecutionError('TIMEOUT', 'Fixture transition was not verified');
    } };
  observer.hybrid = new HybridContextObserver(session);
  const adapter = { catalog: { resolve: async () => ({ app: { serial: 'A', packageName: pkg }, choices: [] }) }, open: async () => {
    sessions++; return { backend: 'appium', sessionId: () => 'S', observe: observer.read,
      execute: async () => assert.fail('Already foreground; no legacy action dispatch permitted'),
      interactV2: grant => executeGroundedInteraction(session, observer, grant, controller.signal), close: async () => { closed++; } };
  } };
  return { adapter, events, controller, requests, reasoner: { generate: async () => { modelCalls++; assert.fail('Deterministic P1 must not call a model'); } },
    get clicks() { return clicks; }, get closed() { return closed; }, get sessions() { return sessions; }, get modelCalls() { return modelCalls; } };
}
for (const ownerMode of ['normal', 'owner', 'full-control']) {
  test('OFFLINE real V2 loop/grounded executor/DOM helper completes P1 in one Session: ' + ownerMode, async () => {
    const f = runtimeFixture(), policy = new OwnerTestPolicy(), executionId = randomUUID(); let mode, owner;
    if (ownerMode !== 'normal') { mode = policy.enable('A', 'physical-A', undefined, { fullControl: ownerMode === 'full-control', rollbackOnFailure: true }); owner = policy.bind('A', 'physical-A', executionId); }
    try {
      await runAgentV2(request, 'A', executionId, 'physical-A', new AgentBudget({ iterations: 50 }), f.adapter, e => f.events.push(e), f.controller.signal, f.reasoner, owner);
      const final = f.events.at(-1);
      assert.equal(final.status, 'COMPLETED', final.reason);
      assert.equal(final.v2.graph.nodes.every(n => n.status === 'VERIFIED'), true);
      assert.equal(final.v2.browserResult.url, url); assert.equal(final.v2.browserResult.title, title);
      assert.equal(f.clicks, 1); assert.equal(f.closed, 1); assert.equal(f.sessions, 1); assert.equal(f.modelCalls, 0);
    } finally { if (mode) policy.disable('A', mode.id); }
    assert.equal(policy.list().length, 0);
  });
}
for (const mode of ['unknown', 'timeout', 'cancel', 'foreign-device', 'foreign-session']) {
  test('OFFLINE V2 fail-closed with Session release and no replay: ' + mode, async () => {
    const f = runtimeFixture(mode);
    await runAgentV2(request, 'A', 'p1-' + mode, 'physical-A', new AgentBudget({ iterations: 50 }), f.adapter, e => f.events.push(e), f.controller.signal, f.reasoner);
    assert.equal(f.events.at(-1).status, mode === 'cancel' ? 'CANCELLED' : 'BLOCKED', f.events.at(-1).reason);
    assert.equal(f.clicks, mode.startsWith('foreign-') ? 0 : 1); assert.equal(f.closed, 1); assert.equal(f.sessions, 1); assert.equal(f.modelCalls, 0);
    assert.equal(f.events.some(e => e.status === 'COMPLETED'), false);
  });
}

test('OFFLINE production organic extractor output feeds V2 first-result selection, excluding sponsored products and video cards', () => {
  const root = { tagName: 'HTML', nodeType: 1 }, body = { tagName: 'BODY', nodeType: 1, parentElement: root, children: [] }; root.children = [body]; let current;
  const anchor = (label, source, ad) => ({ tagName: 'A', nodeType: 1, parentElement: body, href: 'https://example.org/' + label, children: [],
    querySelector: () => ({ textContent: label }), matches: selector => ad && selector.includes('[data-impdclcc]'),
    querySelectorAll: selector => selector === '[role="text"],cite' && source ? [{ textContent: 'https://example.org' }] : [],
    getBoundingClientRect: () => ({ left: 0, top: 100, right: 400, bottom: 220, x: 0, y: 100, width: 400, height: 120 }), contains: top => top === current });
  const anchors = [anchor('sponsored-product', true, true), anchor('video-card', false, false), anchor('first-article', true, false)]; body.children = anchors;
  const doc = { documentElement: root, body, title: 'Search', readyState: 'complete', querySelectorAll: selector => selector === 'a[href]' ? anchors : [], elementFromPoint: () => current };
  const extracted = vm.runInNewContext(`(()=>{${READ_WEB_DOCUMENT}})()`, { document: doc, URL, location: { href: searchUrl, hostname: 'www.google.com', pathname: '/search' },
    innerWidth: 400, innerHeight: 800, getComputedStyle: a => { current = a; return { display: 'block', visibility: 'visible' }; }, performance: { getEntriesByType: () => [] } });
  assert.deepEqual(Array.from(extracted.links, l => l.title), ['first-article']);
  const f = resultFixture(), view = scene(); view.web.document = extracted;
  const scope = beginBrowserResult(f.node, view, f.proof, 'S');
  const candidates = generateGroundedCandidates(f.node, view, 'p1-unit', 'S', false, 0, '', false, undefined, false, undefined, undefined, scope).candidates;
  assert.equal(candidates.length, 1); assert.equal(scope.link.title, 'first-article'); assert.equal(scope.ordinal, 1);
});
