/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { createExecutionContext } = require('../lib/android/condition-executor.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { matchUiTarget } = require('../lib/android/ui-understanding.ts');
const { explorationGoal } = require('../lib/android/exploration/types.ts');
const { detectScrollRegion } = require('../lib/android/exploration/scroll-regions.ts');
const { discoveryCandidates } = require('../lib/android/exploration/element-memory.ts');
const serial = process.argv[2], app = process.argv[3];
if (!serial || !['youtube', 'chrome', 'settings'].includes(app)) { console.error('Opt-in: node tests/milestone25.integration.cjs SERIAL youtube|chrome|settings [--inspect]'); process.exit(2); }
let context;
const report = { app, mode: 'REAL_DEVICE', steps: [], observations: [], started: new Date().toISOString(), outcome: 'NOT_TESTED' };
const signal = AbortSignal.timeout(300000);
async function observe() {
  const state = await context.observe(signal);
  const target = app === 'youtube' ? 'video_card_2' : app === 'chrome' ? 'result_3' : 'text:Thông tin điện thoại';
  const goal = explorationGoal(target), region = detectScrollRegion(state, goal);
  const candidates = region.status === 'FOUND' ? discoveryCandidates(state, region.region, goal) : undefined;
  const record = { screen: state.screen, package: state.foregroundPackage, nodes: state.nodes.length, web: state.web,
    targetMatch: matchUiTarget(state, target).status, region: region.status, candidates: candidates?.status, reason: candidates?.reason,
    titles: candidates?.candidates.map(candidate => candidate.title),
    controls: app === 'youtube' || app === 'chrome' ? state.nodes.filter(node => node.text || node.description || node.clickable)
      .map(node => ({ id: node.resourceId, text: node.text, description: node.description, clickable: node.clickable, parent: node.parentIndex, bounds: node.bounds })) : undefined };
  report.observations.push(record); console.log('OBSERVE', JSON.stringify(record)); return state;
}
async function step(action) {
  const started = performance.now(), record = { action, progress: [] }; report.steps.push(record);
  try {
    const outcome = await context.execute(action, signal, progress => {
      if (!progress.exploration) return;
      const previous = record.progress.at(-1);
      if (!previous || previous.scrollCount !== progress.exploration.scrollCount || previous.phase !== progress.exploration.phase) {
        record.progress.push(progress.exploration);
        if (progress.exploration.phase === 'WAITING_DATA' || progress.exploration.status) console.log('PROGRESS', JSON.stringify(progress.exploration));
      }
    });
    Object.assign(record, outcome, { status: outcome.verification === 'VERIFIED' ? 'PASS' : 'SENT' });
    console.log('STEP', JSON.stringify({ action, status: record.status, elapsedMs: outcome.elapsedMs, postcondition: outcome.postcondition,
      evidence: outcome.evidence, interaction: outcome.interaction, exploration: outcome.exploration })); return outcome;
  } catch (error) { Object.assign(record, { status: 'FAIL', code: error.code, error: error.message, exploration: error.exploration, elapsedMs: Math.round(performance.now() - started) }); throw error; }
}
(async () => {
  context = await createExecutionContext(serial, [{ type: 'OPEN_APP', app }], runAdb, signal);
  if (process.argv.includes('--inspect')) { await observe(); return; }
  await step({ type: 'OPEN_APP', app });
  if (app === 'youtube') {
    await step({ type: 'WAIT_FOR', target: 'search_button', timeoutMs: 20000 });
    await step({ type: 'CLICK', target: 'search_button' });
    await step({ type: 'INPUT_TEXT', text: 'podcast tiếng Anh' });
    await step({ type: 'PRESS_KEY', key: 'ENTER' });
    await step({ type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 });
    await observe();
    const result = await step({ type: 'CLICK', target: 'video_card_2' });
    report.outcome = result.verification === 'VERIFIED' ? 'PASS' : 'SENT';
    await observe();
  } else if (app === 'chrome') {
    await step({ type: 'CLICK', target: 'address_bar' });
    await step({ type: 'INPUT_TEXT', text: 'công thức nấu phở' });
    await step({ type: 'PRESS_KEY', key: 'ENTER' });
    await observe();
    const result = await step({ type: 'CLICK', target: 'result_3' });
    report.outcome = result.verification === 'VERIFIED' ? 'PASS' : 'SENT';
    await observe();
  } else {
    const before = await observe();
    report.initialMatch = matchUiTarget(before, 'text:Thông tin điện thoại').status;
    const result = await step({ type: 'WAIT_FOR', target: 'text:Thông tin điện thoại', timeoutMs: 30000 });
    report.outcome = result.verification === 'VERIFIED' ? 'PASS' : 'SENT';
  }
})().catch(async error => {
  report.outcome = ['AMBIGUOUS', 'UNKNOWN', 'NOT_FOUND', 'SCROLL_LIMIT_REACHED'].includes(error.code) ? 'BLOCKED' : 'FAIL';
  report.error = { code: error.code, message: error.message }; console.error('FAIL', JSON.stringify(report.error)); process.exitCode = 1;
  if (context) { try { await observe(); } catch (error) { console.error('DIAGNOSIS_FAILED', error.code, error.message); } }
}).finally(async () => {
  try { await context?.close(); report.cleanup = 'PASS'; console.log('SESSION_CLOSED'); }
  catch (error) { report.cleanup = 'FAIL'; report.cleanupError = error.message; process.exitCode = 1; }
  const file = path.join(os.tmpdir(), `phone-commander-m25-resolution-${app}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log('REPORT', file);
});
