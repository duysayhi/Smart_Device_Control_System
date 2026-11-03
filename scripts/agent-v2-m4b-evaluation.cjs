/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), ts = require('typescript'), { spawn } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts'), { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts'), { AgentBudget } = require('../lib/android/agent/budget.ts');
const { proposePrimitiveDecomposition } = require('../lib/android/agent/primitive-decomposition.ts'), { OllamaAgentReasoner } = require('../lib/android/agent/ollama.ts');
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
const argv = process.argv.slice(2), opt = k => argv[argv.indexOf(k) + 1], device = opt('--device'), mode = opt('--mode');
const base = 'http://127.0.0.1:3000', active = t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status);
const state = async () => { const r = await fetch(base + '/api/agent/runtime', { signal: AbortSignal.timeout(25000) }); if (!r.ok) throw Error('Runtime unavailable'); return r.json(); };
const hash = () => crypto.createHash('sha256').update(fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
const child = args => new Promise((resolve, reject) => { const c = spawn(process.execPath, args, { windowsHide: true, stdio: 'inherit' }); c.once('error', reject); c.once('exit', resolve); });
async function main() {
  if (!device || !['intents', 'baseline', 'after', 'equivalence'].includes(mode) || !argv.includes('--run')) throw Error('Explicit --run --device --mode required');
  const before = await state(); if (before.tasks.some(active) || before.ownerTestModes.length) throw Error('Runtime not idle / owner modes not zero');
  const frozen = hash(), output = path.join(os.tmpdir(), 'agent-v2-m4b-' + mode + '-' + Date.now() + '.json'), report = { label: 'REAL_ANDROID', mode, device, runtimeSha256: frozen, rows: [] };
  const save = () => { report.unchanged = hash() === frozen; fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
  const readiness = async () => { const a = androidV2Adapter(device, new AgentBudget()); if (await a.readiness() !== 'READY') throw Error('Unlock phone; no attempt counted'); };
  const myfiles = { id: 'myfiles', goal: 'Mo com.sec.android.app.myfiles va tim fieldwork-notes-2026-zqx' };
  const drive = { id: 'drive', goal: 'Xin truy cap com.google.android.apps.docs va loc "coastal research archive"', approval: 'OPEN_APP: com.google.android.apps.docs; SEARCH: "coastal research archive"', warm: true };
  let tasks = [myfiles, drive];
  if (mode === 'intents') tasks = [
    { id: 'open-app', goal: 'open app com.sec.android.app.myfiles', approval: 'OPEN_APP: com.sec.android.app.myfiles' },
    { id: 'url', goal: 'open url "https://example.com"', approval: 'OPEN_URL: https://example.com' },
    { id: 'dial', goal: 'open dialer 5550100', approval: 'OPEN_DIALER: 5550100' },
    { id: 'settings', goal: 'open settings android.settings.SETTINGS', approval: 'OPEN_SETTINGS: android.settings.SETTINGS' },
    ...['wifi', 'battery', 'media_volume', 'ring_volume', 'brightness'].map(s => ({ id: 'state-' + s, goal: 'read ' + s, approval: 'READ_STATE: ' + s })),
    { id: 'sms', goal: 'compose sms 5550100 "Phone Commander draft only"', approval: 'COMPOSE_SMS: 5550100 | Phone Commander draft only' },
  ];
  if (argv.includes('--only')) tasks = tasks.filter(t => opt('--only').split(',').includes(t.id));
  try {
    if (mode === 'equivalence') {
      for (const pkg of ['com.sec.android.app.myfiles', 'com.google.android.apps.docs']) {
        await readiness(); const budget = new AgentBudget(), adapter = androidV2Adapter(device, budget), app = await adapter.catalog.resolve(pkg, 'LAUNCH');
        if (!app.app) throw Error('App not proven');
        const e = await adapter.open([app.app]);
        try {
          await e.execute({ type: 'OPEN_APP', app: pkg }); const snapshots = [];
          for (const timeout of [1000, 500, 1000, 500]) {
            const r = await fetch('http://127.0.0.1:4723/session/' + e.sessionId() + '/appium/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { waitForIdleTimeout: timeout } }) });
            if (!r.ok) throw Error('Appium settings refused');
            const start = performance.now(), snapshot = await e.observe(); snapshots.push({ timeout, elapsedMs: performance.now() - start, snapshot });
          }
          const canonical = s => JSON.stringify({ activity: s.activity, foregroundPackage: s.foregroundPackage, viewport: s.viewport, nodes: s.nodes });
          report.rows.push({ pkg, snapshots, equivalentAllNativeAttributes: snapshots.every(s => canonical(s.snapshot) === canonical(snapshots[0].snapshot)), profile: budget.summary() });
        } finally { await e.close(); }
        save();
      }
      return;
    }
    for (const task of tasks) {
      if (hash() !== frozen) throw Error('Source changed'); await readiness();
      const s = await state(); if (s.tasks.some(active)) throw Error('Runtime busy');
      const warm = new AgentBudget(); let warmError;
      if (task.warm) try { await proposePrimitiveDecomposition(task.goal, new OllamaAgentReasoner(fetch, true, { model: 'qwen2.5:3b-instruct' }), warm, undefined, { apps: await new AppCatalog(device, runAdb).inventory() }); } catch (e) { warmError = e.message; }
      const began = Date.now();
      const exitCode = await child(['scripts/agent-v2-acceptance.cjs', '--run', '--device', device, '--goal', task.goal, '--owner-authorized-test', '--stop-on-user-action', ...(task.approval ? ['--approved-interpretation', task.approval] : [])]);
      const end = await state(), t = end.tasks.filter(t => t.request === task.goal && t.createdAt >= began).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!t) throw Error('Missing new execution for ' + task.id);
      const shot = await fetch(base + '/api/devices/' + encodeURIComponent(device) + '/screenshot?width=720', { signal: AbortSignal.timeout(15000) });
      const screenshot = path.join(os.tmpdir(), 'm4b-' + mode + '-' + task.id + '-' + t.executionId + '.jpg');
      if (shot.ok) fs.writeFileSync(screenshot, Buffer.from(await shot.arrayBuffer()));
      let nativeEvidence, nativeError, e;
      if (task.id !== 'sms') try {
        const adapter = androidV2Adapter(device, new AgentBudget());
        if (await adapter.readiness() !== 'READY') throw Error('Readback locked');
        const pkg = t.latest?.v2?.graph.nodes.find(n => n.packageName)?.packageName;
        if (pkg) { const app = await adapter.catalog.resolve(pkg, 'LAUNCH'); if (app.app) { e = await adapter.open([app.app]); nativeEvidence = await e.observe(); } }
      } catch (error) { nativeError = error.message; } finally { await e?.close(); }
      let ownedSessionClosed;
      const sessionId = t.latest?.v2?.sessionId;
      if (sessionId) { const probe = await fetch('http://127.0.0.1:4723/session/' + sessionId + '/timeouts'); const value = await probe.json(); ownedSessionClosed = value.value?.error === 'invalid session id'; }
      report.rows.push({ ...task, exitCode, executionId: t.executionId, status: t.status, reason: t.latest?.reason, latest: t.latest, nativeEvidence, nativeError, screenshot: shot.ok ? screenshot : undefined, ownedSessionClosed, warm: warm.summary(), warmError });
      save(); console.log(JSON.stringify({ id: task.id, status: t.status, reason: t.latest?.reason, output, ownedSessionClosed }));
      if (end.tasks.some(active) || end.ownerTestModes.length) throw Error('Cleanup incomplete');
    }
  } finally {
    const end = await state(); report.finalActiveTasks = end.tasks.filter(active).length; report.finalOwnerModes = end.ownerTestModes.length; save(); console.log(output);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
