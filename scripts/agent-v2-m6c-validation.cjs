/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6c-validation-')), results = [];
function run(name, args, timeout = 420000) {
  const started = performance.now(), child = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = (child.stdout || '') + '\n' + (child.stderr || '') + (child.error ? '\n' + child.error.message : '');
  const log = path.join(directory, name + '.log'); fs.writeFileSync(log, output);
  const row = { name, exitCode: child.status, signal: child.signal, elapsedMs: performance.now() - started, log };
  if (name === 'regression') { try { row.summary = JSON.parse((child.stdout || '').trim().split(/\r?\n/).at(-1)); } catch { row.parseFailure = true; } }
  if (name === 'eslint-full') row.knownUnrelatedOnly = /130:98\s+error\s+Unexpected any/.test(output) && /1 error, 9 warnings/.test(output);
  results.push(row); save(); console.log(JSON.stringify(row));
}
function save() { fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ directory, results }, null, 2)); }
console.log(JSON.stringify({ directory }));
run('regression', ['scripts/agent-v2-m6a-validation.cjs'], 600000);
run('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
run('eslint-scoped', ['node_modules/eslint/bin/eslint.js',
  ...['temporal-contract', 'temporal-ui', 'temporal-ui-inventory', 'temporal-ui-runner', 'agent-v2', 'goal-graph', 'grounded-candidates-v2', 'effect-grants', 'local-effect-journal'].map(f => 'lib/android/agent/' + f + '.ts'),
  'lib/android/grounded-interactions.ts', 'lib/android/condition-executor.ts', 'components/commands/AgentGoalPanel.tsx', 'tests/agent-v2-m6c.test.cjs', 'scripts/agent-v2-m6c-survey.cjs', 'scripts/agent-v2-m6c-validation.cjs', 'scripts/agent-v2-m6c-acceptance.cjs']);
run('eslint-full', ['node_modules/eslint/bin/eslint.js', '.']);
run('webpack-build', ['node_modules/next/dist/bin/next', 'build', '--webpack']);
const diff = spawnSync('git', ['diff', '--check'], { encoding: 'utf8', windowsHide: true });
fs.writeFileSync(path.join(directory, 'diff-check.log'), (diff.stdout || '') + (diff.stderr || ''));
results.push({ name: 'diff-check', exitCode: diff.status, log: path.join(directory, 'diff-check.log') });
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const secrets = Object.entries(process.env).filter(([k, v]) => /(?:KEY|TOKEN)$/.test(k) && v?.length >= 16).map(([, v]) => v), matches = []; let scanned = 0;
function scan(root) { for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (['.git', 'node_modules', '.next', 'sealed', 'holdout', '.local-drivers'].includes(d.name) || d.name.startsWith('.env') || d.isSymbolicLink()) continue;
  const file = path.join(root, d.name); if (d.isDirectory()) scan(file);
  else if (/\.(?:ts|tsx|cjs|md|json|jsonl|log)$/.test(d.name) && fs.statSync(file).size < 10000000) { const text = fs.readFileSync(file, 'utf8'); scanned++; if (secrets.some(s => text.includes(s)) || /gsk_[A-Za-z0-9]{24,}/.test(text)) matches.push(file); }
} }
scan(process.cwd()); results.push({ name: 'secret-scan', exitCode: matches.length ? 1 : 0, scanned, matchingPaths: matches, excluded: ['env', 'dependencies', 'build', 'git', 'sealed', 'holdout', 'external logs/tool transcript'] }); save();
process.exitCode = results.some(r => r.exitCode !== 0 && !(r.name === 'eslint-full' && r.knownUnrelatedOnly)) ? 1 : 0;
console.log(JSON.stringify({ summary: path.join(directory, 'summary.json'), exitCode: process.exitCode }));
