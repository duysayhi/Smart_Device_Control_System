/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { AppCatalog } = require('../lib/android/agent/app-catalog.ts');
const { createExecutionContext } = require('../lib/android/condition-executor.ts');
const { deviceReadiness } = require('../lib/android/agent/device-readiness.ts');
const { observedAffordances } = require('../lib/android/agent/ui-affordances.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { geometryFingerprint } = require('../lib/android/visual-grounding.ts');
async function main() {
  const [serial, ...args] = process.argv.slice(2), split = args.indexOf('--inspect-labels');
  const packages = split < 0 ? args : args.slice(0, split), labels = split < 0 ? [] : args.slice(split + 1);
  if (labels.length && packages.length !== 1) throw Error('Inspect labels requires exactly one package. Opening an empty editor must be separately owner-authorized.');
  if (!serial || !packages.length || packages.some(p => !/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(p))) throw Error('Usage: node scripts/agent-v2-recon.cjs <serial> <installed-package> ...');
  const catalog = new AppCatalog(serial, runAdb), inventory = await catalog.inventory();
  const readiness = async () => deviceReadiness((await runAdb(['-s', serial, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout);
  if (await readiness() !== 'READY') throw Error('Device must be awake and unlocked; no action sent.');
  for (const p of packages) if (!inventory.some(row => row.packageName === p)) throw Error('Not in observed launcher catalog: ' + p);
  const output = path.join(os.tmpdir(), 'phone-commander-recon-' + Date.now() + '.json');
  const report = { serial, observedAt: Date.now(), inventory, screens: [] };
  let execution;
  try {
    execution = await createExecutionContext(serial, packages.map(app => ({ type: 'OPEN_APP', app })), runAdb);
    for (const app of packages) {
      if (await readiness() !== 'READY') throw Error('Device locked during reconnaissance.');
      await execution.execute({ type: 'OPEN_APP', app });
      const snapshot = await execution.observe();
      if (snapshot.foregroundPackage !== app) throw Error('Foreground mismatch; stop reconnaissance.');
      report.screens.push({ app, snapshot, affordances: observedAffordances(snapshot, 'read-only-recon', execution.sessionId()) });
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ app, snapshotId: snapshot.snapshotId, nodes: snapshot.nodes.length,
        controls: report.screens.at(-1).affordances.filter(r => r.roles.some(role => ['editable', 'navigation', 'save', 'clickable', 'checkable'].includes(role))).map(r => ({ label: r.label, hint: r.hint, className: r.className, resourceId: r.resourceId, roles: r.roles, checked: r.checked })) }));
      for (const label of labels) {
        if (await readiness() !== 'READY') throw Error('Device locked; no diagnostic click sent.');
        const before = await execution.observe();
        const matches = observedAffordances(before, 'read-only-recon', execution.sessionId()).filter(row => row.label === label && row.enabled && row.roles.includes('clickable') && !row.sensitive && !row.destructive && !row.roles.some(role => ['editable', 'save', 'capture', 'checkable'].includes(role)));
        if (matches.length !== 1) throw Error('Diagnostic target absent/ambiguous or outside read-only scope: ' + label);
        const node = before.nodes[matches[0].index];
        if (!node.description) throw Error('Diagnostic navigation requires an exact observed accessibility label.');
        const client = new AppiumClient(), root = '/session/' + execution.sessionId();
        const found = await client.request('POST', root + '/elements', { using: 'accessibility id', value: node.description });
        if (found.length !== 1 || Date.now() - before.timestamp > 5000) throw Error('Diagnostic grounding ambiguous/stale.');
        await client.request('POST', root + '/element/' + encodeURIComponent(found[0]['element-6066-11e4-a52e-4f735466cecf']) + '/click', {});
        let next; const deadline = Date.now() + 10000;
        for (let attempt = 0; attempt < 6; attempt++) {
          next = await execution.observe();
          if (geometryFingerprint(next) !== geometryFingerprint(before)) break;
          if (Date.now() >= deadline || attempt === 5) throw Error('Navigation response not observed; no click retry.');
        }
        if (next.foregroundPackage !== app) throw Error('Diagnostic navigation left expected application.');
        report.screens.push({ app, afterLabel: label, snapshot: next, affordances: observedAffordances(next, 'read-only-recon', execution.sessionId()) });
        fs.writeFileSync(output, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ afterLabel: label, snapshotId: next.snapshotId, controls: report.screens.at(-1).affordances.map(row => ({ label: row.label, hint: row.hint, text: row.text, className: row.className, resourceId: row.resourceId, roles: row.roles, checked: row.checked })) }));
      }
    }
  } finally { await execution?.close(); console.log('Recon evidence:', output); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
