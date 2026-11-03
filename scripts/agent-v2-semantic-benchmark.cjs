/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const cases = require('../tests/fixtures/agent-v2-semantic-heldout-v2.cjs');
const { proposeOutcomes, compileReviewedProposal } = require('../lib/android/agent/outcome-proposal.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const project = spec => spec.outcomes.map(({ kind, value, app, negated, semanticIntent }) => ({ kind, value, ...(app ? { app } : {}), negated, ...(semanticIntent ? { semanticIntent } : {}) }));
async function main() {
  const model = new OllamaAgentReasoner(fetch, true), results = [], output = path.join(os.tmpdir(), 'phone-commander-semantic-reliability-' + Date.now() + '.json');
  for (const fixture of cases) {
    const budget = new AgentBudget(); let raw;
    const reasoner = { async generate(...args) { raw = await model.generate(...args); return raw; } };
    let row;
    try {
      const p = await proposeOutcomes(fixture.request, reasoner, budget), graph = compileReviewedProposal(p, 'benchmark-only', fixture.id);
      const actual = project(p.spec), faithful = JSON.stringify(actual) === JSON.stringify(fixture.outcomes) && JSON.stringify(p.dependencies) === JSON.stringify(fixture.dependencies);
      row = { ...fixture, faithful, disposition: graph.coverage, actual, dependenciesActual: p.dependencies, executable: graph.coverage === 'COMPLETE', graph };
    } catch (error) { row = { ...fixture, faithful: false, disposition: 'SAFE_BLOCKED', reason: error.message }; }
    results.push({ ...row, raw, metrics: budget.summary() });
    fs.writeFileSync(output, JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'phone-commander', results }, null, 2));
    console.log(JSON.stringify({ id: fixture.id, faithful: row.faithful, disposition: row.disposition, reason: row.reason, inferenceMs: budget.timings.reasoningMs }));
  }
  const summary = { total: results.length, faithful: results.filter(r => r.faithful).length, falseAcceptedExecutable: results.filter(r => !r.faithful && r.executable).length,
    schemaValid: results.filter(r => r.metrics.reasoningMeasurements.every(m => m.status === 'VALID')).length,
    unsupportedExpected: results.filter(r => r.outcomes.some(o => o.semanticIntent)).length,
    unsupportedFaithful: results.filter(r => r.outcomes.some(o => o.semanticIntent) && r.faithful && !r.executable).length };
  fs.writeFileSync(output, JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'phone-commander', summary, results }, null, 2));
  console.log(JSON.stringify({ summary, evidence: output }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
