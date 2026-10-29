/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const { androidRuntimeDigest, runtimeDirectory } = require('../lib/android/agent/runtime-storage.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const base = 'http://127.0.0.1:3000', deviceId = 'R58MA78W6QK';
const active = t => !t.finishedAt && ['RUNNING', 'QUEUED', 'WAITING_HUMAN'].includes(t.status);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function api(route, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(route + ' HTTP ' + response.status);
  return response.json();
}
async function main() {
  if (!process.argv.includes('--approved-m7a-usb')) throw Error('Explicit acceptance scope required.');
  if (process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct' || ![undefined, 'ollama'].includes(process.env.AGENT_STRUCTURED_PROVIDER) || process.env.AGENT_CLOUD_REASONING_ENABLED === 'true' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true') throw Error('Local/cloud-off configuration mismatch.');
  const initial = await api('/api/agent/runtime');
  if (initial.tasks.some(active) || initial.ownerTestModes.length || initial.reasoning.running || initial.reasoning.waiting || await readDeviceOwnership(deviceId, runAdb)) throw Error('Runtime not idle; nothing interrupted.');
  const frozen = androidRuntimeDigest();
  const worker = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(), 'address.json'), 'utf8'));
  if (!frozen || worker.runtimeSha256 !== frozen) throw Error('Current worker/source mismatch.');
  const identity = await readTransportIdentity(runAdb, deviceId, true);
  if (identity?.hardwareSerial !== deviceId) throw Error('Exact USB identity unavailable.');
  const readiness = async () => deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout);
  if (await readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no task counted.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m7a-acceptance-'));
  const report = { startedAt: new Date().toISOString(), directory, deviceId, physicalId: identity.physicalId, runtimeSha256: frozen, path: 'Real Unified Dashboard browser; observer never ANALYZE/EXECUTE/ASSISTs tasks', cases: [], lifecycle: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
  let owner, current, timer, polling = false, lastStatus, stopping = false;
  const known = new Set((await api('/api/unified-agent')).executions.map(e => e.id));
  const audit = async (row, phase) => {
    const target = row[phase] = { at: Date.now(), adbCount: 0 };
    const png = execFileSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 15000, maxBuffer: 12 * 1024 * 1024 }); target.adbCount++;
    target.screenshot = path.join(directory, row.id + '-' + phase + '.png'); fs.writeFileSync(target.screenshot, png);
    const policy = await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'], 5000); target.adbCount++;
    target.readiness = deviceReadiness(policy.stdout);
    const xml = await runAdb(['-s', deviceId, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 20000); target.adbCount++;
    target.native = path.join(directory, row.id + '-' + phase + '.xml'); fs.writeFileSync(target.native, xml.stdout);
    if (row.id === '4') {
      const media = await runAdb(['-s', deviceId, 'shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id:_display_name:date_added:date_modified:_size:owner_package_name', '--sort', '_id'], 15000); target.adbCount++;
      target.media = path.join(directory, row.id + '-' + phase + '-media.txt'); fs.writeFileSync(target.media, media.stdout); target.mediaExitCode = media.exitCode;
    }
  };
  const poll = async () => {
    if (polling || !current) return;
    polling = true;
    try {
      if (androidRuntimeDigest() !== frozen) throw Error('RUNTIME_SOURCE_CHANGED');
      const entries = (await api('/api/unified-agent')).executions;
      const execution = entries.find(e => e.id === current.execution?.id) ?? entries.find(e => !known.has(e.id) && e.plan.source === current.source && e.plan.deviceId === deviceId);
      if (execution) {
        if (!current.execution) { current.firstSeenAt = Date.now(); known.add(execution.id); }
        current.execution = execution;
        const signature = JSON.stringify([execution.status, execution.reason, execution.task?.latest?.reason, execution.task?.latest?.v2?.assistance]);
        if (signature !== lastStatus) {
          lastStatus = signature; current.transitions.push({ at: Date.now(), execution });
          console.log(JSON.stringify({ id: current.id, engine: execution.plan.engine, status: execution.status, reason: execution.reason, assistance: execution.task?.latest?.v2?.assistance, sessionId: execution.task?.latest?.v2?.sessionId }));
        }
      }
      save();
    } catch (error) { report.pollErrors ??= []; report.pollErrors.push({ at: Date.now(), error: error.message }); save(); if (error.message === 'RUNTIME_SOURCE_CHANGED') { stopping = true; input.close(); } }
    finally { polling = false; }
  };
  let input;
  try {
    await api('/api/agent/runtime', { type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: true, fullControl: true, rollbackOnFailure: true });
    owner = (await api('/api/agent/runtime')).ownerTestModes.find(m => m.deviceId === deviceId && m.fullControl);
    if (!owner) throw Error('Scoped full-control not enabled.');
    report.owner = owner; save(); console.log(JSON.stringify({ ready: true, directory, frozen, ownerExpiresAt: owner.expiresAt }));
    timer = setInterval(() => void poll(), 1000);
    input = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of input) {
      if (!line.trim()) continue;
      let command;
      try { command = JSON.parse(line); } catch { console.log('JSON_COMMAND_REQUIRED'); continue; }
      if (command.type === 'FINISH') { stopping = true; break; }
      try {
        while (polling) await pause(50);
        if (command.type === 'BEGIN') {
          if (current) throw Error('END current case first.');
          if (androidRuntimeDigest() !== frozen) throw Error('RUNTIME_SOURCE_CHANGED');
          if ((await api('/api/agent/runtime')).tasks.some(active)) throw Error('Runtime busy.');
          if (await readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: next task not counted.');
          current = { id: command.id, source: command.source, beginAt: Date.now(), transitions: [], marks: [] }; lastStatus = undefined;
          report.cases.push(current); await audit(current, 'before'); save();
          console.log(JSON.stringify({ begun: current.id, readiness: current.before.readiness }));
        } else if (command.type === 'MARK') {
          if (!current) throw Error('No current case.');
          current.marks.push({ ...command, observedAt: Date.now() }); save(); console.log(JSON.stringify({ marked: command.name, id: current.id }));
        } else if (command.type === 'POLL') { await poll(); console.log(JSON.stringify({ id: current?.id, status: current?.execution?.status ?? 'NO_EXECUTION', reason: current?.execution?.reason }));
        } else if (command.type === 'END') {
          await poll();
          if (!current) throw Error('No current case.');
          const state = await api('/api/agent/runtime');
          if (state.tasks.some(active) || await readDeviceOwnership(deviceId, runAdb)) throw Error('Task/session still active: END refused.');
          await audit(current, 'after');
          current.runtimeSha256After = androidRuntimeDigest(); current.runtimeUnchanged = frozen === current.runtimeSha256After;
          current.endAt = Date.now(); current.cleanup = { activeTasks: state.tasks.filter(active).length, ownership: null };
          current.notes = command.notes; save(); console.log(JSON.stringify({ ended: current.id, status: current.execution?.status, runtimeUnchanged: current.runtimeUnchanged }));
          if (!current.runtimeUnchanged) throw Error('RUNTIME_SOURCE_CHANGED');
          current = undefined;
        }
      } catch (error) { console.log(JSON.stringify({ commandError: error.message })); if (error.message === 'RUNTIME_SOURCE_CHANGED') throw error; }
    }
  } catch (error) { report.error = error.message; }
  finally {
    input?.close(); process.stdin.pause();
    clearInterval(timer); while (polling) await pause(50);
    if (current?.execution && !current.execution.finishedAt) {
      try { await api('/api/unified-agent', { type: 'CANCEL', executionId: current.execution.id }); report.lifecycle.push('Cancelled own unfinished execution in finally.'); } catch (e) { report.lifecycle.push(e.message); }
    }
    const deadline = Date.now() + 60000;
    let end = await api('/api/agent/runtime');
    while (end.tasks.some(t => active(t) && report.cases.some(c => c.execution?.workerExecutionId === t.executionId)) && Date.now() < deadline) { await pause(500); end = await api('/api/agent/runtime'); }
    if (owner) await api('/api/agent/runtime', { type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: false, authorizationId: owner.id });
    end = await api('/api/agent/runtime');
    report.cleanup = { activeTasks: end.tasks.filter(active).length, ownerModes: end.ownerTestModes.length, ownership: await readDeviceOwnership(deviceId, runAdb) ?? null, runtimeSha256: androidRuntimeDigest(), explicitFinish: stopping, finishedAt: new Date().toISOString() };
    save(); console.log(JSON.stringify({ finished: true, directory, cleanup: report.cleanup, error: report.error }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
