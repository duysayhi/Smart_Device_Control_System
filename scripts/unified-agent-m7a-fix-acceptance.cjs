/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), { execFileSync } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { readTransportIdentity } = require('../lib/android/transport-identity.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const { androidRuntimeDigest, runtimeDirectory } = require('../lib/android/agent/runtime-storage.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const base = 'http://127.0.0.1:3000', deviceId = 'R58MA78W6QK', terminal = e => Boolean(e.finishedAt);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(route, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(190000) });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? 'HTTP ' + response.status); return data;
}
async function main() {
  const temporal = process.argv.includes('--temporal-approved');
  if (!temporal && !process.argv.includes('--read-only')) throw Error('Choose explicit acceptance scope.');
  if (process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct' || ![undefined, 'ollama'].includes(process.env.AGENT_STRUCTURED_PROVIDER) || process.env.AGENT_CLOUD_REASONING_ENABLED === 'true' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true') throw Error('Local/cloud-off configuration mismatch; no configuration changed.');
  const state = await api('/api/agent/runtime');
  if (state.tasks.some(t => !t.finishedAt) || state.ownerTestModes.length || await readDeviceOwnership(deviceId, runAdb)) throw Error('Device/runtime must be idle and unowned.');
  const identity = await readTransportIdentity(runAdb, deviceId, true);
  if (identity?.hardwareSerial !== deviceId) throw Error('Exact Samsung USB unavailable.');
  const frozen = androidRuntimeDigest(), worker = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(), 'address.json'), 'utf8'));
  if (!frozen || frozen !== worker.runtimeSha256) throw Error('Worker/source mismatch; reload idle worker first.');
  const readiness = async () => deviceReadiness((await runAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout);
  if (await readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no task counted.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m7a-fix-acceptance-'));
  const report = { directory, deviceId, physicalId: identity.physicalId, frozen, mode: temporal ? 'ONE_ALARM_ONE_TIMER_NEW_ONLY' : 'READ_SEARCH_AND_LEGACY_PLAYBACK', path: 'Unified HTTP API + real worker/Android; browser clarification is recorded separately', startedAt: new Date().toISOString(), cases: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  let owner, current;
  const jobs = temporal ? [{ id: 'alarm', source: 'Đặt báo thức 7 giờ sáng' }, { id: 'timer', source: 'Hẹn giờ 2 phút' }] : [
    { id: 'battery', source: 'Cho mình xem pin còn bao nhiêu', state: 'battery' },
    { id: 'wifi', source: 'Cho mình biết Wi-Fi đang bật hay tắt', state: 'wifi' },
    { id: 'youtube', source: 'Mở YouTube và tìm nhạc không lời để học bài', query: 'nhạc không lời để học bài' },
    { id: 'drive', source: 'Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập', query: 'báo cáo thực tập' },
    { id: 'ordinal', source: 'Mở YouTube, tìm hải dương học và mở video thứ hai' },
  ];
  console.log(JSON.stringify({ directory, mode: report.mode, frozen }));
  try {
    if (temporal) {
      await api('/api/agent/runtime', { type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: true, fullControl: true, rollbackOnFailure: true });
      owner = (await api('/api/agent/runtime')).ownerTestModes.find(m => m.deviceId === deviceId && m.fullControl);
      if (!owner) throw Error('Owner scope unavailable.'); report.owner = owner;
    }
    for (const job of jobs) {
      if (androidRuntimeDigest() !== frozen) throw Error('RUNTIME_SOURCE_CHANGED');
      if (await readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: next task not counted.');
      const row = { ...job, startedAt: Date.now(), events: [] }; report.cases.push(row); save();
      console.log(JSON.stringify({ case: job.id, phase: 'ANALYZE' }));
      try {
        const start = performance.now(), data = await api('/api/unified-agent', { type: 'ANALYZE', input: { source: job.source, deviceId } });
        row.analyzeMs = performance.now() - start; row.plan = data.plan; row.clarification = data.clarification;
        if (!data.plan) { row.verdict = 'ASK'; throw Error('ASK: explicit clarification required; no execution sent.'); }
        const executing = performance.now();
        const admitted = await api('/api/unified-agent', { type: 'EXECUTE', reference: data.plan.reference }); current = admitted.execution.id; row.executionId = current;
        const answered = new Set(); let last;
        do {
          last = (await api('/api/unified-agent')).executions.find(e => e.id === current);
          if (!last) throw Error('Execution disappeared.'); row.execution = last;
          const statusKey = JSON.stringify([last.status, last.reason, last.task?.latest?.v2?.assistance]);
          if (row.lastKey !== statusKey) { row.lastKey = statusKey; row.events.push({ at: Date.now(), execution: last }); console.log(JSON.stringify({ case: job.id, status: last.status, reason: last.reason })); }
          const assistance = last.task?.latest?.v2?.assistance;
          if (assistance && last.status === 'WAITING_HUMAN' && !answered.has(assistance.token)) {
            answered.add(assistance.token); const graph = last.task.latest.v2.graph;
            const exact = graph.original.request === job.source && graph.nodes.length === 2 && graph.nodes[0].capability === 'LAUNCH' && graph.nodes[1].capability === 'SEARCH' && graph.nodes[1].outcome.value === job.query && graph.nodes.every(n => !n.outcome.negated && !n.outcome.ambiguity.length);
            const approved = Boolean(job.query && exact && assistance.category === 'GOAL_INTERPRETATION' && assistance.choices.length === 1);
            row.assistance = { category: assistance.category, approved, sessionRetained: assistance.sessionRetained };
            await api('/api/unified-agent', { type: 'ASSIST', executionId: current, reply: { kind: 'V2', token: assistance.token, approved, choice: approved ? assistance.choices[0].id : '' } });
          }
          save(); if (performance.now() - executing > 300000) throw Error('Acceptance deadline; no replay.');
          if (!terminal(last)) await sleep(700);
        } while (!terminal(last));
        row.executeObservedMs = performance.now() - executing; row.verdict = last.status;
        row.manual = { adbCount: 0 };
        const png = execFileSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 10000, maxBuffer: 12 * 1024 * 1024 }); row.manual.adbCount++;
        row.manual.screenshot = path.join(directory, job.id + '.png'); fs.writeFileSync(row.manual.screenshot, png);
        const native = await runAdb(['-s', deviceId, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 20000); row.manual.adbCount++;
        row.manual.native = path.join(directory, job.id + '.xml'); fs.writeFileSync(row.manual.native, native.stdout);
        if (job.state) {
          const commands = job.state === 'battery' ? [['dumpsys', 'battery'], ['cat', '/sys/class/power_supply/battery/capacity']] : [['settings', 'get', 'global', 'wifi_on'], ['cmd', 'wifi', 'status']];
          row.manual.stateReads = [];
          for (const command of commands) { const value = await runAdb(['-s', deviceId, 'shell', ...command], 5000); row.manual.adbCount++; row.manual.stateReads.push({ command, ...value }); }
        }
        current = undefined;
      } catch (error) { row.error = error.message; row.verdict ??= 'BLOCKED'; if (current) throw error; }
      finally { row.runtimeSha256After = androidRuntimeDigest(); row.finishedAt = Date.now(); save(); }
      if (row.runtimeSha256After !== frozen) throw Error('RUNTIME_SOURCE_CHANGED');
      if (await readDeviceOwnership(deviceId, runAdb)) throw Error('Session/device cleanup incomplete.');
    }
  } catch (error) { report.error = error.message; }
  finally {
    if (current) { await api('/api/unified-agent', { type: 'CANCEL', executionId: current }); const until = Date.now() + 60000; while ((await api('/api/agent/runtime')).tasks.some(t => !t.finishedAt) && Date.now() < until) await sleep(500); }
    if (owner) await api('/api/agent/runtime', { type: 'SET_OWNER_TEST_MODE', deviceId, physicalId: identity.physicalId, enabled: false, authorizationId: owner.id });
    const end = await api('/api/agent/runtime'); report.cleanup = { activeTasks: end.tasks.filter(t => !t.finishedAt).length, ownerModes: end.ownerTestModes.length, ownership: await readDeviceOwnership(deviceId, runAdb) ?? null, runtimeSha256: androidRuntimeDigest() };
    report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ directory, error: report.error, results: report.cases.map(c => ({ id: c.id, verdict: c.verdict, reason: c.error ?? c.execution?.reason })), cleanup: report.cleanup }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
