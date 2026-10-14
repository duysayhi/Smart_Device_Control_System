/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

// Load the server-only TypeScript modules without a second runtime dependency.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { parseUiHierarchy, findUiTarget } = require('../lib/android/targets.ts');
const { validateAndroidPlan, needsAdbKeyboard, ADB_KEYBOARD, androidCapabilityPrompt } = require('../lib/android/capabilities.ts');
const { createAndroidExecutor, quoteAndroidShell } = require('../lib/android/executor.ts');

const node = (attributes = '') => `<node package="com.google.android.youtube" enabled="true" clickable="true" bounds="[10,20][110,80]" ${attributes}/>`;
const hierarchy = (...nodes) => `<?xml version="1.0"?><hierarchy>${nodes.join('')}</hierarchy>`;
const open = { type: 'OPEN_APP', app: 'youtube' };

function mockAdb(handler) {
  const calls = [];
  const run = async (args, timeout) => {
    const command = args.slice(3).map((arg) => arg.slice(1, -1).split(["'", '"', "'", '"', "'"].join('')).join("'"));
    calls.push(command);
    return { stdout: await handler(command, timeout), stderr: '' };
  };
  return { executor: createAndroidExecutor(run), calls };
}

test('XML parser decodes labels, ignores invisible/disabled nodes and selects YouTube search', () => {
  const nodes = parseUiHierarchy(hierarchy(
    node('text="Search &amp; find" resource-id="com.google.android.youtube:id/search"'),
    '<node bounds="[0,0][0,0]"/>',
    '<node enabled="false" content-desc="Search" bounds="[0,0][50,50]"/>',
  ));
  assert.equal(nodes[0].text, 'Search & find');
  assert.equal(findUiTarget(nodes, 'search_button'), nodes[0]);
  assert.equal(findUiTarget(nodes, 'text:Search & find'), nodes[0]);
  assert.equal(findUiTarget(nodes, 'accessibility_id:Search'), undefined);
  assert.throws(() => parseUiHierarchy('<hierarchy>'), /invalid XML/);
});

test('video cards are ordered by position and unknown targets never fall back to a click', () => {
  const nodes = parseUiHierarchy(hierarchy(
    node('resource-id="com.google.android.youtube:id/thumbnail"').replace('[10,20][110,80]', '[10,100][110,160]'),
    node('resource-id="com.google.android.youtube:id/thumbnail"'),
  ));
  assert.equal(findUiTarget(nodes, 'video_card_1'), nodes[1]);
  assert.equal(findUiTarget(nodes, 'video_card_2'), nodes[0]);
  assert.equal(findUiTarget(nodes, 'video_card_3'), undefined);
  assert.equal(findUiTarget(nodes, 'invented'), undefined);
});

test('modern YouTube cards use localized play-video accessibility labels without resource IDs', () => {
  const nodes = parseUiHierarchy(hierarchy(
    node('content-desc="Example A - 10 phút - Chuyển đến kênh A - 100 lượt xem - phát video"'),
    node('content-desc="Example B - 12 minutes - Go to channel B - 100 views - Play video"').replace('[10,20][110,80]', '[10,100][110,160]'),
    node('content-desc="Menu tác vụ"'),
    node('content-desc="Chuyển đến kênh A"'),
    node('content-desc="Phát video"'),
  ));
  assert.equal(findUiTarget(nodes, 'video_list'), nodes[0]);
  assert.equal(findUiTarget(nodes, 'video_card_1'), nodes[0]);
  assert.equal(findUiTarget(nodes, 'video_card_2'), nodes[1]);
  assert.equal(findUiTarget(nodes, 'video_card_3'), undefined);
});

test('thumbnail inside an accessibility card counts as one video and ads are excluded', () => {
  const xml = `<hierarchy>
    <node package="com.google.android.youtube" enabled="true" clickable="true" bounds="[0,0][300,400]" content-desc="Example - 10 minutes - Play video">
      <node package="com.google.android.youtube" enabled="true" bounds="[0,0][300,200]" resource-id="com.google.android.youtube:id/thumbnail"/>
    </node>
    <node package="com.google.android.youtube" enabled="true" clickable="true" bounds="[0,400][300,700]" content-desc="Ad title - Sponsored - Play video">
      <node package="com.google.android.youtube" enabled="true" bounds="[0,400][300,600]" resource-id="com.google.android.youtube:id/thumbnail"/>
    </node>
  </hierarchy>`;
  const nodes = parseUiHierarchy(xml);
  assert.equal(findUiTarget(nodes, 'video_card_1'), nodes[0]);
  assert.equal(findUiTarget(nodes, 'video_card_2'), undefined);
});

test('plan validation rejects unknown targets, unsupported apps and wrong semantic context', () => {
  validateAndroidPlan([open, { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 8000 }]);
  assert.throws(() => validateAndroidPlan([open, { type: 'CLICK', target: 'invented' }]), /Step 2/);
  assert.throws(() => validateAndroidPlan([{ type: 'OPEN_APP', app: 'zalo' }]), /Unsupported app/);
  assert.throws(() => validateAndroidPlan([{ type: 'CLICK', target: 'search_button' }]), /YouTube|youtube/);
  assert.throws(() => validateAndroidPlan([open, { type: 'SCREENSHOT' }]), /Unsupported action/);
  assert.throws(() => validateAndroidPlan([open, { type: 'CLICK', target: 'video_list' }]), /video_card/);
});

test('Appium validates video ordinals beyond five while ADB retains its limit', () => {
  for (const ordinal of [6, 10, 99]) {
    const actions = [open, { type: 'WAIT_FOR', target: `video_card_${ordinal}`, timeoutMs: 20000 }, { type: 'CLICK', target: `video_card_${ordinal}` }];
    validateAndroidPlan(actions, true);
    assert.throws(() => validateAndroidPlan(actions), /Unsupported target/);
  }
  for (const target of ['video_card_0', 'video_card_100', 'video_card_06', 'video_card_6junk']) {
    assert.throws(() => validateAndroidPlan([open, { type: 'CLICK', target }], true), /1\.\.99/);
  }
  assert.throws(() => validateAndroidPlan([{ type: 'OPEN_APP', app: 'chrome' }, { type: 'CLICK', target: 'video_card_6' }], true), /youtube/);
  assert.throws(() => validateAndroidPlan([open, { type: 'CLICK', target: 'video_list' }], true), /not video_list/);
  assert.match(androidCapabilityPrompt(true), /video_card_1\.\.99/);
  assert.doesNotMatch(androidCapabilityPrompt(false), /video_card_1\.\.99/);
});

test('WAIT_FOR retries the hierarchy; CLICK uses fresh bounds', async () => {
  let reads = 0;
  const { executor, calls } = mockAdb(async (args) => {
    if (args[0] === 'cat') return ++reads === 1 ? hierarchy() : hierarchy(node('content-desc="Search"'));
    return '';
  });
  await executor.execute('device', { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 2000 });
  await executor.execute('device', { type: 'CLICK', target: 'search_button' });
  assert.equal(reads, 3);
  assert.deepEqual(calls.find((args) => args[0] === 'input'), ['input', 'tap', '60', '50']);
  assert.equal(calls.filter((args) => args[0] === 'rm').length, 3);
});

test('WAIT_FOR times out without issuing a tap', async () => {
  const { executor, calls } = mockAdb(async (args) => args[0] === 'cat' ? hierarchy() : '');
  await assert.rejects(executor.execute('device', { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 25 }), /Timed out/);
  assert.ok(!calls.some((args) => args[0] === 'input'));
});

test('preflight rejects missing Unicode keyboard before any mutating action', async () => {
  const { executor, calls } = mockAdb(async (args) => args[0] === 'pm' ? 'package:/data/app/youtube.apk' : '');
  await assert.rejects(executor.preflight('device', [open, { type: 'INPUT_TEXT', text: 'tiếng Việt' }]), /ADB Keyboard/);
  assert.deepEqual(calls.map((args) => args[0]), ['pm', 'ime']);
  assert.equal(needsAdbKeyboard('100%s'), true);
});

test('ASCII text preserves spaces and remote-shell metacharacters', async () => {
  let input = false;
  const { executor, calls } = mockAdb(async (args) => {
    if (args[0] === 'input') input = true;
    return args[0] === 'cat' ? hierarchy(node(`focused="true" class="android.widget.EditText" text="${input ? 'a b&apos;$(touch /tmp/x);&amp;' : ''}"`)) : '';
  });
  const text = "a b'$(touch /tmp/x);&";
  await executor.execute('device', { type: 'INPUT_TEXT', text });
  assert.deepEqual(calls.find((args) => args[0] === 'input'), ['input', 'text', text.replace(/ /g, '%s')]);
  assert.equal(quoteAndroidShell("a'b"), ["'a'", '"', "'", '"', "'b'"].join(''));
});

test('Unicode text uses UTF-8 base64 and restores the previous keyboard on failure', async () => {
  const text = 'tìm nhạc tiếng Việt';
  const { executor, calls } = mockAdb(async (args) => {
    if (args[0] === 'cat') return hierarchy(node('focused="true" class="android.widget.EditText"'));
    if (args[0] === 'settings') return 'old.keyboard/.IME';
    if (args[0] === 'dumpsys') return `mCurMethodId=${ADB_KEYBOARD} mInputShown=true`;
    if (args[0] === 'am') throw new Error('broadcast failed');
    return '';
  });
  await assert.rejects(executor.execute('device', { type: 'INPUT_TEXT', text }), /broadcast failed/);
  const broadcast = calls.find((args) => args[0] === 'am');
  assert.equal(Buffer.from(broadcast.at(-1), 'base64').toString('utf8'), text);
  assert.deepEqual(calls.at(-1), ['ime', 'set', 'old.keyboard/.IME']);
});

test('INPUT_TEXT rejects a screen with no focused input', async () => {
  const { executor, calls } = mockAdb(async (args) => args[0] === 'cat' ? hierarchy(node('text="Search"')) : '');
  await assert.rejects(executor.execute('device', { type: 'INPUT_TEXT', text: 'hello' }), /focused editable/);
  assert.ok(!calls.some((args) => args[0] === 'input'));
});

test('preflight rejects a missing package without opening it', async () => {
  const { executor, calls } = mockAdb(async () => '');
  await assert.rejects(executor.preflight('device', [open]), /not installed/);
  assert.deepEqual(calls, [['pm', 'path', 'com.google.android.youtube']]);
});

test('Unicode input verifies the committed text and restores the keyboard', async () => {
  let entered = false;
  const text = 'tiếng Việt';
  const { executor, calls } = mockAdb(async (args) => {
    if (args[0] === 'am') entered = true;
    if (args[0] === 'cat') return hierarchy(node(`focused="true" class="android.widget.EditText" text="${entered ? text : ''}"`));
    if (args[0] === 'settings') return 'old.keyboard/.IME';
    if (args[0] === 'dumpsys') return `mCurMethodId=${ADB_KEYBOARD} mInputShown=true`;
    return '';
  });
  await executor.execute('device', { type: 'INPUT_TEXT', text });
  assert.deepEqual(calls.at(-1), ['ime', 'set', 'old.keyboard/.IME']);
  assert.equal(calls.filter((args) => args[0] === 'cat').length, 2);
});

test('WAIT_FOR retries transient UIAutomator idle failures and cleans temporary files', async () => {
  let dumps = 0;
  const { executor, calls } = mockAdb(async (args) => {
    if (args[0] === 'uiautomator' && ++dumps === 1) return 'ERROR: could not get idle state.';
    if (args[0] === 'cat') return hierarchy(node('content-desc="Search"'));
    return '';
  });
  await executor.execute('device', { type: 'WAIT_FOR', target: 'search_button', timeoutMs: 2000 });
  assert.equal(dumps, 2);
  assert.equal(calls.filter((args) => args[0] === 'rm').length, 2);
});
