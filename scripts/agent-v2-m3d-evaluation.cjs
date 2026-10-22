/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), ts = require('typescript');
const { spawn, execFile } = require('node:child_process');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { proposePrimitiveDecomposition } = require('../lib/android/agent/primitive-decomposition.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const args = process.argv.slice(2), opt = key => args[args.indexOf(key) + 1], device = opt('--device'), phase = opt('--phase');
process.env.OLLAMA_MODEL = 'qwen2.5:3b-instruct';
function digest() { return crypto.createHash('sha256').update(fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex'); }
const state = async () => (await fetch('http://127.0.0.1:3000/api/agent/runtime')).json();
const memory = () => new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', '[long]((Get-Process -ErrorAction SilentlyContinue|Where-Object {$_.ProcessName -match "^(ollama|llama)"}|Measure-Object WorkingSet64 -Sum).Sum)'], { windowsHide: true }, (e, out) => resolve(e ? undefined : Number(out.trim()))));
async function main() {
  if (!device || !['baseline', 'after'].includes(phase)) throw Error('Explicit --device and --phase required');
  let tasks = args.includes('--tasks') ? JSON.parse(fs.readFileSync(opt('--tasks'), 'utf8')) : [
    { id: 'myfiles', goal: 'Mo com.sec.android.app.myfiles va tim fieldwork-notes-2026-zqx' },
    { id: 'maps', goal: 'Xin ghe com.google.android.apps.maps roi do "public libraries"', approval: 'OPEN_APP: com.google.android.apps.maps; SEARCH: "public libraries"' },
    { id: 'play', goal: 'Xin ghe com.android.vending roi do "ocean sounds"', approval: 'OPEN_APP: com.android.vending; SEARCH: "ocean sounds"' },
  ];
  if (args.includes('--full')) tasks = [tasks[0], { ...tasks[0], id: 'myfiles-repeat-2' }, { ...tasks[0], id: 'myfiles-repeat-3' },
    { id: 'myfiles-positive', goal: 'Mo com.sec.android.app.myfiles va tim 20261019_154525.jpg', oracle: { uri: 'content://media/external/images/media/2248', name: '20261019_154525.jpg' } }, ...tasks.slice(1),
    { id: 'photos', goal: 'Xin truy cap com.google.android.apps.photos va loc "20261019_154525.jpg"', approval: 'OPEN_APP: com.google.android.apps.photos; SEARCH: "20261019_154525.jpg"', stopOnUserAction: true }];
  if (args.includes('--coccoc')) tasks = [{ id: 'coccoc', goal: 'Xin ghe com.coccoc.trinhduyet roi do "marine biology talks"', approval: 'OPEN_APP: com.coccoc.trinhduyet; SEARCH: "marine biology talks"', stopOnUserAction: true }];
  const frozen = digest(), rows = [], output = path.join(os.tmpdir(), 'agent-v2-m3d-' + phase + '-' + frozen.slice(0, 12) + '-' + Date.now() + '.json');
  for (const task of tasks) {
    const s = await state(); if (s.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status))) throw Error('Runtime busy');
    const ready = (await runAdb(['-s', device, 'shell', 'dumpsys', 'window', 'policy'])).stdout;
    if (!/mIsShowing=false/.test(ready) || !/SCREEN_STATE_ON/.test(ready)) throw Error('Unlock phone; attempt not started');
    const samples = []; let sampling = false;
    const sample = async () => { if (sampling) return; sampling = true; try { samples.push(await memory()); } finally { sampling = false; } };
    await sample(); const timer = setInterval(sample, 3000), warmBudget = new AgentBudget();
    let exitCode, warmError;
    try {
      if (compileOutcomes(task.goal, device, 'warm-only').coverage !== 'COMPLETE') {
        try {
          // Exact production reasoner, schema, prompt, model, options and keep_alive.
          await proposePrimitiveDecomposition(task.goal, new OllamaAgentReasoner(fetch, true), warmBudget, undefined,
            { apps: await new AppCatalog(device, runAdb).inventory() });
        } catch (e) { warmError = e.message; }
      }
      exitCode = await new Promise((resolve, reject) => {
        const argv = ['scripts/agent-v2-acceptance.cjs', '--run', '--device', device, '--goal', task.goal, '--owner-authorized-test', ...(task.stopOnUserAction ? ['--stop-on-user-action'] : []), ...(task.approval ? ['--approved-interpretation', task.approval] : [])];
        const child = spawn(process.execPath, argv, { windowsHide: true, stdio: 'inherit' }); child.once('error', reject); child.once('exit', resolve);
      });
    } finally { clearInterval(timer); }
    const end = await state(), t = end.tasks.filter(t => t.request === task.goal).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!t) throw Error('Missing execution');
    const shot = await fetch('http://127.0.0.1:3000/api/devices/' + encodeURIComponent(device) + '/screenshot?width=720');
    const screenshot = path.join(os.tmpdir(), 'm3d-' + phase + '-' + task.id + '-' + t.executionId + '.jpg');
    if (shot.ok) fs.writeFileSync(screenshot, Buffer.from(await shot.arrayBuffer()));
    const calls = t.latest?.reasoningMeasurements ?? [];
    let nativeEvidence, nativeError;
    const adapter = androidV2Adapter(device, new AgentBudget());
    let evidenceSession;
    try {
      if (await adapter.readiness() === 'READY') {
        const app = await adapter.catalog.resolve(t.latest?.v2?.graph.nodes.find(n => n.packageName)?.packageName, 'LAUNCH');
        if (app.app) { evidenceSession = await adapter.open([app.app]); nativeEvidence = await evidenceSession.observe(); }
      }
    } catch (e) { nativeError = e.message; } finally { await evidenceSession?.close(); }
    rows.push({ ...task, exitCode, executionId: t.executionId, status: t.status, reason: t.latest?.reason, latest: t.latest, events: t.events,
      nativeEvidence, nativeError,
      screenshot: shot.ok ? screenshot : undefined, warm: warmBudget.summary(), warmError,
      warmAssertion: calls.length ? !warmError && warmBudget.reasoningMeasurements.length > 0 && calls[0].loadMs !== undefined && calls[0].loadMs < 1000 : 'NO_REAL_INFERENCE',
      ollamaWorkingSetPeakBytes: Math.max(0, ...samples.filter(Number.isFinite)) });
    fs.writeFileSync(output, JSON.stringify({ classification: 'REAL_ANDROID', phase, runtimeSha256: frozen, unchanged: frozen === digest(), device, rows }, null, 2));
    console.log(JSON.stringify({ id: task.id, status: t.status, reason: t.latest?.reason, warmAssertion: rows.at(-1).warmAssertion, output, screenshot }));
    if (digest() !== frozen) throw Error('Source changed during evaluation');
    if (end.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status)) || end.ownerTestModes.length) throw Error('Cleanup incomplete');
    if (t.events.some(e => /Unlock the selected phone/.test(e.reason ?? ''))) throw Error('Locked attempt excluded; unlock before retry');
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
