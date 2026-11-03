/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { proposeOutcomes, compileReviewedProposal } = require('../lib/android/agent/outcome-proposal.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
async function main() {
  const results = [];
  // Held-out wording, not additional runtime rules. No device effects or implicit interpretation approvals.
  const requests = process.argv.includes('--extended') ? [
    'Kh\u1edfi ch\u1ea1y \u0110\u1ed3ng h\u1ed3.', 'Mo Gallery roi xem Albums.', 'Please launch Notes and search "blue sky".',
    'Open calculator then compute 19 * 6.', 'Open Clock but do not create an alarm.', 'Send a message to my friend.',
    'Could you show that app?', 'Open Calendar then open Gallery.', 'Search "never delete my data" in Notes.',
  ] : process.argv.length > 2 ? process.argv.slice(2) : ['Please bring up the calendar.', "I'd like to visit gallery.", 'Bring up calculator; then show history.'];
  for (const request of requests) {
    const budget = new AgentBudget();
    let raw;
    const model = new OllamaAgentReasoner(fetch, true), reasoner = { async generate(...args) { raw = await model.generate(...args); return raw; } };
    try {
      const proposal = await proposeOutcomes(request, reasoner, budget);
      const graph = compileReviewedProposal(proposal, 'offline-evaluation', 'proposal-only');
      results.push({ request, status: 'VALID_PROPOSAL_REQUIRES_HUMAN_REVIEW', execution: graph.coverage === 'COMPLETE' ? 'EXECUTABLE' : 'EXECUTION_UNSUPPORTED', graph, spec: proposal.spec, dependencies: proposal.dependencies, metrics: budget.summary() });
    } catch (error) { results.push({ request, status: 'SAFE_BLOCKED', reason: error.message, rawProposal: raw, metrics: budget.summary() }); }
    console.log(JSON.stringify(results.at(-1)));
  }
  const output = path.join(os.tmpdir(), 'phone-commander-held-out-' + Date.now() + '.json');
  fs.writeFileSync(output, JSON.stringify(results, null, 2)); console.log('Evidence:', output);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
