/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript');
const http = require('node:http'), { randomBytes } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { createExecutionContext, assertNonSensitivePlan } = require('../lib/android/condition-executor.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { visualReviewHtml } = require('../lib/android/visual-review.ts');
const serial = process.argv[2];
if (!serial || !/^[A-Za-z0-9._:-]+$/.test(serial)) { console.error('Opt-in: node.exe tests/visual-grounding.integration.cjs SERIAL [--review]'); process.exit(2); }
const plan = { intent: 'search_podcast_second', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'youtube' },
  { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 30000 }, { type: 'CLICK', target: 'search_button' },
  { type: 'INPUT_TEXT', text: 'podcast tiếng Anh' }, { type: 'PRESS_KEY', key: 'ENTER' },
  { type: 'WAIT_FOR', target: 'video_list', timeoutMs: 20000 }, { type: 'CLICK', target: 'video_card_2' }] };
let context;
const cancel = new AbortController(), signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(300000)]);
process.once('SIGINT', () => cancel.abort());
const report = { mode: 'REAL_DEVICE', outcome: 'NOT_TESTED', started: new Date().toISOString(), steps: [] };
const folder = path.join(os.tmpdir(), `phone-commander-m26-${Date.now()}`);
function saveEvidence(evidence) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'target.png'), Buffer.from(evidence.image.dataUrl.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(folder, 'review.html'), visualReviewHtml(evidence, 'offline-review'));
  fs.writeFileSync(path.join(folder, 'evidence.json'), JSON.stringify({ ...evidence, image: { ...evidence.image, dataUrl: '[local target.png]' } }, null, 2));
  console.log('EVIDENCE', folder);
}
async function review(evidence) {
  const token = randomBytes(24).toString('hex'), nonce = randomBytes(18).toString('base64');
  const prefix = '/' + token + '/';
  let origin, used = false, finish, timer;
  const finished = new Promise(resolve => { finish = resolve; });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'`);
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
    if (req.url === prefix && req.method === 'GET') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(visualReviewHtml(evidence, nonce)); return; }
    if (req.url !== prefix + 'decision' || req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' || used) { res.writeHead(403).end(); return; }
    let body = ''; req.setEncoding('utf8');
    try {
      for await (const chunk of req) { body += chunk; if (body.length > 2048) throw Error('Body too large'); }
      const choice = JSON.parse(body);
      if (choice.evidenceId !== evidence.id) throw Error('Evidence mismatch');
      used = true;
      if (choice.cancel === true) { report.outcome = 'CANCELLED'; cancel.abort(); }
      else {
        if (choice.confirmed !== true || !Number.isFinite(choice.x) || !Number.isFinite(choice.y)) throw Error('Invalid confirmation');
        report.decision = { ...choice, source: 'EXPLICIT_USER_REVIEW' };
        if (process.argv.includes('--preview')) report.outcome = 'UI_QA_ONLY_NO_DEVICE_ACTION';
        else {
          report.result = await context.confirmVisualTap(choice, plan, signal);
          report.outcome = report.result.verification === 'VERIFIED' ? 'PASS_HUMAN_ASSISTED' : 'SENT';
        }
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: report.outcome, message: report.result?.postcondition ??
        (report.outcome === 'UI_QA_ONLY_NO_DEVICE_ACTION' ? 'QA hoàn tất, không thao tác điện thoại.' : 'Đã hủy, không gửi nhấn.') }));
    } catch (error) {
      report.outcome = ['TIMEOUT', 'DEVICE_ERROR', 'SESSION_ERROR', 'BACKEND_ERROR'].includes(error.code) ? 'FAIL' : 'BLOCKED'; report.reviewError = { code: error.code, message: error.message };
      res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: error.message }));
    } finally { finish(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log('REVIEW_URL', origin + prefix);
  const abort = () => finish(); signal.addEventListener('abort', abort, { once: true });
  timer = setTimeout(finish, Math.max(0, evidence.expiresAt - Date.now()));
  try { await finished; } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    // Let the final response flush before removing connections.
    const drain = setTimeout(() => server.closeAllConnections(), 2000);
    await new Promise(resolve => server.close(resolve)); clearTimeout(drain);
  }
}
(async () => {
  if (process.argv.includes('--preview')) {
    report.mode = 'UI_QA_NO_DEVICE';
    const source = process.argv[process.argv.indexOf('--preview') + 1];
    const evidence = JSON.parse(fs.readFileSync(path.join(source, 'evidence.json'), 'utf8'));
    evidence.image.dataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(source, 'target.png')).toString('base64');
    evidence.selectedTitle = 'UI QA (không thao tác điện thoại): ' + evidence.selectedTitle;
    evidence.expiresAt = Date.now() + 120000;
    await review(evidence); return;
  }
  assertNonSensitivePlan(plan);
  context = await createExecutionContext(serial, plan.actions, runAdb, signal);
  for (const action of plan.actions) {
    try {
      const result = await context.execute(action, signal);
      report.steps.push({ action, ...result }); console.log('STEP', action.type, result.verification, result.elapsedMs);
    } catch (error) {
      report.error = { code: error.code, message: error.message, visualFailure: error.visualFailure };
      report.outcome = ['TIMEOUT', 'DEVICE_ERROR', 'SESSION_ERROR', 'BACKEND_ERROR'].includes(error.code) ? 'FAIL' : 'BLOCKED';
      if (error.visual) {
        report.visual = { id: error.visual.id, status: error.visual.status, coherent: error.visual.coherent, capturedSpanMs: error.visual.capturedSpanMs };
        saveEvidence(error.visual);
        if (process.argv.includes('--review') && error.visual.status === 'HUMAN_REQUIRED') await review(error.visual);
      }
      else console.error('NO_VISUAL_EVIDENCE', JSON.stringify(report.error));
      return;
    }
  }
  report.outcome = 'PASS_NATIVE';
})().catch(error => { report.outcome = 'FAIL'; report.error = { code: error.code, message: error.message }; process.exitCode = 1; })
.finally(async () => {
  try { await context?.close(); report.cleanup = 'PASS'; } catch (error) { report.cleanup = 'FAIL'; report.cleanupError = error.message; process.exitCode = 1; }
  if (report.cleanup !== 'FAIL') {
    if (report.outcome === 'FAIL') process.exitCode = 1;
    else if (['BLOCKED', 'SENT', 'NOT_TESTED'].includes(report.outcome)) process.exitCode = 2;
  }
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log('REPORT', path.join(folder, 'report.json'), report.outcome, report.cleanup);
});
