/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { IntentRequestSchema } = require('../lib/android/agent/intent-schema.ts');
const { proposeIntentOutcomes, approveIntentSource, assertIntentApproval, intentCapabilities } = require('../lib/android/agent/intent-capabilities.ts');
const { resolveIntent, verifyIntentScreen, corroborateState, isIntentEvidence, executeIntentCapability } = require('../lib/android/agent/intent-executor.ts');
const { redactedReasoningPayload, publicReasoningSchema, CloudJsonProposalProvider, createStructuredReasoner } = require('../lib/android/agent/reasoning-provider.ts');
for (const source of ['open app org.example.app', 'open url "https://example.com"', 'open dialer 5550100', 'open settings android.settings.SETTINGS', 'read wifi', 'read battery', 'read media_volume', 'read ring_volume', 'read brightness', 'compose sms 5550100 "Phone Commander draft only"']) test('M4b source-bound intent: ' + source, () => {
  const p = proposeIntentOutcomes(source); assert.equal(p.outcomes.length, 1);
  const o = p.outcomes[0], a = approveIntentSource(source, 'D', 'E', 'P');
  if (o.intent.request.name === 'COMPOSE_SMS') assert.throws(() => assertIntentApproval(a, 'D', 'E', o.span, o.intent), /NOT_IMPLEMENTED/);
  else {
    assert.doesNotThrow(() => assertIntentApproval(a, 'D', 'E', o.span, o.intent));
    assert.throws(() => assertIntentApproval(a, 'OTHER', 'E', o.span, o.intent));
    assert.throws(() => assertIntentApproval({ ...a }, 'D', 'E', o.span, o.intent));
    assert.throws(() => assertIntentApproval(a, 'D', 'E', o.span, { ...o.intent, slots: {} }));
    assert.ok(intentCapabilities[o.intent.request.name].verifier);
  }
});
for (const source of ['open url "file:///data/private"', 'open url "javascript:alert(1)"', 'open url "https://user:pass@example.com"', 'open url "https://example.com;reboot"', 'open dialer 112', 'open dialer *123#', 'open dialer 5550100,123', 'open app org.example.app && reboot', 'delete org.example.app', 'do not open app org.example.app', 'open app unknown', 'open settings android.settings.DELETE']) test('M4b rejects unsafe or unsupported source: ' + source, () => assert.equal(proposeIntentOutcomes(source), undefined));
test('M4b closed schemas reject model commands, extra keys and missing verifier authorization', () => {
  assert.equal(IntentRequestSchema.safeParse({ name: 'OPEN_APP', args: { packageName: 'org.example.app', shell: 'reboot' } }).success, false);
  assert.equal(isIntentEvidence({ id: 'invented' }), false);
});
test('M4b resolver rejects ambiguity, wrong package and SMS before dispatch', async () => {
  for (const output of ['', 'android/com.android.internal.app.ResolverActivity', 'org.example.a/.Main\norg.example.b/.Main', 'org.wrong/.Main']) {
    await assert.rejects(resolveIntent('D', { name: 'OPEN_APP', args: { packageName: 'org.example.app' } }, async () => ({ stdout: output })));
  }
  let calls = 0;
  await assert.rejects(resolveIntent('D', { name: 'COMPOSE_SMS', args: { number: '5550100', body: 'draft' } }, async () => { calls++; }), /NOT_IMPLEMENTED/);
  assert.equal(calls, 0);
  const r = await resolveIntent('D', { name: 'OPEN_DIALER', args: { number: '5550100' } }, async args => { assert.ok(args.includes('android.intent.action.DIAL')); assert.ok(!args.includes('android.intent.action.CALL')); return { stdout: 'org.example.dial/.Main' }; });
  assert.equal(r.action, 'android.intent.action.DIAL');
});
test('M4b screen verification requires fresh native and independent exact resumed activity', () => {
  const req = { name: 'OPEN_DIALER', args: { number: '5550100' } }, resolution = { packageName: 'org.example.dial', component: 'org.example.dial/.Main' };
  const s = { timestamp: Date.now(), foregroundPackage: resolution.packageName, observationStatus: 'OBSERVED', activity: '.Main', nodes: [{ text: '555 0100', displayed: true, className: 'android.widget.EditText', packageName: resolution.packageName }] };
  const dump = 'mResumedActivity: ActivityRecord{123 u0 org.example.dial/.Main t1}';
  assert.equal(verifyIntentScreen(req, resolution, s, dump), true);
  assert.equal(verifyIntentScreen(req, resolution, s, dump.replace('.Main', '.Wrong')), false);
  assert.equal(verifyIntentScreen(req, resolution, { ...s, timestamp: Date.now() - 6000 }, dump), false);
  assert.equal(verifyIntentScreen(req, resolution, { ...s, nodes: [] }, dump), false);
  assert.equal(verifyIntentScreen(req, resolution, { ...s, nodes: [...s.nodes, ...s.nodes] }, dump), false);
});
test('M4b independent state mismatch, unavailable and ambiguous readbacks never complete', () => {
  assert.equal(corroborateState('wifi', '1', 'Wifi is enabled'), '1');
  assert.equal(corroborateState('wifi', '1', 'Wifi is disabled'), undefined);
  assert.equal(corroborateState('battery', 'level: 82', '82'), '82');
  assert.equal(corroborateState('battery', 'level: 82', 'permission denied'), undefined);
  assert.equal(corroborateState('brightness', '128', 'mScreenBrightnessSetting=128'), '128');
  assert.equal(corroborateState('brightness', '64', 'mScreenBrightness=0.2509804'), '64');
  assert.equal(corroborateState('brightness', '64', 'mScreenBrightness=0.2509804\nmScreenBrightness=0.5'), undefined);
  assert.equal(corroborateState('brightness', '64', 'mScreenBrightnessSettingDefaultFloat=0.2509804'), undefined);
  assert.equal(corroborateState('media_volume', 'volume is 7', 'STREAM_MUSIC:\n Current: 2 (speaker): 7, 4 (headset): 3'), undefined);
  assert.equal(corroborateState('ring_volume', 'volume is 5', 'STREAM_RING:\n Current: 2 (speaker): 5'), '5');
});
test('M4b cloud redaction strips source, private values, system prompt and UI labels', () => {
  const p = redactedReasoningPayload({ request: 'search private medical record', slots: [[1, 'secret']], password: 'secret', candidates: [{ id: 'C1', action: 'CLICK', text: 'secret', selector: 'secret' }, { id: 'secret', action: 'CLICK' }] });
  assert.equal(JSON.stringify(p).includes('secret'), false); assert.deepEqual(p.slotIds, [1]); assert.deepEqual(p.candidates, [{ id: 'C1', action: 'CLICK' }]);
  assert.throws(() => publicReasoningSchema({ type: 'string', enum: ['secret'] }));
  assert.throws(() => new CloudJsonProposalProvider('https://example.com', 'test', false));
  assert.throws(() => new CloudJsonProposalProvider('http://example.com', 'test', true));
  if (!process.env.AGENT_STRUCTURED_PROVIDER) assert.equal(createStructuredReasoner().constructor.name, 'OllamaAgentReasoner');
});
test('M4b executor authenticates proof and prohibits effect replay even after unknown transport outcome', async () => {
  const source = 'open app org.example.app', outcome = proposeIntentOutcomes(source).outcomes[0];
  const session = { serial: 'D', sessionId: 'S', ensureActive: async () => {}, assertPhysicalIdentity: async () => {} };
  const snapshot = () => ({ timestamp: Date.now(), snapshotId: 'fresh', foregroundPackage: 'org.example.app', observationStatus: 'OBSERVED', activity: '.Main', nodes: [] });
  const observer = { readNativeSnapshot: async () => snapshot() };
  let effects = 0, uncertain = false;
  const run = async args => {
    if (args.includes('resolve-activity')) return { stdout: 'org.example.app/.Main' };
    if (args.includes('policy')) return { stdout: 'mIsShowing=false\nscreenState=SCREEN_STATE_ON' };
    if (args.includes('activities')) return { stdout: 'mResumedActivity: ActivityRecord{123 u0 org.example.app/.Main t1}' };
    if (args.includes('start')) { effects++; if (uncertain) throw Error('UNKNOWN transport outcome'); return { stdout: 'Starting' }; }
    throw Error('Unexpected command');
  };
  const a = approveIntentSource(source, 'D', 'E', 'P');
  const p = await executeIntentCapability(session, observer, run, a, outcome.intent, outcome.span, 'E', 'org.example.app');
  assert.equal(isIntentEvidence(p), true); assert.equal(isIntentEvidence({ ...p }), false);
  await assert.rejects(executeIntentCapability(session, observer, run, a, outcome.intent, outcome.span, 'E', 'org.example.app'), /never replayed/);
  assert.equal(effects, 1);
  uncertain = true; const b = approveIntentSource(source, 'D', 'E2', 'P');
  await assert.rejects(executeIntentCapability(session, observer, run, b, outcome.intent, outcome.span, 'E2', 'org.example.app'), /UNKNOWN/);
  await assert.rejects(executeIntentCapability(session, observer, run, b, outcome.intent, outcome.span, 'E2', 'org.example.app'), /never replayed/);
  assert.equal(effects, 2);
});
