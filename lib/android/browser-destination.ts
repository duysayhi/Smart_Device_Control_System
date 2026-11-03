import type { WebDocument } from './hybrid-context-observer';
import { canonicalUiText } from './ui-understanding';
import { XMLParser } from 'fast-xml-parser';
import { isIP } from 'node:net';

function publicDestination(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || isIP(url.hostname) ||
    !url.hostname.includes('.') || /\.(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw new Error('Invalid public destination.');
  return url.href;
}

// Resolve only the observed Google redirect, never fetch the destination or run its scripts.
export async function resolveBrowserDestinationUrl(value: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  const source = new URL(value);
  if (source.pathname !== '/goto' || !['www.google.com', 'google.com'].includes(source.hostname)) return value;
  if (source.protocol !== 'https:' || source.port || source.username || source.password || !source.searchParams.get('url')) throw new Error('Invalid Google redirect.');
  const response = await request(source.href, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
  const location = response.headers.get('location');
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    await response.body?.cancel();
    return publicDestination(new URL(location, source).href);
  }
  if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error('No redirect evidence.'); }
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 16384) throw new Error('Redirect response too large.');
      chunks.push(chunk);
    }
  } finally { await reader.cancel(); }
  const body = Buffer.concat(chunks).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY|<script\b/i.test(body)) throw new Error('Unsupported redirect document.');
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', transformTagName: name => name.toLowerCase(),
    transformAttributeName: name => name.toLowerCase(), unpairedTags: ['meta'], processEntities: false }).parse(body);
  const html = parsed.html, anchor = html?.body?.a;
  if (html?.head?.title !== '302 Moved' || html?.body?.h1 !== '302 Moved' || !anchor || Array.isArray(anchor) ||
    typeof anchor['@href'] !== 'string') throw new Error('No unique explicit redirect destination.');
  return publicDestination(anchor['@href']);
}

const resource = (value: string): string => {
  const url = new URL(value);
  return url.origin + url.pathname.replace(/\/$/, '') + url.search;
};

export function matchesBrowserDestination(expectedValue: string, document: WebDocument): boolean {
  try {
    const expected = new URL(expectedValue), actual = new URL(document.url);
    if (!/^https?:$/.test(actual.protocol) || !/^https?:$/.test(expected.protocol) || actual.username || actual.password || expected.username || expected.password) return false;
    if (expected.hostname.replace(/^www\./, '') === actual.hostname.replace(/^www\./, '') &&
      expected.port === actual.port && expected.pathname.replace(/\/$/, '') === actual.pathname.replace(/\/$/, '')) return true;
    // A locale redirect needs browser navigation provenance AND explicit page identity.
    // Same hostname or a similar title alone cannot authorize a different path.
    return expected.origin === actual.origin && (document.redirectCount ?? 0) > 0 && document.navigationType === 'navigate' &&
      document.navigationUrl !== undefined && resource(document.navigationUrl) === resource(document.url) &&
      document.canonicalUrls?.length === 1 && resource(document.canonicalUrls[0]) === resource(document.url) &&
      document.alternateUrls?.some(url => resource(url) === resource(expectedValue)) &&
      document.alternateUrls.some(url => resource(url) === resource(document.url));
  } catch { return false; }
}

export function matchesBrowserResultTitle(expectedTitle: string, expectedUrl: string, document: WebDocument): boolean {
  const expected = canonicalUiText(expectedTitle), titles = [document.title, ...document.headings].map(canonicalUiText);
  if (!expected) return false;
  if (titles.some(title => title.includes(expected))) return true;
  try {
    const host = new URL(expectedUrl).hostname.replace(/^www\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const branded = expected.match(new RegExp(`^(.+\\S)\\s+[-|\\u2013\\u2014]\\s+${host}$`, 'i'));
    if (!branded) return false;
    const article = canonicalUiText(branded[1]);
    // Only a literal hostname suffix may be removed, with exact title/H1 and independent identity evidence.
    return matchesBrowserDestination(expectedUrl, document) && document.canonicalUrls?.length === 1 &&
      resource(document.canonicalUrls[0]) === resource(document.url) && document.navigationType === 'navigate' &&
      document.navigationUrl !== undefined && resource(document.navigationUrl) === resource(document.url) &&
      canonicalUiText(document.title) === article && document.headings.some(heading => canonicalUiText(heading) === article);
  } catch { return false; }
}
