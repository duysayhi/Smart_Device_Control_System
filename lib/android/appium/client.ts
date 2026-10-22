import { AndroidExecutionError, checkCancellation } from '../errors';

export interface AppiumElement { 'element-6066-11e4-a52e-4f735466cecf': string }
export interface AppiumSelector { using: 'id' | 'accessibility id' | 'xpath' | 'css selector'; value: string }
export interface AppiumRpcMeasurement { kind: 'SOURCE' | 'ELEMENT' | 'SESSION' | 'CAPABILITIES' | 'SETTINGS' | 'SCREENSHOT' | 'OTHER'; elapsedMs: number; outcome: 'OK' | 'ERROR' }

export class AppiumClient {
  private readonly url: string;
  constructor(url = process.env.APPIUM_URL ?? 'http://127.0.0.1:4723', private readonly fetcher: typeof fetch = fetch, private readonly report?: (value: AppiumRpcMeasurement) => void) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new AndroidExecutionError('CONFIG_ERROR', 'APPIUM_URL must be an HTTP(S) URL without credentials.');
    }
    this.url = url.replace(/\/$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
    checkCancellation(signal);
    const started = performance.now(); let outcome: AppiumRpcMeasurement['outcome'] = 'ERROR';
    try {
      const response = await this.fetcher(this.url + path, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))), ...(signal ? [signal] : [])]),
      });
      const payload = await response.json() as { value: T & { error?: string; message?: string } };
      if (!response.ok || payload.value?.error) {
        const message = payload.value?.message ?? `Appium returned HTTP ${response.status}.`;
        const code = payload.value?.error === 'invalid session id' || /socket hang up/i.test(message) ? 'SESSION_ERROR' :
          /timed? ?out|timeout/i.test(message) ? 'TIMEOUT' : 'BACKEND_ERROR';
        // Do not expose server stack traces, commands, or UI source in user-visible logs.
        const error = new AndroidExecutionError(code, /socket hang up/i.test(message) ? 'Appium instrumentation connection closed (socket hang up).' :
          code === 'SESSION_ERROR' ? 'Appium session is no longer active.' : `Appium command failed (${payload.value?.error ?? response.status}).`);
        error.requestOutcomeKnown = true;
        error.sessionInvalid = payload.value?.error === 'invalid session id';
        if (/only supports Chrome|current browser version|No Chromedriver found.*automate|Chrome version.*not supported/i.test(message)) error.backendReason = 'CHROMEDRIVER_INCOMPATIBLE';
        else if (/chromedriver.*(?:not found|missing|does not exist|could not|cannot)|cannot.*chromedriver/i.test(message)) error.backendReason = 'CHROMEDRIVER_UNAVAILABLE';
        else if (/no such context|context.*not found/i.test(message)) error.backendReason = 'CONTEXT_UNAVAILABLE';
        throw error;
      }
      outcome = 'OK'; return payload.value;
    } catch (error) {
      checkCancellation(signal);
      if (error instanceof AndroidExecutionError) throw error;
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new AndroidExecutionError('TIMEOUT', 'Appium request exceeded its deadline.', { cause: error });
      }
      const failure = new AndroidExecutionError('BACKEND_ERROR', 'Cannot communicate with Appium server.', { cause: error });
      const networkCode = (error as { cause?: { code?: string } })?.cause?.code;
      if (networkCode === 'ECONNREFUSED' || networkCode === 'ENOTFOUND') failure.requestOutcomeKnown = true;
      throw failure;
    } finally {
      try { this.report?.({ kind: path.endsWith('/source') ? 'SOURCE' : /\/elements?(?:\/|$)/.test(path) ? 'ELEMENT' : path === '/session' ? 'SESSION' : path.endsWith('/capabilities') ? 'CAPABILITIES' : path.endsWith('/settings') ? 'SETTINGS' : path.endsWith('/screenshot') ? 'SCREENSHOT' : 'OTHER', elapsedMs: performance.now() - started, outcome }); }
      catch { /* Diagnostics must not change command/ownership results. */ }
    }
  }
}
