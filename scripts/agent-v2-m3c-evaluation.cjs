/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const args = process.argv.slice(2), opt = key => args[args.indexOf(key) + 1];
const device = opt('--device'), phase = opt('--phase');
const base = 'http://127.0.0.1:3000';
function digest() { return crypto.createHash('sha256').update(fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex'); }
async function memory() {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', '$p=Get-Process -ErrorAction SilentlyContinue|Where-Object {$_.ProcessName -match "^(ollama|llama)"}; [long](($p|Measure-Object WorkingSet64 -Sum).Sum)'], { windowsHide: true }, (e, out) => resolve(e ? undefined : Number(out.trim()))));
}
async function main() {
  if (!device || !['baseline', 'after'].includes(phase)) throw Error('--device and --phase baseline|after required');
  const tasks = [
    { id: 'myfiles', goal: 'Mo com.sec.android.app.myfiles va tim fieldwork-notes-2026-zqx' },
    { id: 'maps', goal: 'Xin ghe com.google.android.apps.maps roi do "public libraries"', approval: 'OPEN_APP: com.google.android.apps.maps; SEARCH: "public libraries"' },
    { id: 'play', goal: 'Xin ghe com.android.vending roi do "ocean sounds"', approval: 'OPEN_APP: com.android.vending; SEARCH: "ocean sounds"' },
  ];
  if (args.includes('--extra-file')) tasks.push(...JSON.parse(fs.readFileSync(opt('--extra-file'), 'utf8')));
  const frozen = digest(), rows = [];
  for (const task of tasks) {
    const runtime = await (await fetch(base + '/api/agent/runtime')).json();
    if (runtime.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status))) throw Error('Runtime busy');
    const warmStart = Date.now();
    const warm = await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: JSON.stringify({ model: 'qwen2.5:3b-instruct', prompt: '', stream: false, keep_alive: '10m' }), signal: AbortSignal.timeout(120000) });
    if (!warm.ok) throw Error('Ollama warmup failed'); await warm.json();
    const warmMs = Date.now() - warmStart, samples = []; let sampling = false;
    const sample = async () => { if (sampling) return; sampling = true; try { samples.push(await memory()); } finally { sampling = false; } };
    await sample(); const timer = setInterval(sample, 3000);
    let exitCode;
    try {
      const argv = ['scripts/agent-v2-acceptance.cjs', '--run', '--device', device, '--goal', task.goal, '--owner-authorized-test', ...(task.approval ? ['--approved-interpretation', task.approval] : [])];
      exitCode = await new Promise((resolve, reject) => { const child = spawn(process.execPath, argv, { stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', resolve); });
    } finally { clearInterval(timer); }
    const state = await (await fetch(base + '/api/agent/runtime')).json();
    const t = state.tasks.filter(t => t.request === task.goal).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!t) throw Error('Missing task');
    const shot = await fetch(base + '/api/devices/' + encodeURIComponent(device) + '/screenshot?width=720');
    const screenshot = path.join(os.tmpdir(), `m3c-${phase}-${task.id}-${t.executionId}.jpg`);
    if (shot.ok) fs.writeFileSync(screenshot, Buffer.from(await shot.arrayBuffer()));
    rows.push({ ...task, exitCode, warmMs, executionId: t.executionId, status: t.status, reason: t.latest?.reason, events: t.events, latest: t.latest,
      screenshot: shot.ok ? screenshot : undefined, ollamaWorkingSetPeakBytes: Math.max(0, ...samples.filter(Number.isFinite)) });
    const output = path.join(os.tmpdir(), `agent-v2-m3c-${phase}-${frozen.slice(0, 12)}.json`);
    fs.writeFileSync(output, JSON.stringify({ classification: 'REAL_ANDROID', phase, device, runtimeSha256: frozen, unchanged: frozen === digest(), rows }, null, 2));
    console.log(JSON.stringify({ id: task.id, status: t.status, reason: t.latest?.reason, screenshot, output }));
    if (frozen !== digest()) throw Error('Source changed during evaluation');
    if (t.events.some(e => /Unlock the selected phone/.test(e.reason ?? ''))) throw Error('Phone locked; attempt excluded; unlock before further tasks');
    if (state.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status)) || state.ownerTestModes.length) throw Error('Cleanup incomplete');
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
