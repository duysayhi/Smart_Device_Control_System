/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { resolveBrowserDestinationUrl } = require('../lib/android/browser-destination.ts');
const { READ_WEB_DOCUMENT } = require('../lib/android/hybrid-context-observer.ts');
const redirect = 'https://www.google.com/goto?url=opaque-observed-value';
const destination = 'https://example.org/recipe';
const moved = href => `<HTML><HEAD><meta http-equiv="content-type" content="text/html;charset=utf-8"><TITLE>302 Moved</TITLE></HEAD><BODY><H1>302 Moved</H1>The document has moved<A HREF="${href}">here</A>.</BODY></HTML>`;

test('observed Google redirect resolves from an explicit unique moved document without fetching its target', async () => {
  const calls = [];
  const request = async (url, options) => { calls.push([url, options]); return new Response(moved(destination)); };
  assert.equal(await resolveBrowserDestinationUrl(redirect, undefined, request), destination);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], redirect);
  assert.equal(calls[0][1].redirect, 'manual');
  assert.equal(calls[0][1].credentials, 'omit');
});

test('normal article links are not fetched and HTTP redirect headers are explicit evidence', async () => {
  assert.equal(await resolveBrowserDestinationUrl(destination, undefined, () => { throw new Error('unexpected request'); }), destination);
  assert.equal(await resolveBrowserDestinationUrl(redirect, undefined, async () => new Response(null, { status: 302, headers: { location: destination } })), destination);
});

test('redirects reject private destinations, credentials, scripts, ambiguous anchors and unbounded bodies', async () => {
  for (const href of ['http://127.0.0.1/private', 'http://192.168.1.1/', 'http://localhost/', 'https://example.local/', 'https://user:password@example.org/', 'javascript:alert(1)']) {
    await assert.rejects(resolveBrowserDestinationUrl(redirect, undefined, async () => new Response(moved(href))));
  }
  for (const body of ['<HTML><BODY>ordinary page</BODY></HTML>', moved(destination).replace('</BODY>', '<A HREF="https://other.org/">other</A></BODY>'),
    moved(destination).replace('</BODY>', '<script>location="https://other.org"</script></BODY>'), 'x'.repeat(16385)]) {
    await assert.rejects(resolveBrowserDestinationUrl(redirect, undefined, async () => new Response(body)));
  }
});

test('Google article ordinals exclude observed ad attributes and video cards without source-URL semantics', () => {
  const root = { tagName: 'HTML', nodeType: 1 }, body = { tagName: 'BODY', nodeType: 1, parentElement: root, children: [] };
  root.children = [body];
  const make = (title, source, ad, parentAd = false) => {
    const parent = parentAd ? { tagName: 'DIV', nodeType: 1, parentElement: body, children: [], matches: () => true, querySelectorAll: () => [] } : body;
    const anchor = { tagName: 'A', nodeType: 1, parentElement: parent, href: `https://example.org/${title}`, children: [],
      querySelector: () => ({ textContent: title }), matches: selector => ad && selector.includes('[data-impdclcc]'),
      querySelectorAll: selector => selector === '[role="text"],cite' ? source ? [{ textContent: 'https://example.org' }] : [] : [],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100 }), contains: top => top === anchor };
    parent.children.push(anchor);
    if (parentAd) body.children.push(parent);
    return anchor;
  };
  const anchors = [make('sponsored-product', true, true), make('video', false, false), make('first-article', true, false),
    make('nested-ad', true, false, true), make('second-article', true, false)];
  const document = { documentElement: root, body, title: 'Search', readyState: 'complete',
    querySelectorAll: selector => selector === 'a[href]' ? anchors : [], elementFromPoint: () => current };
  let current;
  const result = vm.runInNewContext(`(()=>{${READ_WEB_DOCUMENT}})()`, { document, URL,
    location: { href: 'https://www.google.com/search?q=recipe', hostname: 'www.google.com', pathname: '/search' }, innerWidth: 400, innerHeight: 800,
    getComputedStyle: anchor => { current = anchor; return { display: 'block', visibility: 'visible' }; }, performance: { getEntriesByType: () => [] } });
  assert.deepEqual(Array.from(result.links, link => link.title), ['first-article', 'second-article']);
  assert.equal(result.ambiguousAds, false);
});
