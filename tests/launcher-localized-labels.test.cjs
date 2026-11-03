/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { launcherLabelsFromBadging } = require('../lib/android/agent/launcher-labels.ts');
const { LauncherLabelCache, launcherCacheDirectory } = require('../lib/android/agent/launcher-label-cache.ts');
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');

for (const [pkg, base, localized] of [['org.unseen.time', 'Clock', 'Đồng hồ'], ['net.other.memo', 'Notes', 'Ghi chú']]) {
  const component = pkg + '/.Main';
  const badging = `package: name='${pkg}' versionCode='1'\napplication-label:'${base}'\napplication-label-vi:'${localized}'\nlaunchable-activity: name='${pkg}.Main' label='${base}' icon=''`;
  test('OFFLINE primary activity retains verified localized application labels: ' + pkg, () => {
    assert.deepEqual(launcherLabelsFromBadging(badging, pkg, component), [base, localized]);
    assert.deepEqual(launcherLabelsFromBadging(badging, 'org.foreign', 'org.foreign/.Main'), []);
  });
  test('OFFLINE installed-app discovery resolves a localized label without package-specific aliases: ' + pkg, async () => {
    const run = async () => ({ stdout: component, stderr: '' });
    const catalog = new AppCatalog('device', run, async () => new Map([[component, launcherLabelsFromBadging(badging, pkg, component)]]));
    const resolved = await catalog.resolve(localized, 'LAUNCH');
    assert.equal(resolved.app?.packageName, pkg);
    assert.equal(resolved.app?.serial, 'device');
  });
}

test('OFFLINE a distinct activity label cannot inherit unrelated package translations', () => {
  const source = "package: name='org.unseen.suite' versionCode='1'\napplication-label:'Suite'\napplication-label-vi:'Bộ công cụ'\nlaunchable-activity: name='org.unseen.suite.Main' label='Timer' icon=''";
  assert.deepEqual(launcherLabelsFromBadging(source, 'org.unseen.suite', 'org.unseen.suite/.Main'), ['Timer']);
});

test('OFFLINE locale aliases do not resolve an ambiguous installed package', async () => {
  const components = ['org.first.time/.Main', 'org.second.time/.Main'];
  const catalog = new AppCatalog('device', async () => ({ stdout: components.join('\n'), stderr: '' }), async () => new Map(components.map(c => [c, ['Clock', 'Đồng hồ']])));
  assert.equal((await catalog.resolve('Đồng hồ', 'LAUNCH')).app, undefined);
});

test('OFFLINE extractor revision invalidates old single-label cache without deleting it', async () => {
  assert.match(launcherCacheDirectory(), /label-cache-v2$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'label-revision-test-'));
  const file = path.join(dir, 'labels.json'), revision = { packageName: 'org.unseen.time', versionCode: '1' }, component = 'org.unseen.time/.Main';
  const old = JSON.stringify({ schema: 1, rows: [{ physicalId: 'physical', ...revision, component, labels: ['Clock'], at: Date.now() }] });
  fs.writeFileSync(file, old);
  try {
    const cache = new LauncherLabelCache(dir); await cache.load();
    assert.equal(cache.get('physical', revision, component), undefined);
    assert.equal(fs.readFileSync(file, 'utf8'), old);
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});
