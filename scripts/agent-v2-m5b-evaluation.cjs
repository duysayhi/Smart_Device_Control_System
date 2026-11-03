/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), ts = require('typescript'), { execFile } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { cases, apps, provenance } = require('../tests/fixtures/m5b-development.cjs');
const { proposeReviewedPhrasing } = require('../lib/android/agent/reviewed-phrasing.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { androidRuntimeDigest } = require('../lib/android/agent/runtime-storage.ts');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main() {
  if (!process.argv.includes('--run')) throw Error('Explicit --run required. No Android/grants are imported by this runner.');
  if (process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct' || (process.env.AGENT_STRUCTURED_PROVIDER ?? 'ollama') !== 'ollama' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true') throw Error('Keep Qwen local default with cloud disabled before evaluation.');
  const fixture = 'tests/fixtures/m5b-development.cjs', frozen = androidRuntimeDigest(), cohort = hash(fixture);
  const file = path.join(os.tmpdir(), 'agent-v2-m5b-model-' + Date.now() + '.json');
  const report = { label: 'REAL_MODEL_SIMULATED_UI', provenance, simulation: 'Simulated installed-app catalog; no grants or Android execution. Forced-model pass is diagnostic, not the default deterministic-skip pipeline.', model: 'qwen2.5:3b-instruct', runtimeBefore: frozen, fixtureBefore: cohort, rows: [], memorySamples: [] };
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
  let sampling = false, pending;
  const sample = () => {
    if (sampling) return pending;
    sampling = true;
    pending = new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', "Get-Process -Name ollama,'ollama app',llama-server,runner,ollama_llama_server -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64 | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 5000 }, (_error, stdout) => {
      try { const parsed = JSON.parse(stdout), rows = Array.isArray(parsed) ? parsed : [parsed]; report.memorySamples.push({ at: Date.now(), bytes: rows.reduce((n, p) => n + p.WorkingSet64, 0), processes: rows }); } catch { /* Missing sample is not a zero-memory measurement. */ }
      sampling = false; resolve();
    })); return pending;
  };
  await sample(); const timer = setInterval(sample, 3000);
  try {
    // Same frozen set, two declared conditions. No retries or best-of selection.
    for (const forceModel of [false, true]) for (const c of cases) {
      const budget = new AgentBudget(), at = performance.now();
      const row = { id: c.id, condition: forceModel ? 'FORCED_MODEL_DIAGNOSTIC' : 'DEFAULT_PIPELINE', expected: c.expected, request: c.request };
      try {
        const proposal = await proposeReviewedPhrasing(c.request, c.apps ?? apps, new OllamaAgentReasoner(fetch, true, { model: report.model }), budget, undefined, forceModel);
        row.actual = proposal.spec.outcomes.map(o => [o.kind, o.value]); row.summary = proposal.summary;
        row.verdict = c.expected === 'PLAN' && JSON.stringify(row.actual) === JSON.stringify(c.steps) ? 'FAITHFUL' : 'FALSE_ACCEPT';
      } catch (error) { row.error = error.message; row.verdict = c.expected === 'PLAN' ? 'REJECTED_POSITIVE' : c.expected === 'REFUSE' && !/HARD_BLOCKED/.test(error.message) ? 'WRONG_REJECTION_CLASS' : 'CORRECT_REJECTION'; }
      row.elapsedMs = performance.now() - at;
      row.calls = budget.reasoningMeasurements.map(m => ({ ...m, provider: 'ollama' })); row.singletonSkips = budget.profiling.singletonClausesSkipped;
      row.runtimeAfter = androidRuntimeDigest(); row.fixtureAfter = hash(fixture);
      report.rows.push(row); save();
      console.log(JSON.stringify({ id: row.id, condition: row.condition, verdict: row.verdict, elapsedMs: Math.round(row.elapsedMs), calls: row.calls.length }));
      if (row.runtimeAfter !== frozen || row.fixtureAfter !== cohort) throw Error('Freeze violated; stop without tuning/rerunning.');
    }
  } finally {
    clearInterval(timer); await pending;
    report.runtimeAfter = androidRuntimeDigest(); report.fixtureAfter = hash(fixture);
    report.ollamaWorkingSetPeakBytes = report.memorySamples.length ? Math.max(...report.memorySamples.map(s => s.bytes)) : null;
    save(); console.log(JSON.stringify({ evidence: file, rows: report.rows.length, memorySamples: report.memorySamples.length, ollamaWorkingSetPeakBytes: report.ollamaWorkingSetPeakBytes }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
