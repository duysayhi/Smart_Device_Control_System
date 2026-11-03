/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { createHash } = require('node:crypto'), { execFile } = require('node:child_process');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { proposePrimitiveDecomposition, bindReviewedPrimitives } = require('../lib/android/agent/primitive-decomposition.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const fixture = require('../tests/fixtures/agent-v2-m2b-development.cjs');
async function main() {
  const ctx = process.argv.includes('--ctx4096') ? 4096 : 2048, modelName = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b-instruct';
  const files = fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort();
  const digest = () => createHash('sha256').update(files.map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
  const frozen = digest(), output = path.join(os.tmpdir(), 'agent-v2-m2b-' + Date.now() + '.json'), rows = [], memory = [];
  let sampling;
  const sample = () => {
    if (sampling) return sampling;
    sampling = new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', "$o=Get-CimInstance Win32_OperatingSystem;$p=Get-Process -Name 'ollama*','llama*' -ErrorAction SilentlyContinue;[pscustomobject]@{ollamaWorkingSetBytes=($p|Measure-Object WorkingSet64 -Sum).Sum;freePhysicalKB=$o.FreePhysicalMemory;totalPhysicalKB=$o.TotalVisibleMemorySize}|ConvertTo-Json -Compress"], { windowsHide: true }, (error, stdout) => {
      if (!error) try { memory.push({ at: Date.now(), ...JSON.parse(stdout) }); } catch { /* Optional profiling cannot change results. */ }
      resolve();
    })).finally(() => { sampling = undefined; }); return sampling;
  };
  await sample(); const timer = setInterval(sample, 2500); timer.unref();
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); body.model = modelName; body.options.num_ctx = ctx;
    return fetch(url, { ...init, body: JSON.stringify(body) });
  };
  const reasoner = new OllamaAgentReasoner(fetcher, true);
  const forceModel = process.argv.includes('--reference'), warmBudget = new AgentBudget();
  try {
    await proposePrimitiveDecomposition(fixture.cases.find(f => !f.reject).request, reasoner, warmBudget, undefined, { apps: fixture.apps, forceModel: true });
    for (const f of fixture.cases) {
      const budget = new AgentBudget(), replies = []; let row;
      const capture = { async generate(...args) { const result = await reasoner.generate(...args); replies.push(result); return result; } };
      try {
        const p = await proposePrimitiveDecomposition(f.request, capture, budget, undefined, { apps: fixture.apps, forceModel });
        const graph = bindReviewedPrimitives(p, 'SIMULATED', f.id), actual = p.steps.map((s, i) => [s.primitive, p.spec.outcomes[i].value, graph.nodes[i].app ?? null]);
        const executable = graph.coverage === 'COMPLETE', faithful = !f.reject && JSON.stringify(actual) === JSON.stringify(f.expected) && p.steps.every(s => !s.negated);
        row = { ...f, actual, executable, faithful, rejected: !executable, falseAccepted: executable && (f.reject || !faithful), reason: graph.nodes.map(n => n.reason).filter(Boolean).join('; ') };
      } catch (e) { row = { ...f, executable: false, faithful: false, rejected: true, falseAccepted: false, reason: e.message }; }
      row.metrics = budget.summary(); row.replies = replies; rows.push(row);
      fs.writeFileSync(output, JSON.stringify({ classification: 'REAL_MODEL_SIMULATED_UI', development: true, modelName, ctx, runtimeSha256: frozen, rows, memory }, null, 2));
      console.log(JSON.stringify({ id: f.id, faithful: row.faithful, rejected: row.rejected, falseAccepted: row.falseAccepted, ms: budget.timings.reasoningMs, reason: row.reason?.slice(0, 160) }));
    }
  } finally { clearInterval(timer); if (sampling) await sampling; }
  if (digest() !== frozen) throw Error('Runtime changed during evaluation; results invalid.');
  const summary = { validTotal: fixture.cases.filter(f => !f.reject).length, validFaithful: rows.filter(r => !r.reject && r.faithful && r.executable).length,
    invalidTotal: fixture.cases.filter(f => f.reject).length, invalidRejected: rows.filter(r => r.reject && r.rejected).length, falseAccepted: rows.filter(r => r.falseAccepted).length };
  summary.gate = summary.validFaithful >= 10 && summary.falseAccepted === 0 && summary.invalidRejected === summary.invalidTotal;
  fs.writeFileSync(output, JSON.stringify({ classification: rows.some(r => r.metrics.reasoningMeasurements.length) ? 'REAL_MODEL_SIMULATED_UI' : 'OFFLINE_TESTED', development: true, forceModel, warm: warmBudget.summary(), modelName, ctx, runtimeSha256: frozen, summary, rows, memory, androidActions: 0 }, null, 2));
  console.log(JSON.stringify({ summary, evidence: output, sampledPeakOllamaMB: Math.max(0, ...memory.map(m => m.ollamaWorkingSetBytes / 1048576)) }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
