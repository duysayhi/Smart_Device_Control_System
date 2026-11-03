/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { createHash } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { proposePrimitiveDecomposition, bindReviewedPrimitives } = require('../lib/android/agent/primitive-decomposition.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
async function main() {
  const files = fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort();
  const digest = () => createHash('sha256').update(files.map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
  const frozen = digest(), model = new OllamaAgentReasoner(fetch, true), rows = [];
  // Development probes, never the sealed cohort. Compile for analysis only;
  // no adapter, device, Session, effect grant or Android action exists here.
  for (const [request, primitive, value, executable] of [
    ['Ghé org.development.viewer', 'OPEN_APP', 'org.development.viewer', true],
    ['Nhờ dò "san hô".', 'SEARCH', '"san hô"', true],
    ['Đọc số đo "độ ẩm".', 'READ_VALUE', '"độ ẩm"', false],
  ]) {
    const budget = new AgentBudget(); let raw;
    const ai = { async generate(...args) { raw = await model.generate(...args); return raw; } };
    try {
      const p = await proposePrimitiveDecomposition(request, ai, budget), g = bindReviewedPrimitives(p, 'SIMULATED', 'MODEL-EVAL');
      const faithful = p.steps.length === 1 && p.steps[0].primitive === primitive && p.spec.outcomes[0].value === value;
      rows.push({ request, faithful, bindingMatches: (g.coverage === 'COMPLETE') === executable, coverage: g.coverage, raw, metrics: budget.summary() });
    } catch (e) { rows.push({ request, faithful: false, reason: e.message, raw, metrics: budget.summary() }); }
    console.log(JSON.stringify({ request, faithful: rows.at(-1).faithful, reason: rows.at(-1).reason, inferenceMs: budget.timings.reasoningMs }));
  }
  if (digest() !== frozen) throw Error('Runtime changed during probes.');
  const output = path.join(os.tmpdir(), 'agent-v2-decomposition-' + Date.now() + '.json');
  fs.writeFileSync(output, JSON.stringify({ classification: 'REAL_MODEL_SIMULATED_UI', runtimeSha256: frozen, model: process.env.OLLAMA_MODEL,
    rows, faithful: rows.filter(r => r.faithful).length, total: rows.length, androidActions: 0 }, null, 2));
  console.log(JSON.stringify({ evidence: output, runtimeSha256: frozen }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
