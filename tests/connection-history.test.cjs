/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, fileName: f,
}).outputText, f);
const { ConnectionHistory } = require('../components/devices/ConnectionManager.tsx');
const connection = (port, lastConnectedAt, extra = {}) => ({ serial: `192.168.50.9:${port}`, ip: '192.168.50.9', port, state: 'DISCONNECTED', lastConnectedAt, ...extra });
const render = (connections, pending = false) => renderToStaticMarkup(React.createElement(ConnectionHistory, { connections, pending, onCommand() { assert.fail('Rendering must not send a connection command'); } }));

test('connection history is bounded to four fixed-height rows without discarding older endpoints', () => {
  const rows = Array.from({ length: 9 }, (_, i) => connection(40000 + i, i + 1));
  const before = JSON.stringify(rows), html = render(rows);
  assert.match(html, /h-80 overflow-y-auto overscroll-contain/);
  assert.equal((html.match(/<li /g) || []).length, 9);
  assert.equal((html.match(/grid h-20 /g) || []).length, 9);
  assert.match(html, /tabindex="0"/);
  assert.ok(html.indexOf('40008') < html.indexOf('40007'));
  assert.ok(html.indexOf('40007') < html.indexOf('40000'));
  assert.equal(JSON.stringify(rows), before);
});

test('connection history puts latest success first and uses newest registry position for equal or missing dates', () => {
  const html = render([connection(41001), connection(41002, 100), connection(41003, 100), connection(41004)]);
  const order = [...html.matchAll(/aria-label="[^"<>]*?(192\.168\.50\.9:\d+)"/g)].map(m => m[1]);
  assert.deepEqual(order.filter((_, i) => i % 2 === 0), ['192.168.50.9:41003', '192.168.50.9:41002', '192.168.50.9:41004', '192.168.50.9:41001']);
});

test('long errors stay within a history row and remain available as full escaped tooltips', () => {
  const html = render([connection(42001, 1, { model: 'A very long device model name', error: 'Connection <failed> '.repeat(20) })]);
  assert.match(html, /role="alert" class="truncate text-red-600" title="Connection &lt;failed&gt;/);
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test('busy/pending protections remain and empty history does not reserve an empty frame', () => {
  assert.equal(render([]), '');
  const busy = render([connection(43001, 1, { state: 'BUSY' })]);
  assert.equal((busy.match(/disabled=""/g) || []).length, 1);
  assert.equal((render([connection(43001, 1)], true).match(/disabled=""/g) || []).length, 2);
});
