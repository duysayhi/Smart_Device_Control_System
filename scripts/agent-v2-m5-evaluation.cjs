/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFile } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const args = process.argv.slice(2), opt = key => args[args.indexOf(key) + 1];
const base = 'http://127.0.0.1:3000', cohortPath = 'tests/holdout/user-tasks.json';
const active = t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function sourceFiles() {
  return ['lib', 'app/api', 'scripts'].flatMap(d => fs.readdirSync(d, { recursive: true })
    .filter(f => /\.(?:ts|tsx|cjs)$/.test(f)).map(f => path.join(d, f).replaceAll('\\', '/')))
    .concat(['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next.config.ts'].filter(f => fs.existsSync(f))).sort();
}
function fingerprints() {
  const files = sourceFiles();
  return { runtimeSha256: sha(fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort()
    .map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')),
  extendedSha256: sha(files.map(f => f + '\n' + fs.readFileSync(f, 'utf8')).join('\n')),
  cohortSha256: sha(fs.readFileSync(cohortPath)), files: files.map(f => ({ path: f, sha256: sha(fs.readFileSync(f)) })) };
}
function write(file, value, exclusive = false) {
  const text = JSON.stringify(value, null, 2);
  const secrets = Object.entries(process.env).filter(([k, v]) => /(?:KEY|TOKEN)$/.test(k) && v?.length >= 16).map(([, v]) => v);
  if (secrets.some(s => text.includes(s)) || /gsk_[A-Za-z0-9]{24,}/.test(text)) throw Error('Evidence secret check failed');
  fs.writeFileSync(file, text, { flag: exclusive ? 'wx' : 'w' });
}
async function api(body) {
  const r = await fetch(base + '/api/agent/runtime', { method: body ? 'POST' : 'GET',
    headers: { Origin: base, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw Error('Runtime HTTP ' + r.status);
  return r.json();
}
function worker() {
  const root = path.join(os.tmpdir(), 'phone-commander-runtime-' + sha(path.resolve(process.cwd()).toLowerCase()).slice(0, 20));
  const a = JSON.parse(fs.readFileSync(path.join(root, 'address.json'), 'utf8'));
  return { pid: a.pid, runtimeSha256: a.runtimeSha256, observerIdleTimeoutMs: a.observerIdleTimeoutMs };
}
function command(argv, timeout = 15000) {
  return new Promise(resolve => execFile(process.env.ADB_PATH || 'adb', argv, { windowsHide: true, timeout, maxBuffer: 2000000 }, (e, stdout) =>
    resolve({ exitCode: e ? e.code : 0, stdout: stdout || '' })));
}
async function readiness(serial) {
  const r = await command(['-s', serial, 'shell', 'dumpsys', 'window', 'policy']);
  return r.exitCode === 0 && /\bmIsShowing=false\b/.test(r.stdout) && !/\bmIsShowing=true\b/.test(r.stdout) && /screenState=SCREEN_STATE_ON\b/.test(r.stdout);
}
async function observe(serial, prefix) {
  const result = { outsideTask: true, adbReadCommands: 0 }, started = performance.now();
  try {
    const r = await fetch(base + '/api/devices/' + encodeURIComponent(serial) + '/screenshot?width=720', { signal: AbortSignal.timeout(20000) });
    result.screenshotHTTP = r.status;
    if (r.ok) { result.screenshot = prefix + '.jpg'; fs.writeFileSync(result.screenshot, Buffer.from(await r.arrayBuffer())); }
  } catch { result.screenshotError = 'UNAVAILABLE'; }
  for (const [name, argv] of [['window', ['dumpsys', 'window', 'windows']], ['hierarchy', ['uiautomator', 'dump', '/dev/tty']]]) {
    const r = await command(['-s', serial, 'shell', ...argv], 20000); result.adbReadCommands++;
    result[name + 'ExitCode'] = r.exitCode;
    if (r.exitCode === 0) { result[name] = prefix + '-' + name + '.txt'; fs.writeFileSync(result[name], r.stdout); }
  }
  result.elapsedMs = performance.now() - started; return result;
}
async function main() {
  if (process.env.AGENT_STRUCTURED_PROVIDER && process.env.AGENT_STRUCTURED_PROVIDER !== 'ollama' || process.env.AGENT_GROQ_SEND_COMMAND_TEXT === 'true' || process.env.OLLAMA_MODEL !== 'qwen2.5:3b-instruct') throw Error('Local default configuration required');
  const state = await api();
  if (state.tasks.some(active) || state.ownerTestModes.length) throw Error('Idle runtime with zero owner modes required');
  if (args.includes('--init')) {
    const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
    if (!Array.isArray(cohort) || !cohort.length || new Set(cohort.map(t => t.id)).size !== cohort.length || cohort.some(t => !['TASK', 'APPLICATION', 'INITIAL_STATE'].includes(t.group) || !['COMPLETE', 'REFUSE', 'CLARIFY'].includes(t.expectedClass) || !t.request || !t.expectedOutcome)) throw Error('Invalid user cohort; do not edit it');
    const frozen = fingerprints(), serving = worker();
    if (serving.runtimeSha256 !== frozen.runtimeSha256) throw Error('Stale worker; no task executed');
    const output = path.join(os.tmpdir(), 'agent-v2-m5-user-' + Date.now() + '.json');
    write(output, { provenance: 'NEW_USER_AUTHORED_NOT_RECOVERED_SEALED', label: 'REAL_ANDROID', frozen, serving, cohort, attempts: [] }, true);
    console.log(JSON.stringify({ manifest: output, count: cohort.length, runtimeSha256: frozen.runtimeSha256, extendedSha256: frozen.extendedSha256, cohortSha256: frozen.cohortSha256 })); return;
  }
  if (!args.includes('--run') || !args.includes('--manifest') || !args.includes('--task') || !args.includes('--device')) throw Error('Explicit run, manifest, task and device required');
  const manifestPath = opt('--manifest'), batch = JSON.parse(fs.readFileSync(manifestPath, 'utf8')), task = batch.cohort.find(t => t.id === opt('--task'));
  if (!task) throw Error('Task not in frozen user cohort');
  const prior = batch.attempts.filter(a => a.taskId === task.id);
  if (prior.length && (prior.length !== 1 || prior[0].classification !== 'INVALID' || !args.includes('--retry-invalid'))) throw Error('Task already attempted; no retry allowed');
  const check = () => { const now = fingerprints(); if (now.runtimeSha256 !== batch.frozen.runtimeSha256 || now.extendedSha256 !== batch.frozen.extendedSha256 || now.cohortSha256 !== batch.frozen.cohortSha256 || worker().runtimeSha256 !== now.runtimeSha256) throw Error('Source/cohort freeze changed; abort'); return now; };
  check();
  const serial = opt('--device'), device = state.devices.find(d => d.serial === serial && d.status === 'device' && d.identityVerified && d.physicalId);
  if (!device) throw Error('Device unavailable; no counted attempt');
  if (!await readiness(serial)) throw Error('UNLOCK_REQUIRED: no counted attempt');
  const id = crypto.randomUUID(), output = path.join(os.tmpdir(), 'agent-v2-m5-task-' + task.id + '-' + id + '.json');
  const r = { task, attempt: prior.length + 1, configuredProvider: 'ollama', configuredModel: 'qwen2.5:3b-instruct', approvedSummaryArgument: args.includes('--approved-summary') ? opt('--approved-summary') : null,
    freezeBefore: { runtimeSha256: batch.frozen.runtimeSha256, extendedSha256: batch.frozen.extendedSha256, cohortSha256: batch.frozen.cohortSha256 }, reviews: [], memory: [], peakWorkingSetBytes: 0, output };
  r.before = await observe(serial, output.replace(/\.json$/, '-before'));
  if (!await readiness(serial)) throw Error('UNLOCK_REQUIRED: no counted attempt');
  let mode, executionId, terminal = false, latest, timer, sampling = false, inFlight = Promise.resolve();
  const sample = () => { if (sampling) return; sampling = true; inFlight = new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.ProcessName -match 'ollama|llama' } | Select-Object Id,ProcessName,WorkingSet64 | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 10000 }, (e, stdout) => {
    try { const parsed = JSON.parse(stdout), rows = Array.isArray(parsed) ? parsed : [parsed]; r.memory.push({ at: Date.now(), processes: rows }); r.peakWorkingSetBytes = Math.max(r.peakWorkingSetBytes, rows.reduce((s, p) => s + p.WorkingSet64, 0)); } catch { r.memorySampleErrors = (r.memorySampleErrors || 0) + 1; }
    sampling = false; resolve();
  })); };
  try {
    if (!(await api({ type: 'SET_OWNER_TEST_MODE', deviceId: serial, physicalId: device.physicalId, enabled: true })).accepted) throw Error('Owner mode refused');
    mode = (await api()).ownerTestModes.find(m => m.deviceId === serial && m.physicalId === device.physicalId);
    if (!mode) throw Error('Scoped authorization not observed');
    r.authorizationId = mode.id; const start = performance.now(); sample(); timer = setInterval(sample, 3000);
    const started = await api({ type: 'START', requestId: id, jobs: [{ deviceId: serial, goal: task.request, agentVersion: 2, ownerAuthorizedTest: true }] });
    executionId = started.tasks[0].executionId; r.executionId = executionId;
    do {
      latest = (await api()).tasks.find(t => t.executionId === executionId);
      if (!latest) throw Error('Task disappeared'); terminal = !active(latest); if (terminal) break;
      if (latest.status === 'WAITING_HUMAN') {
        const a = latest.latest?.v2?.assistance;
        if (a && !r.reviews.some(review => review.token === a.token)) {
          const approved = task.expectedClass === 'COMPLETE' && a.category === 'GOAL_INTERPRETATION' && a.expiresAt > Date.now() && a.choices.length === 1 && a.choices[0].label === r.approvedSummaryArgument;
          r.reviews.push({ token: a.token, category: a.category, plannedChoices: a.choices, approved, forwardedChoice: approved ? a.choices[0].id : '', forwardedSummary: approved ? r.approvedSummaryArgument : null });
          await api({ type: 'ASSIST_V2', executionId, deviceId: serial, token: a.token, approved, choice: approved ? a.choices[0].id : '' });
          if (a.category === 'DEVICE_UNLOCK') r.externalInvalidation = 'DEVICE_LOCKED';
        }
      }
      if (performance.now() - start > 210000) { r.runnerDeadline = { observedAt: Date.now(), elapsedMs: performance.now() - start }; break; }
      await delay(400);
    } while (!terminal);
    r.wallTaskMs = performance.now() - start;
  } catch (e) { r.runnerError = String(e.message).replace(/gsk_[A-Za-z0-9]+/g, '[REDACTED]'); }
  finally {
    if (executionId && !terminal) {
      const checked = await require('./agent-v2-runner-lifecycle.cjs').cancelIfActive(api, executionId, serial, r.lifecycle ??= []);
      latest = checked.task; terminal = checked.terminal;
      const until = Date.now() + 35000;
      while (!terminal && Date.now() < until) { latest = (await api()).tasks.find(t => t.executionId === executionId); terminal = latest && !active(latest); if (!terminal) await delay(500); }
    }
    if (timer) clearInterval(timer); await inFlight;
    if (mode) await api({ type: 'SET_OWNER_TEST_MODE', deviceId: serial, physicalId: device.physicalId, enabled: false, authorizationId: mode.id });
    r.latestTask = latest; r.terminal = terminal;
    if (latest?.latest?.v2?.sessionId) {
      const reply = await fetch('http://127.0.0.1:4723/session/' + latest.latest.v2.sessionId + '/timeouts', { signal: AbortSignal.timeout(10000) });
      const body = await reply.json(); r.sessionProbe = { http: reply.status, error: body.value?.error };
    }
    r.after = await observe(serial, output.replace(/\.json$/, '-after'));
    const end = await api(); r.finalActiveTasks = end.tasks.filter(active).length; r.finalOwnerModes = end.ownerTestModes.length;
    try { const f = check(); r.freezeAfter = { runtimeSha256: f.runtimeSha256, extendedSha256: f.extendedSha256, cohortSha256: f.cohortSha256 }; r.unchanged = true; } catch { r.unchanged = false; }
    r.manualCheck = 'PENDING_EXTERNAL_SCREENSHOT_AND_NATIVE_READBACK_REVIEW';
    write(output, r, true); batch.attempts.push({ taskId: task.id, executionId, output, terminalStatus: latest?.status, classification: r.externalInvalidation ? 'INVALID' : 'UNASSESSED', unchanged: r.unchanged }); write(manifestPath, batch);
    console.log(JSON.stringify({ taskId: task.id, executionId, status: latest?.status, reason: latest?.latest?.reason, output, unchanged: r.unchanged, active: r.finalActiveTasks, modes: r.finalOwnerModes, reviews: r.reviews.map(({ category, plannedChoices, approved }) => ({ category, plannedChoices, approved })) }));
    if (!r.unchanged || !terminal || r.finalActiveTasks || r.finalOwnerModes) throw Error('Freeze/cleanup invariant failed; stop evaluation');
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
