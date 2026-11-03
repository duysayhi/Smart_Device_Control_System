/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { selectorForNode } = require('../lib/android/state-observer.ts');
async function main() {
  const [device, ...packages] = process.argv.slice(2), state = await (await fetch('http://127.0.0.1:3000/api/agent/runtime')).json();
  if (!device || !packages.length || state.tasks.some(t => ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(t.status))) throw Error('Device/apps required; runtime must be idle');
  const adapter = androidV2Adapter(device, new AgentBudget());
  if (await adapter.readiness() !== 'READY') throw Error('Unlock phone first');
  const apps = []; for (const p of packages) { const a = await adapter.catalog.resolve(p, 'LAUNCH'); if (!a.app) throw Error('App not verified'); apps.push(a.app); }
  const execution = await adapter.open(apps), client = new AppiumClient(), screens = [], root = '/session/' + encodeURIComponent(execution.sessionId());
  try {
    for (const app of apps) {
      await execution.execute({ type: 'OPEN_APP', app: app.packageName });
      const snapshot = await execution.observe(), attributes = [];
      for (const node of snapshot.nodes.filter(n => /EditText|AutoCompleteTextView/.test(n.className))) {
        const elements = await client.request('POST', root + '/elements', selectorForNode(node, snapshot.nodes));
        if (elements.length !== 1) continue;
        const values = {};
        for (const key of ['text', 'hint', 'showingHintText', 'password', 'focused', 'extras']) {
          try { values[key] = await client.request('GET', root + '/element/' + elements[0]['element-6066-11e4-a52e-4f735466cecf'] + '/attribute/' + key); }
          catch (e) { values[key] = e.message; }
        }
        attributes.push({ node, values });
      }
      const xml = await client.request('GET', root + '/source');
      screens.push({ app: app.packageName, snapshot, attributes, xml });
      console.log(JSON.stringify({ app: app.packageName, attributes }));
    }
  } finally { await execution.close(); }
  const output = path.join(os.tmpdir(), 'm3d-recon-' + Date.now() + '.json'); fs.writeFileSync(output, JSON.stringify({ screens }, null, 2)); console.log(output);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
