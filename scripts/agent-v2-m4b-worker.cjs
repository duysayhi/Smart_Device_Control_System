/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
async function main() {
  const idle = process.argv[2]; if (!['500', '1000'].includes(idle)) throw Error('Only explicit 500/1000 experiment allowed');
  const state = await (await fetch('http://127.0.0.1:3000/api/agent/runtime')).json();
  if (state.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status)) || state.ownerTestModes.length) throw Error('Worker must be idle with no owner authorization');
  await new Promise((resolve, reject) => { const c = spawn(process.execPath, ['scripts/agent-worker.cjs', '--stop'], { windowsHide: true, stdio: 'inherit' }); c.once('error', reject); c.once('exit', code => code ? reject(Error('Shutdown failed')) : resolve()); });
  // The shutdown endpoint drains Session cleanup; allow its asynchronous close to finish.
  await new Promise(r => setTimeout(r, 2000));
  const log = path.join(os.tmpdir(), 'agent-v2-m4b-worker-' + idle + '-' + Date.now() + '.log'), fd = fs.openSync(log, 'a');
  const c = spawn(process.execPath, ['scripts/agent-worker.cjs'], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, AGENT_V2_OBSERVER_IDLE_TIMEOUT_MS: idle } });
  c.unref(); fs.closeSync(fd);
  const root = path.join(os.tmpdir(), 'phone-commander-runtime-' + crypto.createHash('sha256').update(path.resolve(process.cwd()).toLowerCase()).digest('hex').slice(0, 20));
  const source = path.join(process.cwd(), 'lib', 'android');
  const expectedSha = crypto.createHash('sha256').update(fs.readdirSync(source, { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join(source, f), 'utf8')).join('\n')).digest('hex');
  let verified = false, runningPid;
  for (let i = 0; i < 30; i++) {
    try { const a = JSON.parse(fs.readFileSync(path.join(root, 'address.json'))); if (a.runtimeSha256 === expectedSha && a.observerIdleTimeoutMs === Number(idle)) { verified = true; runningPid = a.pid; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(JSON.stringify({ pid: c.pid, runningPid, runtimeSha256: expectedSha, idleTimeoutMs: Number(idle), log, workerSourceAndSettingsVerified: verified }));
  if (!verified) throw Error('Experiment worker did not acquire ownership; do not count paired data');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
