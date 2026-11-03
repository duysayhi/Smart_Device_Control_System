/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { cases, apps } = require('./fixtures/m5b-development.cjs');
const { proposeReviewedPhrasing } = require('../lib/android/agent/reviewed-phrasing.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { forbiddenSource, forbiddenControl, assertSafePlan } = require('../lib/android/safety-envelope.ts');
const { launcherLabelsFromBadging } = require('../lib/android/agent/launcher-labels.ts');
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
const { issuePlanAuthorization, consumePlanAuthorization, assertLegacyExecutionPolicy } = require('../lib/android/action-plan-authorization.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { z } = require('zod');
const noModel = { generate() { throw Error('Unexpected inference in deterministic phrasing tests'); } };
for (const c of cases) test('OFFLINE_TESTED M5b DEVELOPMENT ' + c.id + ': ' + c.request, async () => {
  const get = () => proposeReviewedPhrasing(c.request, c.apps ?? apps, noModel, new AgentBudget());
  if (c.expected !== 'PLAN') { await assert.rejects(get); return; }
  const p = await get();
  assert.deepEqual(p.spec.outcomes.map(o => [o.kind, o.value]), c.steps);
  assert.ok(p.spec.outcomes.every(o => !o.negated));
  for (const step of p.steps) assert.ok(step.dependencies.every(d => d < p.steps.indexOf(step)));
  for (const o of p.spec.outcomes) assert.equal(p.spec.request.slice(o.span.start, o.span.end), o.span.text);
});
test('M5b display-label resource provenance and installed exact matching', async () => {
  const badging = "package: name='org.sky.atlas' versionCode='3'\napplication-label:'wrong fallback'\nlaunchable-activity: name='org.sky.atlas.Main' label='Bản đồ Sao' icon=''";
  assert.deepEqual(launcherLabelsFromBadging(badging, 'org.sky.atlas', 'org.sky.atlas/.Main'), ['Bản đồ Sao']);
  assert.deepEqual(launcherLabelsFromBadging(badging, 'org.evil', 'org.evil/.Main'), []);
  const run = async args => ({ stdout: args.includes('query-activities') ? 'org.sky.atlas/.Main\norg.second.atlas/.Main' : args.includes('org.sky.atlas') ? 'org.sky.atlas/.Main' : '', stderr: '' });
  const labels = async () => new Map([['org.sky.atlas/.Main', ['Bản đồ Sao']]]);
  const catalog = new AppCatalog('D', run, labels);
  assert.equal((await catalog.resolve('ban do sao', 'LAUNCH')).app.packageName, 'org.sky.atlas');
  assert.equal((await catalog.resolve('Unknown label', 'LAUNCH')).app, undefined);
  const ambiguous = new AppCatalog('D', run, async () => new Map([['org.sky.atlas/.Main', ['Same']], ['org.second.atlas/.Main', ['Same']]]));
  assert.equal((await ambiguous.resolve('Same', 'LAUNCH')).app, undefined);
});
const plan = { intent: 'search', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'chrome' }] };
test('M5b backend source/plan/device ticket is single-use, non-spoofable and expiring', () => {
  const token = issuePlanAuthorization('A', 'P-A', 'Open Chrome', plan);
  for (const [device, source, body] of [['B', 'Open Chrome', plan], ['A', 'Open camera', plan], ['A', 'Open Chrome', { ...plan, actions: [{ type: 'OPEN_APP', app: 'settings' }] }]]) assert.throws(() => consumePlanAuthorization(token, device, 'P-A', source, body));
  assert.throws(() => consumePlanAuthorization(token, 'A', 'P-B', 'Open Chrome', plan));
  assert.doesNotThrow(() => consumePlanAuthorization(token, 'A', 'P-A', 'Open Chrome', plan));
  assert.throws(() => consumePlanAuthorization(token, 'A', 'P-A', 'Open Chrome', plan));
  const stale = issuePlanAuthorization('A', 'P-A', 'Open Chrome', plan), now = Date.now;
  try { Date.now = () => now() + 120001; assert.throws(() => consumePlanAuthorization(stale, 'A', 'P-A', 'Open Chrome', plan)); } finally { Date.now = now; }
});
for (const source of ['remove account', 'replace existing file', 'uninstall app', 'clear app data', 'factory reset', 'change password', 'purchase a subscription', 'đổi mật khẩu', 'ghi đè tệp']) test('M5b shared non-bypassable source/control policy: ' + source, () => {
  assert.equal(forbiddenSource(source), true); assert.equal(forbiddenControl(source), true);
  assert.throws(() => issuePlanAuthorization('D', 'P-D', source, plan));
  assert.throws(() => assertSafePlan(source, plan));
});
test('M5b development preference does not authorize legacy dispatch', () => {
  const previous = process.env.ANDROID_POLICY_MODE; process.env.ANDROID_POLICY_MODE = 'development';
  try { assert.throws(() => assertLegacyExecutionPolicy({ ...plan, actions: [{ type: 'CLICK', target: 'send_button' }] })); }
  finally { if (previous === undefined) delete process.env.ANDROID_POLICY_MODE; else process.env.ANDROID_POLICY_MODE = previous; }
});
for (const unicode of [false, true]) for (const n of [1535, 1536, 1537]) test('M5b unchanged UTF-8 byte guard ' + n + '/' + unicode, async () => {
  const schema = z.object({ ok: z.literal(true) }), base = Buffer.byteLength(JSON.stringify(null) + JSON.stringify(z.toJSONSchema(schema))), extra = unicode ? 'ế' : '';
  const system = extra + 'x'.repeat(n - base - Buffer.byteLength(extra)); let calls = 0;
  const reasoner = new OllamaAgentReasoner(async () => { calls++; return new Response(JSON.stringify({ message: { content: '{"ok":true}' } })); }, true);
  const invoke = () => reasoner.generate(schema, system, null, new AgentBudget());
  if (n > 1536) { await assert.rejects(invoke, /CONTEXT_LIMIT/); assert.equal(calls, 0); }
  else { assert.deepEqual(await invoke(), { ok: true }); assert.equal(calls, 1); }
});
