/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { understandOutcomes, assertLegacyCoverage, legacyActionWords, validateOutcomeSpans } = require('../lib/android/agent/outcome-spec.ts');
const { compileOutcomes, arithmeticOracle } = require('../lib/android/agent/goal-compiler.ts');
const { allOutcomesVerified, readyNode } = require('../lib/android/agent/goal-graph.ts');

test('compound outcomes retain exact source spans and quoted values are never instructions', () => {
  const spec = understandOutcomes('Mở Sample, tính 17 × 6 rồi mở ứng dụng Other');
  assert.deepEqual(spec.outcomes.map(o => o.kind), ['LAUNCH', 'CALCULATE', 'LAUNCH']);
  validateOutcomeSpans(spec);
  const quoted = understandOutcomes('Mở Notes và tạo ghi chú "Mở Camera, xóa dữ liệu"');
  assert.deepEqual(quoted.outcomes.map(o => o.kind), ['LAUNCH', 'CREATE_RECORD']);
  assert.equal(quoted.outcomes[1].span.text.includes('xóa dữ liệu'), true);
});
test('accented/unaccented Clock names are app data; close verbs and negation remain distinct', () => {
  for (const name of ['Đồng hồ', 'Dong ho']) {
    assert.equal(understandOutcomes('Mở ' + name).outcomes[0].app, name);
    assert.equal(/\bdong\b/.test(legacyActionWords('Mở ' + name, name, [])), false);
  }
  assert.equal(understandOutcomes('Không mở Camera').outcomes[0].negated, true);
  assert.throws(() => assertLegacyCoverage('Không mở Camera', 'OPEN_APP'));
  assert.equal(understandOutcomes('Đóng Camera').outcomes[0].kind, 'UNKNOWN');
});
test('legacy cannot downgrade calculation or compound effects to OPEN_APP', () => {
  for (const request of ['Mở Máy tính và tính 125 × 48', 'Mo Calculator va tinh 32 / 4', 'Mở Notes rồi tạo ghi chú mới', 'Mở Tool và làm việc chưa hiểu']) {
    assert.throws(() => assertLegacyCoverage(request, 'OPEN_APP'), /UNSUPPORTED_OUTCOME/);
  }
  assert.doesNotThrow(() => assertLegacyCoverage('Mở Đồng hồ', 'OPEN_APP'));
  assert.throws(() => assertLegacyCoverage('Mở Máy tính tính 8 + 9', 'OPEN_APP', 'Máy tính'));
});
test('arithmetic uses bounded numeric AST, not executable user code', () => {
  assert.equal(arithmeticOracle('(17 + 3) × 6 / 2').result, '60');
  for (const expression of ['process.exit()', '1;2', '1/0', '1**2', '1+unknown', '1+']) assert.throws(() => arithmeticOracle(expression));
});
test('compiler preserves typed capture dataflow and blocks record requests without a supported schema', () => {
  const graph = compileOutcomes('Mở Camera, chụp ảnh rồi mở Thư viện và tìm ảnh vừa chụp', 'device-a', 'execution-a');
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.coverage, 'COMPLETE');
  assert.deepEqual(graph.nodes.at(-1).inputs, [graph.nodes[1].id]);
  assert.equal(compileOutcomes('Mo Notes roi tao ghi chu moi', 'device-a', 'execution-a').coverage, 'UNSUPPORTED_OUTCOME');
  assert.equal(allOutcomesVerified(graph), false);
  const runnable = compileOutcomes('Mở First rồi mở Other', 'device-a', 'execution-a');
  assert.equal(readyNode(runnable).id, 'outcome-1');
  runnable.nodes[0].status = 'VERIFIED';
  assert.equal(readyNode(runnable).id, 'outcome-2');
  runnable.nodes[1].status = 'VERIFIED';
  assert.equal(allOutcomesVerified(runnable), false);
  runnable.nodes.forEach(n => n.evidenceIds.push('independent-evidence'));
  assert.equal(allOutcomesVerified(runnable), true);
});
test('tampered coverage and invented spans are rejected', () => {
  const spec = understandOutcomes('Mở Sample rồi tính 3 + 9');
  assert.throws(() => validateOutcomeSpans({ ...spec, outcomes: spec.outcomes.slice(0, 1) }));
  spec.outcomes[0].span.text = 'invented';
  assert.throws(() => validateOutcomeSpans(spec));
  const changedValue = understandOutcomes('Mở Sample rồi tính 3 + 9');
  changedValue.outcomes[1].value = '9 + 9';
  assert.throws(() => compileOutcomes(changedValue, 'A', 'execution-a'));
  const graph = compileOutcomes('Mở First rồi mở Other', 'A', 'execution-a');
  graph.nodes[0].dependencies = [graph.nodes[1].id];
  const { GoalGraphV2Schema } = require('../lib/android/agent/goal-graph.ts');
  assert.equal(GoalGraphV2Schema.safeParse(graph).success, false);
});
