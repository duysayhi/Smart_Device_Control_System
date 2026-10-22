/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { MediaStoreReader } = require('../lib/android/agent/media-evidence.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const { androidRuntimeDigest, runtimeDirectory } = require('../lib/android/agent/runtime-storage.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const base = 'http://127.0.0.1:3000', deviceId = 'R58MA78W6QK', request = 'Mở Camera và chụp 1 tấm ảnh';
const active = t => ['RUNNING', 'QUEUED', 'WAITING_HUMAN'].includes(t.status);
async function api(body) {
  const r = await fetch(base + '/api/agent/runtime', { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error('Dashboard runtime HTTP ' + r.status);
  return r.json();
}
async function main() {
  if (!process.argv.includes('--preflight') && !process.argv.includes('--run-approved-one-photo')) throw Error('Explicit preflight or one-photo approval flag required.');
  if (process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct' || ![undefined, 'ollama'].includes(process.env.AGENT_STRUCTURED_PROVIDER) || process.env.AGENT_CLOUD_REASONING_ENABLED === 'true' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true') throw Error('Required local model/cloud configuration differs; configuration was not changed.');
  const devices = (await runAdb(['devices', '-l'])).stdout;
  if (!new RegExp('^' + deviceId + '\\s+device\\b', 'm').test(devices)) throw Error('USB_DEVICE_REQUIRED: no attempt counted.');
  const identity = await readTransportIdentity(runAdb, deviceId, true);
  if (!identity || identity.hardwareSerial !== deviceId) throw Error('USB physical identity unverified.');
  const ready = deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'])).stdout);
  if (ready !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no attempt counted.');
  const status = await (await fetch('http://127.0.0.1:4723/status', { signal: AbortSignal.timeout(5000) })).json();
  const sessions = await (await fetch('http://127.0.0.1:4723/appium/sessions', { signal: AbortSignal.timeout(5000) })).json();
  if (!status.value?.ready || Array.isArray(sessions.value) && sessions.value.length) throw Error('Appium is unavailable or another Session exists; no Session was created.');
  if (await readDeviceOwnership(deviceId, runAdb)) throw Error('Device ownership exists; no Session was created.');
  const processes = (await runAdb(['-s', deviceId, 'shell', 'ps', '-A'])).stdout;
  if (/io\.appium\.uiautomator2\.server(?:\s|$)/m.test(processes)) throw Error('UiAutomator2 process already active; inspect before another Session.');
  const tags = await (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) })).json();
  if (!tags.models?.some(m => m.name === 'qwen2.5:3b-instruct')) throw Error('Required local Ollama model unavailable.');
  const initial = await api();
  if (initial.tasks.some(active) || initial.ownerTestModes.length) throw Error('Idle runtime and zero owner modes required; existing work was not interrupted.');
  const device = initial.devices.find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified && d.physicalId === identity.physicalId);
  if (!device) throw Error('Dashboard device identity differs from USB.');
  const frozen = androidRuntimeDigest(), worker = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(), 'address.json'), 'utf8'));
  if (worker.runtimeSha256 !== frozen) throw Error('IDLE_WORKER_SOURCE_STALE: restart the idle worker before the one allowed run.');
  if (process.argv.includes('--preflight')) { console.log(JSON.stringify({ ready, deviceId, physicalId: identity.physicalId, activeTasks: 0, ownerModes: 0, ownedSessions: 0, globalAppiumSessions: Array.isArray(sessions.value) ? sessions.value.length : 'UNVERIFIED_DISCOVERY_DISABLED', runtimeSha256: frozen, ollamaModel: process.env.OLLAMA_MODEL, cloudEnabled: false })); return; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6a-camera-')), output = path.join(directory, 'acceptance.json');
  const report = { label: 'REAL_ANDROID', request, deviceId, physicalId: identity.physicalId, runtimeSha256: frozen, before: undefined, after: undefined, output, finalActiveTasks: undefined, finalOwnerModes: undefined };
  const save = () => { report.runtimeSha256After = androidRuntimeDigest(); report.runtimeUnchanged = report.runtimeSha256After === frozen; fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
  let owner, executionId, latest, terminal = false;
  const reader = new MediaStoreReader(deviceId, runAdb);
  report.before = await reader.readCapture(identity.physicalId);
  const started = performance.now();
  try {
    const enabled = await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: true, fullControl: true, rollbackOnFailure: true });
    if (!enabled.accepted) throw Error('Owner full-control refused.');
    owner = (await api()).ownerTestModes.find(m => m.deviceId === deviceId && m.fullControl);
    if (!owner) throw Error('Owner scope missing.');
    const launched = await api({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId, goal: request, agentVersion: 2, ownerAuthorizedTest: true }] });
    executionId = launched.tasks?.[0]?.executionId; report.executionId = executionId;
    if (!executionId) throw Error('Task was not admitted.');
    while (!terminal) {
      if (frozen !== androidRuntimeDigest()) throw Error('RUNTIME_SOURCE_CHANGED: abort.');
      latest = (await api()).tasks.find(t => t.executionId === executionId);
      if (!latest) throw Error('Task disappeared.'); terminal = !active(latest);
      if (latest.status === 'WAITING_HUMAN') {
        // Approval is not synthesized for target, permission, recovery or ambiguous interpretation.
        throw Error('Unexpected assistance: ' + (latest.latest?.v2?.assistance?.category ?? 'unknown') + '; no confirmation forwarded.');
      }
      if (!terminal && performance.now() - started > 240000) throw Error('Acceptance deadline exceeded.');
      if (!terminal) await new Promise(resolve => setTimeout(resolve, 400));
    }
  } catch (error) { report.error = error.message; }
  finally {
    if (executionId && !terminal) {
      await require('./agent-v2-runner-lifecycle.cjs').cancelIfActive(api, executionId, deviceId, report.lifecycle ??= []);
      const deadline = Date.now() + 35000;
      do { latest = (await api()).tasks.find(t => t.executionId === executionId); terminal = latest && !active(latest); if (!terminal) await new Promise(r => setTimeout(r, 400)); } while (!terminal && Date.now() < deadline);
    }
    if (owner) await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: false, authorizationId: owner.id });
    report.elapsedMs = performance.now() - started; report.task = latest;
    try { report.after = await reader.readCapture(identity.physicalId); } catch (error) { report.metadataError = error.message; }
    try {
      const shot = await fetch(base + '/api/devices/' + deviceId + '/screenshot?width=720', { signal: AbortSignal.timeout(15000) });
      if (shot.ok) { report.screenshot = path.join(directory, 'after.jpg'); fs.writeFileSync(report.screenshot, Buffer.from(await shot.arrayBuffer())); }
    } catch (error) { report.screenshotError = error.message; }
    const end = await api(); report.finalActiveTasks = end.tasks.filter(active).length; report.finalOwnerModes = end.ownerTestModes.length;
    report.globalAppiumSessions = 'UNVERIFIED_DISCOVERY_DISABLED';
    try {
      const id = latest?.latest?.v2?.sessionId;
      const response = id && await fetch('http://127.0.0.1:4723/session/' + encodeURIComponent(id), { signal: AbortSignal.timeout(5000) });
      const ended = response && await response.json();
      report.finalOwnedSessionClosed = Boolean(id && response.status === 404 && ended.value?.error === 'invalid session id');
      report.finalDeviceOwnership = Boolean(await readDeviceOwnership(deviceId, runAdb));
    } catch { report.finalOwnedSessionClosed = false; }
    const added = report.after?.rows.filter(r => !report.before.rows.some(old => old.uri === r.uri)) ?? [];
    report.added = added; report.countDelta = report.after && report.after.summary.count - report.before.summary.count;
    report.independentMetadataCheck = report.countDelta === 1 && added.length === 1 && added[0].size > 0 && latest?.latest?.v2?.artifacts?.some(a => a.mediaUri === added[0].uri);
    report.disposition = added.length ? 'LEFT_IN_PLACE' : 'NO_NEW_MEDIA_OBSERVED';
    report.verdict = latest?.status === 'COMPLETED' && report.independentMetadataCheck && !report.finalActiveTasks && !report.finalOwnerModes && report.finalOwnedSessionClosed && !report.finalDeviceOwnership ? 'PASS' : 'FAIL';
    save();
  }
  console.log(JSON.stringify({ output, executionId, verdict: report.verdict, status: latest?.status, reason: latest?.latest?.reason, elapsedMs: report.elapsedMs, countDelta: report.countDelta, finalActiveTasks: report.finalActiveTasks, finalOwnerModes: report.finalOwnerModes, ownedSessionClosed: report.finalOwnedSessionClosed, runtimeUnchanged: report.runtimeUnchanged }));
  if (report.verdict !== 'PASS') process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
