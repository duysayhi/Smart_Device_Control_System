/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { randomUUID, createHash } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { generateGroundedCandidates } = require('../lib/android/agent/grounded-candidates-v2.ts');
const { understandUiWorld } = require('../lib/android/agent/ui-world-model.ts');
const { chooseGroundedNext } = require('../lib/android/agent/open-world-plan.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
async function main() {
  const files = fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort();
  const digest = () => createHash('sha256').update(files.map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
  const frozen = digest(), rows = [], model = new OllamaAgentReasoner(fetch, true);
  // Evaluation-only labels and synthetic native UI; no device actions are sent.
  for (const [i, label] of ['Tidal forecasts', 'Glacier observations', 'Accessible platforms'].entries()) {
    const pkg = 'org.evaluation.unseen' + i, graph = compileOutcomes(`Mo ${pkg} va xem ${label}`, 'SIMULATED', 'E'), node = graph.nodes[1];
    node.packageName = pkg; const id = randomUUID();
    const nodes = [label + ' archive', label].map((text, index) => ({ text, description: '', className: 'android.widget.Button', resourceId: pkg + ':id/menu_' + index,
      packageName: pkg, enabled: true, displayed: true, clickable: true, focused: false, bounds: [0, index * 90, 400, index * 90 + 70] }));
    const snapshot = { deviceSerial: 'SIMULATED', snapshotId: id, timestamp: Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', nodes,
      elements: nodes.map((n, j) => ({ ...n, elementId: id + ':' + j })), viewport: { x: 0, y: 0, width: 400, height: 800 } };
    const candidates = generateGroundedCandidates(node, snapshot, 'E', 'MODEL-EVAL', false).candidates;
    const expected = candidates.find(c => c.target.label === label)?.id;
    if (!expected || candidates.length !== 2) throw Error('Evaluation layout did not supply the intended competing candidates.');
    const budget = new AgentBudget();
    try {
      const decision = await chooseGroundedNext(node, graph, candidates, understandUiWorld(snapshot, 'E', 'MODEL-EVAL'), [], budget, model);
      rows.push({ id: i, expected, decision, correct: decision.choice === expected, metrics: budget.summary() });
    } catch (error) { rows.push({ id: i, correct: false, reason: error.message, metrics: budget.summary() }); }
    console.log(JSON.stringify({ id: i, correct: rows.at(-1).correct, inferenceMs: budget.timings.reasoningMs }));
  }
  if (digest() !== frozen) throw Error('Runtime changed; evaluation invalid.');
  const output = path.join(os.tmpdir(), 'agent-v2-next-action-evaluation-' + Date.now() + '.json');
  fs.writeFileSync(output, JSON.stringify({ classification: 'REAL_MODEL_SIMULATED_UI', runtimeSha256: frozen, model: process.env.OLLAMA_MODEL,
    rows, correct: rows.filter(r => r.correct).length, total: rows.length, deviceActions: 0 }, null, 2));
  console.log(JSON.stringify({ evidence: output, runtimeSha256: frozen }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
