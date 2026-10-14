import type { Observation } from './state-observer';
import { normalizeUiText, canonicalUiText, findBrowserResultNodes, browserResultUrl } from './ui-understanding';
import type { DiscoveredSelection } from './exploration/types';
import { isDescendant } from './exploration/scroll-regions';
import { navigationLayers } from './browser-navigation';
import { matchesBrowserDestination } from './browser-destination';

export function verifyReversibleNavigation(before: Observation, after: Observation): boolean {
  if (after.observationStatus !== 'OBSERVED' || before.foregroundPackage !== after.foregroundPackage || uiFingerprint(before) === uiFingerprint(after)) return false;
  const oldLayers = navigationLayers(before), newLayers = navigationLayers(after);
  if (oldLayers.length) return oldLayers.some(layer => !newLayers.includes(layer)) &&
    (newLayers.length > 0 || after.nodes.some(n => n.packageName === after.foregroundPackage && n.resourceId.endsWith(':id/url_bar') && n.enabled && n.displayed !== false));
  const dialog = (state: Observation) => state.nodes.some(n => /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle');
  return dialog(before) && !dialog(after);
}

export function verifyDiscoveredSelection(selection: DiscoveredSelection, before: Observation, after: Observation): boolean | undefined {
  if (selection.itemType === 'list') return undefined;
  if (after.foregroundPackage !== before.foregroundPackage) return false;
  const title = canonicalUiText(selection.title);
  if (selection.itemType === 'video') {
    if (after.screen !== 'VIDEO_PLAYER') return false;
    const metadata = after.nodes.filter(n => n.resourceId.endsWith(':id/video_metadata_layout'));
    if (metadata.length > 1) return false;
    return after.nodes.some(n => n.enabled && n.displayed !== false && (metadata.length === 1
      ? isDescendant(after.nodes, n, metadata[0]) && (canonicalUiText(n.text) === title || canonicalUiText(n.description).includes(title))
      : /:id\/(modern_title|video_title)$/.test(n.resourceId) && [n.text, n.description].some(value => canonicalUiText(value) === title)));
  }
  let expected: URL;
  try { expected = new URL(selection.url!); } catch { return false; }
  if (after.web?.status === 'DOM_AVAILABLE') {
    const document = after.web.document;
    return matchesBrowserDestination(expected.href, document) && document.readyState === 'complete' &&
      !/\b(?:404|403|500|not found|access denied|captcha|unavailable)\b/.test(normalizeUiText(document.title)) &&
      canonicalUiText([document.title, ...document.headings].join(' ')).includes(title);
  }
  if (after.web?.status === 'AMBIGUOUS_CONTEXT') return false;
  const actual = addressUrl(after);
  return Boolean(actual && expected.hostname.replace(/^www\./, '') === actual.hostname.replace(/^www\./, '') &&
    expected.pathname.replace(/\/$/, '') === actual.pathname.replace(/\/$/, '') &&
    after.nodes.some(n => /WebView/.test(n.className)) && after.nodes.some(n => canonicalUiText(n.text || n.description).includes(title)));
}

function addressUrl(snapshot: Observation): URL | undefined {
  const address = snapshot.nodes.find((node) => /url_bar|address_bar|omnibox/.test(node.resourceId))?.text;
  if (!address) return undefined;
  try { return new URL(/^https?:\/\//.test(address) ? address : `https://${address}`); } catch { return undefined; }
}
export function verifyBrowserSearch(snapshot: Observation, query: string): boolean {
  if (snapshot.web?.status === 'DOM_AVAILABLE') {
    const document = snapshot.web.document;
    const url = new URL(document.url);
    return [...url.searchParams.values()].some(value => canonicalUiText(value) === canonicalUiText(query)) &&
      !document.ambiguousAds && document.links.length > 0 && document.readyState !== 'loading';
  }
  const url = addressUrl(snapshot);
  return Boolean(url && [...url.searchParams.values()].some((value) => normalizeUiText(value) === normalizeUiText(query)) && findBrowserResultNodes(snapshot).length);
}

export function uiFingerprint(snapshot: Observation): string {
  return JSON.stringify(snapshot.nodes.filter((node) => node.displayed !== false).map((node) =>
    [node.resourceId, node.className, node.text, node.description, node.bounds, node.focused, node.selected]));
}

export function verifyClickTransition(before: Observation, after: Observation, target: string): boolean | undefined {
  const name = normalizeUiText(target);
  if (/^(search button|search field|address bar|search input|tim kiem)$/.test(name) ||
    /search_query|url_bar|search_edit_text/.test(target)) {
    return after.foregroundPackage === before.foregroundPackage && after.nodes.some((node) =>
      node.enabled && node.displayed !== false && node.focused && /EditText|AutoCompleteTextView/.test(node.className));
  }
  if (/^video card [1-5]$/.test(name)) return after.screen === 'VIDEO_PLAYER';
  if (name === 'first result') {
    const result = findBrowserResultNodes(before)[0];
    const expected = result && browserResultUrl(result);
    const actual = addressUrl(after);
    const title = result?.description.match(/https?:\/\/[^\s]+\s+(.+)/)?.[1];
    return Boolean(expected && actual && expected.hostname.replace(/^www\./, '') === actual.hostname.replace(/^www\./, '') &&
      after.nodes.some((node) => /WebView/.test(node.className)) && title &&
      after.nodes.some((node) => normalizeUiText(node.text || node.description).includes(normalizeUiText(title))));
  }
  if (/wi ?fi|wlan/.test(name)) {
    return after.foregroundPackage === before.foregroundPackage && uiFingerprint(before) !== uiFingerprint(after) &&
      after.nodes.some((node) => /^wi ?fi|^wlan/.test(normalizeUiText(node.text || node.description))) &&
      after.nodes.some((node) => /Switch/.test(node.className));
  }
  return undefined;
}
