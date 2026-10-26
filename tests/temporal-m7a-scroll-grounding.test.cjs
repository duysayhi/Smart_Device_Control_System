/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f,
}).outputText, f);
const { readTemporalUiInventory } = require('../lib/android/agent/temporal-ui-inventory.ts');
const { issuedTemporalUiInventory } = require('../lib/android/agent/temporal-ui.ts');
const pkg = 'org.generic.clock';

function view(times, options = {}) {
  const width = options.width || 400, height = options.height || 900;
  const top = Math.round(height * .2), bottom = Math.round(height * .8);
  const rowHeight = Math.floor((bottom - top) / 4), nodes = [{ className: 'androidx.recyclerview.widget.RecyclerView', enabled: !options.disabledCollection,
    resourceId: options.noResourceId ? '' : pkg + ':id/observed_collection', scrollable: false, bounds: [0, top, width, bottom] }];
  for (const [i, text] of times.entries()) {
    const parentIndex = nodes.length, y = top + i * rowHeight;
    nodes.push({ className: 'android.view.ViewGroup', parentIndex: 0,
      bounds: [0, options.clipped && i === 0 ? top - 10 : y, width, y + rowHeight - 5] });
    nodes.push({ text, parentIndex, bounds: [10, y + 10, width * .4, y + rowHeight - 10] });
    nodes.push({ className: 'android.widget.Switch', parentIndex, checked: options.changed && i === 0 || false,
      checkable: true, clickable: true, bounds: [width * .8, y + 10, width - 10, y + rowHeight - 10] });
  }
  nodes.push({ className: 'androidx.generic.ActionBar$Tab', description: 'Alarm Tab 1 of 4.',
    selected: !options.drift, clickable: true, bounds: [0, bottom, width / 2, height - 10] });
  nodes.push({ className: 'androidx.generic.ActionBar$Tab', description: 'World clock Tab 2 of 4.',
    selected: Boolean(options.drift), clickable: true, bounds: [width / 2, bottom, width, height - 10] });
  const snapshotId = randomUUID();
  const normalized = nodes.map(n => ({ text: '', description: '', resourceId: '', packageName: pkg,
    className: 'android.widget.TextView', displayed: true, enabled: true, clickable: false, focused: false, ...n }));
  return { deviceSerial: 'device', snapshotId, timestamp: Date.now(), observedAt: new Date().toISOString(),
    observationStatus: 'OBSERVED', source: 'APPIUM', screen: 'UNKNOWN', foregroundPackage: pkg,
    viewport: { x: 0, y: 0, width, height }, nodes: normalized,
    elements: normalized.map((n, i) => ({ ...n, elementId: snapshotId + ':' + i })) };
}

function fixture(t, options = {}) {
  let wall = Date.now(), reads = 0, lookups = 0, current, page = 0;
  t.mock.method(Date, 'now', () => wall);
  const calls = [], snapshots = [], gestures = [], pages = options.pages || [['00:15', '06:00', '07:30']];
  const session = { serial: 'device', sessionId: 'session', path: '/session/session', async ensureActive() {}, async assertPhysicalIdentity() {},
    client: { async request(method, route, data) {
      calls.push({ method, route, data });
      if (route.endsWith('/elements')) {
        lookups++;
        if (options.lookupDelay) wall += options.lookupDelay;
        return Object.hasOwn(options, 'elements') ? options.elements : [{ 'element-6066-11e4-a52e-4f735466cecf': 'native-' + lookups }];
      }
      if (route.endsWith('/rect')) {
        const [left, top, right, bottom] = current.nodes[0].bounds;
        return Object.hasOwn(options, 'rect') ? options.rect : { x: left, y: top, width: right - left, height: bottom - top };
      }
      assert.ok(route.endsWith('/execute/sync')); assert.equal(data.script, 'mobile: scrollGesture');
      gestures.push(data.args[0]);
      if (options.dispatchError) throw options.dispatchError;
      if (Object.hasOwn(options, 'termination')) return options.termination;
      if (data.args[0].direction === 'up') return false;
      if (options.scanDelay) wall += options.scanDelay;
      page = Math.min(page + 1, pages.length - 1);
      return page < pages.length - 1;
    } } };
  const observer = { async readNativeSnapshot() {
    reads++; wall += 10;
    const final = gestures.some(g => g.direction === 'down');
    current = view(pages[page], { ...options, clipped: final && options.clipped,
      changed: final && options.changed, drift: options.drift && gestures.length > 0 });
    if (final && options.staleFinal) current.timestamp -= 6000;
    if (final && options.childOutside) current.nodes[2].bounds[0] = -1;
    snapshots.push(current); return current;
  } };
  const signal = options.signal;
  const run = async args => {
    if (args.includes('policy') && options.lockAfterLookup && lookups) return { stdout: 'screenState=SCREEN_STATE_OFF mIsShowing=true', stderr: '' };
    return { stdout: args.includes('policy') ? 'screenState=SCREEN_STATE_ON mIsShowing=false' : 'Asia/Bangkok', stderr: '' };
  };
  return { calls, gestures, snapshots, read: () => readTemporalUiInventory(session, observer, run, pkg,
    { kind: 'ALARM', hour: 7, minute: 0 }, signal, undefined, { scrollTarget: 'NATIVE_ELEMENT' }), reads: () => reads };
}

for (const size of [[400, 900], [1080, 2340]]) test('M7a scroll targets a freshly unique native collection at ' + size.join('x'), async t => {
  const f = fixture(t, { width: size[0], height: size[1] });
  const result = await f.read(); assert.equal(issuedTemporalUiInventory(result), true);
  assert.deepEqual(f.gestures, [{ elementId: 'native-1', direction: 'up', percent: .35 }, { elementId: 'native-2', direction: 'down', percent: .35 }]);
  assert.equal(f.calls.filter(c => c.route.endsWith('/elements')).length, 2);
  assert.ok(f.calls.filter(c => c.route.endsWith('/elements')).every(c => c.data.using === 'id' && c.data.value === pkg + ':id/observed_collection'));
  assert.equal(result.observedAt, f.snapshots[2].timestamp);
});
test('M7a anonymous collection uses a fresh structural selector and native ID, never guessed coordinates', async t => {
  const f = fixture(t, { noResourceId: true }); await f.read();
  const lookups = f.calls.filter(c => c.route.endsWith('/elements'));
  assert.ok(lookups.every(c => c.data.using === 'xpath' && c.data.value.includes('RecyclerView') && c.data.value.includes('@bounds=')));
  assert.ok(f.gestures.every(g => g.elementId && !Object.hasOwn(g, 'left')));
});
test('M7a disabled collection container with readable switch children remains natively locatable', async t => {
  const f = fixture(t, { disabledCollection: true });
  const result = await f.read(); assert.equal(issuedTemporalUiInventory(result), true);
  assert.equal(f.gestures.length, 2);
});
for (const [name, elements, reason] of [
  ['missing', [], /NATIVE_TARGET_NOT_UNIQUE/],
  ['ambiguous', [{ ELEMENT: 'one' }, { ELEMENT: 'two' }], /NATIVE_TARGET_NOT_UNIQUE/],
  ['malformed response', false, /NATIVE_TARGET_NOT_UNIQUE/],
  ['missing native ID', [{}], /NATIVE_TARGET_NOT_LOCATABLE/],
]) test('M7a ' + name + ' collection cannot fall back to a coordinate gesture', async t => {
  const f = fixture(t, { elements }); await assert.rejects(f.read(), reason); assert.equal(f.gestures.length, 0);
});
test('M7a changed native rectangle blocks before gesture', async t => {
  const f = fixture(t, { rect: { x: 0, y: 180, width: 400, height: 541 } });
  await assert.rejects(f.read(), /NATIVE_BOUNDS_CHANGED/); assert.equal(f.gestures.length, 0);
});
test('M7a stale source after native lookup blocks before gesture', async t => {
  const f = fixture(t, { lookupDelay: 6000 });
  await assert.rejects(f.read(), /STALE_UI_LIST_SCROLL/); assert.equal(f.gestures.length, 0);
});
test('M7a keyguard is checked again after native lookup', async t => {
  const f = fixture(t, { lockAfterLookup: true });
  await assert.rejects(f.read(), /DEVICE_LOCKED/); assert.equal(f.gestures.length, 0);
});
test('M7a unknown native scroll response is not retried with bounds', async t => {
  const failure = Error('lost native scroll response'), f = fixture(t, { dispatchError: failure });
  await assert.rejects(f.read(), e => e === failure); assert.equal(f.gestures.length, 1);
});
test('M7a native termination must still be boolean', async t => {
  const f = fixture(t, { termination: undefined });
  await assert.rejects(f.read(), /EXHAUSTION_UNPROVEN/); assert.equal(f.gestures.length, 1);
});
test('M7a native element targeting preserves the top-search budget', async t => {
  const f = fixture(t, { termination: true });
  await assert.rejects(f.read(), /UI_LIST_TOP_BUDGET/); assert.equal(f.gestures.length, 8);
  assert.ok(f.gestures.every(g => g.elementId && g.direction === 'up'));
});
test('M7a post-scroll tab drift remains blocked even for native element gestures', async t => {
  const f = fixture(t, { drift: true });
  await assert.rejects(f.read(), /TAB_CHANGED/); assert.equal(f.gestures.length, 1);
});
test('M7a scan over five seconds rebases only unchanged rows wholly visible in the final snapshot', async t => {
  const f = fixture(t, { scanDelay: 6000 }), result = await f.read(), final = f.snapshots.at(-1);
  assert.equal(issuedTemporalUiInventory(result), true); assert.equal(result.observedAt, final.timestamp);
  assert.deepEqual(result.snapshots, [final.snapshotId]); assert.equal(result.rows.length, 3);
  assert.ok(final.timestamp - f.snapshots[2].timestamp > 5000);
});
test('M7a slow scan cannot refresh an offscreen row using a later snapshot', async t => {
  const f = fixture(t, { scanDelay: 6000, pages: [['00:15', '06:00'], ['06:00', '07:30']] });
  await assert.rejects(f.read(), /EXHAUSTION_OR_FRESHNESS_UNPROVEN/);
});
test('M7a short overlapping-page scan retains its original timestamp and multi-frame evidence', async t => {
  const f = fixture(t, { pages: [['00:15', '06:00'], ['06:00', '07:30']] }), result = await f.read();
  assert.equal(result.observedAt, f.snapshots[2].timestamp);
  assert.deepEqual(result.snapshots, [f.snapshots[2].snapshotId, f.snapshots.at(-1).snapshotId]);
  assert.equal(result.rows.length, 3);
});
test('M7a final full view cannot hide changed switch values', async t => {
  const f = fixture(t, { scanDelay: 6000, changed: true });
  await assert.rejects(f.read(), /CHANGED_DURING_SCAN/);
});
for (const option of ['clipped', 'childOutside']) test('M7a slow scan does not rebase a partially visible row: ' + option, async t => {
  const f = fixture(t, { scanDelay: 6000, [option]: true });
  await assert.rejects(f.read(), /EXHAUSTION_OR_FRESHNESS_UNPROVEN/);
});
test('M7a final snapshot must itself remain fresh to rebase', async t => {
  const f = fixture(t, { scanDelay: 6000, staleFinal: true });
  await assert.rejects(f.read(), /FOREIGN_OR_STALE/);
});
test('M7a rebase cannot bypass missing row overlap', async t => {
  const f = fixture(t, { scanDelay: 6000, pages: [['00:15', '06:00'], ['07:30', '08:00']] });
  await assert.rejects(f.read(), /CONTINUITY_UNPROVEN/);
});
