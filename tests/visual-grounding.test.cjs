/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), sharp = require('sharp');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { VisualGroundingEngine, validateGroundedPoint, geometryFingerprint } = require('../lib/android/visual-grounding.ts');
const { visualReviewHtml } = require('../lib/android/visual-review.ts');
const { AndroidExecutionError } = require('../lib/android/errors.ts');
const pkg = 'com.google.android.youtube';
const node = (v = {}) => ({ packageName: pkg, resourceId: '', className: 'android.view.View', text: '', description: 'Podcast - 10 minutes - 2 products - Play video',
  bounds: [10, 30, 90, 150], clickable: true, enabled: true, displayed: true, focused: false, ...v });
const state = (nodes = [node()]) => ({ deviceSerial: 'test', snapshotId: 'test', timestamp: Date.now(), observedAt: new Date().toISOString(),
  foregroundPackage: pkg, activity: 'Main', observationStatus: 'OBSERVED', viewport: { x: 0, y: 0, width: 100, height: 200 }, nodes });
const geometry = { orientation: 'PORTRAIT', densityDpi: 420, viewport: { x: 0, y: 0, width: 100, height: 200 },
  bars: { statusBar: { x: 0, y: 0, width: 100, height: 20, visible: true }, navigationBar: { x: 0, y: 180, width: 100, height: 20, visible: true } } };
const plan = { intent: 'podcast', isSensitive: false, actions: [{ type: 'OPEN_APP', app: 'youtube' }, { type: 'CLICK', target: 'video_card_2' }] };
async function fixture() {
  const patch = await sharp({ create: { width: 70, height: 40, channels: 3, background: '#366a91' } }).png().toBuffer();
  const image = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#d8e8f8' } }).composite([{ input: patch, left: 15, top: 40 }]).png().toBuffer();
  let current = state(), display = structuredClone(geometry), images = [image], imageCalls = 0, taps = 0, commandFailure;
  const session = { serial: 'test', path: '/session/test', ensureActive: async () => {}, client: { request: async (method, path, body) => {
    if (commandFailure) throw commandFailure;
    if (path.endsWith('/orientation')) return display.orientation;
    if (path.endsWith('/window/rect')) return display.viewport;
    if (path.endsWith('/screenshot')) return images[Math.min(imageCalls++, images.length - 1)].toString('base64');
    if (body?.script === 'mobile: getDisplayDensity') return display.densityDpi;
    if (body?.script === 'mobile: getSystemBars') return display.bars;
    if (body?.script === 'mobile: clickGesture') { taps++; return null; }
    throw Error('Unexpected command: ' + path);
  } } };
  const engine = new VisualGroundingEngine(session, { readNativeSnapshot: async () => current });
  const blocked = { snapshot: current, node: current.nodes[0], selection: { itemType: 'video', title: 'Podcast', ordinal: 2, identity: 'actual' } };
  return { engine, blocked, get current() { return current; }, set current(value) { current = value; }, get display() { return display; },
    set display(value) { display = value; }, set images(value) { images = value; imageCalls = 0; }, set commandFailure(value) { commandFailure = value; },
    get taps() { return taps; }, get imageCalls() { return imageCalls; } };
}
test('coherent paired screenshot/native evidence is geometry only, cropped and requires a human', async () => {
  const f = await fixture(), e = await f.engine.collect(f.blocked, 'Product card');
  assert.equal(e.status, 'HUMAN_REQUIRED'); assert.equal(e.visionAvailable, false); assert.equal(e.coherent, true);
  assert.equal(f.imageCalls, 2); assert.equal(f.taps, 0); assert.deepEqual(e.image.crop, [10, 30, 90, 150]);
  assert.equal(e.candidates[0].reason, 'Product card');
});
test('human-confirmed point is revalidated, sent once and cannot be replayed', async () => {
  const f = await fixture(), e = await f.engine.collect(f.blocked, 'Product card');
  const choice = { evidenceId: e.id, x: 40, y: 60, confirmed: true };
  const out = await f.engine.tap(choice, plan); assert.equal(out.decision, 'HUMAN_CONFIRMED'); assert.equal(f.taps, 1);
  await assert.rejects(f.engine.tap(choice, plan), /expired, replayed/); assert.equal(f.taps, 1);
});
test('changed native content before collection prevents capture', async () => {
  const f = await fixture(); f.current = state([node({ description: 'Changed' })]);
  await assert.rejects(f.engine.collect(f.blocked, 'blocked'), /changed before/); assert.equal(f.imageCalls, 0);
});
test('different screenshot pixels make evidence BLOCKED even if XML is unchanged', async () => {
  const f = await fixture(), red = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer();
  f.images = [await sharp({ create: { width: 100, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer(), red];
  const e = await f.engine.collect(f.blocked, 'blocked'); assert.equal(e.status, 'BLOCKED'); assert.equal(e.coherent, false);
  await assert.rejects(f.engine.tap({ evidenceId: e.id, x: 40, y: 60, confirmed: true }, plan)); assert.equal(f.taps, 0);
});
test('image/device scale mismatch and rotated screenshot cannot authorize a point', async () => {
  for (const display of [{ ...geometry, viewport: { x: 0, y: 0, width: 50, height: 100 } }, { ...geometry, orientation: 'LANDSCAPE' }]) {
    const f = await fixture(); f.display = display; await assert.rejects(f.engine.collect(f.blocked, 'blocked'), /mapping or orientation/); assert.equal(f.taps, 0);
  }
});
test('invalid bounds, offscreen and system-inset points are rejected', () => {
  const s = state();
  for (const [x, y] of [[NaN, 60], [40, 999], [-1, 50], [10, 30]]) assert.throws(() => validateGroundedPoint(s, s.nodes[0], geometry, x, y));
  const b = state([node({ bounds: [0, 0, 100, 200] })]); assert.throws(() => validateGroundedPoint(b, b.nodes[0], geometry, 50, 10), /system inset/);
  const invalid = state([node({ bounds: [0, 0, NaN, 200] })]); assert.throws(() => validateGroundedPoint(invalid, invalid.nodes[0], geometry, 40, 60));
});
test('competing overlapping clickable nodes and sensitive auxiliary controls remain blocked', () => {
  const s = state([node(), node({ parentIndex: 0, description: 'Products', bounds: [20, 40, 70, 90] })]);
  assert.throws(() => validateGroundedPoint(s, s.nodes[0], geometry, 40, 60), /competes/);
  const sensitive = state([node({ resourceId: pkg + ':id/delete_button' })]);
  assert.throws(() => validateGroundedPoint(sensitive, sensitive.nodes[0], geometry, 40, 60), /sensitive semantics/);
});
test('changed hierarchy, orientation or pixels after confirmation prevents tap', async () => {
  for (const change of ['hierarchy', 'orientation', 'pixels']) {
    const f = await fixture(), e = await f.engine.collect(f.blocked, 'blocked');
    if (change === 'hierarchy') f.current = state([node({ description: 'Other podcast' })]);
    if (change === 'orientation') f.display = { ...geometry, orientation: 'LANDSCAPE' };
    if (change === 'pixels') f.images = [await sharp({ create: { width: 100, height: 200, channels: 3, background: '#00ddff' } }).png().toBuffer()];
    await assert.rejects(f.engine.tap({ evidenceId: e.id, x: 40, y: 60, confirmed: true }, plan)); assert.equal(f.taps, 0);
  }
});
test('sensitive flag, missing consent, incorrect goal and expired evidence cannot bypass policy', async () => {
  for (const variant of ['flag', 'consent', 'goal', 'expiry']) {
    const f = await fixture(), e = await f.engine.collect(f.blocked, 'blocked');
    const choice = { evidenceId: e.id, x: 40, y: 60, confirmed: variant !== 'consent' };
    if (variant === 'expiry') e.expiresAt = 0;
    const p = variant === 'flag' ? { ...plan, isSensitive: true } : variant === 'goal' ? { ...plan, actions: [...plan.actions.slice(0, -1), { type: 'CLICK', target: 'video_card_3' }] } : plan;
    await assert.rejects(f.engine.tap(choice, p)); assert.equal(f.taps, 0);
  }
});
test('timeout, Session error and cancellation propagate without a tap', async () => {
  for (const code of ['TIMEOUT', 'SESSION_ERROR']) {
    const f = await fixture(); f.commandFailure = new AndroidExecutionError(code, 'test failure');
    await assert.rejects(f.engine.collect(f.blocked, 'blocked'), e => e.code === code); assert.equal(f.taps, 0);
  }
  const f = await fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.engine.collect(f.blocked, 'blocked', abort.signal), e => e.code === 'CANCELLED'); assert.equal(f.taps, 0);
});
test('visual capture has a fixed screenshot budget and blocks sensitive input before screenshot', async () => {
  const f = await fixture(); for (let i = 0; i < 3; i++) await f.engine.collect(f.blocked, 'blocked');
  await assert.rejects(f.engine.collect(f.blocked, 'blocked'), /budget exhausted/); assert.equal(f.imageCalls, 6);
  const sensitive = await fixture(); sensitive.current.nodes.push(node({ focused: true, className: 'android.widget.EditText' }));
  await assert.rejects(sensitive.engine.collect(sensitive.blocked, 'blocked'), /not permitted/); assert.equal(sensitive.imageCalls, 0);
});
test('fingerprint includes enabled state and native package while ignoring snapshot UUID', () => {
  const s = state(); assert.equal(geometryFingerprint(s), geometryFingerprint({ ...s, snapshotId: 'new', timestamp: Date.now() + 1 }));
  assert.notEqual(geometryFingerprint(s), geometryFingerprint(state([node({ enabled: false })])));
});
test('review HTML escapes model/UI strings and maps CSS pointer to screenshot crop coordinates', async () => {
  const f = await fixture(), e = await f.engine.collect(f.blocked, 'blocked'); e.selectedTitle = '</script><script>evil()</script>';
  const html = visualReviewHtml(e, 'trustednonce'); assert.ok(!html.includes(e.selectedTitle));
  assert.ok(html.includes('getBoundingClientRect')); assert.ok(html.includes('crop[0]+x*')); assert.ok(html.includes('confirmed:true'));
  assert.ok(html.includes('evidence.coherent')); assert.ok(html.includes('evidence.expiresAt'));
});
test('blank secure/uniform screenshot is never treated as sufficient visual evidence', async () => {
  const f = await fixture(); f.images = [await sharp({ create: { width: 100, height: 200, channels: 3, background: '#000000' } }).png().toBuffer()];
  const e = await f.engine.collect(f.blocked, 'blocked'); assert.equal(e.coherent, true); assert.equal(e.status, 'BLOCKED');
  await assert.rejects(f.engine.tap({ evidenceId: e.id, x: 40, y: 60, confirmed: true }, plan)); assert.equal(f.taps, 0);
});
test('duplicate content candidates and a title unrelated to the node cannot create approval evidence', async () => {
  for (const variant of ['duplicate', 'title']) {
    const f = await fixture();
    if (variant === 'duplicate') f.current.nodes.push(node({ bounds: [10, 151, 90, 178] }));
    else f.blocked.selection.title = 'Unrelated';
    await assert.rejects(f.engine.collect(f.blocked, 'blocked'), /competing identical candidates/); assert.equal(f.imageCalls, 0);
  }
});
test('a fresh diagnostic image after a changed screen never authorizes the old ordinal', async () => {
  const f = await fixture(); f.current = state([node({ bounds: [10, 35, 90, 150] })]);
  const e = await f.engine.collect(f.blocked, 'blocked'); assert.equal(e.status, 'BLOCKED'); assert.equal(e.ordinalVerified, false);
  assert.equal(e.coherent, true); assert.ok(e.image.dataUrl.startsWith('data:image/png;base64,'));
  await assert.rejects(f.engine.tap({ evidenceId: e.id, x: 40, y: 60, confirmed: true }, plan)); assert.equal(f.taps, 0);
});
