/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { matchesBrowserResultTitle } = require('../lib/android/browser-destination.ts');
const { verifyDiscoveredSelection } = require('../lib/android/action-verifier.ts');
const url = 'https://example.org/article', title = 'Python installation on Windows';
const doc = { url, title, headings: [title], canonicalUrls: [url], navigationType: 'navigate', navigationUrl: url, readyState: 'complete', alternateUrls: [] };
test('literal hostname branding requires exact article title, H1, canonical and navigation provenance', () => {
  assert.equal(matchesBrowserResultTitle(title + ' - Example.org', url, doc), true);
  assert.equal(matchesBrowserResultTitle(title + ' - Other brand', url, doc), false);
  assert.equal(matchesBrowserResultTitle(title + ' - evil.org', url, doc), false);
  for (const change of [{ canonicalUrls: [] }, { canonicalUrls: [url, url + '/other'] }, { canonicalUrls: [url + '/other'] },
    { headings: [] }, { headings: ['Similar Python article'] }, { title: title + ' sequel' }, { navigationType: 'back_forward' }, { navigationUrl: url + '/other' }, { url: 'https://evil.org/article' }]) {
    assert.equal(matchesBrowserResultTitle(title + ' - Example.org', url, { ...doc, ...change }), false);
  }
});
test('partial or semantically different article names are not matched by deleting arbitrary suffixes', () => {
  assert.equal(matchesBrowserResultTitle('Python download - Example.org', url, doc), false);
  assert.equal(matchesBrowserResultTitle(title + ' extra - Example.org', url, doc), false);
  assert.equal(matchesBrowserResultTitle(title + ' - Example', url, doc), false);
});
test('full title remains supported but title and H1 fragments cannot be concatenated into fake evidence', () => {
  assert.equal(matchesBrowserResultTitle(title, url, doc), true);
  assert.equal(matchesBrowserResultTitle('first second', url, { ...doc, title: 'first', headings: ['second'] }), false);
});
test('hostname branding never overrides readiness, URL or captcha failure in destination verification', () => {
  const selection = { itemType: 'browser', ordinal: 1, url, title: title + ' - Example.org' }, before = { foregroundPackage: 'com.android.chrome' };
  const after = { foregroundPackage: before.foregroundPackage, web: { status: 'DOM_AVAILABLE', document: doc } };
  assert.equal(verifyDiscoveredSelection(selection, before, after), true);
  for (const change of [{ readyState: 'loading' }, { title: 'Captcha', headings: ['Captcha'] }, { url: url + '/other' }]) {
    assert.equal(verifyDiscoveredSelection(selection, before, { ...after, web: { status: 'DOM_AVAILABLE', document: { ...doc, ...change } } }), false);
  }
});
