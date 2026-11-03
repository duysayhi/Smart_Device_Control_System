/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { destructiveTestIntent } = require('../lib/android/agent/owner-test-policy.ts');
const { semanticOptions } = require('../lib/android/agent/outcome-proposal.ts');
const { sourceSlots, sourcePrimitiveFamilies } = require('../lib/android/agent/source-slots.ts');
const { proposeIntentOutcomes } = require('../lib/android/agent/intent-capabilities.ts');
const { recheckTask, cancelIfActive } = require('./agent-v2-runner-lifecycle.cjs');
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
async function main() {
  if (!args.includes('--run') || !args.includes('--device') || !args.includes('--goal')) throw Error('Opt in with --run --device <serial> --goal <goal>. Photo testing additionally requires explicit owner authorization and --approved-single-photo.');
  const deviceId = option('--device'), goal = option('--goal'), base = 'http://127.0.0.1:3000';
  const graph = compileOutcomes(goal, deviceId, randomUUID());
  const photoConsent = args.includes('--approved-single-photo') && graph.nodes.filter(n => n.capability === 'CAPTURE_MEDIA').length === 1;
  const ownerTest = args.includes('--owner-authorized-test');
  const approvedSummary = args.includes('--approved-interpretation') ? option('--approved-interpretation') : undefined;
  const intentPlan = proposeIntentOutcomes(goal), intentSummary = intentPlan?.outcomes.map(o => o.intent.request.name + ': ' + Object.values(o.intent.request.args).join(' | ')).join('; ');
  const approvedIntents = Boolean(intentPlan && approvedSummary && intentSummary === approvedSummary);
  const approvedReadOnly = typeof approvedSummary === 'string' && sourceSlots(goal).clauses.every(c => {
    const families = sourcePrimitiveFamilies(c.text); return families.length > 0 && families.every(f => ['OPEN_APP', 'NAVIGATE_TO', 'SEARCH'].includes(f));
  });
  const reviewReadOnly = approvedReadOnly || approvedIntents || args.includes('--wait-interpretation') && semanticOptions(goal).every(rows => ['open', 'view', 'search'].includes(rows[0].a));
  if (destructiveTestIntent(goal) || graph.coverage !== 'COMPLETE' && !reviewReadOnly || graph.nodes.some(n => !['LAUNCH', 'NAVIGATE', 'SEARCH', 'CALCULATE', ...(reviewReadOnly ? ['UNKNOWN'] : []), ...(ownerTest ? ['CAPTURE_MEDIA', 'CREATE_RECORD', 'SET_STRUCTURED_STATE', 'SET_STATE', 'FIND_ARTIFACT'] : photoConsent ? ['CAPTURE_MEDIA'] : [])].includes(n.capability))) throw Error('Acceptance runner refuses destructive, unsupported or unapproved persistent-effect goals.');
  const request = async body => {
    const r = await fetch(base + '/api/agent/runtime', { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw Error('Runtime HTTP ' + r.status); return r.json();
  };
  const active = ['QUEUED', 'RUNNING', 'WAITING_HUMAN'];
  const before = await request();
  if (before.tasks.some(t => active.includes(t.status))) throw Error('Another execution is active; no acceptance task sent.');
  const deadline = Date.now() + 180000;
  let task, terminal = false, approvalForwarded = false, forwardedToken, executionId, authorization, createdMode = false, announcedReview, runnerError, runnerDeadline;
  const lifecycle = [];
  try {
    if (ownerTest) {
      const device = before.devices.find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
      if (!device) throw Error('Owner test runner requires a verified physical device.');
      authorization = before.ownerTestModes?.find(mode => mode.deviceId === deviceId && mode.physicalId === device.physicalId && mode.expiresAt > Date.now());
      if (!authorization) {
        const enabled = await request({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: device.physicalId, enabled: true });
        if (!enabled.accepted) throw Error('Owner test authorization was refused.');
        authorization = (await request()).ownerTestModes?.find(mode => mode.deviceId === deviceId && mode.physicalId === device.physicalId);
        if (!authorization) throw Error('Owner test authorization not observed.');
        createdMode = true;
      }
    }
    const started = await request({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId, goal, agentVersion: 2, ...(ownerTest ? { ownerAuthorizedTest: true } : {}) }] });
    executionId = started.tasks[0].executionId;
    do {
      const state = await request(); task = state.tasks.find(t => t.executionId === executionId);
      if (!task) throw Error('Acceptance execution disappeared.');
      terminal = !active.includes(task.status);
      if (terminal) break;
      if (task.status === 'WAITING_HUMAN') {
        const a = task.latest?.v2?.assistance;
        if (a?.category === 'USER_ACTION' && args.includes('--stop-on-user-action')) {
          await request({ type: 'ASSIST_V2', executionId, deviceId, token: a.token, approved: false, choice: '' });
        } else if (reviewReadOnly && a?.category === 'GOAL_INTERPRETATION') {
          if (announcedReview !== a.token) { announcedReview = a.token; console.log(JSON.stringify({ executionId, waitingInterpretation: a.choices.map(c => c.label) })); }
          // Operator-supplied exact summary represents explicit prior human approval,
          // not the disabled source-exact auto-review policy.
          if ((approvedReadOnly || approvedIntents) && !approvalForwarded) {
            if (a.expiresAt <= Date.now() || a.choices.length !== 1 || a.choices[0].label !== approvedSummary) throw Error('Interpretation differs from the explicitly approved read-only summary; no confirmation forwarded.');
            approvalForwarded = true; forwardedToken = a.token;
            await request({ type: 'ASSIST_V2', executionId, deviceId, token: a.token, approved: true, choice: a.choices[0].id });
          }
        } else if (!(approvalForwarded && a?.token === forwardedToken)) {
          if (ownerTest || !photoConsent || approvalForwarded || a?.category !== 'EFFECT_CONFIRMATION' || a.choices.length !== 1 || a.choices[0].label !== 'Capture one photo using the observed shutter') throw Error('Technical/human assistance required; owner mode cannot fabricate missing evidence or resolve ambiguity.');
          approvalForwarded = true; forwardedToken = a.token;
          await request({ type: 'ASSIST_V2', executionId, deviceId, token: a.token, approved: true, choice: a.choices[0].id });
        }
      }
      if (Date.now() > deadline) {
        runnerDeadline = { observedAt: Date.now(), deadline };
        const fresh = await recheckTask(request, executionId, deviceId, lifecycle); task = fresh.task; terminal = fresh.terminal;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    } while (!terminal);
  } catch (error) { runnerError = error.message; }
  finally {
    try {
      if (executionId && !terminal) {
        const fresh = await cancelIfActive(request, executionId, deviceId, lifecycle); task = fresh.task; terminal = fresh.terminal;
        const until = Date.now() + 35000;
        while (!terminal && Date.now() < until) {
          const settled = await recheckTask(request, executionId, deviceId, lifecycle); task = settled.task; terminal = settled.terminal;
          if (!terminal) await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } finally { if (createdMode && authorization) await request({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: authorization.physicalId, enabled: false, authorizationId: authorization.id }); }
  }
  if (task) {
    const report = { goal, executionId, deviceId, runnerError, runnerDeadline, lifecycle, ownerTestMode: task.ownerTestMode, status: task.status, reason: task.latest?.reason, timings: task.latest?.timings,
      reasoningMeasurements: task.latest?.reasoningMeasurements, profiling: task.latest?.profiling, measurements: task.latest?.measurements, intent: task.latest?.v2?.intent,
      sessionId: task.latest?.v2?.sessionId, graph: task.latest?.v2?.graph, artifacts: task.latest?.v2?.artifacts, search: task.latest?.v2?.search, analysis: task.latest?.v2?.analysis,
      trace: task.events.filter(e => e.type === 'progress').map(e => ({ status: e.status, node: e.subgoalId, screen: e.currentScreen?.screenType, snapshotId: e.currentScreen?.snapshotId, sessionId: e.v2?.sessionId, package: e.foregroundPackage, interaction: e.v2?.interaction, search: e.v2?.search, reason: e.reason })) };
    const output = path.join(require('node:os').tmpdir(), 'v2-acceptance-' + executionId + '.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ executionId, status: task.status, reason: task.latest?.reason, timings: report.timings, output }));
    if (task.status !== 'COMPLETED' || runnerError || !terminal) process.exitCode = 1;
  }
  if (runnerError) throw Error(runnerError);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
