/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { randomUUID } = require('node:crypto'), { execFileSync } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const { androidRuntimeDigest, runtimeDirectory } = require('../lib/android/agent/runtime-storage.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const { parseTemporal } = require('../lib/android/agent/temporal-contract.ts');
const { cancelIfActive } = require('./agent-v2-runner-lifecycle.cjs');
const base = 'http://127.0.0.1:3000', deviceId = process.argv[2], active = t => ['RUNNING', 'QUEUED', 'WAITING_HUMAN'].includes(t.status);
async function api(body) {
  const r = await fetch(base + '/api/agent/runtime', { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error('Dashboard runtime HTTP ' + r.status); return r.json();
}
async function main() {
  if (deviceId !== 'R58MA78W6QK' || !process.argv.includes('--approved-one-alarm-one-timer')) throw Error('Exact approved USB device and explicit two-artifact scope required.');
  if (process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct' || ![undefined, 'ollama'].includes(process.env.AGENT_STRUCTURED_PROVIDER) || process.env.AGENT_CLOUD_REASONING_ENABLED === 'true' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true') throw Error('Local default/cloud-off configuration differs; no configuration changed.');
  const initial = await api();
  if (initial.tasks.some(active) || initial.ownerTestModes.length || await readDeviceOwnership(deviceId, runAdb)) throw Error('Runtime/device already owned; nothing interrupted.');
  const frozen = androidRuntimeDigest(), addressFile = path.join(runtimeDirectory(), 'address.json');
  let worker = JSON.parse(fs.readFileSync(addressFile, 'utf8'));
  if (worker.runtimeSha256 !== frozen) {
    if (initial.reasoning?.running || initial.reasoning?.waiting) throw Error('Reasoning queue is not idle.');
    const reply = await fetch('http://127.0.0.1:' + worker.port + '/shutdown', { method: 'POST', headers: { Authorization: 'Bearer ' + worker.token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) });
    if (!reply.ok) throw Error('Idle worker refused graceful reload.');
    const deadline = Date.now() + 30000;
    while (fs.existsSync(addressFile) && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
    if (fs.existsSync(addressFile)) throw Error('Idle worker did not finish shutdown.');
    await api(); worker = JSON.parse(fs.readFileSync(addressFile, 'utf8'));
  }
  if (worker.runtimeSha256 !== frozen) throw Error('Worker runtime hash differs.');
  const identity = await readTransportIdentity(runAdb, deviceId, true);
  if (!identity || identity.hardwareSerial !== deviceId) throw Error('USB identity unavailable.');
  const ready = async () => deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout);
  if (await ready() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no counted task.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6c-acceptance-')), output = path.join(directory, 'evidence.json');
  const report = { directory, output, path: 'Dashboard-facing /api/agent/runtime, Agent V2 worker', runtimeSha256: frozen, deviceId, physicalId: identity.physicalId, tasks: [] };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2)); save(); console.log(JSON.stringify({ output }));
  let owner, current;
  try {
    await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: true, fullControl: true, rollbackOnFailure: true });
    owner = (await api()).ownerTestModes.find(m => m.deviceId === deviceId && m.fullControl);
    if (!owner) throw Error('Scoped full-control was not enabled.');
    for (const source of ['đặt báo thức 3:30', 'Đặt báo thức 7 giờ sáng', 'Hẹn giờ 10 phút']) {
      if (androidRuntimeDigest() !== frozen) throw Error('RUNTIME_SOURCE_CHANGED');
      if (await ready() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: next task not counted.');
      const expected = parseTemporal(source), start = performance.now(), row = { source, expected, events: [], forwardedInterpretations: 0 }; report.tasks.push(row); save();
      const admitted = await api({ type: 'START', requestId: randomUUID(), jobs: [{ deviceId, goal: source, agentVersion: 2, ownerAuthorizedTest: true }] });
      current = admitted.tasks?.[0]?.executionId; if (!current) throw Error('Task admission failed.'); row.executionId = current;
      const replied = new Set(); let last;
      do {
        if (androidRuntimeDigest() !== frozen) throw Error('RUNTIME_SOURCE_CHANGED');
        last = (await api()).tasks.find(t => t.executionId === current); if (!last) throw Error('Task disappeared.');
        const event = last.latest;
        if (event && JSON.stringify(row.events.at(-1)) !== JSON.stringify(event)) row.events.push(event);
        const a = event?.v2?.assistance;
        if (last.status === 'WAITING_HUMAN' && a && !replied.has(a.token)) {
          replied.add(a.token);
          const graph = event.v2.graph, exact = graph.original.request === source && graph.nodes.length === 1 && JSON.stringify(graph.nodes[0].outcome.temporal) === JSON.stringify(expected.request) && !graph.nodes[0].outcome.negated && !graph.nodes[0].outcome.ambiguity.length;
          const approve = expected.request && a.category === 'GOAL_INTERPRETATION' && exact && a.choices.length === 1;
          const allowedAmbiguity = expected.issue === 'AM_PM_REQUIRED' && a.category === 'FIELD_AMBIGUITY' && a.choices.length === 2;
          await api({ type: 'ASSIST_V2', executionId: current, deviceId, token: a.token, approved: Boolean(approve), choice: approve ? a.choices[0].id : 'am' });
          if (approve) row.forwardedInterpretations++;
          else if (!allowedAmbiguity) row.unexpectedAssistance = a.category;
        }
        save(); if (performance.now() - start > 290000) throw Error('Acceptance deadline exceeded.');
        if (active(last)) await new Promise(r => setTimeout(r, 300));
      } while (active(last));
      row.task = last; row.elapsedMs = performance.now() - start; row.runtimeSha256After = androidRuntimeDigest(); row.runtimeUnchanged = frozen === row.runtimeSha256After;
      row.modelCalls = last.latest?.reasoningMeasurements?.length ?? 0;
      row.manualAudit = { adbCount: 0, claimedCompletion: last.status === 'COMPLETED' };
      const screenshot = execFileSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], { timeout: 10000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }); row.manualAudit.adbCount++;
      row.manualAudit.screenshot = path.join(directory, report.tasks.length + '.png'); fs.writeFileSync(row.manualAudit.screenshot, screenshot);
      const native = await runAdb(['-s', deviceId, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 20000); row.manualAudit.adbCount++;
      row.manualAudit.nativeReadback = path.join(directory, report.tasks.length + '.xml'); fs.writeFileSync(row.manualAudit.nativeReadback, native.stdout);
      row.manualAudit.review = 'UNVERIFIED: requires visual/manual audit, not inferred from unit tests.';
      current = undefined; save(); console.log(JSON.stringify({ source, status: last.status, reason: last.latest?.reason, elapsedMs: row.elapsedMs, modelCalls: row.modelCalls, evidence: output }));
    }
  } catch (error) { report.error = error.message; }
  finally {
    if (current) {
      await cancelIfActive(api, current, deviceId, report.lifecycle ??= []);
      const deadline = Date.now() + 35000;
      while ((await api()).tasks.some(t => t.executionId === current && active(t)) && Date.now() < deadline) await new Promise(r => setTimeout(r, 300));
    }
    if (owner) await api({ type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: false, authorizationId: owner.id });
    const end = await api(); report.activeTasksAfter = end.tasks.filter(active).length; report.ownerModesAfter = end.ownerTestModes.length;
    report.deviceOwnershipAfter = await readDeviceOwnership(deviceId, runAdb) ?? null;
    report.runtimeSha256After = androidRuntimeDigest(); report.runtimeUnchanged = frozen === report.runtimeSha256After;
    const journals = path.join(os.tmpdir(), 'phone-commander-local-effects'); report.journals = [];
    if (fs.existsSync(journals)) for (const name of fs.readdirSync(journals).filter(n => n.endsWith('.jsonl'))) {
      const file = path.join(journals, name), lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s));
      if (lines.some(e => report.tasks.some(t => t.executionId === e.executionId))) report.journals.push({ file, lines: lines.filter(e => report.tasks.some(t => t.executionId === e.executionId)) });
    }
    save(); console.log(JSON.stringify({ output, error: report.error, activeTasksAfter: report.activeTasksAfter, ownerModesAfter: report.ownerModesAfter, runtimeUnchanged: report.runtimeUnchanged }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
