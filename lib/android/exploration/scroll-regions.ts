import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { matchUiTarget, findBrowserResultNodes } from '../ui-understanding';
import type { ExplorationGoal, ScrollDirection } from './types';

export interface ScrollRegion { node: UiNode; index: number; bounds: [number, number, number, number]; signature: string }
export type RegionDetection = { status: 'FOUND'; region: ScrollRegion } | { status: 'NOT_FOUND' | 'AMBIGUOUS'; reason: string };
export function isDescendant(nodes: UiNode[], child: UiNode, parent: UiNode): boolean {
  if (child === parent) return true;
  let index = child.parentIndex;
  const visited = new Set<number>();
  while (index !== undefined && !visited.has(index)) {
    visited.add(index);
    if (nodes[index] === parent) return true;
    index = nodes[index]?.parentIndex;
  }
  return false;
}
export function clippedBounds(snapshot: Observation, node: UiNode): [number, number, number, number] {
  const { x, y, width, height } = snapshot.viewport;
  let clip: [number, number, number, number] = [Math.max(x, node.bounds[0]), Math.max(y, node.bounds[1]), Math.min(x + width, node.bounds[2]), Math.min(y + height, node.bounds[3])];
  let parent = node.parentIndex;
  while (parent !== undefined) {
    const p = snapshot.nodes[parent];
    if (!p || !p.enabled || p.displayed === false) return [0, 0, 0, 0];
    clip = [Math.max(clip[0], p.bounds[0]), Math.max(clip[1], p.bounds[1]), Math.min(clip[2], p.bounds[2]), Math.min(clip[3], p.bounds[3])];
    parent = p.parentIndex;
  }
  return clip;
}
export function detectScrollRegion(snapshot: Observation, goal: ExplorationGoal, direction: ScrollDirection = goal.direction): RegionDetection {
  const vertical = direction === 'up' || direction === 'down';
  const regions: ScrollRegion[] = [];
  snapshot.nodes.forEach((node, index) => {
    if (node.packageName !== snapshot.foregroundPackage || node.scrollable !== true || !node.enabled || node.displayed === false) return;
    const bounds = clippedBounds(snapshot, node);
    const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
    if (w < 96 || h < 96 || (vertical ? h < w * .65 : w < h * 1.3)) return;
    regions.push({ node, index, bounds, signature: `${node.packageName}:${node.resourceId}:${node.className}` });
  });
  if (!regions.length) return { status: 'NOT_FOUND', reason: 'No observed scrollable region supports the requested direction.' };
  if (vertical && snapshot.foregroundPackage === 'com.google.android.youtube' && goal.kind === 'ordinal' && goal.itemType === 'video') {
    const resultLists = regions.filter(region => region.node.resourceId === 'com.google.android.youtube:id/results');
    if (resultLists.length === 1) return { status: 'FOUND', region: resultLists[0] };
    if (resultLists.length > 1) return { status: 'AMBIGUOUS', reason: 'Multiple YouTube search result lists are observed.' };
  }
  const match = goal.kind === 'target' ? matchUiTarget(snapshot, goal.target) : undefined;
  const relevant = match?.node ? [match.node] : goal.kind === 'ordinal' && goal.itemType === 'video'
    ? snapshot.nodes.filter(n => n.packageName === snapshot.foregroundPackage && /\s[-\u2013\u2014]\s(?:phat video|play video)$/i.test(n.description.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
    : goal.kind === 'ordinal' && goal.itemType === 'browser' ? findBrowserResultNodes(snapshot) : [];
  let candidates = relevant.length ? regions.filter(r => relevant.some(n => isDescendant(snapshot.nodes, n, r.node))) : regions;
  if (!candidates.length) return { status: 'NOT_FOUND', reason: 'Observed scroll regions do not contain the goal content.' };
  // Prefer the innermost list only if it encloses all goal evidence. Peer lists remain ambiguous.
  candidates = candidates.filter(outer => !candidates.some(inner => inner !== outer && isDescendant(snapshot.nodes, inner.node, outer.node) &&
    (!relevant.length || relevant.every(n => isDescendant(snapshot.nodes, n, inner.node)))));
  if (candidates.length !== 1) return { status: 'AMBIGUOUS', reason: 'Multiple scroll regions remain plausible for this goal.' };
  return { status: 'FOUND', region: candidates[0] };
}
export function regionFingerprint(snapshot: Observation, region: ScrollRegion): string {
  return JSON.stringify(snapshot.nodes.filter(n => n.displayed !== false && isDescendant(snapshot.nodes, n, region.node))
    .map(n => [n.resourceId, n.className, n.text, n.description, n.bounds.map((v, i) => v - region.bounds[i % 2]), n.selected]));
}
