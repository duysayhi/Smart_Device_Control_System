/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts'), { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const { proposeIntentOutcomes } = require('../lib/android/agent/intent-capabilities.ts');
const { runtimeDirectory } = require('../lib/android/agent/runtime-storage.ts');
const base = 'http://127.0.0.1:3000', deviceId = process.argv[process.argv.indexOf('--device') + 1], active = t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status);
const digest = () => crypto.createHash('sha256').update(fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
async function api(body) { const r = await fetch(base + '/api/agent/runtime', { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: base }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(25000) }); if (!r.ok) throw Error('Runtime HTTP ' + r.status); return r.json(); }
async function main() {
  if (!process.argv.includes('--run-approved-settings') || !deviceId) throw Error('Explicit operator approval flag and --device required');
  const tasks = [
    ...[['wifi', 0], ['bluetooth', 1], ['brightness', 80], ['dnd', 0]].map(([s, v]) => ({ id: s, goal: `set ${s} ${v}` })),
    ...[['wifi', 0], ['bluetooth', 1], ['brightness', 80]].map(([s, v]) => ({ id: 'compound-' + s, goal: `open settings android.settings.SETTINGS; set ${s} ${v}; read ${s}` })),
    { id: 'delete-block', goal: 'open settings android.settings.SETTINGS then delete all photos', expectBlock: true },
    { id: 'overwrite-block', goal: 'overwrite existing user files', expectBlock: true },
  ];
  if (process.argv.includes('--replacement-dnd')) {
    const index = tasks.findIndex(t => t.id === 'compound-bluetooth');
    tasks[index] = { id: 'compound-dnd', goal: 'open settings android.settings.SETTINGS; set dnd 0; read dnd' };
    tasks.splice(tasks.findIndex(t => t.id === 'bluetooth'), 1);
  }
  if (process.argv.includes('--unsupported-only')) tasks.splice(0, tasks.length, ...['rotation', 'media_volume', 'ring_volume', 'flashlight', 'airplane'].map(s => ({ id: s, goal: `set ${s} 1`, expectBlock: true })));
  if (process.argv.includes('--only')) {
    const ids = process.argv[process.argv.indexOf('--only') + 1].split(',');
    for (let i = tasks.length - 1; i >= 0; i--) if (!ids.includes(tasks[i].id)) tasks.splice(i, 1);
  }
  const before = await api(); if (before.tasks.some(active) || before.ownerTestModes.length) throw Error('Idle runtime with zero owner modes required');
  const device = before.devices.find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified);
  if (!device?.physicalId) throw Error('Verified USB device required');
  const frozen = digest(), output = path.join(os.tmpdir(), 'agent-v2-m4d-' + Date.now() + '.json');
  const report = { label: 'REAL_ANDROID', deviceId, physicalId: device.physicalId, runtimeSha256: frozen, rows: [], invalidAttempts: [] };
  const save = () => { report.unchanged = frozen === digest(); fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
  for (const task of tasks) {
    if (digest() !== frozen) throw Error('Runtime changed during batch');
    const worker = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(), 'address.json'), 'utf8'));
    if (worker.runtimeSha256 !== frozen || !worker.features?.includes('full-control-test-mode')) throw Error('Worker source/features differ from frozen runtime; reload idle worker before acceptance');
    if (deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'])).stdout) !== 'READY') { report.invalidAttempts.push({ task: task.id, reason: 'DEVICE_LOCKED: no counted attempt or mutation' }); save(); throw Error('Unlock required; no attempt counted'); }
    let authorization, executionId, terminal = false, latest;
    const start = Date.now();
    try {
      if (!(await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: device.physicalId, enabled: true, fullControl: true, rollbackOnFailure: true })).accepted) throw Error('Full-control mode refused');
      authorization = (await api()).ownerTestModes.find(m => m.deviceId === deviceId && m.fullControl?.mode === 'FULL_CONTROL_TEST_MODE');
      if (!authorization) throw Error('Explicit full-control authorization missing');
      const r = await api({ type: 'START', requestId: crypto.randomUUID(), jobs: [{ deviceId, goal: task.goal, agentVersion: 2, ownerAuthorizedTest: true }] }); executionId = r.tasks[0].executionId;
      const expected = proposeIntentOutcomes(task.goal)?.outcomes.map(o => o.intent.request.name + ': ' + Object.values(o.intent.request.args).join(' | ')).join('; ');
      let approved;
      do {
        latest = (await api()).tasks.find(t => t.executionId === executionId); if (!latest) throw Error('Task disappeared');
        terminal = !active(latest); if (terminal) break;
        if (latest.status === 'WAITING_HUMAN') {
          const a = latest.latest?.v2?.assistance;
          if (a?.token !== approved) {
            if (expected && a?.category === 'GOAL_INTERPRETATION' && a.expiresAt > Date.now() && a.choices.length === 1 && a.choices[0].label === expected) {
              approved = a.token; await api({ type: 'ASSIST_V2', deviceId, executionId, token: a.token, approved: true, choice: a.choices[0].id });
            } else throw Error('Unexpected assistance/interpretation; no confirmation supplied');
          }
        }
        if (Date.now() - start > 180000) { (report.deadlines ??= []).push({ executionId, deadlineAt: start + 180000, observedAt: Date.now() }); throw Error('Acceptance deadline'); }
        await new Promise(r => setTimeout(r, 500));
      } while (!terminal);
    } finally {
      if (executionId && !terminal) {
        const checked = await require('./agent-v2-runner-lifecycle.cjs').cancelIfActive(api, executionId, deviceId, report.lifecycle ??= []);
        latest = checked.task; terminal = checked.terminal;
        const deadline = Date.now() + 35000;
        while (!terminal && Date.now() < deadline) { latest = (await api()).tasks.find(t => t.executionId === executionId); terminal = latest && !active(latest); if (!terminal) await new Promise(r => setTimeout(r, 500)); }
      }
      // Do not revoke the scope until bounded in-flight undo has finished.
      if (authorization) await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: device.physicalId, enabled: false, authorizationId: authorization.id });
      if (!terminal && authorization) { report.invalidAttempts.push({ task: task.id, reason: 'Cleanup did not settle; scope retained only for bounded rollback, inspect manually' }); save(); }
      save();
    }
    const shotAt = performance.now(), shot = await fetch(base + '/api/devices/' + encodeURIComponent(deviceId) + '/screenshot?width=720');
    const screenshot = path.join(os.tmpdir(), 'm4d-' + task.id + '-' + executionId + '.jpg'); if (shot.ok) fs.writeFileSync(screenshot, Buffer.from(await shot.arrayBuffer()));
    const audit = latest.latest?.v2?.mutations;
    const verdict = task.expectBlock ? latest.status === 'BLOCKED' && !audit?.records.length : latest.status === 'COMPLETED' && audit?.restored && audit.records.length > 0 && audit.records.every(r => r.verified && r.restoration === 'RESTORED');
    report.rows.push({ ...task, executionId, status: latest.status, reason: latest.latest?.reason, passed: Boolean(verdict), latest: latest.latest, elapsedMs: Date.now() - start, screenshot: shot.ok ? screenshot : undefined, screenshotMs: performance.now() - shotAt });
    const end = await api(); report.finalActiveTasks = end.tasks.filter(active).length; report.finalOwnerModes = end.ownerTestModes.length;
    save(); console.log(JSON.stringify({ id: task.id, executionId, status: latest.status, passed: Boolean(verdict), reason: latest.latest?.reason, output }));
    if (end.tasks.some(active) || end.ownerTestModes.length || digest() !== frozen) throw Error('Cleanup/source freeze failure');
    if (audit?.records.some(r => r.restoration === 'MANUAL_REQUIRED')) throw Error('Stop: restoration requires operator');
  }
  console.log(output);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
