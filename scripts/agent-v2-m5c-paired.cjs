/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), crypto = require('node:crypto'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const Module = require('node:module'), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve(request.slice(2)) : request, ...args); };
const { runAdb } = require('../lib/android/adb.ts'), { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const { androidRuntimeDigest } = require('../lib/android/agent/runtime-storage.ts'), { launcherCacheDirectory } = require('../lib/android/agent/launcher-label-cache.ts'), { readLauncherLabels } = require('../lib/android/agent/launcher-labels.ts');
const exec = promisify(execFile), args = process.argv.slice(2), opt = name => args[args.indexOf(name) + 1];
const active = t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status);
async function main() {
  if (!args.includes('--run') || !['--device', '--goal', '--approved-interpretation', '--manifest', '--condition'].every(a => args.includes(a))) throw Error('Explicit run/device/goal/exact prior approval/frozen manifest/cold-or-warm condition required.');
  const condition = opt('--condition'), deviceId = opt('--device'), goal = opt('--goal'), summary = opt('--approved-interpretation');
  if (!['cold', 'warm'].includes(condition) || !/^OPEN_APP: [^;]+; SEARCH: [^;]+$/.test(summary)) throw Error('Only explicitly approved two-step search measurement.');
  if (process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct' || (process.env.AGENT_STRUCTURED_PROVIDER ?? 'ollama') !== 'ollama' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true') throw Error('Keep local Qwen default and cloud off.');
  const manifest = JSON.parse(fs.readFileSync(opt('--manifest'), 'utf8')), frozen = androidRuntimeDigest();
  if (!frozen || manifest.runtimeSha256 !== frozen) throw Error('Frozen runtime changed; no task sent.');
  const base = 'http://127.0.0.1:3000', api = async body => {
    const r = await fetch(base + '/api/agent/runtime', { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw Error('Runtime HTTP ' + r.status); return r.json();
  };
  const before = await api(), device = before.devices.find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
  if (!device || before.tasks.some(active) || before.ownerTestModes.length) throw Error('Verified idle device and zero preexisting owner modes required.');
  if (deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'])).stdout) !== 'READY') throw Error('UNLOCK_REQUIRED: no counted task.');
  const file = path.join(os.tmpdir(), 'agent-v2-m5c-paired-' + condition + '-' + Date.now()), report = { label: 'REAL_ANDROID_DEVELOPMENT', condition, goal, approvedSummary: summary, runtimeBefore: frozen, preparation: [] };
  let mode;
  try {
    if (!(await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: device.physicalId, enabled: true })).accepted) throw Error('Owner mode refused.');
    mode = (await api()).ownerTestModes.find(m => m.deviceId === deviceId && m.physicalId === device.physicalId);
    if (!mode) throw Error('Owner authorization not observed.');
    const directory = launcherCacheDirectory();
    if (condition === 'cold') {
      let saved = { schema: 1, rows: [] };
      try { saved = JSON.parse(fs.readFileSync(path.join(directory, 'labels.json'), 'utf8')); } catch { /* Missing metadata is cold. */ }
      if (saved.schema !== 1 || !Array.isArray(saved.rows)) throw Error('Unexpected cache format; refuse to rewrite.');
      saved.rows = saved.rows.filter(r => r.physicalId !== device.physicalId);
      fs.mkdirSync(directory, { recursive: true });
      const temp = path.join(directory, 'measurement-' + crypto.randomUUID() + '.tmp'); fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temp, path.join(directory, 'labels.json'));
    }
    const inventory = (await runAdb(['-s', deviceId, 'shell', 'cmd', 'package', 'query-activities', '--brief', '--components', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER'])).stdout;
    const components = [...new Set(inventory.split(/\r?\n/).map(l => l.trim()).filter(l => /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(l)))];
    let available = await readLauncherLabels(deviceId, components, runAdb, undefined, { maxExtractions: 0, expectedPhysicalId: device.physicalId });
    if (condition === 'cold' && available.size) throw Error('Cold metadata not empty; do not count this as cold.');
    if (condition === 'warm') for (let i = 0; available.size < components.length && i < 4; i++) available = await readLauncherLabels(deviceId, components, runAdb, undefined, { expectedPhysicalId: device.physicalId, onTiming: row => report.preparation.push(row) });
    report.cacheBefore = { launcherEntries: components.length, cachedEntries: available.size, resolvedEntries: [...available.values()].filter(a => a.length).length };
    if (condition === 'warm' && available.size !== components.length) throw Error('Warm cache incomplete; no task measured.');
    if (deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'])).stdout) !== 'READY') throw Error('UNLOCK_REQUIRED before START: no counted task.');
    const wallAt = performance.now();
    let child;
    try { child = await exec(process.execPath, ['scripts/agent-v2-acceptance.cjs', '--run', '--device', deviceId, '--goal', goal, '--owner-authorized-test', '--approved-interpretation', summary, '--stop-on-user-action'], { windowsHide: true, encoding: 'utf8', maxBuffer: 3000000, timeout: 280000 }); report.childExit = 0; }
    catch (error) { report.childExit = error.code; child = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
    report.runnerWallMs = performance.now() - wallAt;
    fs.writeFileSync(file + '-runner.log', child.stdout + child.stderr);
    const completed = child.stdout.split(/\r?\n/).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }).find(r => r.output);
    if (completed?.output) report.execution = JSON.parse(fs.readFileSync(completed.output, 'utf8'));
    else report.runnerError = child.stderr || 'Runner did not write a terminal report.';
    const screenshot = await exec(process.env.ADB_PATH ?? 'adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], { windowsHide: true, encoding: 'buffer', maxBuffer: 20000000, timeout: 10000 });
    fs.writeFileSync(file + '.png', screenshot.stdout); report.screenshot = file + '.png';
    const native = (await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'activity', 'activities'])).stdout;
    report.nativeActivity = native.split(/\r?\n/).filter(l => /mResumedActivity|topResumedActivity/.test(l));
    report.manualScreenshotReview = 'PENDING';
  } catch (error) { report.error = error.message; }
  finally {
    if (mode) await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: device.physicalId, enabled: false, authorizationId: mode.id });
    const end = await api(); report.activeTasks = end.tasks.filter(active).length; report.ownerModes = end.ownerTestModes.length;
    report.runtimeAfter = androidRuntimeDigest(); report.freezeMatched = report.runtimeAfter === frozen;
    const session = report.execution?.sessionId;
    if (session) { const reply = await fetch('http://127.0.0.1:4723/session/' + session + '/timeouts', { signal: AbortSignal.timeout(10000) }); report.sessionProbe = { status: reply.status, error: (await reply.json()).value?.error }; }
    fs.writeFileSync(file + '.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ evidence: file + '.json', condition, status: report.execution?.status, childExit: report.childExit, error: report.error, cacheBefore: report.cacheBefore, timings: report.execution?.timings, activeTasks: report.activeTasks, ownerModes: report.ownerModes, freezeMatched: report.freezeMatched }));
  }
  if (report.error || report.childExit !== 0 || report.execution?.status !== 'COMPLETED' || !report.freezeMatched || report.activeTasks || report.ownerModes) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
