/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6b-validation-')), results = [];
function run(name, args, timeout = 240000) {
  const started = performance.now(), child = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = (child.stdout || '') + '\n' + (child.stderr || '') + (child.error ? '\n' + child.error.message : '');
  const log = path.join(directory, name + '.log'); fs.writeFileSync(log, output);
  const result = { name, exitCode: child.status, signal: child.signal, elapsedMs: performance.now() - started, log };
  if (name === 'regression') {
    const last = (child.stdout || '').trim().split(/\r?\n/).at(-1); try { result.summary = JSON.parse(last); } catch { result.parseFailure = true; }
  }
  if (name === 'eslint-full') result.knownUnrelatedOnly = /130:98\s+error\s+Unexpected any/.test(output) && /1 error, 9 warnings/.test(output);
  results.push(result); fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ directory, results }, null, 2)); console.log(JSON.stringify(result)); return result;
}
console.log(JSON.stringify({ directory }));
run('regression', ['scripts/agent-v2-m6a-validation.cjs'], 420000);
run('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
const files = ['lib/android/agent/temporal-contract.ts', 'lib/android/agent/temporal-evidence.ts', 'lib/android/agent/temporal-executor.ts', 'lib/android/agent/temporal-clarification.ts', 'lib/android/agent/agent-v2.ts', 'lib/android/agent/outcome-spec.ts', 'lib/android/agent/capability-registry.ts', 'lib/android/agent/goal-graph.ts', 'lib/android/agent/goal-compiler.ts', 'lib/android/agent/permission-decision.ts', 'lib/android/agent/effect-grants.ts', 'lib/android/agent/local-effect-journal.ts', 'lib/android/condition-executor.ts', 'tests/agent-v2-m6b.test.cjs', 'scripts/agent-v2-m6b-acceptance.cjs', 'scripts/agent-v2-m6b-validation.cjs'];
run('eslint-scoped', ['node_modules/eslint/bin/eslint.js', ...files]);
run('eslint-full', ['node_modules/eslint/bin/eslint.js', '.']);
run('webpack-build', ['node_modules/next/dist/bin/next', 'build', '--webpack'], 420000);
const diff = spawnSync('git', ['diff', '--check'], { encoding: 'utf8', windowsHide: true });
fs.writeFileSync(path.join(directory, 'diff-check.log'), (diff.stdout || '') + (diff.stderr || ''));
results.push({ name: 'diff-check', exitCode: diff.status, log: path.join(directory, 'diff-check.log') });
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ directory, node: process.execPath, results }, null, 2));
process.exitCode = results.some(r => r.exitCode !== 0 && !(r.name === 'eslint-full' && r.knownUnrelatedOnly)) ? 1 : 0;
console.log(JSON.stringify({ summary: path.join(directory, 'summary.json'), exitCode: process.exitCode }));
