/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawnSync } = require('node:child_process'), crypto = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const keys = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET/.test(name) && value?.length >= 16).map(([, value]) => value);
const skip = new Set(['node_modules', '.git', '.local-drivers', 'sealed', 'holdout']);
const findings = [], oversized = []; let scannedFiles = 0, scannedBytes = 0;
function check(file) {
  const size = fs.statSync(file).size;
  if (size > 10000000) { oversized.push(file); return; }
  const value = fs.readFileSync(file, 'utf8'); scannedFiles++; scannedBytes += size;
  if (keys.some(key => value.includes(key)) || /(?:gsk_[A-Za-z0-9]{24,}|sk-proj-[A-Za-z0-9_-]{40,})/.test(value)) findings.push(file);
}
function walk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.env') || entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx|js|cjs|mjs|json|jsonl|html|map|md|log|txt)$/.test(entry.name)) check(file);
  }
}
async function main() {
  walk(process.cwd());
  const acceptance = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  walk(path.dirname(acceptance.output));
  const journals = path.join(os.tmpdir(), 'phone-commander-local-effects');
  if (fs.existsSync(journals)) walk(journals);
  const root = path.join(process.cwd(), 'lib', 'android');
  const hash = crypto.createHash('sha256').update(fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.ts')).sort().map(f => f + '\n' + fs.readFileSync(path.join(root, f), 'utf8')).join('\n')).digest('hex');
  const diff = spawnSync('git', ['diff', '--check'], { encoding: 'utf8', windowsHide: true });
  const current = await (await fetch('http://127.0.0.1:3000/api/agent/runtime', { signal: AbortSignal.timeout(30000) })).json();
  const output = path.join(os.tmpdir(), 'phone-commander-m6a-final-audit.json');
  const report = { at: new Date().toISOString(), secretScan: { scannedFiles, scannedBytes, matchingPaths: findings, oversized,
    exclusions: ['environment files', 'dependencies', '.git', 'sealed', 'holdout', 'binary images', 'unrelated TEMP'], transcriptNotScannable: true },
    diffCheck: { exitCode: diff.status, output: diff.stdout, warnings: diff.stderr }, runtimeSha256: hash, acceptanceRuntimeUnchanged: hash === acceptance.runtimeSha256,
    activeTasks: current.tasks.filter(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status)).length, ownerModes: current.ownerTestModes.length };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, scannedFiles, scannedBytes, secretMatches: findings.length, oversized: oversized.length, diffExitCode: diff.status, runtimeUnchanged: report.acceptanceRuntimeUnchanged, activeTasks: report.activeTasks, ownerModes: report.ownerModes }));
  if (findings.length || diff.status !== 0 || !report.acceptanceRuntimeUnchanged || report.activeTasks || report.ownerModes) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
