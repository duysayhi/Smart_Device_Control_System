/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAgentV2, androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { GroqProposalProvider, GroqLocalRouter } = require('../lib/android/agent/reasoning-provider.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');
const { acquireDeviceLock } = require('../lib/android/appium/session-manager.ts');
const args = process.argv.slice(2), opt = k => args[args.indexOf(k) + 1];
const hash = () => crypto.createHash('sha256').update(fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
async function main() {
  if (!args.includes('--run') || !args.includes('--device') || !args.includes('--goal') || !args.includes('--approved-summary') || !['groq', 'fallback'].includes(opt('--mode'))) throw Error('Explicit device/goal/approved-summary/mode required via argv');
  const goal = opt('--goal'), deviceId = opt('--device'), mode = opt('--mode'), approved = opt('--approved-summary');
  const state = await (await fetch('http://127.0.0.1:3000/api/agent/runtime', { signal: AbortSignal.timeout(25000) })).json();
  if (state.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status)) || state.ownerTestModes.length) throw Error('Runtime not idle; no execution');
  const device = state.devices.find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
  if (!device) throw Error('Connected identity-verified device required');
  const executionId = crypto.randomUUID(), budget = new AgentBudget({ reasoning: 8 }), frozen = hash();
  budget.runtimeIdentity = { executionId, deviceId, physicalId: device.physicalId };
  const adapter = androidV2Adapter(deviceId, budget);
  if (await adapter.readiness() !== 'READY') throw Error('UNLOCK_REQUIRED');
  const output = path.join(os.tmpdir(), 'agent-v2-groq-android-' + executionId + '.json');
  const report = { label: 'REAL_ANDROID', deviceId, executionId, mode, goal, runtimeSha256: frozen, events: [], proposalIntervals: [], dispatches: [], interpretationReviews: [] };
  let sessionOpenAt, sessionClosedAt, final;
  const open = adapter.open.bind(adapter);
  adapter.persistedForms = false;
  adapter.open = async (...input) => {
    const e = await open(...input); sessionOpenAt = performance.now(); report.sessionId = e.sessionId();
    const interact = e.interactV2.bind(e), execute = e.execute.bind(e), intent = e.intentV2?.bind(e), close = e.close.bind(e);
    e.interactV2 = async (grant, signal) => {
      if (grant.candidate.effect !== 'READ') throw Error('Read-only acceptance refuses persistent effects');
      report.dispatches.push({ at: performance.now(), kind: 'GROUNDED_READ', grantExpiresAt: grant.expiresAt }); return interact(grant, signal);
    };
    e.execute = async (a, s) => { if (a.type !== 'OPEN_APP') throw Error('Only verified app launch through this path'); return execute(a, s); };
    e.intentV2 = async (a, binding, ...rest) => { if (binding.request.name !== 'OPEN_APP') throw Error('Only app intent allowed'); return intent(a, binding, ...rest); };
    e.close = async () => { await close(); sessionClosedAt = performance.now(); };
    return e;
  };
  const cloud = mode === 'fallback' ? { providerId: 'forced-network-failure', async generate() { throw Error('Forced network failure at proposal only'); } } : new GroqProposalProvider();
  const router = new GroqLocalRouter(cloud);
  const reasoner = { async generate(schema, system, input, b, signal) {
    // This controlled spot check proves planning before Session/grants. It does
    // not pretend to cover UI-choice inference inside an already-open Session.
    if (sessionOpenAt) throw Error('Spot check does not allow model inference after Session setup');
    const start = performance.now(), publicSchema = require('zod').z.toJSONSchema(schema);
    try { return await router.generate(schema, system, input, b, signal); }
    finally { report.proposalIntervals.push({ start, end: performance.now(), publicSchema, beforeSession: !sessionOpenAt }); }
  } };
  const publish = event => {
    final = event; report.events.push(event);
    const assistance = event.v2?.assistance;
    if (assistance) {
      const exact = assistance.category === 'GOAL_INTERPRETATION' && assistance.choices.length === 1 && assistance.choices[0].label === approved;
      report.interpretationReviews.push({ category: assistance.category, exactApprovedSummary: exact, reason: exact ? 'MATCH' : 'EXACT_APPROVED_SUMMARY_MISMATCH_OR_UNAPPROVED_CATEGORY' });
      submitAssistanceV2({ token: assistance.token, deviceId, executionId, approved: exact, choice: exact ? assistance.choices[0].id : '' });
    }
  };
  const release = await acquireDeviceLock('device-reservation:' + device.physicalId);
  try { await runAgentV2(goal, deviceId, executionId, device.physicalId, budget, adapter, publish, AbortSignal.timeout(240000), reasoner); }
  finally {
    await release();
    report.profile = budget.summary(); report.final = final; report.unchanged = hash() === frozen; report.sessionOpenAt = sessionOpenAt; report.sessionClosedAt = sessionClosedAt;
    report.noCloudDuringGrantWindow = report.proposalIntervals.every(p => p.beforeSession && (!sessionOpenAt || p.end <= sessionOpenAt));
    const text = JSON.stringify(report, null, 2); if (process.env.GROQ_API_KEY && text.includes(process.env.GROQ_API_KEY)) throw Error('Evidence redaction failed');
    fs.writeFileSync(output, text); console.log(JSON.stringify({ output, status: final?.status, modelCalls: report.proposalIntervals.length, unchanged: report.unchanged, noCloudDuringGrantWindow: report.noCloudDuringGrantWindow }));
    if (final?.status !== 'COMPLETED' || !report.unchanged || !report.noCloudDuringGrantWindow) process.exitCode = 1;
  }
}
main().catch(e => { console.error(e.message === 'UNLOCK_REQUIRED' ? e.message : 'Controlled Android acceptance stopped before unapproved action'); process.exitCode = 1; });
