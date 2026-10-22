/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb } = require('../lib/android/adb.ts');
const { androidV2Adapter } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const { AppiumClient } = require('../lib/android/appium/client.ts');
const { selectorForNode } = require('../lib/android/state-observer.ts');
async function main() {
  const serial = process.argv[2]; if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw Error('Pass device serial as argv');
  const state = await (await fetch('http://127.0.0.1:3000/api/agent/runtime')).json();
  if (state.tasks.some(t => ['RUNNING', 'QUEUED', 'WAITING_HUMAN'].includes(t.status)) || state.ownerTestModes.length || await readDeviceOwnership(serial, runAdb)) throw Error('Runtime/device must be idle');
  const budget = new AgentBudget(), adapter = androidV2Adapter(serial, budget);
  if (await adapter.readiness() !== 'READY') throw Error('DEVICE_UNLOCK_REQUIRED: no task counted');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6c-survey-')), report = { directory, sources: [], screens: [] };
  console.log(JSON.stringify({ directory }));
  for (const [name, args] of [['next_alarm_formatted', ['settings', 'get', 'system', 'next_alarm_formatted']], ['time_format', ['settings', 'get', 'system', 'time_12_24']], ['timezone', ['getprop', 'persist.sys.timezone']], ['alarm', ['dumpsys', 'alarm']], ['notification', ['dumpsys', 'notification']], ['statusbar', ['dumpsys', 'statusbar']]]) {
    const started = performance.now(), row = { name };
    try {
      const r = await runAdb(['-s', serial, 'shell', ...args], 10000);
      row.status = /Permission Denial|SecurityException|not found/i.test(r.stdout + r.stderr) ? 'DENIED_OR_UNAVAILABLE' : 'READABLE';
      row.output = ['notification', 'statusbar'].includes(name) ? r.stdout.split(/\r?\n/).filter(line => /next[_ -]?alarm|alarm_clock|alarmclock/i.test(line)).join('\n') : r.stdout;
      if (name === 'alarm') fs.writeFileSync(path.join(directory, 'alarm.txt'), r.stdout);
    } catch (e) { row.status = 'ERROR'; row.error = e.message; }
    row.elapsedMs = performance.now() - started; report.sources.push(row);
  }
  const app = await adapter.resolveTemporalApp({ kind: 'ALARM', hour: 7, minute: 0, enabled: true, clock: 'DEVICE_LOCAL' });
  if (!app) throw Error('Clock unresolved');
  let execution;
  try {
    execution = await adapter.open([app]); const client = new AppiumClient();
    await execution.execute({ type: 'OPEN_APP', app: app.packageName });
    for (const [kind, pattern] of [['ALARM', /^(Alarm|Báo thức|Chuông báo)/i], ['TIMER', /^(Timer|Hẹn giờ|Đếm giờ|Bộ đếm)/i]]) {
      let s = await execution.observe(); const tabs = s.nodes.filter(n => /Tab/.test(n.className) && pattern.test(n.description || n.text) && n.enabled);
      if (tabs.length !== 1) throw Error('Unique observed tab missing');
      if (!tabs[0].selected) {
        const found = await client.request('POST', '/session/' + execution.sessionId() + '/elements', selectorForNode(tabs[0], s.nodes));
        if (found.length !== 1) throw Error('Ambiguous tab');
        await client.request('POST', '/session/' + execution.sessionId() + '/element/' + found[0]['element-6066-11e4-a52e-4f735466cecf'] + '/click', {});
      }
      const deadline = Date.now() + 10000;
      do { s = await execution.observe(); } while (!s.nodes.some(n => /Tab/.test(n.className) && pattern.test(n.description || n.text) && n.selected) && Date.now() < deadline);
      const screen = { kind, snapshot: s }; report.screens.push(screen);
      if (process.argv.includes('--inventory')) {
        const started = performance.now();
        try { screen.inventory = await execution.temporalUiInventoryV2(app.packageName, kind === 'ALARM' ? { kind, hour: 7, minute: 0, enabled: true, clock: 'DEVICE_LOCAL' } : { kind, seconds: 600, start: true }); }
        catch (error) { screen.inventoryError = error.message; }
        screen.inventoryMs = performance.now() - started;
        console.log(JSON.stringify({ kind, inventory: screen.inventory, error: screen.inventoryError, elapsedMs: screen.inventoryMs }));
      }
      fs.writeFileSync(path.join(directory, kind + '.png'), Buffer.from(await client.request('GET', '/session/' + execution.sessionId() + '/screenshot'), 'base64'));
    }
  } finally { await execution?.close(); report.profiling = budget.summary(); fs.writeFileSync(path.join(directory, 'survey.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ directory, sources: report.sources.map(r => ({ name: r.name, status: r.status, output: ['alarm'].includes(r.name) ? r.output.split(/\r?\n/).filter(l => /next alarm clock|triggerTime|user:|type=0|RTC_WAKEUP/i.test(l)).slice(0, 20).join('\n') : r.output })), screens: report.screens.map(r => ({ kind: r.kind, nodes: r.snapshot.nodes.length })) }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
