import { createHash } from 'node:crypto';
import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { normalizeUiText, canonicalUiText, findBrowserResultNodes, browserResultUrl } from '../ui-understanding';
import { isDescendant, clippedBounds, type ScrollRegion } from './scroll-regions';
import type { ExplorationGoal } from './types';

export interface DiscoveryCandidate {
  node: UiNode; identity: string; title: string; itemType: 'video' | 'browser' | 'list'; url?: string;
  confidence: 'EXACT_CONTENT'; partial: boolean;
}
export interface RememberedElement extends Omit<DiscoveryCandidate, 'node'> {
  firstSeen: number; snapshotId: string; context: string; resourceId: string; text: string; contentDescription: string;
  bounds: UiNode['bounds']; observationOrder: number; duplicateCount: number;
  maxObservedHeight: number;
}
const keyFor = (value: string) => createHash('sha256').update(value).digest('hex');
const adLabel = (text: string) => /^(ad|ads|sponsored|advertisement|quang cao|duoc tai tro)(?:$|\s[-\u2013\u2014,:])/.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\u0111/g, 'd').trim());

export function videoResultTitle(description: string): string | undefined {
  const parts = description.split(/\s[-\u2013\u2014]\s/);
  const duration = parts.findIndex(part => /^(?:\d[\d\s,:.]*\s*(?:phut|giay|gio|minutes?|seconds?|hours?)|\d{1,2}:\d{2}(?::\d{2})?|live|truc tiep|dang phat truc tiep)(?:\b|$)/.test(normalizeUiText(part)));
  const separators = [...description.matchAll(/\s[-\u2013\u2014]\s/g)];
  return duration > 0 && separators[duration - 1] ? description.slice(0, separators[duration - 1].index).trim() : undefined;
}
export function videoIdentityEvidence(description: string): string {
  const title = videoResultTitle(description);
  const parts = description.split(/\s[-\u2013\u2014]\s/);
  const duration = parts.find(part => /^(?:\d[\d\s,:.]*\s*(?:phut|giay|gio|minutes?|seconds?|hours?)|\d{1,2}:\d{2}(?::\d{2})?|live|truc tiep)(?:\b|$)/.test(normalizeUiText(part)));
  const channels = parts.filter(part => /^(?:kenh|channel|go to channel|chuyen den kenh)\s/.test(normalizeUiText(part)));
  // Only ignore volatile view/date fields when an explicit channel and duration
  // identify the same content. Unknown layouts retain exact-description identity.
  return title && duration && channels.length === 1 ? JSON.stringify([canonicalUiText(title), canonicalUiText(duration), canonicalUiText(channels[0])]) : canonicalUiText(description);
}

export function discoveryCandidates(snapshot: Observation, region: ScrollRegion, goal: ExplorationGoal): { status: 'OBSERVED' | 'AMBIGUOUS'; candidates: DiscoveryCandidate[]; reason?: string } {
  if (goal.kind !== 'ordinal') return { status: 'OBSERVED', candidates: [] };
  const inRegion = snapshot.nodes.filter(n => n.packageName === snapshot.foregroundPackage && n.enabled && n.displayed !== false && isDescendant(snapshot.nodes, n, region.node));
  let rows: UiNode[];
  if (goal.itemType === 'video') {
    if (snapshot.foregroundPackage !== 'com.google.android.youtube' || !snapshot.nodes.some(n => n.resourceId.endsWith(':id/search_query') && n.text.trim())) return { status: 'AMBIGUOUS', candidates: [], reason: 'Video ordinal requires an observed YouTube search query.' };
    rows = inRegion.filter(n => n.clickable && /\s[-\u2013\u2014]\s(?:phat video|play video)$/.test(n.description.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
    const inObservedAd = (node: UiNode) => {
      let group: UiNode | undefined = node;
      const visited = new Set<UiNode>();
      while (group && group !== region.node && !visited.has(group)) {
        visited.add(group);
        const container = group;
        if (inRegion.some(n => adLabel(n.text || n.description) && isDescendant(snapshot.nodes, n, container)) &&
          rows.filter(row => isDescendant(snapshot.nodes, row, container)).length <= 1) return true;
        group = group.parentIndex === undefined ? undefined : snapshot.nodes[group.parentIndex];
      }
      return false;
    };
    // Bare thumbnails cannot establish long-video identity, type, or ordinal.
    const unidentified = inRegion.some(n => /:id\/(thumbnail|video_thumbnail)$/.test(n.resourceId) &&
      !inObservedAd(n) &&
      !rows.some(row => isDescendant(snapshot.nodes, n, row) || n.bounds[0] >= row.bounds[0] && n.bounds[1] >= row.bounds[1] && n.bounds[2] <= row.bounds[2] && n.bounds[3] <= row.bounds[3]));
    if (unidentified) return { status: 'AMBIGUOUS', candidates: [], reason: 'A video thumbnail lacks reliable long-video identity/type evidence.' };
  } else if (goal.itemType === 'browser') {
    rows = findBrowserResultNodes(snapshot).filter(n => isDescendant(snapshot.nodes, n, region.node));
    if (!rows.length && inRegion.some(n => adLabel(n.text || n.description)) && inRegion.some(n => browserResultUrl(n))) return { status: 'AMBIGUOUS', candidates: [], reason: 'Cannot determine organic browser result boundaries around observed ads.' };
  }
  else {
    if (!/RecyclerView|ListView/.test(region.node.className)) return { status: 'AMBIGUOUS', candidates: [], reason: 'Generic ordinal requires an observed list with identifiable rows.' };
    rows = inRegion.filter(n => n !== region.node && n.clickable &&
      !inRegion.some(p => p !== n && p.clickable && p !== region.node && isDescendant(snapshot.nodes, n, p)));
  }
  rows = rows.filter(n => {
    const b = clippedBounds(snapshot, n);
    return b[2] > b[0] && b[3] > b[1];
  }).sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
  const candidates: DiscoveryCandidate[] = [];
  for (const node of rows) {
    if (goal.itemType === 'video') {
      let parent = node.parentIndex;
      while (parent !== undefined && snapshot.nodes[parent] !== region.node) {
        const group = snapshot.nodes[parent];
        if (!group) break;
        if (group.scrollable === true) {
          const grouped = rows.filter(row => isDescendant(snapshot.nodes, row, group));
          const horizontal = /HorizontalScrollView/.test(group.className) || grouped.some(a => grouped.some(b => a !== b &&
            a.bounds[2] <= b.bounds[0] && Math.min(a.bounds[3], b.bounds[3]) > Math.max(a.bounds[1], b.bounds[1])));
          if (!horizontal) return { status: 'AMBIGUOUS', candidates: [], reason: 'Nested video group orientation/order is not proven for a vertical ordinal.' };
          parent = -1; break;
        }
        parent = group.parentIndex;
      }
      if (parent === -1) continue;
    }
    if (inRegion.some(n => /:id\/.*shorts/.test(n.resourceId) && isDescendant(snapshot.nodes, node, n))) continue;
    if (adLabel(node.description) || adLabel(node.text) || inRegion.some(n => adLabel(n.text || n.description) && isDescendant(snapshot.nodes, n, node))) continue;
    // Only associate an ad marker with a containing group if it does not group multiple results.
    let parent = node.parentIndex;
    let excluded = false;
    while (parent !== undefined && snapshot.nodes[parent] !== region.node) {
      const group = snapshot.nodes[parent];
      if (!group) break;
      if (inRegion.some(n => adLabel(n.text || n.description) && isDescendant(snapshot.nodes, n, group))) {
        if (rows.filter(row => isDescendant(snapshot.nodes, row, group)).length > 1) return { status: 'AMBIGUOUS', candidates: [], reason: 'Ad/result group boundary is not reliable.' };
        excluded = true; break;
      }
      parent = group.parentIndex;
    }
    if (excluded) continue;
    const description = node.description || node.text || inRegion.filter(n => n !== node && isDescendant(snapshot.nodes, n, node) && n.text.trim()).map(n => n.text).join(' | ');
    const url = goal.itemType === 'browser' ? browserResultUrl(node)?.href : undefined;
    const title = goal.itemType === 'video' ? videoResultTitle(description) ?? '' : goal.itemType === 'browser'
      ? description.match(/https?:\/\/[^\s]+\s+(.+)/)?.[1]?.trim() ?? '' : description.trim();
    if (title.length < 3) return { status: 'AMBIGUOUS', candidates: [], reason: 'Result lacks enough stable identity evidence.' };
    const identity = keyFor(`${goal.itemType}:${url ?? ''}:${goal.itemType === 'video' ? videoIdentityEvidence(description) : canonicalUiText(description)}`);
    const clip = clippedBounds(snapshot, node);
    candidates.push({ node, title, identity, itemType: goal.itemType, url, confidence: 'EXACT_CONTENT', partial: clip.some((v, i) => v !== node.bounds[i]) });
  }
  return { status: 'OBSERVED', candidates };
}

export class DiscoveredElementMemory {
  readonly items: RememberedElement[] = [];
  anchored = false;
  duplicates = 0;
  constructor(readonly context: string, private readonly maxElements: number) {}
  ingest(snapshot: Observation, candidates: DiscoveryCandidate[]): { status: 'OBSERVED' | 'AMBIGUOUS' | 'LIMIT'; added: number; reason?: string } {
    if (!this.anchored) return { status: 'AMBIGUOUS', added: 0, reason: 'List origin has not been verified.' };
    const keys = candidates.map(c => c.identity);
    if (new Set(keys).size !== keys.length) return { status: 'AMBIGUOUS', added: 0, reason: 'Duplicate content identities in one viewport cannot be disambiguated.' };
    for (const candidate of candidates) {
      if (this.items.some(item => normalizeUiText(item.title) === normalizeUiText(candidate.title) && item.identity !== candidate.identity)) return { status: 'AMBIGUOUS', added: 0, reason: 'Same title has changed identity metadata; refuse to merge or count it again.' };
    }
    let appendFrom = 0;
    if (this.items.length && candidates.length) {
      const offset = this.items.findIndex(item => item.identity === keys[0]);
      if (offset < 0) return { status: 'AMBIGUOUS', added: 0, reason: 'No overlap with remembered results; ordinal continuity was lost.' };
      appendFrom = Math.min(keys.length, this.items.length - offset);
      for (let i = 0; i < appendFrom; i++) if (this.items[offset + i].identity !== keys[i]) return { status: 'AMBIGUOUS', added: 0, reason: 'Result order changed or a virtualized row disappeared.' };
      if (keys.slice(appendFrom).some(key => this.items.some(item => item.identity === key))) return { status: 'AMBIGUOUS', added: 0, reason: 'Previously seen items were reordered after the overlapping prefix.' };
    }
    if (this.items.length + candidates.length - appendFrom > this.maxElements) return { status: 'LIMIT', added: 0, reason: 'Discovered element memory limit reached.' };
    candidates.forEach((candidate) => {
      const existing = this.items.find(item => item.identity === candidate.identity);
      const data = { snapshotId: snapshot.snapshotId, context: this.context, resourceId: candidate.node.resourceId, text: candidate.node.text,
        contentDescription: candidate.node.description, bounds: candidate.node.bounds, partial: candidate.partial };
      if (existing) { Object.assign(existing, data); existing.maxObservedHeight = Math.max(existing.maxObservedHeight, candidate.node.bounds[3] - candidate.node.bounds[1]); existing.duplicateCount++; this.duplicates++; }
      else {
        const { node: unusedNode, ...identity } = candidate;
        void unusedNode;
        this.items.push({ ...identity, ...data, firstSeen: snapshot.timestamp, observationOrder: this.items.length + 1, duplicateCount: 0, maxObservedHeight: candidate.node.bounds[3] - candidate.node.bounds[1] });
      }
    });
    return { status: 'OBSERVED', added: candidates.length - appendFrom };
  }
}
