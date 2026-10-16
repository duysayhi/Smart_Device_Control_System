import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rmdir, unlink, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { AdbRunner } from '../executor';
import { AndroidExecutionError, checkCancellation } from '../errors';
import { AppiumClient } from './client';
import { withSessionContextLock } from './session-operation-lock';
import { allocateSessionPorts, type PortLease } from './port-allocator';

const activeDevices = new Set<string>();

export async function acquireDeviceLock(serial: string): Promise<() => Promise<void>> {
  const key = createHash('sha256').update(serial).digest('hex');
  const root = join(tmpdir(), 'phone-commander-device-locks');
  const path = join(root, key);
  if (activeDevices.has(serial)) throw new AndroidExecutionError('SESSION_ERROR', 'Device already has an active execution.');
  activeDevices.add(serial);
  try {
    await mkdir(root, { recursive: true });
    await mkdir(path);
    await writeFile(join(path, 'owner.json'), JSON.stringify({ serial, pid: process.pid, acquiredAt: new Date().toISOString() }), 'utf8');
  } catch (error) {
    activeDevices.delete(serial);
    throw new AndroidExecutionError('SESSION_ERROR', 'Device is locked by another execution. Stale locks require manual inspection.', { cause: error });
  }
  return async () => {
    await unlink(join(path, 'owner.json'));
    await rmdir(path);
    activeDevices.delete(serial);
  };
}

export async function assertDeviceConnected(run: AdbRunner, serial: string, timeoutMs = 3000): Promise<void> {
  try {
    const { stdout } = await run(['-s', serial, 'get-state'], Math.max(1, Math.ceil(Math.min(3000, timeoutMs))));
    if (stdout.trim() !== 'device') throw new Error('not ready');
  } catch (error) {
    const failure = error as { cause?: { killed?: boolean; code?: string }; message?: string };
    if (['ENOENT', 'EACCES', 'EPERM'].includes(failure.cause?.code ?? '')) throw new AndroidExecutionError('CONFIG_ERROR', 'ADB cannot run. Check ADB_PATH and process permissions.', { cause: error });
    if (failure.cause?.killed || failure.cause?.code === 'ETIMEDOUT' || /ETIMEDOUT|timed? ?out/i.test(failure.message ?? '')) {
      throw new AndroidExecutionError('TIMEOUT', 'ADB health check exceeded its observation deadline.', { cause: error });
    }
    throw new AndroidExecutionError('DEVICE_ERROR', 'Android device disconnected, offline or unauthorized.', { cause: error });
  }
}

export async function verifyInstalledAppiumServer(run: AdbRunner, serial: string): Promise<void> {
  let expected: string;
  try {
    const home = process.env.APPIUM_HOME ?? join(homedir(), '.appium');
    const require = createRequire(join(home, 'node_modules', 'appium-uiautomator2-driver', 'package.json'));
    const packageFile = require.resolve('appium-uiautomator2-server/package.json');
    const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version: string };
    expected = pkg.version;
  } catch (error) {
    throw new AndroidExecutionError('CONFIG_ERROR', 'Cannot verify the installed UiAutomator2 driver/server version. Check APPIUM_HOME.', { cause: error });
  }
  for (const name of ['io.appium.settings', 'io.appium.uiautomator2.server', 'io.appium.uiautomator2.server.test']) {
    const { stdout } = await run(['-s', serial, 'shell', 'dumpsys', 'package', name]);
    const user = stdout.match(/User 0:[^\r\n]*(?:\r?\n[^\r\n]*enabled=\d+)?/)?.[0];
    if (!user || !/installed=true/.test(user) || /hidden=true|suspended=true|enabled=[234]/.test(user)) {
      throw new AndroidExecutionError('CONFIG_ERROR', `Required Appium package is missing or disabled: ${name}. No APK installation was attempted.`);
    }
    if (name === 'io.appium.uiautomator2.server' && stdout.match(/versionName=([^\s]+)/)?.[1] !== expected) {
      throw new AndroidExecutionError('CONFIG_ERROR', 'Installed UiAutomator2 server does not match the local driver. Installation requires explicit approval.');
    }
  }
  const { stdout } = await run(['-s', serial, 'shell', 'pm', 'list', 'instrumentation']);
  if (!stdout.includes('io.appium.uiautomator2.server.test/androidx.test.runner.AndroidJUnitRunner (target=io.appium.uiautomator2.server)')) {
    throw new AndroidExecutionError('CONFIG_ERROR', 'UiAutomator2 instrumentation is not registered. No APK installation was attempted.');
  }
}

export class ManagedAppiumSession {
  private id?: string;
  private creationUncertain = false;
  private ports?: PortLease;
  private opening = false;
  constructor(public readonly client: AppiumClient, public readonly serial: string, private readonly run: AdbRunner,
    private readonly verifyServer = verifyInstalledAppiumServer, private readonly allocatePorts = allocateSessionPorts) {}
  get path(): string {
    if (!this.id) throw new AndroidExecutionError('SESSION_ERROR', 'Appium session has not been created.');
    return `/session/${encodeURIComponent(this.id)}`;
  }
  async open(signal?: AbortSignal): Promise<void> {
    if (this.opening || this.id || this.creationUncertain || this.ports) throw new AndroidExecutionError('SESSION_ERROR', 'This Session already owns resources or is being opened.');
    this.opening = true;
    try {
    checkCancellation(signal);
    const idleTimeout = Number(process.env.ANDROID_OBSERVER_IDLE_TIMEOUT_MS ?? 1000);
    if (!Number.isInteger(idleTimeout) || idleTimeout < 500 || idleTimeout > 10000) throw new AndroidExecutionError('CONFIG_ERROR', 'ANDROID_OBSERVER_IDLE_TIMEOUT_MS must be an integer between 500 and 10000.');
    const chromedriver = process.env.APPIUM_CHROMEDRIVER_EXECUTABLE;
    if (chromedriver && (!isAbsolute(chromedriver) || !(await stat(chromedriver).catch(() => null))?.isFile())) {
      throw new AndroidExecutionError('CONFIG_ERROR', 'APPIUM_CHROMEDRIVER_EXECUTABLE must point to an existing absolute file. No driver was downloaded automatically.');
    }
    await assertDeviceConnected(this.run, this.serial);
    await this.verifyServer(this.run, this.serial);
    const forwards = await this.run(['forward', '--list']);
    if (forwards.stdout.split(/\r?\n/).some((line) => line.startsWith(this.serial + ' ') && /\btcp:6790\b/.test(line))) {
      throw new AndroidExecutionError('SESSION_ERROR', 'Device already has an Appium port forward. Close the external session before execution.');
    }
    // Never auto-install or initialize APKs. Server skip is allowed only after version checks.
    // Creation is not aborted mid-flight: retain the resulting ID so cancellation can clean it up.
    this.ports = await this.allocatePorts(this.serial);
    this.creationUncertain = true;
    let result: { sessionId: string };
    try {
      result = await this.client.request<{ sessionId: string }>('POST', '/session', { capabilities: {
      alwaysMatch: { platformName: 'Android', 'appium:automationName': 'UiAutomator2',
        'appium:deviceName': this.serial, 'appium:udid': this.serial, 'appium:noReset': true,
        'appium:systemPort': this.ports.systemPort, 'appium:chromedriverPort': this.ports.chromedriverPort,
        ...(process.env.APPIUM_ENABLE_MJPEG === 'true' ? { 'appium:mjpegServerPort': this.ports.mjpegServerPort } : {}),
        ...(chromedriver ? { 'appium:chromedriverExecutable': chromedriver } : {}),
        'appium:chromeOptions': { androidUseRunningApp: true, androidDeviceSerial: this.serial },
        'appium:fullReset': false, 'appium:skipServerInstallation': true, 'appium:skipDeviceInitialization': true,
        'appium:skipUnlock': true, 'appium:autoLaunch': false, 'appium:skipLogcatCapture': true,
        'appium:adbExecTimeout': 20000, 'appium:uiautomator2ServerInstallTimeout': 120000,
        // Keep the Session alive through the 120-second human evidence window and revalidation.
        'appium:uiautomator2ServerLaunchTimeout': 30000, 'appium:newCommandTimeout': 180,
      }, firstMatch: [{}],
    } }, 120000);
    } catch (error) {
      if (error instanceof AndroidExecutionError && error.requestOutcomeKnown) this.creationUncertain = false;
      throw error;
    }
    if (!result.sessionId) throw new AndroidExecutionError('SESSION_ERROR', 'Appium did not return a Session ID.');
    this.id = result.sessionId;
    this.creationUncertain = false;
    checkCancellation(signal);
    await this.ensureActive(signal);
    await this.client.request('POST', this.path + '/timeouts', { implicit: 0 }, 10000, signal);
    // Animated feeds may never become idle. Keep a bounded session-only idle wait;
    // observer conditions and fresh native validation still decide when an action is safe.
    await this.client.request('POST', this.path + '/appium/settings', { settings: { waitForIdleTimeout: idleTimeout } }, 10000, signal);
    } finally { this.opening = false; }
  }
  async ensureActive(signal?: AbortSignal): Promise<void> {
    await assertDeviceConnected(this.run, this.serial);
    const response = await this.client.request<{ capabilities?: Record<string, unknown> } & Record<string, unknown>>('GET', this.path + '/appium/capabilities', undefined, 10000, signal);
    const caps = response.capabilities ?? response;
    if ((caps['appium:udid'] ?? caps.udid) !== this.serial) throw new AndroidExecutionError('SESSION_ERROR', 'Appium session device does not match selected serial.');
  }
  async close(): Promise<void> {
    return withSessionContextLock(this, () => this.closeWithinContextLock());
  }
  private async closeWithinContextLock(): Promise<void> {
    if (this.creationUncertain) throw new AndroidExecutionError('SESSION_ERROR', 'Session creation outcome is uncertain; retain device lock and inspect Appium before retrying.');
    if (!this.id) { await this.ports?.release(); this.ports = undefined; return; }
    try { await this.client.request('DELETE', this.path, undefined, 30000); this.id = undefined; }
    catch (error) {
      if (error instanceof AndroidExecutionError && error.sessionInvalid) { this.id = undefined; }
      else throw error;
    }
    await this.ports?.release(); this.ports = undefined;
  }
}
