/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { createExecutionContext } = require('../lib/android/condition-executor.ts');
const { runAdb } = require('../lib/android/adb.ts');
const serial = process.argv[2];
if (!serial) { console.error('Opt-in: node tests/youtube-ad-search.integration.cjs DEVICE_SERIAL'); process.exit(2); }
let context;
const signal = AbortSignal.timeout(300000);
(async () => {
  context = await createExecutionContext(serial, [], runAdb, signal);
  const before = await context.observe(signal);
  const query = before.nodes.find(n => n.resourceId.endsWith(':id/search_query'))?.text;
  console.log('BEFORE', JSON.stringify({ screen: before.screen, query, nodes: before.nodes.length }));
  if (process.argv.includes('--inspect')) {
    console.log('RESULT_UI', JSON.stringify(before.nodes.map((n, index) => ({ index, parent: n.parentIndex, id: n.resourceId,
      text: n.text, description: n.description, clickable: n.clickable, scrollable: n.scrollable, bounds: n.bounds }))
      .filter(n => n.text || n.description || n.scrollable)));
    return;
  }
  if (before.foregroundPackage !== 'com.google.android.youtube' || query?.trim().toLowerCase() !== 'openai' || before.screen !== 'SEARCH_RESULTS') {
    throw new Error('Expected the current OpenAI search results; no navigation or clicks were performed.');
  }
  let lastScroll;
  const result = await context.execute({ type: 'WAIT_FOR', target: 'video_list', timeoutMs: 30000 }, signal, progress => {
    if (progress.exploration && progress.exploration.scrollCount !== lastScroll) {
      lastScroll = progress.exploration.scrollCount;
      console.log('PROGRESS', JSON.stringify(progress.exploration));
    }
  });
  console.log('VIDEO_DISCOVERY', JSON.stringify({ verification: result.verification, elapsedMs: result.elapsedMs, exploration: result.exploration }));
  if (process.argv.includes('--click-fourth')) {
    lastScroll = undefined;
    const clicked = await context.execute({ type: 'CLICK', target: 'video_card_4' }, signal, progress => {
      if (progress.exploration && progress.exploration.scrollCount !== lastScroll) {
        lastScroll = progress.exploration.scrollCount;
        console.log('FOURTH_PROGRESS', JSON.stringify(progress.exploration));
      }
    });
    console.log('FOURTH_VIDEO', JSON.stringify(clicked));
    if (clicked.verification !== 'VERIFIED') throw new Error('Fourth video was dispatched but playback was not verified.');
    const after = await context.observe(signal);
    console.log('WATCH_STATE', JSON.stringify({ screen: after.screen, package: after.foregroundPackage,
      titles: after.nodes.filter(n => /:id\/(modern_title|video_title)$/.test(n.resourceId)).map(n => n.text || n.description) }));
  }
})().catch(error => { console.error('FAIL', error.code, error.message, JSON.stringify(error.exploration)); process.exitCode = 1; })
  .finally(async () => {
    try { await context?.close(); console.log('SESSION_CLOSED'); }
    catch (error) { console.error('CLEANUP_FAILED', error.message); process.exitCode = 1; }
  });
