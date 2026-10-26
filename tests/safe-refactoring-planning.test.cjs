/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { bindCommandSource, cloudCommandText } = require('../lib/android/agent/cloud-command.ts');
const { needsPhrasingReview } = require('../lib/android/agent/reviewed-phrasing.ts');
const { understandOutcomes, commandMask, foldIntent } = require('../lib/android/agent/outcome-spec.ts');
const { enterSearchBoundary, politeWords } = require('../lib/android/agent/natural-phrasing.ts');
const legacyNatural = (request, original) => {
  const first = original.outcomes[0], second = original.outcomes[1];
  const gap = second ? commandMask(request).slice(first.span.end, second.span.start).trim() : undefined;
  return Boolean(enterSearchBoundary(commandMask(request))) && gap !== undefined && ['', 'de', 'to'].includes(gap) ||
    original.outcomes.some(o => new RegExp('^(?:' + politeWords + ')\\s+').test(foldIntent(o.span.text)));
};
for (const request of ['Mở YouTube', 'Mở Drive và tìm báo cáo thực tập', 'Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập', 'Ghé YouTube để tìm giúp mình hải dương học nhé', 'open Drive to search marine biology', 'Please open Drive then search biology', 'Cho mình xem pin còn bao nhiêu', 'Cho mình biết Wi-Fi đang bật hay tắt', 'Đặt báo thức 3:30', 'Hẹn giờ 2 phút', 'Mở YouTube, tìm "please open then search"', 'Mở Drive rồi tìm "báo cáo và ghi chú"', 'Tìm "please read battery"', 'không mở Drive', 'unknown request']) {
  test('OFFLINE shared review predicate equals the two original call sites: ' + request, () => {
    const original = understandOutcomes(request), before = JSON.stringify(original);
    assert.equal(needsPhrasingReview(request, original), legacyNatural(request, original));
    assert.equal(JSON.stringify(original), before);
  });
}

for (const input of [undefined, null, false, 0, 'literal input', { slots: [[1, 'private value']], commandRef: { forged: true } }, ['a', 'b']]) {
  test('OFFLINE bound reasoner preserves payload semantics and original objects: ' + JSON.stringify(input), async () => {
    const calls = [], schema = {}, budget = {}, signal = new AbortController().signal, result = { choice: 'ABSTAIN' };
    const provider = { generate(...args) { assert.equal(this, provider); calls.push(args); return Promise.resolve(result); } };
    const before = input && typeof input === 'object' ? { ...input } : input;
    const wrapped = bindCommandSource(provider, 'Mở Drive'), response = await wrapped.generate(schema, 'same system prompt', input, budget, signal);
    assert.equal(response, result); assert.equal(calls.length, 1);
    assert.equal(calls[0][0], schema); assert.equal(calls[0][1], 'same system prompt'); assert.equal(calls[0][3], budget); assert.equal(calls[0][4], signal);
    if (input && typeof input === 'object') {
      assert.notEqual(calls[0][2], input);
      const { commandRef, ...data } = calls[0][2], { commandRef: ignored, ...expected } = before; void ignored;
      assert.deepEqual(data, expected); assert.ok(Object.isFrozen(commandRef)); assert.notEqual(commandRef, before.commandRef);
      assert.deepEqual({ ...input }, before);
    } else assert.equal(calls[0][2], input);
  });
}

test('OFFLINE wrapper is lazy, reuses one source reference and forwards the exact promise/error', async () => {
  const calls = [], error = new Error('same provider failure'), promise = Promise.reject(error);
  promise.catch(() => {});
  const wrapper = bindCommandSource({ generate(_schema, _system, input) { calls.push(input); return promise; } }, 'Mở Drive');
  assert.equal(calls.length, 0);
  const first = wrapper.generate({}, '', {}, {}), second = wrapper.generate({}, '', {}, {});
  assert.equal(first, promise); assert.equal(second, promise); assert.equal(calls[0].commandRef, calls[1].commandRef);
  await assert.rejects(first, e => e === error);
});

test('OFFLINE source binding preserves opt-in, authentic source and sensitive withholding without a network call', () => {
  const previous = process.env.AGENT_GROQ_SEND_COMMAND_TEXT;
  const inspect = source => { let captured; bindCommandSource({ generate(_schema, _system, input) { captured = input; return Promise.resolve({}); } }, source).generate({}, '', { commandRef: {} }, {}); return captured; };
  try {
    delete process.env.AGENT_GROQ_SEND_COMMAND_TEXT; assert.equal(cloudCommandText(inspect('Mở Drive')), undefined);
    process.env.AGENT_GROQ_SEND_COMMAND_TEXT = 'true';
    assert.equal(cloudCommandText(inspect('Mở Drive')), 'Mở Drive');
    assert.equal(cloudCommandText(inspect('send password to account')), undefined);
    assert.equal(cloudCommandText({ commandRef: {} }), undefined);
  } finally { if (previous === undefined) delete process.env.AGENT_GROQ_SEND_COMMAND_TEXT; else process.env.AGENT_GROQ_SEND_COMMAND_TEXT = previous; }
});
