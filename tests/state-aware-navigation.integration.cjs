/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in live read/search navigation. No reset, installation or media selection.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { buildGoal } = require('../lib/android/agent/goal-planner.ts');
const { runAgent, createAgentExecution } = require('../lib/android/agent/agent-loop.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { understandCurrentScreen } = require('../lib/android/agent/navigation-semantics.ts');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const serial = arg('--serial'), app = arg('--app'), query = arg('--query') ?? 'podcast tiếng Anh', expected = arg('--expect-screen');
if (!serial || !['youtube', 'chrome', 'settings'].includes(app)) throw Error('Use --serial ADB_SERIAL --app youtube|chrome|settings [--query TEXT] [--expect-screen TYPE]');
if (arg('--adb-path')) process.env.ADB_PATH = arg('--adb-path');
const budget = new AgentBudget(), report = { kind: 'REAL_ANDROID', app, started: new Date().toISOString(), events: [] };
const spec = app === 'settings' ? { app, operation: 'FIND_ELEMENT', targetText: query, isSensitive: false } :
  { app, operation: 'SEARCH', query, resultType: app === 'chrome' ? 'browser' : 'video', isSensitive: false };
const goal = buildGoal(`Mở ${app}, tìm ${query}`, spec, budget);
budget.runtimeIdentity = { executionId: goal.id, deviceId: serial };
const signal = AbortSignal.timeout(240000);
(async () => {
  const setup = performance.now(), execution = await createAgentExecution(goal, budget, serial, runAdb, signal);
  budget.timings.sessionSetupMs = Math.round(performance.now() - setup);
  const original = execution.observe.bind(execution);
  execution.observe = async cancel => {
    const s = await original(cancel);
    if (!report.initial) {
      report.initial = understandCurrentScreen(s, goal.id);
      console.log('INITIAL', JSON.stringify(report.initial));
      if (expected && report.initial.screenType !== expected) throw Error('Initial screen does not match requested acceptance case; no action sent.');
    }
    return s;
  };
  const out = await runAgent(goal, budget, execution, undefined, signal, event => {
    if (event.currentScreen && (!report.events.length || report.events.at(-1).screen !== event.currentScreen.screenType || event.action || event.type === 'complete')) {
      const row = { status: event.status, screen: event.currentScreen.screenType, required: event.navigation?.required, action: event.action,
        navigation: event.navigation, reason: event.reason };
      report.events.push(row); console.log('PROGRESS', JSON.stringify(row));
    }
  });
  report.result = out.result; report.navigation = out.memory.navigation; report.actions = out.memory.actions;
  report.status = expected && report.initial?.screenType !== expected ? 'NOT_TESTED_INITIAL_STATE' :
    out.result.status === 'COMPLETED' ? 'REAL_ANDROID_PASS' : 'BLOCKED_OR_FAILED';
  if (out.result.status !== 'COMPLETED') process.exitCode = 1;
})().catch(error => { report.status = 'FAILED'; report.error = error.message; process.exitCode = 1; console.error(error.message); })
  .finally(() => {
    report.finished = new Date().toISOString();
    const file = path.resolve('.next', `state-navigation-${app}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log('REPORT', file);
  });
