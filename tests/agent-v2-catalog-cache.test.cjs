/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { LauncherLabelCache, packageRevisions } = require('../lib/android/agent/launcher-label-cache.ts');
const { readLauncherLabels } = require('../lib/android/agent/launcher-labels.ts');
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
const { isVerifiedApplication } = require('../lib/android/agent/application-discovery.ts');
const { CatalogWarmup, warmLauncherCatalog } = require('../lib/android/agent/catalog-warmup.ts');
const { cancelIfActive, recheckTask } = require('../scripts/agent-v2-runner-lifecycle.cjs');
const pkg = 'org.example.reader', component = pkg + '/.Main', revision = { packageName: pkg, versionCode: '7', updatedAt: '2026-10-20 10:00:00' };
async function temporary(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-cache-test-'));
  try { await fn(dir); } finally { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); fs.rmdirSync(dir); }
}
const dump = (version = '7', date = revision.updatedAt) => `Packages:\n  Package [${pkg}] (a):\n    versionCode=${version} minSdk=21\n    lastUpdateTime=${date}\n`;
const props = serial => `[ro.serialno]: [${serial}]\n[ro.boot.serialno]: [${serial}]\n[ro.product.manufacturer]: [Fixture]\n[ro.product.model]: [Example]\n`;

test('OFFLINE_TESTED M5c persistent hit/miss and restarted reader', () => temporary(async dir => {
  const a = new LauncherLabelCache(dir); await a.load(); assert.equal(a.get('P', revision, component), undefined);
  a.put('P', revision, component, ['Reader']); await a.save();
  const b = new LauncherLabelCache(dir); await b.load(); assert.deepEqual(b.get('P', revision, component), ['Reader']);
  const names = b.get('P', revision, component); names.push('forged'); assert.deepEqual(b.get('P', revision, component), ['Reader']);
  assert.deepEqual(fs.readdirSync(dir), ['labels.json']);
}));
for (const [name, changed] of [['version', { ...revision, versionCode: '8' }], ['update time', { ...revision, updatedAt: '2026-10-21 10:00:00' }], ['missing update time', { packageName: pkg, versionCode: '7' }]]) test('M5c invalidates ' + name, () => temporary(async dir => {
  const cache = new LauncherLabelCache(dir); cache.put('P', revision, component, ['Reader']); await cache.save(); await cache.load(); assert.equal(cache.get('P', changed, component), undefined);
}));
test('M5c physical device and launcher alias isolation', () => temporary(async dir => {
  const cache = new LauncherLabelCache(dir); cache.put('P-A', revision, component, ['A']); cache.put('P-B', revision, component, ['B']); await cache.save(); await cache.load();
  assert.deepEqual(cache.get('P-A', revision, component), ['A']); assert.deepEqual(cache.get('P-B', revision, component), ['B']); assert.equal(cache.get('P-C', revision, component), undefined); assert.equal(cache.get('P-A', revision, pkg + '/.Alias'), undefined);
  assert.throws(() => cache.put('P-A', revision, 'org.foreign/.Main', ['Reader']));
}));
for (const content of ['{bad json', JSON.stringify({ schema: 999, rows: [] }), JSON.stringify({ schema: 1, rows: [{ labels: ['fake'] }] }), ' '.repeat(1024 * 1024 + 1)]) test('M5c ignores corrupt/oversized cache ' + content.length, () => temporary(async dir => {
  fs.writeFileSync(path.join(dir, 'labels.json'), content); const cache = new LauncherLabelCache(dir); await cache.load(); assert.equal(cache.get('P', revision, component), undefined);
}));
test('M5c cache bounded to eight devices and 500 entries', () => temporary(async dir => {
  const cache = new LauncherLabelCache(dir); for (let i = 0; i < 620; i++) cache.put('P-' + Math.floor(i / 60), revision, pkg + '/.A' + i, ['Reader ' + i]); await cache.save();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'))); assert.ok(saved.rows.length <= 500); assert.ok(new Set(saved.rows.map(r => r.physicalId)).size <= 8);
}));
test('M5c unresolved backoff never creates a label and expires', () => temporary(async dir => {
  const cache = new LauncherLabelCache(dir); cache.put('P', revision, component, []); assert.deepEqual(cache.get('P', revision, component), []);
  const now = Date.now; try { Date.now = () => now() + 300001; assert.equal(cache.get('P', revision, component), undefined); } finally { Date.now = now; }
}));
test('M5c parses package revisions, not disabled originals', () => {
  const revisions = packageRevisions(dump() + '\nHidden system packages:\n  Package [' + pkg + '] (b):\n    versionCode=1\n');
  assert.deepEqual(revisions.get(pkg), revision); assert.equal(packageRevisions('garbage').size, 0);
});
test('M5c partial extraction returns all hits and prioritizes unresolved exact packages', () => temporary(async dir => {
  const calls = [], run = async args => ({ stdout: args.includes('getprop') ? props('SERIAL-A') : dump() + '  Package [org.example.second] (b):\n    versionCode=1\n', stderr: '' });
  const extract = async c => { calls.push(c); return ['Label ' + c]; }, second = 'org.example.second/.Main';
  const first = await readLauncherLabels('A', [component, second], run, undefined, { directory: dir, maxExtractions: 1, priorityPackages: ['org.example.second'], extract });
  assert.equal(first.size, 1); assert.deepEqual(calls, [second]);
  const warm = await readLauncherLabels('A', [component, second], run, undefined, { directory: dir, maxExtractions: 0, extract }); assert.equal(warm.size, 1); assert.deepEqual(calls, [second]);
  const filled = await readLauncherLabels('A', [component, second], run, undefined, { directory: dir, extract }); assert.equal(filled.size, 2); assert.deepEqual(calls, [second, component]);
}));
test('M5c fresh metadata and physical identity revalidated on cache hit; version change re-extracts', () => temporary(async dir => {
  let version = '7', serial = 'SERIAL-A', pulls = 0, identities = 0, metadata = 0;
  const run = async args => { if (args.includes('getprop')) identities++; else metadata++; return { stdout: args.includes('getprop') ? props(serial) : dump(version), stderr: '' }; };
  const options = { directory: dir, extract: async () => { pulls++; return ['Reader']; } };
  await readLauncherLabels('A', [component], run, undefined, options); await readLauncherLabels('A', [component], run, undefined, options); assert.equal(pulls, 1); assert.equal(identities, 3); assert.equal(metadata, 2);
  version = '8'; await readLauncherLabels('A', [component], run, undefined, options); assert.equal(pulls, 2);
  serial = 'SERIAL-B'; await readLauncherLabels('A', [component], run, undefined, options); assert.equal(pulls, 3);
}));
test('M5c transport replacement during extraction cannot persist a foreign label', () => temporary(async dir => {
  let serial = 'SERIAL-A';
  const run = async args => ({ stdout: args.includes('getprop') ? props(serial) : dump(), stderr: '' });
  const labels = await readLauncherLabels('A', [component], run, undefined, { directory: dir, extract: async () => { serial = 'SERIAL-B'; return ['Foreign Reader']; } });
  assert.equal(labels.size, 0); assert.equal(fs.existsSync(path.join(dir, 'labels.json')), false);
}));
test('M5c cancelled scan preserves completed entry without continuing work', () => temporary(async dir => {
  const stop = new AbortController(); let calls = 0;
  const run = async args => ({ stdout: args.includes('getprop') ? props('SERIAL-A') : dump(), stderr: '' });
  await assert.rejects(() => readLauncherLabels('A', [component], run, stop.signal, { directory: dir, extract: async () => { calls++; stop.abort(); return ['Do not persist cancelled work']; } }));
  assert.equal(calls, 1); const cache = new LauncherLabelCache(dir); await cache.load(); assert.equal(fs.existsSync(path.join(dir, 'labels.json')), false);
}));
test('M5c names cannot bypass fresh launchability, ambiguity, unknown, or alias rules', async () => {
  let installed = true, checks = 0;
  const run = async args => { if (args.includes('resolve-activity')) checks++; return { stdout: args.includes('query-activities') ? component : installed ? component : '', stderr: '' }; };
  const catalog = new AppCatalog('A', run, async () => new Map([[component, ['Example Reader']]]));
  assert.ok((await catalog.resolve('Example Reader', 'LAUNCH')).app); installed = false;
  await assert.rejects(() => catalog.resolve('Example Reader', 'LAUNCH')); assert.ok(checks >= 2);
  assert.equal((await catalog.resolve('Publisher Example Reader', 'LAUNCH')).app, undefined);
  assert.equal((await catalog.resolve('Unknown', 'LAUNCH')).app, undefined);
  assert.equal(isVerifiedApplication((await catalog.inventory())[0]), false);
  const ambiguous = new AppCatalog('A', async () => ({ stdout: component + '\norg.example.second/.Main', stderr: '' }), async () => new Map([[component, ['Same']], ['org.example.second/.Main', ['Same']]]));
  assert.match((await ambiguous.resolve('Same', 'LAUNCH')).reason, /NEEDS_CLARIFICATION/);
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const deadline = Date.now() + 10000; while (!predicate()) { if (Date.now() >= deadline) throw Error('Simulated warmup did not reach expected state'); await sleep(5); } }
const device = { serial: 'A', physicalId: 'P-A', status: 'device', identityVerified: true, connectionType: 'USB' };
test('M5c warmup non-blocking, single device at a time and no active-task competition', async () => {
  let idle = false, simultaneous = 0, peak = 0, scans = 0;
  const warm = new CatalogWarmup(() => idle, async () => { scans++; simultaneous++; peak = Math.max(peak, simultaneous); await sleep(8); simultaneous--; }, 1);
  try { warm.connected([device, { ...device, serial: 'B', physicalId: 'P-B' }]); assert.equal(scans, 0); await sleep(10); assert.equal(scans, 0); idle = true; warm.schedule(); await until(() => scans === 2 && simultaneous === 0); assert.equal(scans, 2); assert.equal(peak, 1); warm.connected([device]); await sleep(10); assert.equal(scans, 2); } finally { await warm.close(); }
});
test('M5c task admission drains a cancelled background scan before execution', async () => {
  let idle = true, started = false, finished = false;
  const warm = new CatalogWarmup(() => idle, async (_job, signal) => { started = true; await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); await sleep(5); finished = true; }, 1);
  try { warm.connected([device]); await until(() => started); assert.equal(started, true); idle = false; await warm.pause(); assert.equal(finished, true); } finally { await warm.close(); }
});
test('M5c existing external Session or reservation prevents background ADB work', async () => {
  let calls = 0;
  await assert.rejects(() => warmLauncherCatalog({ serial: 'A', physicalId: 'P-A' }, new AbortController().signal, async () => ({ serial: 'A', pid: 123, acquiredAt: '' }), async () => { calls++; return { stdout: '', stderr: '' }; }));
  assert.equal(calls, 0);
});
for (const status of ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'DISCONNECTED']) test('M5c deadline rereads ' + status + ' and never sends CANCEL', async () => {
  const observations = [], task = { executionId: 'E', deviceId: 'A', status, finishedAt: 100 }; let cancels = 0, time = 110;
  const api = async body => { if (body) cancels++; return { tasks: [task] }; };
  const checked = await cancelIfActive(api, 'E', 'A', observations, () => time++); assert.equal(checked.terminal, true); assert.equal(cancels, 0); assert.equal(observations[0].finishedAt, 100); assert.ok(observations[0].checkedAt >= observations[0].requestedAt);
});
test('M5c stale active poll followed by near-deadline completion suppresses cleanup CANCEL', async () => {
  let reads = 0, cancels = 0; const observations = [];
  const api = async body => { if (body) { cancels++; return { accepted: true }; } return { tasks: [{ executionId: 'E', deviceId: 'A', status: reads++ ? 'COMPLETED' : 'RUNNING', finishedAt: reads > 1 ? 123 : undefined }] }; };
  assert.equal((await recheckTask(api, 'E', 'A', observations)).terminal, false);
  assert.equal((await cancelIfActive(api, 'E', 'A', observations)).terminal, true); assert.equal(cancels, 0);
});
test('M5c active cancellation records timestamps and missing/foreign tasks never cancel', async () => {
  let cancels = 0; const observations = [];
  const api = async body => { if (body) { cancels++; return { accepted: true }; } return { tasks: [{ executionId: 'E', deviceId: 'A', status: 'RUNNING' }] }; };
  await cancelIfActive(api, 'E', 'A', observations); assert.equal(cancels, 1); assert.ok(observations[0].cancelRequestedAt); assert.ok(observations[0].cancelRespondedAt);
  await assert.rejects(() => cancelIfActive(api, 'E', 'B', observations)); assert.equal(cancels, 1);
});
