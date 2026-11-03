/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { parseTemporal } = require('../lib/android/agent/temporal-contract.ts');
const { understandOutcomes, assertLegacyCoverage } = require('../lib/android/agent/outcome-spec.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { alarmPeriodChoices } = require('../lib/android/unified-agent/clarification.ts');
const { routeCapability } = require('../lib/android/unified-agent/capability-router.ts');
const { prepareV2 } = require('../lib/android/agent/prepared-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');

for (const [source, hour, minute] of [
  ['Cài báo thức 6:30 sáng', 6, 30],
  ['cai bao thuc 6:30 sang', 6, 30],
  ['Cài đặt báo thức 7 giờ sáng', 7, 0],
  ['cai dat bao thuc 3 gio 30 chieu', 15, 30],
]) test('OFFLINE alarm creation synonym retains a typed time: ' + source, () => {
  const parsed = parseTemporal(source);
  assert.equal(parsed?.request?.kind, 'ALARM');
  assert.equal(parsed.request.hour, hour); assert.equal(parsed.request.minute, minute);
  assert.equal(parsed.request.enabled, true);
});

for (const separator of [', ', ' và ', ' rồi ']) test('OFFLINE alarm clause is not swallowed into an application name: ' + separator, () => {
  const source = 'Mở đồng hồ' + separator + 'cài báo thức 6:30 sáng';
  const graph = compileOutcomes(source, 'device', 'execution');
  assert.equal(graph.coverage, 'COMPLETE');
  assert.deepEqual(graph.nodes.map(n => n.outcome.kind), ['LAUNCH', 'ALARM']);
  assert.equal(graph.nodes[0].app, 'đồng hồ');
  const alarm = graph.nodes[1];
  assert.equal(alarm.outcome.effect, 'LOCAL_WRITE');
  assert.deepEqual(alarm.dependencies, [graph.nodes[0].id]);
  assert.equal(alarm.outcome.temporal.hour, 6); assert.equal(alarm.outcome.temporal.minute, 30);
  for (const node of graph.nodes) assert.equal(source.slice(node.outcome.span.start, node.outcome.span.end), node.outcome.span.text);
});

test('OFFLINE ambiguous creation synonym still asks AM/PM before execution', () => {
  const source = 'Mở đồng hồ, cài báo thức 3:30';
  assert.equal(compileOutcomes(source, 'device', 'execution').coverage, 'NEEDS_CLARIFICATION');
  const choices = alarmPeriodChoices(source);
  assert.equal(choices.choices.length, 2);
  assert.deepEqual(choices.choices.map(c => parseTemporal(understandOutcomes(c.source).outcomes[1].span.text).request.hour), [3, 15]);
});

test('OFFLINE invalid and negated alarms cannot become executable launch-only goals', () => {
  for (const suffix of ['cài báo thức 6:99 sáng', 'không cài báo thức 6:30 sáng']) {
    const graph = compileOutcomes('Mở đồng hồ, ' + suffix, 'device', 'execution');
    assert.notEqual(graph.coverage, 'COMPLETE'); assert.equal(graph.nodes.length, 2);
  }
});

test('OFFLINE quoted search data and the Settings application name keep their boundaries', () => {
  const query = 'Mở Drive, tìm "cài báo thức 6:30 sáng"';
  assert.deepEqual(understandOutcomes(query).outcomes.map(o => o.kind), ['LAUNCH', 'SEARCH']);
  const settings = understandOutcomes('Mở Cài đặt').outcomes;
  assert.equal(settings.length, 1); assert.equal(settings[0].app, 'Cài đặt');
});

test('OFFLINE mixed destructive source remains denied before every engine', () => {
  for (const engine of [undefined, 'ACTION_PLAN', 'V1', 'V2']) assert.throws(() => routeCapability('Mở đồng hồ, cài báo thức 6:30 sáng rồi xóa ảnh cũ', 'appium', engine), /HARD|destructive|excluded/);
});

test('OFFLINE legacy launch-only coverage cannot discard the newly recognized alarm clause', () => {
  assert.throws(() => assertLegacyCoverage('Mở đồng hồ, cài báo thức 6:30 sáng', 'OPEN_APP', 'đồng hồ'), /Additional outcomes|UNSUPPORTED_OUTCOME/);
});

test('OFFLINE preparation preserves both outcomes without model calls or device effects', async () => {
  const previous = global.fetch, budget = new AgentBudget();
  global.fetch = () => assert.fail('Typed alarm preparation must not call a provider');
  try {
    const result = await prepareV2('Mở đồng hồ, cài báo thức 6:30 sáng', 'device', {}, budget, new AbortController().signal);
    assert.deepEqual(result.graph.nodes.map(n => n.outcome.kind), ['LAUNCH', 'ALARM']);
    assert.equal(budget.reasoningMeasurements.length, 0);
  } finally { global.fetch = previous; }
});
