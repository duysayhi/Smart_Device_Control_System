/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { parseTemporal, TemporalRequestSchema, temporalExtras } = require('../lib/android/agent/temporal-contract.ts');
const { compileOutcomes } = require('../lib/android/agent/goal-compiler.ts');
const { TemporalProviderReader, parseTemporalRows, temporalPrecondition, isTemporalEvidence } = require('../lib/android/agent/temporal-evidence.ts');
const { issueTemporalEffectGrant } = require('../lib/android/agent/effect-grants.ts');
const { executeTemporal } = require('../lib/android/agent/temporal-executor.ts');
const { OwnerTestPolicy } = require('../lib/android/agent/owner-test-policy.ts');
const { decidePermission } = require('../lib/android/agent/permission-decision.ts');
const { LocalEffectJournal } = require('../lib/android/agent/local-effect-journal.ts');
const { runAgentV2 } = require('../lib/android/agent/agent-v2.ts');
const { AgentBudget } = require('../lib/android/agent/budget.ts');
const { submitAssistanceV2 } = require('../lib/android/agent/human-assistance-v2.ts');

for (const [source, expected] of [
  ['Đặt báo thức 7 giờ sáng', ['ALARM', 7, 0]], ['dat bao thuc 3 gio 30 chieu', ['ALARM', 15, 30]],
  ['Đặt báo thức 3 giờ 30 chiều', ['ALARM', 15, 30]], ['Set an alarm for 6:45 PM', ['ALARM', 18, 45]],
  ['Set an alarm for 12 AM', ['ALARM', 0, 0]], ['Set an alarm for 12 PM', ['ALARM', 12, 0]],
  ['Đặt báo thức 11 giờ tối', ['ALARM', 23, 0]], ['Set an alarm for 00:00', ['ALARM', 0, 0]],
  ['Hẹn giờ 10 phút', ['TIMER', 600]], ['hen gio 10 phut', ['TIMER', 600]],
  ['Start a timer for 1 hour 20 minutes', ['TIMER', 4800]], ['Set a timer for 2 minutes and 5 seconds', ['TIMER', 125]],
  ['Bắt đầu hẹn giờ 45 giây', ['TIMER', 45]], ['Đặt hẹn giờ 1 giờ 20 phút', ['TIMER', 4800]],
]) test('M6b typed bilingual temporal contract: ' + source, () => {
  const parsed = parseTemporal(source); assert.ok(parsed.request, JSON.stringify(parsed));
  assert.deepEqual(parsed.request.kind === 'ALARM' ? [parsed.request.kind, parsed.request.hour, parsed.request.minute] : [parsed.request.kind, parsed.request.seconds], expected);
  const g = compileOutcomes(source, 'A', 'E'); assert.equal(g.coverage, 'COMPLETE');
  assert.deepEqual(g.nodes[0].outcome.temporal, parsed.request);
});
for (const source of ['Đặt báo thức 3:30', 'Set an alarm for 6:45', 'dat bao thuc 12']) test('M6b ambiguous AM/PM never guessed: ' + source, () => {
  assert.equal(parseTemporal(source).issue, 'AM_PM_REQUIRED');
  assert.equal(compileOutcomes(source, 'A', 'E').coverage, 'NEEDS_CLARIFICATION');
});
for (const source of ['Set an alarm for 24:00', 'Dat bao thuc 7:65 sang', 'Set an alarm for 0 PM', 'Set an alarm for 19 PM', 'hen gio 0 phut', 'hen gio -2 phut', 'hen gio 1.5 phut', 'hen gio 100000000 gio', 'hen gio 2 phut 3 phut', 'Start a timer for 3', 'Set an alarm for 7 AM tomorrow']) test('M6b invalid/unsupported temporal qualifier never executes: ' + source, () => {
  assert.ok(parseTemporal(source).issue); assert.notEqual(compileOutcomes(source, 'A', 'E').coverage, 'COMPLETE');
});
test('M6b duration conjunction is not a second goal; unsupported trailing goal remains covered', () => {
  assert.equal(compileOutcomes('Start a timer for 1 hour and 20 minutes', 'A', 'E').nodes.length, 1);
  const g = compileOutcomes('Start a timer for 10 minutes then delete photos', 'A', 'E');
  assert.equal(g.nodes.length, 2); assert.notEqual(g.coverage, 'COMPLETE');
});
test('M6b timezone contract rejects bad zones and preserves explicit zone', () => {
  assert.equal(TemporalRequestSchema.safeParse({ kind: 'ALARM', hour: 7, minute: 0, clock: 'DEVICE_LOCAL', enabled: true, zone: 'Not/AZone' }).success, false);
  assert.equal(parseTemporal('Set an alarm for 7 AM timezone Asia/Bangkok').request.zone.toLowerCase(), 'asia/bangkok');
});
test('M6b legacy structured form remains available without changing V1/AP schema', () => {
  assert.equal(compileOutcomes('Mo clock va dat bao thuc 07:00', 'A', 'E').nodes[1].capability, 'SET_STRUCTURED_STATE');
});
for (const output of ['Row: 0 _id=1, hour=24, minutes=0, enabled=1, label=X', 'Row: 0 _id=1, hour=7, minutes=0, enabled=2, label=X', 'Error while accessing provider', 'Row: 0 _id=1, hour=7, minutes=0, enabled=1', 'Row: 0 _id=1, hour=7, minutes=0, enabled=1, label=X, enabled=0']) test('M6b malformed/partial provider output cannot become evidence: ' + output, () => assert.equal(parseTemporalRows(output, 'ALARM'), undefined));

function fixture(kind = 'ALARM', pkg = 'org.unseen.clock', options = {}) {
  const source = kind === 'ALARM' ? 'Set an alarm for 6:45 PM' : 'Start a timer for 10 minutes', executionId = randomUUID();
  const node = compileOutcomes(source, 'A', executionId).nodes[0]; node.packageName = pkg;
  let dispatches = 0, shows = 0, createdAt = 0, label = '', rows = options.rows || [], mutateOld = false;
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args.includes('getprop')) return { stdout: options.zone || 'Asia/Bangkok', stderr: '' };
    if (args.includes('policy')) return { stdout: options.locked ? 'screenState=SCREEN_STATE_OFF mIsShowing=true' : 'screenState=SCREEN_STATE_ON mIsShowing=false', stderr: '' };
    if (args.includes('resolve-activity')) return { stdout: options.chooser ? 'android/.ResolverActivity' : pkg + '/.ClockActivity', stderr: '' };
    if (args.includes('package')) return { stdout: 'ContentProvider Authorities:\n  [' + pkg + '.clock]:\n    Provider{abc ' + pkg + '/.AlarmTimerProvider}\n', stderr: '' };
    if (args.includes('query')) {
      if (options.denied) return { stdout: 'SecurityException: permission denied', stderr: '' };
      let data = rows.map(r => ({ ...r }));
      if (label) data.push(kind === 'ALARM' ? { id: '2', label, hour: 18, minute: 45, enabled: !options.disabled } : { id: '2', label, seconds: options.wrongDuration ? 300 : 600, remaining: options.frozen ? 600 : Math.max(1, 600 - Math.floor((Date.now() - createdAt) / 1000)), running: !options.paused });
      if (mutateOld && data[0]) data[0].enabled = false;
      if (args.includes("'COUNT(_id) AS total'")) return { stdout: 'Row: 0 total=' + (data.length + (options.truncated ? 1 : 0)), stderr: '' };
      const stdout = data.length ? data.map((r, i) => 'Row: ' + i + ' _id=' + r.id + (kind === 'ALARM' ? ', hour=' + r.hour + ', minutes=' + r.minute + ', enabled=' + Number(r.enabled) : ', duration_seconds=' + r.seconds + ', remaining_seconds=' + r.remaining + ', running=' + Number(r.running)) + ', label=' + r.label).join('\n') : 'No result found.';
      return { stdout, stderr: '' };
    }
    if (args.includes('am')) {
      if (args.some(a => a.endsWith('SET_ALARM') || a.endsWith('SET_TIMER'))) {
        dispatches++; label = args[args.indexOf('android.intent.extra.alarm.MESSAGE') + 1]; createdAt = Date.now(); mutateOld = options.mutateOld;
        if (options.unknown) throw Error('transport timed out');
      } else shows++;
      return { stdout: 'Starting: Intent', stderr: '' };
    }
    throw Error('Unexpected command');
  };
  const scene = () => {
    const snapshotId = randomUUID(), nodes = [{ className: options.editor ? 'android.widget.EditText' : 'android.widget.TextView', resourceId: pkg + ':id/label', packageName: pkg, text: label || 'Clock', description: '', enabled: true, displayed: true, clickable: false, focused: false, bounds: [0, 0, 400, 700] }];
    return { deviceSerial: 'A', snapshotId, timestamp: options.stale ? Date.now() - 6000 : Date.now(), foregroundPackage: pkg, observationStatus: 'OBSERVED', source: 'APPIUM', viewport: { x: 0, y: 0, width: 400, height: 900 }, nodes, elements: nodes.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
  };
  const session = { serial: 'A', sessionId: 'S', ensureActive: async () => {}, assertPhysicalIdentity: async () => {} }, observer = { readNativeSnapshot: async () => scene() };
  const reader = new TemporalProviderReader('A', run);
  return { source, executionId, node, run, session, observer, scene, reader, calls, get dispatches() { return dispatches; }, get shows() { return shows; }, setRows(v) { rows = v; } };
}
async function grant(f, scope, journal) { return issueTemporalEffectGrant(f.source, f.node, 'A', 'P', f.executionId, 'S', scope, journal); }
for (const pkg of ['org.unseen.clock', 'net.other.timepiece']) test('M6b OFFLINE new-only ALARM persisted readback on unprofiled app ' + pkg, async () => {
  const f = fixture('ALARM', pkg), before = await f.reader.read(pkg, 'ALARM');
  const proof = await executeTemporal(f.session, f.observer, f.run, await grant(f), before);
  assert.ok(isTemporalEvidence(proof)); assert.equal(f.dispatches, 1); assert.equal(f.shows, 2); assert.equal(proof.request.hour, 18);
});
test('M6b OFFLINE TIMER proves exact original duration, RUNNING and real monotonic decrement', async () => {
  const f = fixture('TIMER'), before = await f.reader.read(f.node.packageName, 'TIMER');
  const proof = await executeTemporal(f.session, f.observer, f.run, await grant(f), before);
  assert.ok(isTemporalEvidence(proof)); assert.equal(proof.kind, 'TIMER'); assert.equal(f.dispatches, 1);
});
for (const [name, options, kind] of [['disabled alarm', { disabled: true }, 'ALARM'], ['editor echo', { editor: true }, 'ALARM'], ['changed old record', { rows: [{ id: '1', hour: 9, minute: 0, enabled: true, label: 'old' }], mutateOld: true }, 'ALARM'], ['paused timer', { paused: true }, 'TIMER'], ['wrong timer duration', { wrongDuration: true }, 'TIMER'], ['frozen timer', { frozen: true }, 'TIMER']]) test('M6b false-completion prevention: ' + name, async () => {
  const f = fixture(kind, undefined, options), before = await f.reader.read(f.node.packageName, kind);
  await assert.rejects(() => grant(f).then(g => executeTemporal(f.session, f.observer, f.run, g, before)), /UNVERIFIED/); assert.equal(f.dispatches, 1);
});
for (const [name, options] of [['locked', { locked: true }], ['chooser', { chooser: true }], ['stale UI', { stale: true }]]) test('M6b pre-dispatch safety: ' + name, async () => {
  const f = fixture('ALARM', undefined, options), before = await f.reader.read(f.node.packageName, 'ALARM');
  await assert.rejects(() => grant(f).then(g => executeTemporal(f.session, f.observer, f.run, g, before))); assert.equal(f.dispatches, 0);
});
test('M6b inaccessible provider blocks with zero writes', async () => {
  const f = fixture('ALARM', undefined, { denied: true }); await assert.rejects(() => f.reader.read(f.node.packageName, 'ALARM'), /PROVIDER_UNAVAILABLE/); assert.equal(f.dispatches, 0);
});
test('M6b truncated inventory cannot authorize mutation', async () => {
  const f = fixture('ALARM', undefined, { truncated: true }); await assert.rejects(() => f.reader.read(f.node.packageName, 'ALARM'), /PROVIDER_UNAVAILABLE/); assert.equal(f.dispatches, 0);
});
test('M6b forged, foreign-session, expired grant and stale inventory are rejected without effects', async () => {
  const f = fixture(), before = await f.reader.read(f.node.packageName, 'ALARM'), g = await grant(f);
  await assert.rejects(() => executeTemporal(f.session, f.observer, f.run, { ...g }, before), /HARD_DENY/);
  await assert.rejects(() => executeTemporal({ ...f.session, sessionId: 'OTHER' }, f.observer, f.run, g, before), /HARD_DENY/);
  const now = Date.now;
  try { Date.now = () => now() + 6000; assert.throws(() => temporalPrecondition(before, f.node.outcome.temporal), /STALE/); await assert.rejects(() => executeTemporal(f.session, f.observer, f.run, g, before), /expired/); }
  finally { Date.now = now; }
  assert.equal(f.dispatches, 0);
});
for (const fullControl of [false, true]) test('M6b V2 complete loop, owned Session and automatic scoped effect permission: full=' + fullControl, async () => {
  const f = fixture(), policy = new OwnerTestPolicy(), mode = policy.enable('A', 'P', undefined, { fullControl }), events = []; let closed = 0;
  const adapter = { catalog: {}, resolveTemporalApp: async () => ({ serial: 'A', packageName: f.node.packageName, component: f.node.packageName + '/.ClockActivity' }), readiness: async () => 'READY',
    open: async () => ({ backend: 'appium', sessionId: () => 'S', observe: async () => f.scene(), close: async () => { closed++; },
      temporalInventoryV2: (pkg, request) => f.reader.read(pkg, request.kind), temporalV2: (g, before) => executeTemporal(f.session, f.observer, f.run, g, before) }) };
  try {
    await runAgentV2(f.source, 'A', f.executionId, 'P', new AgentBudget(), adapter, e => events.push(e), undefined, { generate: async () => { throw Error('Unexpected model call'); } }, policy.bind('A', 'P', f.executionId));
    assert.equal(events.at(-1).status, 'COMPLETED', events.at(-1).reason); assert.equal(f.dispatches, 1); assert.equal(closed, 1);
    assert.equal(events.some(e => e.status === 'NEED_HUMAN_ASSISTANCE'), false); assert.equal(events.at(-1).v2.temporal.kind, 'ALARM');
  } finally { policy.disable('A', mode.id); }
});
test('M6b pre-existing matching alarm, timer or different timezone never reused', async () => {
  const f = fixture('ALARM', undefined, { rows: [{ id: '1', hour: 18, minute: 45, enabled: false, label: 'old' }] });
  assert.throws(() => temporalPrecondition({}, f.node.outcome.temporal), /STALE/);
  const before = await f.reader.read(f.node.packageName, 'ALARM'); assert.throws(() => temporalPrecondition(before, f.node.outcome.temporal), /ALREADY_EXISTS/);
  const other = fixture('TIMER', undefined, { rows: [{ id: '1', seconds: 600, remaining: 400, running: false, label: 'old' }] });
  const timerBefore = await other.reader.read(other.node.packageName, 'TIMER'); assert.throws(() => temporalPrecondition(timerBefore, other.node.outcome.temporal), /CONFLICT/);
  const clean = fixture(), cleanBefore = await clean.reader.read(clean.node.packageName, 'ALARM');
  assert.throws(() => temporalPrecondition(cleanBefore, { ...clean.node.outcome.temporal, zone: 'Europe/Paris' }), /TIMEZONE_MISMATCH/);
});
test('M6b UNKNOWN_EFFECT and fresh grants cannot replay the same outcome', async () => {
  const f = fixture('ALARM', undefined, { unknown: true }), before = await f.reader.read(f.node.packageName, 'ALARM'), g = await grant(f);
  await assert.rejects(() => executeTemporal(f.session, f.observer, f.run, g, before), /UNKNOWN_EFFECT/);
  await assert.rejects(() => executeTemporal(f.session, f.observer, f.run, g, before)); assert.equal(f.dispatches, 1);
});
test('M6b normal ASK, scoped owner ALLOW, full-control journal + issued proof required', async () => {
  const f = fixture(), policy = new OwnerTestPolicy(), mode = policy.enable('A', 'P', undefined, { fullControl: true }), owner = policy.bind('A', 'P', f.executionId);
  const common = { source: f.source, stage: 'EFFECT', outcome: f.node.outcome, deviceId: 'A', physicalId: 'P', executionId: f.executionId };
  assert.equal(decidePermission(common).decision, 'ASK');
  assert.equal(decidePermission({ ...common, owner }).decision, 'DENY');
  assert.throws(() => issueTemporalEffectGrant(f.source, f.node, 'A', 'P', f.executionId, 'S', owner), /journal/);
  const before = await f.reader.read(f.node.packageName, 'ALARM'), journal = await LocalEffectJournal.begin(owner, f.source, f.node, f.scene(), before);
  assert.equal(decidePermission({ ...common, owner, journal: journal.authorization }).decision, 'ALLOW');
  const proof = await executeTemporal(f.session, f.observer, f.run, await grant(f, owner, journal), before);
  assert.equal(journal.records[0].kind, 'CREATE_ALARM'); assert.equal(journal.records[0].verified, true); assert.ok(isTemporalEvidence(proof));
  policy.disable('A', mode.id); assert.throws(() => issueTemporalEffectGrant(f.source, f.node, 'A', 'P', f.executionId, 'S', owner, journal));
});
test('M6b minimal AM/PM assistance occurs before catalog/session/effects', async () => {
  let effects = 0; const events = [], executionId = randomUUID();
  await runAgentV2('Đặt báo thức 3:30', 'A', executionId, 'P', new AgentBudget(), { catalog: { resolve: async () => { effects++; } }, open: async () => { effects++; } }, e => {
    events.push(e); const a = e.v2?.assistance;
    if (a) { assert.equal(a.category, 'FIELD_AMBIGUITY'); submitAssistanceV2({ deviceId: 'A', executionId, token: a.token, approved: true, choice: 'am' }); }
  });
  assert.equal(effects, 0); assert.equal(events.at(-1).status, 'BLOCKED'); assert.equal(events.at(-1).v2.graph.nodes[0].outcome.temporal.hour, 3);
});
test('M6b native extras are closed, 24h and do not carry dismissal/delete actions', () => {
  const extras = temporalExtras(parseTemporal('Set an alarm for 6:45 PM').request, 'PhoneCommander-' + randomUUID());
  assert.equal(extras[extras.indexOf('android.intent.extra.alarm.HOUR') + 1], '18'); assert.ok(extras.includes('false'));
  assert.throws(() => temporalExtras(parseTemporal('hen gio 2 phut').request, 'shell; bad'));
});
