import { z } from 'zod';
import { findUiTarget, type UiNode } from './targets';
import { isNodeInteractable } from './screen-state';
import type { Observation } from './state-observer';

export const UiSelectionSchema = z.object({ snapshotId: z.string().uuid(), elementId: z.string().min(1) });
export type UiSelection = z.infer<typeof UiSelectionSchema>;
export interface UiMatch { status: 'MATCH' | 'MISSING' | 'AMBIGUOUS' | 'NOT_INTERACTABLE'; node?: UiNode; reason?: string }
export const normalizeUiText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[-_\s]+/g, ' ').trim();
export const canonicalUiText = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

export function browserResultUrl(node: UiNode): URL | undefined {
  const match = (node.description || node.text).match(/https?:\/\/[^\s]+/);
  if (!match) return undefined;
  try { return new URL(match[0]); } catch { return undefined; }
}

export function findBrowserResultNodes(snapshot: Observation): UiNode[] {
  const ambiguousAdGroups = new Set<number>();
  for (const node of snapshot.nodes) {
    if (!/^(ad|ads|sponsored|quang cao|duoc tai tro)$/.test(normalizeUiText(node.text || node.description))) continue;
    let ancestor = node.parentIndex;
    while (ancestor !== undefined) { ambiguousAdGroups.add(ancestor); ancestor = snapshot.nodes[ancestor]?.parentIndex; }
  }
  // Require URL-bearing accessible result cards inside a WebView. Navigation buttons
  // and headings alone are not sufficient evidence of an organic result.
  const results = snapshot.nodes.filter((node) => {
    if (!node.enabled || !node.clickable || node.displayed === false || !browserResultUrl(node) ||
      !/https?:\/\/[^\s]+\s+\S.{10,}/.test(node.description || node.text)) return false;
    let parentIndex = node.parentIndex;
    let webView = false;
    while (parentIndex !== undefined) {
      const parent = snapshot.nodes[parentIndex];
      if (!parent) return false;
      if (/WebView/.test(parent.className)) webView = true;
      // Without reliable ad-group boundaries, refuse the whole ambiguous group.
      if (ambiguousAdGroups.has(parentIndex)) return false;
      parentIndex = parent.parentIndex;
    }
    return webView;
  });
  return results.sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
}

export function nodeForSelection(snapshot: Observation, selection: unknown): UiNode | undefined {
  const parsed = UiSelectionSchema.safeParse(selection);
  if (!parsed.success || parsed.data.snapshotId !== snapshot.snapshotId) return undefined;
  const index = snapshot.elements.findIndex((element) => element.elementId === parsed.data.elementId);
  return index < 0 ? undefined : snapshot.nodes[index];
}

export function matchUiTarget(snapshot: Observation, target: string, forClick = false): UiMatch {
  const nodes = snapshot.nodes.filter((node) => node.enabled && node.displayed !== false && node.packageName === snapshot.foregroundPackage);
  let candidates: UiNode[] = [];
  const explicit = target.match(/^(id|text|accessibility_id):(.+)$/);
  if (explicit) {
    candidates = nodes.filter((node) => explicit[1] === 'id' ? node.resourceId === explicit[2] : explicit[1] === 'text' ? node.text === explicit[2] : node.description === explicit[2]);
  } else if (target.startsWith('element:')) {
    const selected = nodeForSelection(snapshot, { snapshotId: snapshot.snapshotId, elementId: target.slice(8) });
    candidates = selected ? [selected] : [];
  } else if (target.startsWith('observed:')) {
    // A conjunction of attributes read from this UI, not a model-authored selector.
    const schema = z.object({ resourceId: z.string().min(1).max(200), text: z.string().min(1).max(150), className: z.string().min(1).max(200) }).strict();
    try {
      const parsed = schema.safeParse(JSON.parse(target.slice(9)));
      if (parsed.success) candidates = nodes.filter(n => n.resourceId === parsed.data.resourceId && n.text === parsed.data.text && n.className === parsed.data.className);
    } catch { return { status: 'MISSING' }; }
  } else {
    // Registry optimizes proven selectors; other apps still use evidence from their own snapshot.
    const registry = findUiTarget(nodes, target);
    if (target === 'first_result') candidates = findBrowserResultNodes(snapshot).slice(0, 1);
    else if (registry) candidates = /^video_(list|card_[1-5])$/.test(target)
      ? [registry] : nodes.filter((node) => findUiTarget([node], target));
    else {
      const normalized = normalizeUiText(target);
      const search = /^(search button|search field|address bar|search input|tim kiem)$/.test(normalized);
      const addressOnly = normalized === 'address bar';
      const ranked = nodes.map((node) => {
        const text = normalizeUiText(node.text), description = normalizeUiText(node.description);
        const resource = normalizeUiText(node.resourceId.split('/').pop() ?? '');
        let score = text === normalized || description === normalized ? 100 : 0;
        if (resource === normalized) score = Math.max(score, 90);
        if (search) {
          if (!addressOnly && /^(search|tim kiem)$/.test(description)) score = Math.max(score, 100);
          if ((addressOnly ? /^(url bar|address bar|omnibox)$/ : /url bar|address bar|omnibox|search edit text|search field/).test(resource)) score = Math.max(score, 95);
          if (/EditText|AutoCompleteTextView/.test(node.className) && (addressOnly ? /address|dia chi|url/ : /search|tim kiem|address|dia chi/).test(text + ' ' + description + ' ' + resource)) score = Math.max(score, 85);
        }
        return { node, score };
      }).filter((candidate) => candidate.score >= 85);
      const best = Math.max(0, ...ranked.map((candidate) => candidate.score));
      candidates = ranked.filter((candidate) => candidate.score === best).map((candidate) => candidate.node);
    }
  }
  if (!candidates.length) return { status: 'MISSING' };
  if (forClick) candidates = candidates.map((candidate) => {
    let node = candidate;
    while (!node.clickable && node.parentIndex !== undefined) node = snapshot.nodes[node.parentIndex];
    return node;
  });
  candidates = [...new Set(candidates)];
  if (candidates.length !== 1) return { status: 'AMBIGUOUS', reason: 'Multiple UI elements match; refine the target using snapshot context.' };
  const node = candidates[0];
  if (forClick && !isNodeInteractable(node, snapshot.nodes, snapshot.viewport, target)) return { status: 'NOT_INTERACTABLE' };
  return { status: 'MATCH', node };
}
