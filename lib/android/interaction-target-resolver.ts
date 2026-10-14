import type { Observation } from './state-observer';
import type { UiNode } from './targets';
import { isNodeInteractable } from './screen-state';
import { canonicalUiText, normalizeUiText } from './ui-understanding';
import { clippedBounds, isDescendant } from './exploration/scroll-regions';

export interface InteractionTarget {
  node: UiNode;
  owner: UiNode;
  method: 'ELEMENT_CLICK' | 'LABEL_GESTURE';
  evidence: string[];
}
export type InteractionResolution = { status: 'RESOLVED'; target: InteractionTarget } |
  { status: 'AMBIGUOUS' | 'NOT_INTERACTABLE'; reason: string };

export function resolveInteractionTarget(snapshot: Observation, target: UiNode,
  options: { owner?: UiNode; title?: string; video?: boolean } = {}): InteractionResolution {
  if (!snapshot.nodes.includes(target) || snapshot.observationStatus !== 'OBSERVED') return { status: 'AMBIGUOUS', reason: 'Target is not part of this observed snapshot.' };
  if (!target.enabled || target.displayed === false || target.packageName !== snapshot.foregroundPackage) return { status: 'NOT_INTERACTABLE', reason: 'Target is disabled, hidden or from another app.' };
  const clip = clippedBounds(snapshot, target);
  const area = (target.bounds[2] - target.bounds[0]) * (target.bounds[3] - target.bounds[1]);
  if (area <= 0 || !target.bounds.every(Number.isFinite) || Math.max(0, clip[2] - clip[0]) * Math.max(0, clip[3] - clip[1]) < area * .9) {
    return { status: 'NOT_INTERACTABLE', reason: 'Target is outside the visible ancestor-clipped viewport.' };
  }
  let owner = options.owner ?? target;
  const visited = new Set<UiNode>();
  while (!owner.clickable && owner.parentIndex !== undefined && !visited.has(owner)) {
    visited.add(owner);
    const parent = snapshot.nodes[owner.parentIndex];
    if (!parent) return { status: 'AMBIGUOUS', reason: 'Clickable ancestry is incomplete.' };
    owner = parent;
  }
  if (!owner.clickable || !owner.enabled || owner.displayed === false || owner.packageName !== snapshot.foregroundPackage || !isDescendant(snapshot.nodes, target, owner)) {
    return { status: 'AMBIGUOUS', reason: 'No enabled clickable owner belongs to the target.' };
  }
  if (options.video && /products?|san pham|preview/.test(normalizeUiText(owner.description)) && !options.title) {
    return { status: 'AMBIGUOUS', reason: 'Video card exposes auxiliary product/preview actions without a separate activation label.' };
  }
  const title = options.title;
  if (title && ![target.text, target.description].some(value => canonicalUiText(value) === canonicalUiText(title))) {
    return { status: 'AMBIGUOUS', reason: 'Activation label does not exactly identify the selected content.' };
  }
  const index = snapshot.nodes.indexOf(target);
  if (!isNodeInteractable({ ...target, clickable: true }, snapshot.nodes, snapshot.viewport, 'interaction target', index)) {
    return { status: 'AMBIGUOUS', reason: 'Observed clickable controls cover the target activation point.' };
  }
  if (target === owner && target.clickable) return { status: 'RESOLVED', target: {
    node: target, owner, method: 'ELEMENT_CLICK', evidence: ['current snapshot', 'enabled and visible', 'unique semantic target', 'uncovered native element center'],
  } };
  if (!target.text.trim() && !target.description.trim()) return { status: 'AMBIGUOUS', reason: 'An unlabeled descendant does not prove an activation action.' };
  const siblings = snapshot.nodes.filter(node => node !== target && isDescendant(snapshot.nodes, node, owner) &&
    [node.text, node.description].some(value => value && canonicalUiText(value) === canonicalUiText(target.text || target.description)));
  if (siblings.length) return { status: 'AMBIGUOUS', reason: 'Multiple activation labels occur within the same owner.' };
  return { status: 'RESOLVED', target: { node: target, owner, method: target.clickable ? 'ELEMENT_CLICK' : 'LABEL_GESTURE',
    evidence: ['observed label', 'clickable ancestor', 'parent-child containment', 'uncovered label center'] } };
}
