/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const { androidRuntimeDigest } = require('../lib/android/agent/runtime-storage.ts');
const serial = 'R58MA78W6QK';
async function main() {
  if (!process.argv.includes('--read-only')) throw Error('Read-only probe flag required.');
  const state = await (await fetch('http://127.0.0.1:3000/api/agent/runtime')).json();
  if (state.tasks.some(t => !t.finishedAt) || state.ownerTestModes.length || await readDeviceOwnership(serial, runAdb)) throw Error('Runtime must be idle and unowned.');
  const budget = new AgentBudget(), adapter = androidV2Adapter(serial, budget);
  if (await adapter.readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no action sent.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m7a-clock-probe-'));
  const report = { directory, runtimeSha256: androidRuntimeDigest(), serial, mode: 'READ_ONLY_LAUNCH_NAVIGATION_INVENTORY', operations: [], results: [] };
  const original = AppiumClient.prototype.request; let execution;
  AppiumClient.prototype.request = async function(method, route, body, ...rest) {
    const row = { at: Date.now(), method, route, body }; report.operations.push(row);
    try {
      const value = await original.call(this, method, route, body, ...rest);
      if (route.endsWith('/source')) { row.source = path.join(directory, report.operations.length + '-source.xml'); fs.writeFileSync(row.source, value); }
      else if (route.endsWith('/execute/sync')) row.result = value;
      return value;
    } catch (error) { row.error = error.message; throw error; }
  };
  try {
    const app = await adapter.resolveTemporalApp({ kind: 'ALARM', hour: 7, minute: 0, enabled: true, clock: 'DEVICE_LOCAL' });
    execution = await adapter.open([app]); report.sessionId = execution.sessionId();
    await execution.execute({ type: 'OPEN_APP', app: app.packageName });
    for (const request of [{ kind: 'ALARM', hour: 7, minute: 0, enabled: true, clock: 'DEVICE_LOCAL' }, { kind: 'TIMER', seconds: 120, start: true }]) {
      const row = { kind: request.kind, startedAt: Date.now() }; report.results.push(row);
      try { row.inventory = await execution.temporalUiInventoryV2(app.packageName, request); }
      catch (error) { row.error = error.message; }
      row.snapshot = await execution.observe();
      const screenshot = await new AppiumClient().request('GET', '/session/' + execution.sessionId() + '/screenshot');
      row.screenshot = path.join(directory, request.kind + '.png'); fs.writeFileSync(row.screenshot, Buffer.from(screenshot, 'base64'));
      console.log(JSON.stringify({ kind: row.kind, error: row.error, inventory: row.inventory, screenshot: row.screenshot }));
    }
  } finally {
    try { await execution?.close(); } finally { AppiumClient.prototype.request = original; }
    report.budget = budget.summary(); report.runtimeSha256After = androidRuntimeDigest(); report.ownershipAfter = await readDeviceOwnership(serial, runAdb) ?? null;
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ directory, ownershipAfter: report.ownershipAfter }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
