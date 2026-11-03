import type { AgentGoal, Criterion } from './schema';
import type { Observation } from '../state-observer';
import type { DiscoveredSelection } from '../exploration/types';
import { canonicalUiText, matchUiTarget } from '../ui-understanding';
import { clippedBounds } from '../exploration/scroll-regions';
import { verifyBrowserSearch, verifyDiscoveredSelection } from '../action-verifier';
import { goalPackageAllowed, readLocationVerified } from './navigation-semantics';
import { nativePageVerified, genericNativeGoal, nativeContextSafe, applicationUiBlocked } from './native-navigation';
import { discoveredApplication } from './application-discovery';
import { requestRequiresPlayback } from './outcome-spec';

export function goalRequiresPlayback(goal: AgentGoal): boolean {
  return goal.spec.operation === 'OPEN_RESULT' && goal.spec.resultType === 'video' && requestRequiresPlayback(goal.originalRequest, [goal.spec.query ?? '']);
}

export function criterionSatisfied(goal: AgentGoal, c: Criterion, s: Observation, selection?: DiscoveredSelection): boolean {
  if (s.observationStatus !== 'OBSERVED' || !goalPackageAllowed(goal, s.foregroundPackage)) return false;
  const app = discoveredApplication(goal);
  if (app && s.deviceSerial !== app.serial) return false;
  if (applicationUiBlocked(goal, s)) return false;
  if (c.kind === 'FOREGROUND') return s.foregroundPackage === c.packageName;
  if (c.kind === 'READ_LOCATION') return readLocationVerified(goal, s);
  if (c.kind === 'NATIVE_PAGE') return nativePageVerified(goal, s);
  if (c.kind === 'SEARCH_RESULTS') return goal.spec.resultType === 'browser' ? verifyBrowserSearch(s, c.query) :
    s.screen === 'SEARCH_RESULTS' && s.nodes.some(n => n.resourceId.endsWith(':id/search_query') && canonicalUiText(n.text) === canonicalUiText(c.query));
  if (c.kind === 'TARGET_VISIBLE') {
    if (genericNativeGoal(goal) && !nativeContextSafe(goal, s)) return false;
    if (s.nodes.some(n => n.displayed !== false && (/Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle'))) return false;
    const m = matchUiTarget(s, c.target, false);
    if (m.status !== 'MATCH' || !m.node) return false;
    if (genericNativeGoal(goal) && m.node.packageName !== goal.packageName) return false;
    const b = m.node.bounds, clip = clippedBounds(s, m.node), area = (b[2] - b[0]) * (b[3] - b[1]);
    return area > 0 && Math.max(0, clip[2] - clip[0]) * Math.max(0, clip[3] - clip[1]) >= .9 * area;
  }
  if (goalRequiresPlayback(goal) && (!s.playback || s.playback.source !== 'ADB_MEDIA_SESSION' || s.playback.packageName !== goal.packageName ||
    s.playback.title.normalize('NFC').trim() !== selection?.title.normalize('NFC').trim() || s.playback.positionMs <= s.playback.previousPositionMs)) return false;
  return Boolean(selection && selection.ordinal === c.ordinal && selection.itemType === c.resultType &&
    goal.subgoals.some(sub => sub.criterion.kind === 'SEARCH_RESULTS' && sub.status === 'VERIFIED') &&
    verifyDiscoveredSelection(selection, s, s));
}
