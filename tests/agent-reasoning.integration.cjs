/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { probeOllama } = require('../lib/android/agent/diagnostics.ts');
const { planGoal } = require('../lib/android/agent/goal-planner.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { createAgentExecution, runAgent } = require('../lib/android/agent/agent-loop.ts');
const { AgentDecisionEngine } = require('../lib/android/agent/decision-engine.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { parseUiHierarchy } = require('../lib/android/targets.ts');
const { navigationLayers } = require('../lib/android/browser-navigation.ts');
const { READ_WEB_DOCUMENT, READ_WEB_DESTINATION } = require('../lib/android/hybrid-context-observer.ts');
const { generateActionCandidates } = require('../lib/android/agent/action-candidates.ts');
const serial = process.argv[2];
(async () => {
  if (serial === '--probe') { console.log(JSON.stringify(await probeOllama(true), null, 2)); return; }
  if (!serial) throw new Error('Opt-in: node.exe tests/agent-reasoning.integration.cjs --probe | SERIAL');
  const budget = new AgentBudget(), signal = AbortSignal.timeout(budget.limits.timeMs);
  const goalAt = process.argv.indexOf('--goal');
  const request = goalAt >= 0 ? process.argv[goalAt + 1] : process.argv.includes('--search-only') ? 'Mở Chrome, tìm công thức nấu phở.' : 'Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.';
  const { goal } = await planGoal(request, budget, undefined, signal);
  if (goal.spec.app !== 'chrome') throw new Error('This opt-in harness is restricted to Chrome.');
  const realFetch = global.fetch;
  let currentSession;
  let watchDestination = false;
  const domTrace = [];
  // Observe the real creation response; do not replace data or create another Session.
  global.fetch = async (url, options) => {
    const response = await realFetch(url, options);
    if (process.argv.includes('--backend-trace') && !response.ok && String(url).startsWith(process.env.APPIUM_URL ?? 'http://127.0.0.1:4723')) {
      const failure = (await response.clone().json()).value;
      console.error(JSON.stringify({ backend: 'APPIUM', method: options?.method, operation: new URL(String(url)).pathname.replace(/\/session\/[^/]+/, '/session/[id]'), error: failure?.error,
        message: typeof failure?.message === 'string' && !failure.message.includes('<?xml') ? failure.message.slice(0, 1200) : '[details omitted]' }));
    }
    if (String(url).endsWith('/session') && options?.method === 'POST' && response.ok) {
      currentSession = (await response.clone().json()).value?.sessionId;
    }
    if (process.argv.includes('--dom-trace') && watchDestination && String(url).endsWith('/execute/sync') && response.ok && [READ_WEB_DOCUMENT, READ_WEB_DESTINATION].includes(JSON.parse(options.body ?? '{}').script)) {
      const doc = (await response.clone().json()).value;
      if (doc?.url && !domTrace.some(row => row.url === doc.url && row.title === doc.title && row.readyState === doc.readyState) && domTrace.length < 16) {
        domTrace.push({ url: doc.url, title: doc.title, readyState: doc.readyState, headings: doc.headings, firstResult: doc.links?.[0] && { url: doc.links[0].url, title: doc.links[0].title } });
      }
    }
    return response;
  };
  let execution;
  try {
    execution = await createAgentExecution(goal, budget, serial, runAdb, signal);
    await execution.execute({ type: 'OPEN_APP', app: 'chrome' }, signal);
    if (process.argv.includes('--overview')) {
      const before = await execution.observe(signal);
      if (navigationLayers(before).length) console.log('SETUP: native overview already observed; no preparation action sent.');
      else {
      const candidates = before.nodes.filter(n => n.resourceId === 'com.android.chrome:id/tab_switcher_button' && n.enabled && n.clickable && n.displayed !== false);
      if (candidates.length !== 1) throw new Error('No unique observed tab overview control; setup denied.');
      const client = new AppiumClient(), id = currentSession;
      if (!id) throw new Error('No creation response proves the current single-device Session.');
      const elements = await client.request('POST', `/session/${id}/elements`, { using: 'id', value: candidates[0].resourceId });
      if (elements.length !== 1) throw new Error('Setup control changed or became ambiguous.');
      const element = elements[0]['element-6066-11e4-a52e-4f735466cecf'];
      await client.request('POST', `/session/${id}/element/${element}/click`, {});
      const deadline = performance.now() + 10000;
      let observed = false;
      while (performance.now() < deadline) {
        budget.recordSnapshot('SETUP_NATIVE');
        const xml = await client.request('GET', `/session/${id}/source`, undefined, 5000, signal);
        if (navigationLayers({ foregroundPackage: 'com.android.chrome', observationStatus: 'OBSERVED', nodes: parseUiHierarchy(xml) }).length) { observed = true; break; }
      }
      if (!observed) throw new Error('Tab overview did not appear; do not claim reasoning setup succeeded.');
      console.log('SETUP: opened observed tab overview; not an Agent decision, no tab created/closed.');
      }
    }
    const snapshot = await execution.observe(signal);
    const evidence = { snapshotId: snapshot.snapshotId, screen: snapshot.screen, package: snapshot.foregroundPackage,
      nodes: snapshot.nodes.map((n, index) => ({ index, id: n.resourceId, className: n.className, clickable: n.clickable, enabled: n.enabled })) };
    if (process.argv.includes('--dom-identity')) evidence.web = snapshot.web;
    if (process.argv.includes('--run')) {
      const decisions = [], engine = new AgentDecisionEngine();
      const provider = { async decide(g, s, m, d, b, cancel) {
        const count = b.counters.reasoning;
        const candidates = generateActionCandidates(g, s);
        const decision = await engine.decide(g, s, m, d, b, cancel);
        if (decision.type === 'EXECUTE_ACTION' && decision.action.type === 'CLICK' && /^first_result|result_/.test(decision.action.target)) watchDestination = true;
        decisions.push({ snapshotId: s.snapshotId, package: s.foregroundPackage, nodeCount: s.nodes.length,
          modelCalled: b.counters.reasoning > count, candidates: b.counters.reasoning > count ? candidates : undefined, decision });
        console.log(JSON.stringify(decisions.at(-1))); return decision;
      } };
      const events = [];
      const out = await runAgent(goal, budget, execution, provider, signal, event => events.push({ ...event, visual: undefined }));
      const safeResult = { ...out.result, visual: out.result.visual ? { ...out.result.visual, image: { ...out.result.visual.image, dataUrl: '[omitted]' } } : undefined };
      const rulesRegression = process.argv.includes('--rules-regression');
      const report = { mode: rulesRegression ? 'RULES_REGRESSION_REAL_ANDROID' : 'REAL_MODEL_REAL_ANDROID', originalGoal: goal.originalRequest, preparation: process.argv.includes('--overview') ? 'Observed tab control setup only; not an Agent decision' : 'Current UI, no prepared action sequence', decisions, domTrace, events, result: safeResult, actions: out.memory.actions, selection: out.memory.selection, cleanup: 'runAgent finally completed' };
      const file = path.join(os.tmpdir(), `phone-commander-m311-reasoning-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log('REPORT', file); console.log(JSON.stringify(safeResult));
      if (out.result.status !== 'COMPLETED' || !rulesRegression && (!decisions.some(row => row.modelCalled) || !out.memory.actions.some(row => row.candidateId && row.verification === 'VERIFIED') || !budget.reasoningMeasurements.some(row => row.status === 'VALID'))) process.exitCode = 2;
      return;
    }
    const file = path.join(os.tmpdir(), `phone-commander-m31-inspect-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(evidence, null, 2)); console.log('REPORT', file); console.log(JSON.stringify(evidence));
  } finally { try { await execution?.close(); } finally { global.fetch = realFetch; } }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
