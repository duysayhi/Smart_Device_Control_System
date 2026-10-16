/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { createExecutionContext } = require('../lib/android/condition-executor.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { createAgentExecution, runAgent } = require('../lib/android/agent/agent-loop.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { generateActionCandidates } = require('../lib/android/agent/action-candidates.ts');
const { geometryFingerprint } = require('../lib/android/visual-grounding.ts');
const { readLocationVerified, capacityTextEvidence } = require('../lib/android/agent/navigation-semantics.ts');
const serial = process.argv[2], app = process.argv[3];
if (!serial || !['settings', 'chrome', 'youtube'].includes(app)) throw new Error('Opt-in: node.exe tests/agent-candidates.integration.cjs SERIAL settings|chrome|youtube --inspect');
(async () => {
  if (process.argv.includes('--run')) {
    const at = process.argv.indexOf('--goal');
    const request = at >= 0 ? process.argv[at + 1] : { settings: 'Mở Cài đặt và tìm nơi xem dung lượng bộ nhớ.', chrome: 'Mở Chrome, tìm hướng dẫn cài Python trên Windows và mở kết quả đầu tiên.', youtube: 'Mở YouTube, tìm podcast tiếng Anh và phát video thứ hai.' }[app];
    const budget = new AgentBudget(), cancel = new AbortController(), signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(budget.limits.timeMs)]);
    process.once('SIGINT', () => cancel.abort());
    const { goal, source } = await planGoal(request, budget, undefined, signal);
    if (goal.spec.app !== app) throw new Error('The test goal must stay in the selected app.');
    const decisions = [], events = [], engine = new AgentDecisionEngine(); let capacityEvidence;
    const provider = { async decide(g, s, memory, discovery, b, abort) {
      const candidates = generateActionCandidates(g, s).filter(c => !memory.alreadyAttempted(c.action, g.subgoals[g.currentSubgoal]?.id ?? '', geometryFingerprint(s)));
      const before = b.counters.reasoning;
      const decision = await engine.decide(g, s, memory, discovery, b, abort);
      const row = { snapshotId: s.snapshotId, package: s.foregroundPackage, screen: s.screen, modelCalled: b.counters.reasoning > before, candidates: b.counters.reasoning > before ? candidates : undefined, decision };
      decisions.push(row); console.log(JSON.stringify(row)); return decision;
    } };
    const execution = await createAgentExecution(goal, budget, serial, runAdb, signal);
    const out = await runAgent(goal, budget, execution, provider, signal, event => {
      events.push({ ...event, visual: undefined });
      const s = event.status === 'COMPLETED' ? execution.verificationSnapshot?.() : undefined;
      if (s && goal.spec.operation === 'FIND_PLACE') capacityEvidence = { snapshotId: s.snapshotId, package: s.foregroundPackage, verified: readLocationVerified(goal, s),
        labels: capacityTextEvidence(s) };
    });
    const multi = decisions.filter(row => row.modelCalled && row.candidates?.length >= 2 && new Set(row.candidates.map(c => c.semanticRole)).size >= 2);
    const verifiedChoice = multi.some(row => out.memory.actions.some(a => a.candidateId === row.decision.grounding?.candidateId && a.verification === 'VERIFIED'));
    const report = { mode: 'REAL_ANDROID_M32', originalGoal: request, planner: source, decisions, events,
      result: { ...out.result, visual: undefined }, actions: out.memory.actions, capacityEvidence,
      multiCandidate: multi.length ? verifiedChoice && out.result.status === 'COMPLETED' ? 'PASS' : 'BLOCKED' : 'NOT_TESTED', cleanup: 'runAgent finally completed' };
    const file = path.join(os.tmpdir(), `phone-commander-m32-${app}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log('REPORT', file); console.log(JSON.stringify({ result: report.result, multiCandidate: report.multiCandidate }));
    process.exitCode = out.result.status === 'COMPLETED' && (!process.argv.includes('--require-multi') || report.multiCandidate === 'PASS') ? 0 : 2;
    return;
  }
  const execution = await createExecutionContext(serial, [{ type: 'OPEN_APP', app }], runAdb);
  try {
    if (!process.argv.includes('--current')) await execution.execute({ type: 'OPEN_APP', app });
    const s = await execution.observe();
    const report = { mode: 'REAL_UI_INSPECT', app, snapshotId: s.snapshotId, foreground: s.foregroundPackage, screen: s.screen,
      nodes: s.nodes.map((n, index) => ({ index, id: n.resourceId, class: n.className, label: /EditText|AutoCompleteTextView/.test(n.className) ? '[input omitted]' :
        /^(Bộ nhớ|Memory|Storage|Lưu trữ|Cài đặt|Tìm kiếm|Search|Chăm sóc (pin và )?thiết bị)$|\d+(?:[.,]\d+)?\s*(?:GB|MB|TB)\b|^(Đã sử dụng|Đã dùng|Used|Available|Total|Free|Tổng|Còn trống)/i.test(n.text || n.description) ? n.text || n.description : '[label omitted]',
        clickable: n.clickable, scrollable: n.scrollable, enabled: n.enabled, displayed: n.displayed, parentIndex: n.parentIndex, bounds: n.bounds })) };
    const file = path.join(os.tmpdir(), `phone-commander-m32-inspect-${app}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log('REPORT', file); console.log(JSON.stringify(report));
  } finally { await execution.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
