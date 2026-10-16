import type { AgentGoal } from './schema';
import type { ActionCandidate } from './action-candidates';
import type { Observation } from '../state-observer';
import { goalPackageAllowed, readNavigationLabel, readLocationVerified, visibleNode } from './navigation-semantics';
import { normalizeUiText, matchUiTarget } from '../ui-understanding';
import { uiFingerprint, verifyReversibleNavigation, verifyClickTransition } from '../action-verifier';
import { detectScrollRegion, regionFingerprint } from '../exploration/scroll-regions';
import { explorationGoal } from '../exploration/types';
import { genericNativeGoal, nativeContextSafe, nativePageVerified } from './native-navigation';

export function verifyCandidateOutcome(goal: AgentGoal, candidate: ActionCandidate, before: Observation, after: Observation): boolean {
  if (after.observationStatus !== 'OBSERVED' || !goalPackageAllowed(goal, after.foregroundPackage)) return false;
  if (genericNativeGoal(goal) && !nativeContextSafe(goal, after)) return false;
  const verification = candidate.verification;
  if (verification.kind === 'NAVIGATION_LAYER_REMOVED') return verifyReversibleNavigation(before, after);
  if (verification.kind === 'TARGET_VISIBLE') return candidate.action.type === 'WAIT_FOR' && matchUiTarget(after, candidate.action.target).status === 'MATCH';
  if (verification.kind === 'TARGET_TRANSITION') return candidate.action.type === 'CLICK' && verifyClickTransition(before, after, candidate.action.target) === true;
  if (verification.kind === 'FOCUSED_SEARCH') return (before.foregroundPackage === after.foregroundPackage ||
    before.foregroundPackage === 'com.android.settings' && after.foregroundPackage === 'com.android.settings.intelligence') &&
    after.nodes.filter(n => visibleNode(after, n) && n.focused && /EditText|AutoCompleteTextView/.test(n.className) && /search|query/.test(n.resourceId) && !/tab/.test(n.resourceId)).length === 1;
  if (uiFingerprint(before) === uiFingerprint(after)) return false;
  if (verification.kind === 'SCROLL_CHANGED') {
    if (before.foregroundPackage !== after.foregroundPackage) return false;
    const old = detectScrollRegion(before, explorationGoal('read-only information')), fresh = detectScrollRegion(after, explorationGoal('read-only information'));
    return old.status === 'FOUND' && fresh.status === 'FOUND' && old.region.signature === fresh.region.signature &&
      regionFingerprint(before, old.region) !== regionFingerprint(after, fresh.region);
  }
  if (verification.kind === 'READ_NAVIGATION') {
    if (genericNativeGoal(goal)) return nativePageVerified(goal, after, verification.label);
    if (readLocationVerified(goal, after)) return true;
    const label = normalizeUiText(verification.label).replace('pin va ', '');
    return after.nodes.some(n => visibleNode(after, n) && readNavigationLabel(goal, n) &&
      normalizeUiText(n.text || n.description).replace('pin va ', '') === label &&
      /toolbar|action_bar|title/.test(n.resourceId) && matchUiTarget(after, candidate.action.type === 'CLICK' ? candidate.action.target : '').status !== 'MATCH');
  }
  return false;
}
