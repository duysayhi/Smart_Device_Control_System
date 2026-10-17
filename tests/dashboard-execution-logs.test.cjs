/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
let cursor = 0;
const states = [], refs = [];
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === 'react') return {
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = initial;
      return [states[i], next => {
        if (typeof next !== 'function') { states[i] = next; return; }
        // Strict Mode can replay state updaters against the same previous state.
        const first = next(states[i]), second = next(states[i]);
        assert.deepEqual(second, first, 'state updater must be pure');
        states[i] = second;
      }];
    },
    useRef(initial) { const i = cursor++; return refs[i] ??= { current: initial }; },
    useEffect() {}, useCallback: fn => fn,
  };
  return load.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, parent, main);
};
const { useDashboardDemo } = require('../hooks/useDashboardDemo.ts');
const render = () => { cursor = 0; return useDashboardDemo(); };

test('batched progress in the same millisecond has unique log keys and replay-safe ordering', async () => {
  const originalFetch = global.fetch, now = Date.now;
  const plan = { intent: 'open_settings', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'settings' }] };
  let executions = 0;
  global.fetch = async url => {
    if (url === '/api/devices') return Response.json({ success: true, devices: [{ serial: 'test', model: 'Test', status: 'device', connectionType: 'USB' }] });
    if (url === '/api/commands/interpret') return Response.json({ success: true, actionPlan: plan });
    assert.equal(url, '/api/executions'); executions++;
    const step = { index: 0, action: plan.actions[0], status: 'EXECUTING' };
    return new Response([
      { type: 'progress', steps: [{ ...step, phase: 'EXECUTING' }] },
      { type: 'progress', steps: [{ ...step, phase: 'WAITING' }] },
      { type: 'progress', steps: [{ ...step, phase: 'WAITING' }] },
      { type: 'progress', steps: [{ ...step, status: 'SUCCESS' }] },
      { type: 'complete', steps: [{ ...step, status: 'SUCCESS' }], success: true, status: 'SUCCESS' },
    ].map(event => JSON.stringify(event)).join('\n'));
  };
  Date.now = () => 1234;
  try {
    await render().refreshAndroidDevices();
    await render().handleAnalyzeCommand();
    await render().handleExecuteCommand();
    const dashboard = render();
    assert.equal(executions, 1);
    assert.equal(dashboard.executionStatus, 'SUCCESS');
    const logs = dashboard.logs.filter(log => log.id.startsWith('step-'));
    assert.equal(logs.length, 3, 'identical progress is not logged again');
    assert.equal(new Set(logs.map(log => log.id)).size, logs.length);
    assert.deepEqual(logs.map(log => log.status), ['SUCCESS', 'EXECUTING', 'EXECUTING']);
  } finally { global.fetch = originalFetch; Date.now = now; }
});
