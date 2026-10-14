/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { createAgentExecution, runAgent } = require('../lib/android/agent/agent-loop.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { createAndroidExecutor } = require('../lib/android/executor.ts');
const serial = process.argv[2], app = process.argv[3];
const requests = { chrome: 'Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.', settings: 'Mở Settings và tìm mục Thông tin điện thoại.', youtube: 'Mở YouTube, tìm podcast tiếng Anh và phát video thứ hai.' };
if (!serial || !requests[app]) { console.error('Opt-in: node.exe tests/agent.integration.cjs SERIAL chrome|settings|youtube'); process.exit(2); }
const budget = new AgentBudget(), cancel = new AbortController(), signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(budget.limits.timeMs)]);
process.once('SIGINT', () => cancel.abort());
const goalIndex = process.argv.indexOf('--goal');
const requested = goalIndex >= 0 ? process.argv[goalIndex + 1] : requests[app];
if (!requested) throw new Error('--goal requires a complete natural-language request.');
const report = { mode: 'REAL_DEVICE_AGENT', goal: requested, events: [] };
(async () => {
  const { goal, source } = await planGoal(requested, budget, undefined, signal); report.planner = source;
  if (goal.spec.app !== app) throw new Error('Requested goal must stay in the selected test app.');
  if (process.argv.includes('--fresh')) {
    await createAndroidExecutor(runAdb).execute(serial, { type: 'CLOSE_APP', app: goal.spec.app });
    report.preparation = 'Explicit opt-in close-app test setup, not part of Agent decisions; no app data cleared.';
  }
  const execution = await createAgentExecution(goal, budget, serial, runAdb, signal);
  const out = await runAgent(goal, budget, execution, undefined, signal, e => {
    const copy = { ...e, visual: e.visual ? { ...e.visual, image: { ...e.visual.image, dataUrl: '[omitted from log]' } } : undefined };
    report.events.push(copy);
    if (e.action || e.type === 'complete') console.log(JSON.stringify({ status: e.status, subgoal: e.subgoal, action: e.action, reason: e.reason, counters: e.counters }));
  });
  report.result = out.result; if (report.result.visual) report.result = { ...report.result, visual: { ...report.result.visual, image: { ...report.result.visual.image, dataUrl: '[omitted]' } } };
  report.actions = out.memory.actions; report.cleanup = 'runAgent finally completed';
  process.exitCode = out.result.status === 'COMPLETED' ? 0 : out.result.status === 'BLOCKED' ? 2 : 1;
})().catch(error => { report.error = { code: error.code, message: error.message }; process.exitCode = 1; }).finally(() => {
  const file = path.join(os.tmpdir(), `phone-commander-m3-${app}-${Date.now()}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log('REPORT', file);
});
