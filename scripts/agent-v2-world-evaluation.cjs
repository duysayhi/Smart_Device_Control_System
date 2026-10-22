/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { createHash } = require('node:crypto'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
const { runAdb } = require('../lib/android/adb.ts');
const { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { understandUiWorld } = require('../lib/android/agent/ui-world-model.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
function sourceDigest() {
  const files = fs.readdirSync('lib/android', { recursive: true }).filter(f => f.endsWith('.ts')).sort();
  return createHash('sha256').update(files.map(f => f + '\n' + fs.readFileSync(path.join('lib/android', f), 'utf8')).join('\n')).digest('hex');
}
async function main() {
  const [device, ...packages] = process.argv.slice(2);
  if (!device || !packages.length || packages.some(p => !/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(p))) throw Error('Usage: node scripts/agent-v2-world-evaluation.cjs <device> <installed-package> ...');
  const runtime = await (await fetch('http://127.0.0.1:3000/api/agent/runtime', { signal: AbortSignal.timeout(15000) })).json();
  if (!runtime.tasks || runtime.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status))) throw Error('Runtime not idle; no Session created.');
  const ready = deviceReadiness((await runAdb(['-s', device, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout);
  if (ready !== 'READY') throw Error('Device not ready: ' + ready);
  const frozen = sourceDigest(), budget = new AgentBudget(), catalog = new AppCatalog(device, runAdb);
  const apps = [];
  for (const pkg of packages) {
    const resolved = await catalog.resolve(pkg, 'LAUNCH');
    if (!resolved.app) throw Error('Installed application not verified: ' + pkg);
    apps.push(resolved.app);
  }
  let execution; const screens = [], start = Date.now();
  try {
    execution = await androidV2Adapter(device, budget).open(apps);
    for (const app of apps) {
      if (deviceReadiness((await runAdb(['-s', device, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout) !== 'READY') throw Error('Device locked during evaluation.');
      await execution.execute({ type: 'OPEN_APP', app: app.packageName });
      const snapshot = await execution.observe();
      if (snapshot.foregroundPackage !== app.packageName) throw Error('Foreground changed; no further app launched.');
      const world = understandUiWorld(snapshot, 'read-only-evaluation', execution.sessionId());
      screens.push({ app: app.packageName, world });
      console.log(JSON.stringify({ app: app.packageName, state: world.state, widgets: world.widgets.length, groups: world.groups.length,
        roles: [...new Set(world.widgets.flatMap(w => w.roles))], uniqueIdentities: world.widgets.filter(w => w.identity).length }));
    }
  } finally { await execution?.close(); }
  if (sourceDigest() !== frozen) throw Error('Runtime changed during evaluation; results invalid.');
  const file = path.join(os.tmpdir(), 'agent-v2-world-evaluation-' + Date.now() + '.json');
  fs.writeFileSync(file, JSON.stringify({ classification: 'REAL_DEVICE_OBSERVATION_ONLY', runtimeSha256: frozen, device, screens, elapsedMs: Date.now() - start,
    metrics: budget.summary(), verifiedGoalCompletion: 'UNVERIFIED', mutationScope: 'APP_LAUNCH_ONLY' }, null, 2));
  console.log(JSON.stringify({ evidence: file, elapsedMs: Date.now() - start, runtimeSha256: frozen }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
