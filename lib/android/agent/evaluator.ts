import type { AgentGoal, Criterion } from './schema';
import type { Observation } from '../state-observer';
import type { DiscoveredSelection } from '../exploration/types';
import { canonicalUiText, matchUiTarget } from '../ui-understanding';
import { clippedBounds } from '../exploration/scroll-regions';
import { verifyBrowserSearch, verifyDiscoveredSelection } from '../action-verifier';

export function criterionSatisfied(goal: AgentGoal, c: Criterion, s: Observation, selection?: DiscoveredSelection): boolean {
  if (s.observationStatus !== 'OBSERVED' || s.foregroundPackage !== goal.packageName) return false;
  if (c.kind === 'FOREGROUND') return s.foregroundPackage === c.packageName;
  if (c.kind === 'SEARCH_RESULTS') return goal.spec.resultType === 'browser' ? verifyBrowserSearch(s, c.query) :
    s.screen === 'SEARCH_RESULTS' && s.nodes.some(n => n.resourceId.endsWith(':id/search_query') && canonicalUiText(n.text) === canonicalUiText(c.query));
  if (c.kind === 'TARGET_VISIBLE') {
    if (s.nodes.some(n => n.displayed !== false && (/Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle'))) return false;
    const m = matchUiTarget(s, c.target, false);
    if (m.status !== 'MATCH' || !m.node) return false;
    const b = m.node.bounds, clip = clippedBounds(s, m.node), area = (b[2] - b[0]) * (b[3] - b[1]);
    return area > 0 && Math.max(0, clip[2] - clip[0]) * Math.max(0, clip[3] - clip[1]) >= .9 * area;
  }
  return Boolean(selection && selection.ordinal === c.ordinal && selection.itemType === c.resultType &&
    goal.subgoals.some(sub => sub.criterion.kind === 'SEARCH_RESULTS' && sub.status === 'VERIFIED') &&
    verifyDiscoveredSelection(selection, s, s));
}
