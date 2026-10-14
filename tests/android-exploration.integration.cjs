/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: f,
}).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { createExecutionContext } = require('../lib/android/condition-executor.ts');
const { discoveryCandidates } = require('../lib/android/exploration/element-memory.ts');
const { detectScrollRegion } = require('../lib/android/exploration/scroll-regions.ts');
const { isDescendant } = require('../lib/android/exploration/scroll-regions.ts');
const { explorationGoal } = require('../lib/android/exploration/types.ts');
const { matchUiTarget } = require('../lib/android/ui-understanding.ts');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const serial = arg('--serial'), app = arg('--app'), inspect = process.argv.includes('--inspect');
if (arg('--adb-path')) process.env.ADB_PATH = arg('--adb-path');
const currentOnly = process.argv.includes('--current') && inspect;
const diagnose = process.argv.includes('--diagnose');
if (!serial || !['youtube', 'settings', 'chrome'].includes(app)) {
  console.error('Opt-in: node tests/android-exploration.integration.cjs --serial DEVICE_SERIAL --app youtube|settings|chrome [--inspect]');
  process.exit(2);
}
let context;
const report = { mode: 'REAL_DEVICE', milestone: '2.5', app, serial, started: new Date().toISOString(), steps: [], observations: [], goal: 'NOT TESTED' };
const signal = AbortSignal.timeout(240000);
async function step(action) {
  const started = performance.now();
  const result = { action, progress: [] }; report.steps.push(result);
  try {
    const outcome = await context.execute(action, signal, p => {
      if (p.exploration) {
        const previous = result.progress.at(-1);
        if (!previous || previous.phase !== p.exploration.phase || previous.scrollCount !== p.exploration.scrollCount) result.progress.push(p.exploration);
      }
    });
    Object.assign(result, outcome, { status: outcome.verification === 'VERIFIED' ? 'PASS' : 'SENT' });
    console.log('STEP', JSON.stringify({ action: action.type, target: action.target, status: result.status, elapsedMs: result.elapsedMs, postcondition: result.postcondition, exploration: result.exploration }));
    return outcome;
  } catch (error) {
    Object.assign(result, { status: 'FAIL', errorCode: error.code, error: error.message, exploration: error.exploration, elapsedMs: Math.round(performance.now() - started) }); throw error;
  }
}
async function observe(target) {
  const start = performance.now(), s = await context.observe(signal);
  const goal = explorationGoal(target), region = detectScrollRegion(s, goal);
  const evidence = region.status === 'FOUND' ? discoveryCandidates(s, region.region, goal) : undefined;
  const record = { snapshotId: s.snapshotId, package: s.foregroundPackage, screen: s.screen, nodeCount: s.nodes.length,
    readElapsedMs: Math.round(performance.now() - start), regionStatus: region.status, reason: region.reason,
    region: region.status === 'FOUND' ? { className: region.region.node.className, resourceId: region.region.node.resourceId, bounds: region.region.bounds } : undefined,
    candidateStatus: evidence?.status, candidateCount: evidence?.candidates.length, candidateReason: evidence?.reason,
    currentMatch: matchUiTarget(s, target, true).status };
  report.observations.push(record); console.log('OBSERVATION', JSON.stringify(record));
  if ((inspect && currentOnly || diagnose) && app === 'youtube' && s.foregroundPackage === 'com.google.android.youtube') {
    console.log('PLAYER_EVIDENCE', JSON.stringify(s.nodes.filter(n => /:id\/(title|video_title|modern_title|player_view|player_container|watch_player|player_overlay|video_metadata|subscribe_button)$/.test(n.resourceId))
      .map(n => ({ id: n.resourceId, text: n.text, className: n.className, description: n.description.slice(0, 250), bounds: n.bounds }))));
    console.log('PLAYER_ROLE_IDS', JSON.stringify([...new Set(s.nodes.filter(n => /player|title|metadata|watch/.test(n.resourceId)).map(n => n.resourceId))].slice(0, 40)));
    console.log('INPUT_EVIDENCE', JSON.stringify(s.nodes.filter(n => /EditText|AutoCompleteTextView/.test(n.className)).map(n => ({ id: n.resourceId, className: n.className, focused: n.focused, enabled: n.enabled, displayed: n.displayed, bounds: n.bounds }))));
    console.log('WATCH_TITLE_AD_EVIDENCE', JSON.stringify(s.nodes.filter(n => /modern_title|horizontal_title_row|title_container|:id\/ad_|:id\/.*ad_progress/.test(n.resourceId) || /podcast|ielts|what's up/i.test(n.text))
      .map(n => ({ id: n.resourceId, text: n.text.slice(0, 250), description: n.description.slice(0, 250), bounds: n.bounds })).slice(0, 16)));
    const metadata = s.nodes.find(n => n.resourceId.endsWith(':id/video_metadata_layout'));
    if (metadata) console.log('WATCH_METADATA_EVIDENCE', JSON.stringify(s.nodes.filter(n => isDescendant(s.nodes, n, metadata) && (n.text || n.description))
      .map(n => ({ id: n.resourceId, text: n.text.slice(0, 350), description: n.description.slice(0, 350) })).slice(0, 12)));
  }
  if ((inspect || diagnose) && app === 'youtube' && s.foregroundPackage === 'com.google.android.youtube' && s.nodes.some(n => n.resourceId.endsWith('/search_query') && n.text.toLowerCase() === 'podcast tiếng anh')) {
    console.log('PUBLIC_SEARCH_CARDS', JSON.stringify(s.nodes.filter(n => n.clickable && /phát video|play video|short|tài trợ/i.test(n.description)).map(n => ({ description: n.description, className: n.className, bounds: n.bounds, parentIndex: n.parentIndex })).slice(0, 8)));
  }
  return s;
}
(async () => {
  context = await createExecutionContext(serial, currentOnly ? [] : [{ type: 'OPEN_APP', app }], runAdb, signal);
  if (currentOnly) { await observe('video_card_2'); return; }
  await step({ type: 'OPEN_APP', app });
  if (app === 'youtube') {
    await step({ type: 'WAIT_FOR', target: 'search_button', timeoutMs: 20000 });
    await step({ type: 'CLICK', target: 'search_button' });
    await step({ type: 'INPUT_TEXT', text: 'podcast tiếng anh' });
    await step({ type: 'PRESS_KEY', key: 'ENTER' });
    await step({ type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 });
    await observe('video_card_2');
    if (inspect) { report.goal = 'NOT TESTED'; return; }
    const result = await step({ type: 'CLICK', target: 'video_card_2' });
    report.goal = result.verification === 'VERIFIED' ? 'PASS' : 'BLOCKED';
    if (diagnose) await observe('video_card_2');
  } else if (app === 'chrome') {
    await step({ type: 'CLICK', target: 'address_bar' });
    await step({ type: 'INPUT_TEXT', text: 'công thức nấu phở' });
    await step({ type: 'PRESS_KEY', key: 'ENTER' });
    await observe('result_3');
    if (inspect) { report.goal = 'NOT TESTED'; return; }
    const result = await step({ type: 'CLICK', target: 'result_3' });
    report.goal = result.verification === 'VERIFIED' && result.exploration?.scrollCount > 1 ? 'PASS' : 'BLOCKED';
  } else {
    // Return from any previously open Settings detail to its main list, without changing settings.
    let s = await context.observe(signal);
    for (let i = 0; i < 3 && s.foregroundPackage === 'com.android.settings' && !s.nodes.some(n => n.text === 'Kết nối'); i++) {
      await step({ type: 'PRESS_KEY', key: 'BACK' }); s = await context.observe(signal);
    }
    const initial = await observe('text:Thông tin điện thoại');
    if (initial.foregroundPackage !== 'com.android.settings') { report.goal = 'BLOCKED'; report.reason = 'Main Settings list was not verified'; return; }
    if (inspect) { report.goal = 'NOT TESTED'; return; }
    const result = await step({ type: 'WAIT_FOR', target: 'text:Thông tin điện thoại', timeoutMs: 30000 });
    report.goal = result.verification === 'VERIFIED' && result.exploration?.scrollCount > 0 ? 'PASS' : 'BLOCKED';
    report.reason = result.exploration?.scrollCount ? 'Offscreen Settings item found by observed region scrolling; no settings changed.' : 'Target was already visible, so offscreen discovery was not proven.';
  }
})().catch(async error => {
  report.goal = ['AMBIGUOUS', 'UNKNOWN', 'NOT_FOUND', 'SCROLL_LIMIT_REACHED'].includes(error.code) ? 'BLOCKED' : 'FAIL';
  report.error = { code: error.code, message: error.message }; console.error('TEST_FAILURE', JSON.stringify(report.error)); process.exitCode = 1;
  if (diagnose && context) {
    try { await observe(app === 'chrome' ? 'result_3' : app === 'settings' ? 'text:Thông tin điện thoại' : 'video_card_2'); } catch (inspection) { console.error('DIAGNOSTIC_FAILURE', inspection.code, inspection.message); }
  }
}).finally(async () => {
  try { await context?.close(); report.cleanup = context ? 'PASS' : 'NOT TESTED'; }
  catch (error) { report.cleanup = 'FAIL'; report.cleanupError = error.message; process.exitCode = 1; }
  report.finished = new Date().toISOString();
  const reportPath = path.join(os.tmpdir(), `phone-commander-exploration-${app}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log('REPORT', reportPath);
  if (report.goal === 'BLOCKED' && !process.exitCode) process.exitCode = 2;
});
