import type { WebDocument } from './hybrid-context-observer';

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
