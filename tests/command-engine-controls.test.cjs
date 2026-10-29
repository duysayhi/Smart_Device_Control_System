/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, f) => {
  const original = m.require.bind(m); m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { CommandEngineControl } = require('../components/commands/CommandEngineControl.tsx');
const { UnifiedAgentPanel } = require('../components/commands/UnifiedAgentPanel.tsx');
const { AgentGoalPanel } = require('../components/commands/AgentGoalPanel.tsx');
function elements(tree) { return React.isValidElement(tree) ? [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)] : []; }
const props = { text: 'Mở YouTube', onText() {}, serial: '', onSerial() {}, onRefresh() {}, devices: [], selectedDeviceIds: [], runtime: { tasks: [], ownerTestModes: [], command: async () => {} } };

for (const value of ['', 'ACTION_PLAN', 'V1', 'V2']) test('OFFLINE classic tabs expose one selected mode without engine dropdowns: ' + (value || 'AUTO'), () => {
  const tree = CommandEngineControl({ value, disabled: false, onChange() {} }), all = elements(tree);
  const tabs = all.filter(e => e.props.role === 'tab');
  assert.equal(tabs.length, 2); assert.equal(tabs.filter(e => e.props['aria-selected']).length, 1);
  assert.equal(tabs.find(e => e.props['aria-selected']).props.children, value === 'ACTION_PLAN' ? 'Action Plan' : 'Goal Agent');
  assert.equal(tabs.filter(e => e.props.tabIndex === 0).length, 1);
  assert.equal(all.some(e => e.type === 'select'), false);
  const radios = all.filter(e => e.type === 'input' && e.props.type === 'radio');
  assert.equal(radios.length, value === 'ACTION_PLAN' ? 0 : 3);
  if (radios.length) assert.equal(radios.find(e => e.props.checked).props.value, value);
});

test('OFFLINE switching tabs changes only the requested analysis engine and leaves execution explicit', () => {
  const calls = [], change = value => calls.push(value);
  let all = elements(CommandEngineControl({ value: 'V2', disabled: false, onChange: change }));
  all.find(e => e.props.id === 'command-tab-plan').props.onClick();
  assert.deepEqual(calls, ['ACTION_PLAN']);
  all = elements(CommandEngineControl({ value: 'ACTION_PLAN', disabled: false, onChange: change }));
  all.find(e => e.props.id === 'command-tab-goal').props.onClick();
  assert.deepEqual(calls, ['ACTION_PLAN', '']);
  all.find(e => e.props.id === 'command-tab-plan').props.onClick();
  assert.equal(calls.length, 2);
});

for (const value of ['', 'V1', 'V2']) test('OFFLINE each radio retains its exact backend binding: ' + (value || 'AUTO'), () => {
  const calls = [], tree = CommandEngineControl({ value: '', disabled: false, onChange: v => calls.push(v) });
  elements(tree).find(e => e.type === 'input' && e.props.value === value).props.onChange();
  assert.deepEqual(calls, [value]);
});

test('OFFLINE keyboard tab navigation selects and focuses the requested mode', () => {
  const changed = [], focused = [];
  const tree = CommandEngineControl({ value: 'ACTION_PLAN', disabled: false, onChange: value => changed.push(value) });
  const tab = elements(tree).find(e => e.props.role === 'tab');
  let prevented = 0;
  tab.props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; }, currentTarget: { parentElement: { querySelector(selector) { return { focus() { focused.push(selector); } }; } } } });
  assert.deepEqual(changed, ['']); assert.deepEqual(focused, ['#command-tab-goal']); assert.equal(prevented, 1);
});

test('OFFLINE pending/busy controls cannot switch modes using the keyboard', () => {
  const calls = [], tree = CommandEngineControl({ value: '', disabled: true, onChange: value => calls.push(value) });
  const all = elements(tree);
  assert.ok(all.filter(e => e.props.role === 'tab').every(e => e.props.disabled));
  assert.equal(all.find(e => e.type === 'fieldset').props.disabled, true);
  all.find(e => e.props.role === 'tab').props.onKeyDown({ key: 'Home', preventDefault() { throw Error('Disabled controls must not change modes'); } });
  assert.deepEqual(calls, []);
});

test('OFFLINE full panel keeps one device selector, unified execution controls and safe no-device state', () => {
  const html = renderToStaticMarkup(React.createElement(UnifiedAgentPanel, props));
  assert.equal((html.match(/<select\b/g) || []).length, 1);
  assert.doesNotMatch(html, /role="tablist"/); assert.doesNotMatch(html, /role="tabpanel"/);
  assert.doesNotMatch(html, /Nhiều thiết bị/); assert.doesNotMatch(html, /Nội bộ \/ debug|aria-label="Debug engine"|aria-label="Group engine"/);
  assert.match(html, /disabled=""[^>]*>.*?Phân tích/); assert.match(html, /OWNER_AUTHORIZED_TEST_MODE/);
});

test('OFFLINE group execution retains a separate clearly labelled V1/V2 radio choice without another dropdown', () => {
  const html = renderToStaticMarkup(React.createElement(AgentGoalPanel, { ...props, controlsMode: 'group' }));
  assert.doesNotMatch(html, /<select\b/); assert.match(html, /aria-label="Engine chạy nhóm"/);
  assert.equal((html.match(/name="group-agent-version"/g) || []).length, 2);
  assert.match(html, /Chạy nhóm/);
});
