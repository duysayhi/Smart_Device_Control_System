import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagedAppiumSession } from './appium/session-manager';
import type { AppiumElement } from './appium/client';
import { AndroidExecutionError, checkCancellation } from './errors';
import { isSensitiveControl } from './security-policy';
import { canonicalUiText, normalizeUiText } from './ui-understanding';
import { withSessionContextLock } from './appium/session-operation-lock';
import { matchesBrowserDestination } from './browser-destination';
export { withSessionContextLock } from './appium/session-operation-lock';

const WebLinkSchema = z.object({ selector: z.string().min(1), href: z.string().url(), url: z.string().url(), title: z.string().min(1),
  visible: z.boolean(), covered: z.boolean(), bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]) });
export const WebDocumentSchema = z.object({ url: z.string().url(), title: z.string(), readyState: z.string(),
  canonicalUrls: z.array(z.string().url()).max(4).default([]), alternateUrls: z.array(z.string().url()).max(60).default([]),
  redirectCount: z.number().int().nonnegative().optional(), navigationType: z.string().optional(), navigationUrl: z.string().url().optional(),
  headings: z.array(z.string()).max(100).default([]),
  viewport: z.object({ width: z.number().positive(), height: z.number().positive() }), links: z.array(WebLinkSchema).max(500), ambiguousAds: z.boolean() });
export type WebDocument = z.infer<typeof WebDocumentSchema>;
export type HybridObservation = { status: 'DOM_AVAILABLE'; source: 'WEB_CONTEXT'; context: string; contexts: string[]; document: WebDocument } |
  { status: 'NO_WEB_CONTEXT' | 'AMBIGUOUS_CONTEXT' | 'CHROMEDRIVER_INCOMPATIBLE' | 'CHROMEDRIVER_UNAVAILABLE' | 'WEB_UNAVAILABLE';
    source: 'NATIVE_ONLY'; contexts: string[]; reason: string };

// Read-only semantic extraction. CSS paths identify observed anchors, not guessed
// site-specific selectors. Offscreen headings remain available for DOM discovery.
export const READ_WEB_DOCUMENT = `return (() => {
  const cssPath = el => { const parts = []; while (el && el.nodeType === 1 && el !== document.documentElement) {
    const siblings = Array.from(el.parentElement?.children || []).filter(n => n.tagName === el.tagName);
    parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')'); el = el.parentElement;
  } return 'html > ' + parts.join(' > '); };
  const links = [], seen = new Set(); let ambiguousAds = false;
  for (const anchor of document.querySelectorAll('a[href]')) {
    const heading = anchor.querySelector('h2,h3,[role="heading"]');
    if (!heading) continue;
    const title = (heading.textContent || '').replace(/\\s+/g, ' ').trim(); if (!title) continue;
    const styled = getComputedStyle(anchor); if (styled.display === 'none' || styled.visibility === 'hidden') continue;
    let ancestor = anchor, ad = false;
    while (ancestor && ancestor !== document.body) {
      if (ancestor.matches('[data-text-ad],[data-ad],[aria-label="Sponsored"],[aria-label="Advertisement"]')) { ad = true; break; }
      const labels = Array.from(ancestor.querySelectorAll('span,[role="note"]')).filter(n => /^(Sponsored|Ad|Ads|Advertisement|Quảng cáo|Được tài trợ)$/i.test((n.textContent || '').trim()));
      if (labels.length) { const headingCount = ancestor.querySelectorAll('a h2,a h3,a [role="heading"]').length;
        if (headingCount > 1) ambiguousAds = true; else ad = true; break; }
      ancestor = ancestor.parentElement;
    }
    if (ad) continue;
    let href, url; try { href = new URL(anchor.href, location.href); url = href;
      if (/(^|\\.)google\\.[a-z.]+$/.test(href.hostname) && href.pathname === '/url') url = new URL(href.searchParams.get('q') || href.searchParams.get('url') || href.href);
    } catch { continue; }
    if (!/^https?:$/.test(href.protocol) || !/^https?:$/.test(url.protocol)) continue;
    const identity = url.href + '\\n' + title; if (seen.has(identity)) { ambiguousAds = true; continue; } seen.add(identity);
    const r = anchor.getBoundingClientRect(), width = innerWidth, height = innerHeight;
    const visible = r.width >= 24 && r.height >= 24 && r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1;
    const top = visible ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    links.push({ selector: cssPath(anchor), href: href.href, url: url.href, title, visible, covered: !top || !anchor.contains(top), bounds: [r.left,r.top,r.right,r.bottom] });
    if (links.length >= 500) break;
  }
  const headings = Array.from(document.querySelectorAll('h1,[role="heading"][aria-level="1"]')).filter(el => el.getBoundingClientRect().height > 0)
    .slice(0,100).map(el => (el.textContent || '').replace(/\\s+/g,' ').trim());
  const nav = performance.getEntriesByType('navigation')[0];
  return { url: location.href, title: document.title, headings, readyState: document.readyState, viewport: { width: innerWidth, height: innerHeight }, links, ambiguousAds,
    canonicalUrls: Array.from(document.querySelectorAll('link[rel="canonical"]')).slice(0,4).map(el=>el.href),
    alternateUrls: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).slice(0,60).map(el=>el.href),
    redirectCount: nav?.redirectCount, navigationType: nav?.type, navigationUrl: nav?.name };
})();`;

export const READ_WEB_DESTINATION = `return (() => { const nav=performance.getEntriesByType('navigation')[0]; return { url: location.href, title: document.title, readyState: document.readyState,
  headings: Array.from(document.querySelectorAll('h1,[role="heading"][aria-level="1"]')).filter(el => el.getBoundingClientRect().height > 0)
    .slice(0,100).map(el => (el.textContent || '').replace(/\\s+/g,' ').trim()),
  viewport: {width: innerWidth, height: innerHeight}, links: [], ambiguousAds: false,
  canonicalUrls: Array.from(document.querySelectorAll('link[rel="canonical"]')).slice(0,4).map(el=>el.href),
  alternateUrls: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).slice(0,60).map(el=>el.href),
  redirectCount: nav?.redirectCount, navigationType: nav?.type, navigationUrl: nav?.name }; })();`;

function safeDocument(value: unknown): WebDocument {
  const parsed = WebDocumentSchema.safeParse(value);
  if (!parsed.success || !/^https?:$/.test(new URL(parsed.data.url).protocol)) throw new AndroidExecutionError('UNKNOWN', 'Web Context did not supply a valid HTTP(S) DOM observation.');
  return parsed.data;
}
export function matchesNativeAddress(address: string, webUrl: string): boolean {
  try {
    const native = new URL(/^https?:\/\//.test(address) ? address : `https://${address}`), web = new URL(webUrl);
    const query = (url: URL) => JSON.stringify([...url.searchParams.entries()].map(([key, value]) => [key, value.normalize('NFC')]).sort());
    return /^https?:$/.test(web.protocol) && native.hostname.replace(/^www\./, '') === web.hostname.replace(/^www\./, '') &&
      native.pathname === web.pathname && query(native) === query(web);
  } catch { return false; }
}
export class HybridContextObserver {
  private failures = new Map<string, NonNullable<AndroidExecutionError['backendReason']>>();
  constructor(private readonly session: ManagedAppiumSession, private readonly accounting?: { beforeSnapshot?: (source?: string) => void; beforeScroll?: () => void;
    onWebVerification?: (value: { phase: string; urlMatches?: boolean; titleMatches?: boolean; ready?: boolean; pageError?: boolean; changed?: boolean }) => void }) {}
  async ensureNative(timeoutMs = 10000, signal?: AbortSignal): Promise<void> {
    const current = await this.session.client.request<string>('GET', this.session.path + '/context', undefined, timeoutMs, signal);
    if (current !== 'NATIVE_APP') await this.session.client.request('POST', this.session.path + '/context', { name: 'NATIVE_APP' }, timeoutMs, signal);
  }
  private async restoreNative(): Promise<void> {
    try {
      await this.session.client.request('POST', this.session.path + '/context', { name: 'NATIVE_APP' }, 10000);
      const current = await this.session.client.request<string>('GET', this.session.path + '/context', undefined, 10000);
      if (current !== 'NATIVE_APP') throw new Error('not native');
    } catch (error) { throw new AndroidExecutionError('SESSION_ERROR', 'Cannot restore NATIVE_APP safely; stop using this Session.', { cause: error }); }
  }
  async observe(packageName: string, timeoutMs = 15000, signal?: AbortSignal): Promise<HybridObservation> {
    return withSessionContextLock(this.session, () => this.readInsideSessionLock(packageName, timeoutMs, signal));
  }
  async readInsideSessionLock(packageName: string, timeoutMs: number, signal?: AbortSignal): Promise<HybridObservation> {
    const started = performance.now();
    const remaining = () => Math.max(1, timeoutMs - (performance.now() - started));
    let contexts: string[] = [], switched = false;
    try {
      await this.ensureNative(remaining(), signal);
      const available = await this.session.client.request<unknown>('GET', this.session.path + '/contexts', undefined, remaining(), signal);
      if (!Array.isArray(available) || !available.every(context => typeof context === 'string')) throw new AndroidExecutionError('BACKEND_ERROR', 'Invalid context inventory.');
      contexts = available;
      const candidates = contexts.filter(context => context === `WEBVIEW_${packageName}` || context.startsWith(`WEBVIEW_${packageName}_`) || packageName === 'com.android.chrome' && ['CHROMIUM', 'WEBVIEW_chrome'].includes(context));
      if (candidates.length !== 1) return { status: candidates.length ? 'AMBIGUOUS_CONTEXT' : 'NO_WEB_CONTEXT', source: 'NATIVE_ONLY', contexts,
        reason: candidates.length ? 'Multiple Web Contexts match this app; none was selected.' : 'No Web Context for the foreground app; native hierarchy remains the supported fallback.' };
      const context = candidates[0], previousFailure = this.failures.get(context);
      if (previousFailure) return { status: previousFailure === 'CONTEXT_UNAVAILABLE' ? 'WEB_UNAVAILABLE' : previousFailure, source: 'NATIVE_ONLY', contexts, reason: previousFailure };
      switched = true;
      await this.session.client.request('POST', this.session.path + '/context', { name: context }, remaining(), signal);
      this.accounting?.beforeSnapshot?.('DOM_OBSERVE');
      const value = await this.session.client.request('POST', this.session.path + '/execute/sync', { script: READ_WEB_DOCUMENT, args: [] }, remaining(), signal);
      const document = safeDocument(value);
      return { status: 'DOM_AVAILABLE', source: 'WEB_CONTEXT', context, contexts, document };
    } catch (error) {
      checkCancellation(signal);
      if (!(error instanceof AndroidExecutionError) || ['SESSION_ERROR', 'DEVICE_ERROR', 'CANCELLED'].includes(error.code)) throw error;
      const reason = error.backendReason;
      if (reason && contexts.length) for (const context of contexts.filter(value => value !== 'NATIVE_APP')) this.failures.set(context, reason);
      return { status: reason === 'CHROMEDRIVER_INCOMPATIBLE' || reason === 'CHROMEDRIVER_UNAVAILABLE' ? reason : 'WEB_UNAVAILABLE', source: 'NATIVE_ONLY', contexts,
        reason: reason ?? (error.code === 'TIMEOUT' ? 'Web Context observation timed out; native context is restored before fallback.' : 'Web Context could not provide DOM; native hierarchy is used without claiming DOM access.') };
    } finally { if (switched) await this.restoreNative(); }
  }
  async clickOrdinal(observed: Extract<HybridObservation, { status: 'DOM_AVAILABLE' }>, ordinal: number,
    timeoutMs: number, signal?: AbortSignal): Promise<{ title: string; selectedTitle: string; url: string; finalUrl: string }> {
    return withSessionContextLock(this.session, async () => {
      const started = performance.now(), remaining = () => Math.max(1, timeoutMs - (performance.now() - started));
      let switched = false;
      try {
        checkCancellation(signal);
        const contexts = await this.session.client.request<string[]>('GET', this.session.path + '/contexts', undefined, remaining(), signal);
        if (!contexts.includes(observed.context)) throw new AndroidExecutionError('UNKNOWN', 'Observed Web Context is no longer available.');
        switched = true;
        await this.session.client.request('POST', this.session.path + '/context', { name: observed.context }, remaining(), signal);
        const read = async (source: string) => { this.accounting?.beforeSnapshot?.(source); return safeDocument(await this.session.client.request('POST', this.session.path + '/execute/sync', { script: source === 'DOM_VERIFY' ? READ_WEB_DESTINATION : READ_WEB_DOCUMENT, args: [] }, remaining(), signal)); };
        const before = await read('DOM_PRECLICK');
        if (before.url !== observed.document.url || before.ambiguousAds) throw new AndroidExecutionError('AMBIGUOUS', 'Web query or advertisement/result boundaries changed.');
        const expected = observed.document.links[ordinal - 1], selected = before.links[ordinal - 1];
        if (!expected || !selected || expected.url !== selected.url || expected.title !== selected.title || expected.selector !== selected.selector) throw new AndroidExecutionError('AMBIGUOUS', 'Web result order or identity changed before interaction.');
        if (isSensitiveControl(selected.url) || isSensitiveControl(selected.title)) throw new AndroidExecutionError('CONFIG_ERROR', 'Selected web link has sensitive semantics; no click was sent.');
        const rows = await this.session.client.request<AppiumElement[]>('POST', this.session.path + '/elements', { using: 'css selector', value: selected.selector }, remaining(), signal);
        if (rows.length !== 1) throw new AndroidExecutionError('AMBIGUOUS', 'DOM activation selector does not resolve uniquely.');
        const element = rows[0], id = element['element-6066-11e4-a52e-4f735466cecf'];
        this.accounting?.beforeScroll?.();
        await this.session.client.request('POST', this.session.path + '/execute/sync', { script: 'arguments[0].scrollIntoView({block:"center",inline:"nearest"});', args: [element] }, remaining(), signal);
        const ready = await read('DOM_ACTIVATION'), current = ready.links[ordinal - 1];
        if (ready.url !== before.url || ready.ambiguousAds || !current || current.href !== selected.href || current.url !== selected.url || current.title !== selected.title ||
          current.selector !== selected.selector || !current.visible || current.covered) throw new AndroidExecutionError('AMBIGUOUS', 'DOM result changed, is clipped, hidden or covered after scrolling.');
        const path = this.session.path + `/element/${encodeURIComponent(id)}`;
        if (!await this.session.client.request<boolean>('GET', path + '/displayed', undefined, remaining(), signal) ||
          !await this.session.client.request<boolean>('GET', path + '/enabled', undefined, remaining(), signal)) throw new AndroidExecutionError('AMBIGUOUS', 'Web element is no longer enabled/visible.');
        checkCancellation(signal);
        await this.session.client.request('POST', path + '/click', {}, remaining(), signal);
        const expectedUrl = new URL(selected.url);
        let previousState = '', unchanged = 0;
        while (performance.now() - started < timeoutMs) {
          const after = await read('DOM_VERIFY'), actual = new URL(after.url);
          const content = canonicalUiText([after.title, ...after.headings].join(' '));
          const pageError = /\b(?:404|403|500|not found|access denied|captcha|unavailable)\b/.test(normalizeUiText(after.title));
          this.accounting?.onWebVerification?.({ phase: 'DESTINATION', urlMatches: matchesBrowserDestination(expectedUrl.href, after),
            titleMatches: content.includes(canonicalUiText(selected.title)), ready: after.readyState === 'complete', pageError, changed: actual.href !== before.url });
          if (matchesBrowserDestination(expectedUrl.href, after) && after.readyState === 'complete' &&
            !pageError && content.includes(canonicalUiText(selected.title)) && actual.href !== before.url) return { title: after.title, selectedTitle: selected.title, url: selected.url, finalUrl: after.url };
          const signature = JSON.stringify([after.url, after.title, after.headings, after.readyState]);
          unchanged = signature === previousState ? unchanged + 1 : 0; previousState = signature;
          await delay(Math.min(1000, 250 * 2 ** Math.min(unchanged, 2), remaining()), undefined, { signal }).catch(() => checkCancellation(signal));
        }
        throw new AndroidExecutionError('TIMEOUT', 'Web link was clicked but destination URL/document readiness was not verified.');
      } finally { if (switched) await this.restoreNative(); }
    });
  }
}
