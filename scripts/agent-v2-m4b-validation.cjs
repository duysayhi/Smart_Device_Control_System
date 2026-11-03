/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const scoped = [
  'lib/android/agent/intent-schema.ts', 'lib/android/agent/intent-capabilities.ts', 'lib/android/agent/intent-executor.ts', 'lib/android/agent/reasoning-provider.ts',
  'lib/android/agent/agent-v2.ts', 'lib/android/agent/budget.ts', 'lib/android/agent/schema.ts', 'lib/android/agent/goal-graph.ts', 'lib/android/agent/outcome-spec.ts',
  'lib/android/agent/goal-compiler.ts', 'lib/android/agent/capability-registry.ts', 'lib/android/agent/ollama.ts', 'lib/android/appium/client.ts',
  'lib/android/appium/session-manager.ts', 'lib/android/condition-executor.ts', 'scripts/agent-v2-acceptance.cjs', 'tests/general-agent-v2-m4b.test.cjs',
  'scripts/agent-v2-m4b-benchmark.cjs', 'scripts/agent-v2-m4b-evaluation.cjs', 'scripts/agent-v2-m4b-worker.cjs', 'scripts/agent-v2-m4b-validation.cjs',
];
async function main() {
  if (!process.argv.includes('--run')) throw Error('Explicit --run required; do not overlap benchmarks or device acceptance');
  const mode = process.argv.includes('--m4e') ? 'm4e' : process.argv.includes('--groq') ? 'groq' : process.argv.includes('--m4d') ? 'm4d' : 'm4b';
  if (mode === 'groq' || mode === 'm4e') scoped.push('components/commands/AgentGoalPanel.tsx', 'tests/groq-router.test.cjs',
    'scripts/agent-v2-groq-benchmark.cjs', 'scripts/agent-v2-groq-android.cjs', 'scripts/agent-v2-groq-secret-scan.cjs', 'scripts/agent-v2-groq-summary.cjs');
  if (mode === 'm4e') scoped.push('lib/android/agent/source-value.ts', 'lib/android/agent/source-slots.ts', 'lib/android/agent/primitive-decomposition.ts',
    'lib/android/agent/compatible-choice.ts', 'lib/android/agent/cloud-command.ts', 'lib/android/agent/open-world-plan.ts',
    'tests/general-agent-v2-m4e.test.cjs', 'scripts/agent-v2-m4e-benchmark.cjs', 'scripts/agent-v2-m4e-summary.cjs');
  if (mode === 'm4d') scoped.push('lib/android/agent/full-control-policy.ts', 'lib/android/agent/setting-schema.ts', 'lib/android/agent/setting-mutations.ts',
    'lib/android/agent/strategy-reflection.ts', 'lib/android/agent/owner-test-policy.ts', 'lib/android/agent/effect-grants.ts', 'lib/android/agent/runtime-schema.ts',
    'lib/android/agent/device-runtime.ts', 'lib/android/agent/worker-server.ts', 'lib/android/agent/runtime-storage.ts', 'lib/android/agent/worker-client.ts',
    'components/commands/AgentGoalPanel.tsx', 'tests/general-agent-v2-m4d.test.cjs', 'scripts/agent-v2-m4d-acceptance.cjs');
  const report = { rows: [] }, prefix = path.join(os.tmpdir(), 'agent-v2-' + mode + '-validation-' + Date.now());
  const steps = [
    ['regression', ['--test', ...fs.readdirSync('tests').filter(f => f.endsWith('.test.cjs')).map(f => 'tests/' + f)]],
    ['typescript', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']],
    ['scoped-eslint', ['node_modules/eslint/bin/eslint.js', ...scoped]],
    ['full-eslint', ['node_modules/eslint/bin/eslint.js', '.']],
    ['build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ];
  for (const [name, args] of steps) {
    const log = prefix + '-' + name + '.log', fd = fs.openSync(log, 'w'), start = performance.now();
    const code = await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
      c.once('error', reject); c.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    fs.closeSync(fd); report.rows.push({ name, ...code, elapsedMs: performance.now() - start, log });
    fs.writeFileSync(prefix + '.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.rows.at(-1)));
  }
  console.log(prefix + '.json');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
