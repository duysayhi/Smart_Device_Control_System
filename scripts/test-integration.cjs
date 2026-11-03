/* eslint-disable @typescript-eslint/no-require-imports */
// Reproducible offline regression. No sealed/held-out cohorts or operator acceptance scripts.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(file => /\.test\.(cjs|mjs)$/.test(file) && !/(?:held.?out|open-world)/i.test(file)).sort();
const targeted = process.argv.includes('--teach');
const selected = files.filter(file => !targeted || /^(?:teach-|owner-|history-|legacy-retirement)/.test(file));
const evidence = path.join(root, 'coverage', 'team-integration');
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(evidence, targeted ? 'targeted-manifest.json' : 'regression-manifest.json'), JSON.stringify(selected, null, 2));
const env = { ...process.env, PHONE_COMMANDER_TEST_EVIDENCE: evidence };
for (const key of Object.keys(env)) {
  if (/^(?:DATABASE_URL|GROQ_API_KEY|PHONE_COMMANDER_ENV_FILE|NODE_OPTIONS)$|^(?:TEACH_|HISTORY_|AGENT_|OWNER_)/.test(key)) delete env[key];
}
const result = cp.spawnSync(process.execPath, ['--require', path.join(root, 'tests/helpers/offline-integration-guard.cjs'), '--test', '--test-concurrency=1', ...selected.map(file => path.join('tests', file))], { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.code ?? 'TEST_PROCESS_FAILED');
process.exitCode = result.status ?? 1;
