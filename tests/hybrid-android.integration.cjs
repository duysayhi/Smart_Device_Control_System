/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const { runAdb, listAndroidDevices, captureAndroidScreenshot, isValidAndroidSerial } = require('../lib/android/adb.ts');
const { createExecutionContext } = require('../lib/android/condition-executor.ts');
const { readTransportIdentity, transportMode } = require('../lib/android/transport-identity.ts');
const { readDeviceOwnership } = require('../lib/android/appium/session-manager.ts');
const serial = process.argv[2];
if (!serial || !isValidAndroidSerial(serial)) { console.error('Usage: node tests/hybrid-android.integration.cjs ADB_SERIAL [--require-unplugged]'); process.exit(2); }
let context; const timings = {}, started = performance.now();
async function measured(key, work) { const start = performance.now(); try { return await work(); } finally { timings[key] = Math.round(performance.now() - start); } }
(async () => {
  const health = await measured('adbHealthMs', () => runAdb(['-s', serial, 'get-state'], 5000));
  if (health.stdout.trim() !== 'device') throw new Error('ADB device is unavailable.');
  const identity = await readTransportIdentity(runAdb, serial, true);
  if (!identity) throw new Error('Physical identity is unverified.');
  if (process.argv.includes('--require-unplugged')) {
    if (transportMode(serial) !== 'Wi-Fi') throw new Error('Unplugged acceptance requires a wireless serial.');
    const aliases = await listAndroidDevices();
    if (aliases.some(d => d.connectionType === 'USB' && d.status === 'device' && d.physicalId === identity.physicalId)) throw new Error('USB alias is still present. Ask the user to unplug it first.');
  }
  context = await measured('sessionSetupMs', () => createExecutionContext(serial, [], runAdb, AbortSignal.timeout(90000)));
  const snapshot = await measured('hierarchyMs', () => context.observe());
  if (snapshot.deviceSerial !== serial || snapshot.observationStatus !== 'OBSERVED' || !snapshot.nodes.length) throw new Error('Live hierarchy verification failed.');
  const png = await measured('screenshotMs', () => captureAndroidScreenshot(serial));
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('Screenshot is not a PNG.');
  fs.mkdirSync('.next', { recursive: true });
  const image = path.resolve('.next', `hybrid-${serial.replace(/[^A-Za-z0-9_-]/g, '_')}.png`); fs.writeFileSync(image, png);
  const action = await measured('settingsActionMs', () => context.execute({ type: 'OPEN_APP', app: 'settings' }));
  if (action.verification !== 'VERIFIED' || action.evidence.foregroundPackage !== 'com.android.settings') throw new Error('Settings action was not verified.');
  await measured('cleanupMs', () => context.close()); context = undefined;
  if (await readDeviceOwnership(serial, runAdb)) throw new Error('Ownership remained after cleanup.');
  const forwards = await runAdb(['forward', '--list']);
  if (forwards.stdout.split(/\r?\n/).some(line => line.startsWith(serial + ' ') && /tcp:6790\b/.test(line))) throw new Error('Appium forward remained after cleanup.');
  console.log(JSON.stringify({ status: transportMode(serial) === 'USB' ? 'USB REAL PASS' : 'WIFI TRANSPORT PROBE PASS',
    serial, model: identity.model, usbUnpluggedVerified: process.argv.includes('--require-unplugged'),
    timings, totalMs: Math.round(performance.now() - started), screenshot: image,
    agentAcceptance: 'NOT TESTED by this probe' }, null, 2));
})().catch(error => { console.error('BLOCKED/FAIL', error.message, JSON.stringify(timings)); process.exitCode = 1; })
  .finally(async () => { if (context) { try { await context.close(); } catch (error) { console.error('CLEANUP_FAILED', error.message); process.exitCode = 1; } } });
