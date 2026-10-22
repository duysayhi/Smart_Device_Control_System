/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const { readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { androidV2Adapter, runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { resolveTemporalHandler } = require('../lib/android/agent/temporal-executor.ts');
const { TemporalProviderReader } = require('../lib/android/agent/temporal-evidence.ts');
const { parseTemporal } = require('../lib/android/agent/temporal-contract.ts');
const { selectorForNode } = require('../lib/android/state-observer.ts');
const deviceId = 'R58MA78W6QK';
async function main() {
  const recon = process.argv.includes('--recon'), accept = process.argv.includes('--approved-one-alarm-and-one-timer');
  if (Number(recon) + Number(accept) !== 1) throw Error('Select readonly recon or explicit owner-approved acceptance.');
  const identity = await readTransportIdentity(runAdb, deviceId, true);
  if (!identity || identity.hardwareSerial !== deviceId) throw Error('USB_DEVICE_REQUIRED');
  const initial = await (await fetch('http://127.0.0.1:3000/api/agent/runtime', { signal: AbortSignal.timeout(30000) })).json();
  if (initial.tasks?.some(t => ['RUNNING', 'QUEUED', 'WAITING_HUMAN'].includes(t.status)) || initial.ownerTestModes?.length || await readDeviceOwnership(deviceId, runAdb)) throw Error('Device/runtime already owned; nothing interrupted.');
  const client = new AppiumClient(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6b-'));
  const report = { directory, deviceId, physicalId: identity.physicalId, mode: recon ? 'READ_ONLY_RECON' : 'CONTROLLED_ACCEPTANCE', tasks: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence: path.join(directory, 'evidence.json') }));
  let execution;
  try {
    for (const source of ['Đặt báo thức 7 giờ sáng', 'Hẹn giờ 10 phút']) {
      const budget = new AgentBudget({ timeMs: 180000 }), adapter = androidV2Adapter(deviceId, budget), request = parseTemporal(source).request;
      if (await adapter.readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no counted mutation attempt.');
      const row = { source, request, status: 'UNVERIFIED', events: [] }; report.tasks.push(row); save();
      const app = await adapter.resolveTemporalApp(request); if (!app) throw Error('Handler unavailable');
      row.packageName = app.packageName;
      if (recon) {
        execution = await adapter.open([app]); row.sessionId = execution.sessionId();
        const show = await resolveTemporalHandler(deviceId, request, runAdb, true);
        try { await runAdb(['-s', deviceId, 'shell', 'am', 'start', '-W', '-a', show.action, '-n', show.component]); }
        catch (e) { row.showIntentBlocked = /SET_ALARM|Permission Denial/.test(e.message); await execution.execute({ type: 'OPEN_APP', app: app.packageName }); }
        let snapshot = await execution.observe();
        const tabs = snapshot.nodes.filter(n => n.enabled && n.displayed !== false && /Tab/.test(n.className) && new RegExp(request.kind === 'ALARM' ? '^(Alarm|Báo thức|Chuông báo)' : '^(Timer|Hẹn giờ|Bộ đếm|Đếm giờ)', 'i').test(n.text || n.description));
        if (tabs.length === 1 && !tabs[0].selected) {
          const matches = await client.request('POST', '/session/' + execution.sessionId() + '/elements', selectorForNode(tabs[0], snapshot.nodes));
          if (matches.length === 1) { await client.request('POST', '/session/' + execution.sessionId() + '/element/' + matches[0]['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); snapshot = await execution.observe(); }
        }
        row.snapshot = snapshot;
        if (request.kind === 'ALARM') {
          const add = snapshot.nodes.filter(n => n.enabled && n.clickable && n.displayed !== false && /^(?:add alarm|new alarm|thêm (?:chuông báo|báo thức))$/i.test(n.description || n.text));
          if (add.length === 1) {
            const matches = await client.request('POST', '/session/' + execution.sessionId() + '/elements', selectorForNode(add[0], snapshot.nodes));
            if (matches.length === 1) {
              await client.request('POST', '/session/' + execution.sessionId() + '/element/' + matches[0]['element-6066-11e4-a52e-4f735466cecf'] + '/click', {});
              const deadline = Date.now() + 10000;
              do { row.newFormSnapshot = await execution.observe(); }
              while (!row.newFormSnapshot.nodes.some(n => /EditText|TimePicker|NumberPicker/.test(n.className)) && Date.now() < deadline);
              fs.writeFileSync(path.join(directory, 'ALARM-new-form.png'), Buffer.from(await client.request('GET', '/session/' + execution.sessionId() + '/screenshot'), 'base64'));
              await client.request('POST', '/session/' + execution.sessionId() + '/back', {});
              row.afterFormSnapshot = await execution.observe();
            }
          }
        }
        fs.writeFileSync(path.join(directory, request.kind + '.png'), Buffer.from(await client.request('GET', '/session/' + execution.sessionId() + '/screenshot'), 'base64'));
        try { row.inventory = await new TemporalProviderReader(deviceId, runAdb).read(app.packageName, request.kind); row.status = 'READBACK_AVAILABLE'; }
        catch (e) { row.status = 'BLOCKED_PROVIDER'; row.reason = e.message; }
        await execution.close(); execution = undefined;
      } else {
        const policy = new OwnerTestPolicy(), mode = policy.enable(deviceId, identity.physicalId, undefined, { fullControl: true }), executionId = randomUUID();
        budget.runtimeIdentity = { deviceId, executionId, physicalId: identity.physicalId };
        const began = performance.now(); row.executionId = executionId;
        try {
          await runAgentV2(source, deviceId, executionId, identity.physicalId, budget, adapter, event => { row.events.push(event); save(); }, undefined,
            { generate: async () => { throw Error('No model call expected for source-exact temporal rules; no provider configuration changed.'); } }, policy.bind(deviceId, identity.physicalId, executionId));
          const last = row.events.at(-1); row.status = last.status; row.reason = last.reason;
          row.modelCalls = last.reasoningMeasurements?.length ?? 0; row.rules = last.v2?.analysis?.source;
          row.rpcCount = last.profiling?.rpcCount; row.adbCount = last.profiling?.adbCount; row.timings = last.timings;
          row.sessionId = last.v2?.sessionId; row.localEffects = last.v2?.localEffects;
          if (last.v2?.assistance) throw Error('Unexpected assistance; do not auto-approve an interpretation.');
        } finally { row.elapsedMs = performance.now() - began; policy.disable(deviceId, mode.id); row.ownerModesAfter = policy.list().length; }
      }
      if (row.sessionId) {
        try { await client.request('GET', '/session/' + row.sessionId + '/source'); row.sessionClosed = false; }
        catch (e) { row.sessionClosed = e.code === 'SESSION_ERROR' || e.sessionInvalid === true || /invalid session|no longer active|not known|terminated/i.test(e.message); }
      }
      row.profiling = budget.summary().profiling; save(); console.log(JSON.stringify({ source, status: row.status, reason: row.reason, profiling: row.profiling }));
    }
  } finally {
    await execution?.close();
    report.deviceOwnershipAfter = await readDeviceOwnership(deviceId, runAdb) ?? null;
    const end = await (await fetch('http://127.0.0.1:3000/api/agent/runtime', { signal: AbortSignal.timeout(30000) })).json();
    report.activeTasksAfter = end.tasks.filter(t => ['RUNNING', 'QUEUED', 'WAITING_HUMAN'].includes(t.status)).length;
    report.ownerModesAfter = end.ownerTestModes.length; save();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
