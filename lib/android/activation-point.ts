import type { Observation } from './state-observer';
import type { UiNode } from './targets';
import { isDescendant, clippedBounds } from './exploration/scroll-regions';

// Partition the observed visible rectangle at every occluder edge. No point is
// eligible if any other clickable control (including a nested action) covers it.
export function exclusiveActivationPoint(snapshot: Observation, node: UiNode): { x: number; y: number } | undefined {
  if (snapshot.observationStatus !== 'OBSERVED' || !snapshot.nodes.includes(node) || !node.clickable || !node.enabled || node.displayed === false) return;
  const [left, top, right, bottom] = clippedBounds(snapshot, node);
  if (![left, top, right, bottom].every(Number.isFinite) || right - left < 24 || bottom - top < 24) return;
  const covers = snapshot.nodes.filter(n => n !== node && n.clickable && n.displayed !== false && !isDescendant(snapshot.nodes, node, n) &&
    n.bounds[0] < right && n.bounds[2] > left && n.bounds[1] < bottom && n.bounds[3] > top);
  const xs = [...new Set([left, right, ...covers.flatMap(n => [Math.max(left, n.bounds[0]), Math.min(right, n.bounds[2])])])].sort((a, b) => a - b);
  const ys = [...new Set([top, bottom, ...covers.flatMap(n => [Math.max(top, n.bounds[1]), Math.min(bottom, n.bounds[3])])])].sort((a, b) => a - b);
  const cells: { x: number; y: number; area: number }[] = [];
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
    if (xs[i] - xs[i - 1] < 24 || ys[j] - ys[j - 1] < 24) continue;
    const x = Math.round((xs[i] + xs[i - 1]) / 2), y = Math.round((ys[j] + ys[j - 1]) / 2);
    if (!covers.some(n => x >= n.bounds[0] && x <= n.bounds[2] && y >= n.bounds[1] && y <= n.bounds[3])) cells.push({ x, y, area: (xs[i] - xs[i - 1]) * (ys[j] - ys[j - 1]) });
  }
  cells.sort((a, b) => b.area - a.area);
  return cells[0] && { x: cells[0].x, y: cells[0].y };
}
