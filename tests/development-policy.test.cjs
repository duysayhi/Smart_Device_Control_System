/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { developmentPolicyEnabled } = require('../lib/android/policy-mode.ts');
const { assessPlanPolicy, assertActionNotSensitive, assertObservedControlSafe } = require('../lib/android/security-policy.ts');
const { isNodeInteractable } = require('../lib/android/screen-state.ts');
const plan = { intent: 'test', isSensitive: true, actions: [{ type: 'INPUT_TEXT', text: 'example' }, { type: 'CLICK', target: 'wifi_button' }] };
function mode(value, env, action) {
  const old = process.env.ANDROID_POLICY_MODE, oldEnv = process.env.NODE_ENV;
  process.env.ANDROID_POLICY_MODE = value; process.env.NODE_ENV = env;
  try { action(); } finally {
    if (old === undefined) delete process.env.ANDROID_POLICY_MODE; else process.env.ANDROID_POLICY_MODE = old;
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
  }
}
test('strict and invalid modes fail closed; production ignores development override', () => {
  for (const [value, env] of [['strict', 'development'], ['typo', 'development'], ['development', 'production']]) mode(value, env, () => {
    assert.equal(developmentPolicyEnabled(), false); assert.equal(assessPlanPolicy(plan).decision, 'BLOCK');
  });
});
test('local development permits data-changing, unknown and AI-sensitive plans and observed toggles', () => mode('development', 'development', () => {
  assert.equal(developmentPolicyEnabled(), true); assert.equal(assessPlanPolicy(plan).decision, 'ALLOW');
  assert.doesNotThrow(() => assertActionNotSensitive({ type: 'CLICK', target: 'send_button' }));
  assert.doesNotThrow(() => assertObservedControlSafe({ resourceId: 'settings:id/wifi', text: 'Wi-Fi', description: '', className: 'android.widget.Switch' }));
}));
test('destructive plan targets, actions and native controls stay blocked in development', () => mode('development', 'development', () => {
  for (const target of ['uninstall', 'gỡ cài đặt', 'xóa dữ liệu', 'factory reset', 'clear data']) {
    assert.equal(assessPlanPolicy({ ...plan, actions: [{ type: 'CLICK', target }] }).decision, 'BLOCK');
    assert.throws(() => assertActionNotSensitive({ type: 'CLICK', target }));
    assert.throws(() => assertObservedControlSafe({ resourceId: '', text: target, description: '', className: 'android.widget.Button' }));
  }
}));
test('development mode does not disable geometry or occlusion validation', () => mode('development', 'development', () => {
  const target = { bounds: [0, 0, 100, 100], enabled: true, clickable: true, displayed: true };
  const overlay = { ...target };
  assert.equal(isNodeInteractable(target, [target, overlay], { x: 0, y: 0, width: 400, height: 800 }, 'test', 0), false);
}));
