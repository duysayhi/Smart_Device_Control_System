/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { runAdb } = require('../lib/android/adb.ts');
const { createExecutionContext, assertNonSensitivePlan } = require('../lib/android/condition-executor.ts');
const { matchUiTarget } = require('../lib/android/ui-understanding.ts');
const serialIndex = process.argv.indexOf('--serial');
const appIndex = process.argv.indexOf('--app');
const serial = process.argv[serialIndex + 1];
const app = process.argv[appIndex + 1];
if (serialIndex < 0 || appIndex < 0 || !['youtube', 'chrome', 'settings'].includes(app)) {
  console.error('Opt-in real-device test: node tests/android-observer.integration.cjs --serial DEVICE_SERIAL --app youtube|chrome|settings');
  process.exit(2);
}
const report = { mode: 'REAL_DEVICE', serial, app, started: new Date().toISOString(), steps: [], snapshots: [] };
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new DOMException('Execution deadline exceeded', 'TimeoutError')), 180000);
let context;
const reportPath = path.join(os.tmpdir(), `phone-commander-${app}-integration-${Date.now()}.json`);
async function observe() {
  const started = performance.now();
  const state = await context.observe(controller.signal);
  report.snapshots.push({ snapshotId: state.snapshotId, deviceSerial: state.deviceSerial, timestamp: state.timestamp,
    foregroundPackage: state.foregroundPackage, observationStatus: state.observationStatus, screen: state.screen,
    nodeCount: state.elements.length, source: state.evidenceSource, readElapsedMs: Math.round(performance.now() - started),
    elements: state.elements.map((element) => ({ elementId: element.elementId, resourceId: element.resourceId, className: element.className,
      clickable: element.clickable, enabled: element.enabled, bounds: element.bounds, visible: element.visible, focused: element.focused })) });
  return state;
}
async function action(value) {
  const step = { action: value.type, target: value.target, started: new Date().toISOString() };
  report.steps.push(step);
  try {
    const result = await context.execute(value, controller.signal);
    Object.assign(step, result, { status: result.verification === 'VERIFIED' ? 'PASS' : 'SENT' });
    console.log('STEP', JSON.stringify(step));
    return result;
  } catch (error) {
    Object.assign(step, { status: 'FAIL', code: error.code, error: error.message });
    throw error;
  }
}
(async () => {
  const actions = app === 'youtube' ? [
    { type: 'OPEN_APP', app }, { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 20000 },
    { type: 'CLICK', target: 'search_button' }, { type: 'INPUT_TEXT', text: 'podcast tiếng anh' },
    { type: 'PRESS_KEY', key: 'ENTER' }, { type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 },
  ] : [{ type: 'OPEN_APP', app }];
  assertNonSensitivePlan({ intent: 'integration_test', isSensitive: false, actions });
  context = await createExecutionContext(serial, actions, runAdb, controller.signal);
  for (const value of actions) await action(value);
  const state = await observe();
  if (app === 'youtube') {
    const match = matchUiTarget(state, 'video_card_2', true);
    report.secondVideo = { status: match.status === 'MATCH' ? 'READY' : 'UNKNOWN', reason: match.reason ?? match.status };
    if (match.status === 'MATCH') {
      const outcome = await action({ type: 'CLICK', target: 'video_card_2' });
      report.goal = outcome.verification === 'VERIFIED' ? 'PASS' : 'BLOCKED';
    } else report.goal = 'BLOCKED';
  } else if (app === 'chrome') {
    const match = matchUiTarget(state, 'address_bar', true);
    if (match.status !== 'MATCH') { report.goal = 'BLOCKED'; report.reason = 'Chrome address field is not uniquely interactable; onboarding/popups are not auto-dismissed.'; return; }
    await action({ type: 'CLICK', target: 'address_bar' });
    await action({ type: 'INPUT_TEXT', text: 'công thức nấu phở' });
    await action({ type: 'PRESS_KEY', key: 'ENTER' });
    const results = await observe();
    const first = matchUiTarget(results, 'first_result', true);
    report.firstResult = { status: first.status === 'MATCH' ? 'READY' : 'UNKNOWN', reason: first.reason ?? first.status };
    if (first.status === 'MATCH') {
      const outcome = await action({ type: 'CLICK', target: 'first_result' });
      report.goal = outcome.verification === 'VERIFIED' ? 'PASS' : 'BLOCKED';
    } else report.goal = 'BLOCKED';
  } else {
    let match = matchUiTarget(state, 'text:Wi-Fi', true);
    if (match.status !== 'MATCH') {
      const connection = matchUiTarget(state, 'text:Kết nối', true);
      if (connection.status === 'MATCH') {
        await action({ type: 'CLICK', target: 'text:Kết nối' });
        const next = await observe();
        match = matchUiTarget(next, 'text:Wi-Fi', true);
      }
    }
    if (match.status !== 'MATCH') { report.goal = 'BLOCKED'; report.reason = 'Wi-Fi row is not uniquely interactable in the observed Settings UI.'; return; }
    const outcome = await action({ type: 'CLICK', target: 'text:Wi-Fi' });
    report.goal = outcome.verification === 'VERIFIED' ? 'PASS' : 'BLOCKED';
    await observe();
  }
})().catch((error) => {
  report.goal = 'FAIL'; report.error = { code: error.code, message: error.message }; console.error('TEST_FAILURE', JSON.stringify(report.error)); process.exitCode = 1;
}).finally(async () => {
  try { if (context) { await context.close(); report.cleanup = 'PASS'; } else report.cleanup = 'NOT TESTED'; }
  catch (error) { report.cleanup = 'FAIL'; report.cleanupError = error.message; process.exitCode = 1; }
  if (report.goal === 'BLOCKED' && !process.exitCode) process.exitCode = 2;
  clearTimeout(timer); report.finished = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('REPORT', reportPath);
});
