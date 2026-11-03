/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { observedAffordances } = require('../lib/android/agent/ui-affordances.ts');
const { resolveInteractionTarget } = require('../lib/android/interaction-target-resolver.ts');
const { foldIntent } = require('../lib/android/agent/outcome-spec.ts');
async function main() {
  const observeOnly = process.argv.includes('--observe-only');
  const [device, ...packages] = process.argv.slice(2).filter(a => a !== '--observe-only'), state = await (await fetch('http://127.0.0.1:3000/api/agent/runtime')).json();
  if (!device || !packages.length || packages.some(p => !/^[\w]+(?:\.[\w]+)+$/.test(p)) || state.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status))) throw Error('Invalid args or runtime busy');
  const adapter = androidV2Adapter(device, new AgentBudget());
  if (await adapter.readiness() !== 'READY') throw Error('Unlock phone first');
  const apps = []; for (const p of packages) { const a = await adapter.catalog.resolve(p, 'LAUNCH'); if (!a.app) throw Error('App not verified'); apps.push(a.app); }
  const execution = await adapter.open(apps), screens = [];
  try {
    for (const app of apps) {
      if (!observeOnly) await execution.execute({ type: 'OPEN_APP', app: app.packageName });
      const snapshot = await execution.observe();
      if (snapshot.foregroundPackage !== app.packageName) throw Error('Wrong foreground');
      const affordances = observedAffordances(snapshot, 'recon', execution.sessionId());
      const targets = affordances.filter(a => /search|query|tim kiem|tra cuu/.test(foldIntent([a.label, a.resourceId, a.hint].join(' '))));
      const details = targets.map(a => {
        const ancestors = []; let p = snapshot.nodes[a.index].parentIndex;
        while (p !== undefined && ancestors.length < 8) { const n = snapshot.nodes[p]; ancestors.push({ index: p, className: n.className, clickable: n.clickable, checkable: n.checkable, selected: n.selected, resourceId: n.resourceId }); p = n.parentIndex; }
        const resolution = resolveInteractionTarget(snapshot, snapshot.nodes[a.index]);
        return { index: a.index, className: a.className, resourceId: a.resourceId, roles: a.roles, enabled: a.enabled, focused: a.focused, selected: a.selected, sensitive: a.sensitive, destructive: a.destructive, navigationIntent: a.navigationIntent,
          resolution: { status: resolution.status, reason: resolution.reason }, ancestors };
      });
      screens.push({ app: app.packageName, snapshot, details }); console.log(JSON.stringify({ app: app.packageName, details }));
    }
  } finally { await execution.close(); }
  const output = path.join(require('node:os').tmpdir(), 'm3c-recon-' + Date.now() + '.json'); fs.writeFileSync(output, JSON.stringify({ screens }, null, 2)); console.log(output);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
