import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Observation } from '../state-observer';
import { matchUiTarget, normalizeUiText } from '../ui-understanding';
import { verifyClickTransition } from '../action-verifier';
import { navigationLayers } from '../browser-navigation';
import { geometryFingerprint } from '../visual-grounding';
import { assessPlanPolicy, isSensitiveControl, assessObservedReadNavigation, assessObservedRouteControl } from '../security-policy';
import type { AgentGoal } from './schema';
import { goalPackageAllowed, isReadLocationGoal, observedTarget, searchControl, readNavigationLabel, safeNavigationOwner, visibleNode, hasUnsavedInput, capabilityRouteNodes, resolveRequiredCapability, understandCurrentScreen } from './navigation-semantics';
import { detectScrollRegion } from '../exploration/scroll-regions';
import { explorationGoal } from '../exploration/types';
import { genericNativeGoal, nativeContextSafe, nativeReadControl } from './native-navigation';

const CandidateAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PRESS_KEY'), key: z.literal('BACK') }).strict(),
  z.object({ type: z.literal('CLICK'), target: z.string().min(1) }).strict(),
  z.object({ type: z.literal('WAIT_FOR'), target: z.string().min(1), timeoutMs: z.number().int().positive().max(15000) }).strict(),
  z.object({ type: z.literal('SWIPE'), direction: z.literal('up') }).strict(),
]);
export const CandidateVerificationSchema = z.object({ kind: z.enum(['NAVIGATION_LAYER_REMOVED', 'TARGET_TRANSITION', 'TARGET_VISIBLE', 'FOCUSED_SEARCH', 'READ_NAVIGATION', 'SCROLL_CHANGED', 'CAPABILITY_ROUTE']), label: z.string().max(150) }).strict();
export const ActionCandidateSchema = z.object({
  candidateId: z.string().min(1), snapshotId: z.string().uuid(), subgoalId: z.string().min(1), fingerprint: z.string(),
  action: CandidateAction, semanticRole: z.enum(['reversible_navigation', 'goal_control', 'loading_condition', 'search_navigation', 'read_navigation', 'scroll_discovery', 'capability_navigation']),
  description: z.string().min(1).max(180), expectedOutcome: z.string().min(1).max(180),
  targetElementId: z.string().min(1), anchorResourceId: z.string(), layers: z.array(z.string()).max(4),
  evidence: z.object({ enabled: z.literal(true), visible: z.literal(true), policy: z.literal('ALLOW') }).strict(),
  preconditions: z.object({ packageName: z.string().min(1), uniqueTarget: z.literal(true), noUnsavedInput: z.literal(true), goalScope: z.literal(true) }).strict(),
  safety: z.literal('READ_NAVIGATION'), verification: CandidateVerificationSchema,
  routeContext: z.object({ deviceId: z.string().min(1), activity: z.string(), screenType: z.string().min(1), capability: z.string().min(1),
    viewport: z.tuple([z.number(), z.number(), z.number(), z.number()]), bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    className: z.string(), label: z.string() }).strict().optional(),
  goalRelation: z.enum(['DIRECT_INFORMATION', 'INFORMATION_CATEGORY', 'SEARCH_ROUTE', 'DISCOVERY_ROUTE', 'REVERSIBLE_ROUTE', 'GOAL_CONTROL']),
}).strict();
export type ActionCandidate = z.infer<typeof ActionCandidateSchema>;
export const CandidateGroundingSchema = ActionCandidateSchema;

export function generateActionCandidates(goal: AgentGoal, snapshot: Observation): ActionCandidate[] {
  const subgoal = goal.subgoals[goal.currentSubgoal];
  if (!subgoal || snapshot.observationStatus !== 'OBSERVED' || !goalPackageAllowed(goal, snapshot.foregroundPackage) || goal.spec.isSensitive ||
    snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) ||
      /Dialog/.test(n.className) && isSensitiveControl(n.text + ' ' + n.description)) || hasUnsavedInput(goal, snapshot)) return [];
  const fingerprint = geometryFingerprint(snapshot), candidates: ActionCandidate[] = [];
  const add = (index: number, action: ActionCandidate['action'], semanticRole: ActionCandidate['semanticRole'], description: string, expectedOutcome: string, layers: string[] = [],
    verification = { kind: (action.type === 'WAIT_FOR' ? 'TARGET_VISIBLE' : action.type === 'PRESS_KEY' ? 'NAVIGATION_LAYER_REMOVED' : 'TARGET_TRANSITION') as z.infer<typeof CandidateVerificationSchema>['kind'], label: '' }) => {
    const node = snapshot.nodes[index], element = snapshot.elements[index];
    if (!node || !element || !node.enabled || node.displayed === false || node.packageName !== snapshot.foregroundPackage ||
      !goal.allowedActionScope.includes(action.type) || isSensitiveControl(node.text + ' ' + node.description)) return;
    const [left, top, right, bottom] = node.bounds, view = snapshot.viewport;
    if (right <= left || bottom <= top || Math.min(right, view.x + view.width) <= Math.max(left, view.x) || Math.min(bottom, view.y + view.height) <= Math.max(top, view.y)) return;
    const policy = assessPlanPolicy({ intent: goal.id, isSensitive: goal.spec.isSensitive, actions: [{ type: 'OPEN_APP', app: goal.spec.app }, action] });
    const genericRead = action.type === 'CLICK' && semanticRole === 'read_navigation' && nativeReadControl(goal, snapshot, node);
    const routeRead = semanticRole === 'capability_navigation' && capabilityRouteNodes(goal, snapshot).some(route => route.index === index && route.kind === verification.label) &&
      (action.type === 'PRESS_KEY' && action.key === 'BACK' && verification.label === 'MEDIA_BACK' || action.type === 'CLICK' && assessObservedRouteControl(snapshot, node).decision === 'ALLOW');
    const observedRead = isReadLocationGoal(goal) && ['search_navigation', 'read_navigation'].includes(semanticRole) &&
      action.type === 'CLICK' && observedTarget(snapshot, node) === action.target && safeNavigationOwner(snapshot, node) &&
      (semanticRole === 'search_navigation' ? searchControl(snapshot) === node : readNavigationLabel(goal, node)) &&
      assessObservedReadNavigation(snapshot, node, goal.spec.targetText ?? '', semanticRole === 'search_navigation').decision === 'ALLOW';
    if (policy.decision !== 'ALLOW' && !observedRead && !genericRead && !routeRead && !(genericNativeGoal(goal) && nativeContextSafe(goal, snapshot) && action.type === 'SWIPE')) return;
    const candidateId = 'candidate_' + createHash('sha256').update(`${snapshot.snapshotId}:${subgoal.id}:${JSON.stringify(action)}:${index}`).digest('hex').slice(0, 12);
    candidates.push(ActionCandidateSchema.parse({ candidateId, snapshotId: snapshot.snapshotId, subgoalId: subgoal.id, fingerprint,
      action, semanticRole, description, expectedOutcome, targetElementId: element.elementId, anchorResourceId: node.resourceId, layers,
      evidence: { enabled: true, visible: true, policy: 'ALLOW' }, preconditions: { packageName: snapshot.foregroundPackage, uniqueTarget: true, noUnsavedInput: true, goalScope: true },
      safety: 'READ_NAVIGATION', verification,
      ...(semanticRole === 'capability_navigation' ? { routeContext: {
        deviceId: snapshot.deviceSerial, activity: snapshot.activity ?? '', screenType: understandCurrentScreen(snapshot, goal.id).screenType,
        capability: resolveRequiredCapability(goal, snapshot).name, viewport: [view.x, view.y, view.width, view.height], bounds: [...node.bounds],
        className: node.className, label: verification.label === 'MEDIA_BACK' ? '' : node.description || node.text,
      } } : {}),
      goalRelation: semanticRole === 'search_navigation' ? 'SEARCH_ROUTE' : semanticRole === 'scroll_discovery' ? 'DISCOVERY_ROUTE' : ['reversible_navigation', 'capability_navigation'].includes(semanticRole) ? 'REVERSIBLE_ROUTE' :
        semanticRole === 'read_navigation' ? /^(bo nho|luu tru|dung luong luu tru|memory|storage)$/.test(normalizeUiText(node.text || node.description)) ? 'DIRECT_INFORMATION' : 'INFORMATION_CATEGORY' : 'GOAL_CONTROL' }));
  };
  const layers = navigationLayers(snapshot);
  for (const route of capabilityRouteNodes(goal, snapshot)) {
    const target = observedTarget(snapshot, snapshot.nodes[route.index]);
    if (route.kind !== 'MEDIA_BACK' && !target) continue;
    add(route.index, route.kind === 'MEDIA_BACK' ? { type: 'PRESS_KEY', key: 'BACK' } : { type: 'CLICK', target: target! },
      'capability_navigation', `Observed ${route.kind} route toward ${resolveRequiredCapability(goal, snapshot).name}.`,
      'Verify the required capability or a recognized intermediate navigation destination in the same app.', [], { kind: 'CAPABILITY_ROUTE', label: route.kind });
  }
  if (candidates.length) return candidates.slice(0, 6);
  if (genericNativeGoal(goal)) {
    if (!nativeContextSafe(goal, snapshot)) return [];
    snapshot.nodes.forEach((node, index) => {
      if (nativeReadControl(goal, snapshot, node)) add(index, { type: 'CLICK', target: observedTarget(snapshot, node)! }, 'read_navigation',
        `Open observed native read navigation: ${node.text || node.description}`, 'Verify the exact destination heading in the same app.', [],
        { kind: 'READ_NAVIGATION', label: node.text || node.description });
    });
    const region = detectScrollRegion(snapshot, explorationGoal('native read navigation'), 'down');
    if (region.status === 'FOUND') add(region.region.index, { type: 'SWIPE', direction: 'up' }, 'scroll_discovery',
      'Reveal further content in the observed native list.', 'Verify changed content in the same app and device.', [], { kind: 'SCROLL_CHANGED', label: '' });
    return candidates.slice(0, 6);
  }
  const dialog = snapshot.nodes.findIndex(n => n.packageName === goal.packageName && (/Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle'));
  if (layers.length || dialog >= 0) {
    const anchor = layers.length ? snapshot.nodes.findIndex(n => n.resourceId === 'com.android.chrome:id/hub_main_container') : dialog;
    const top = layers.at(-1);
    add(anchor, { type: 'PRESS_KEY', key: 'BACK' }, 'reversible_navigation',
      top === 'INFORMATION_SHEET' ? 'Dismiss the observed informational sheet without accepting or changing settings.' :
        layers.length ? 'Return from the native tab manager to the existing web page; do not select, create or close tabs.' : 'Dismiss the observed non-sensitive dialog through reversible navigation.',
      'The obstructing native layer disappears in the same app; verify this before continuing the goal.', layers);
    return candidates;
  }
  if (subgoal.criterion.kind === 'READ_LOCATION') {
    const search = searchControl(snapshot);
    if (search && safeNavigationOwner(snapshot, search)) add(snapshot.nodes.indexOf(search), { type: 'CLICK', target: observedTarget(snapshot, search)! }, 'search_navigation',
      'Open the observed search control to locate the requested read-only information.', 'A unique enabled search input gains focus in the authorized app.', [], { kind: 'FOCUSED_SEARCH', label: search.description || search.text });
    snapshot.nodes.forEach((node, index) => {
      if (visibleNode(snapshot, node) && readNavigationLabel(goal, node) && safeNavigationOwner(snapshot, node)) add(index,
        { type: 'CLICK', target: observedTarget(snapshot, node)! }, 'read_navigation', `Open observed read-only navigation: ${node.text || node.description}`,
        'Verify the matching information page or a related read-navigation destination; never change a setting.', [], { kind: 'READ_NAVIGATION', label: node.text || node.description });
    });
    const region = detectScrollRegion(snapshot, explorationGoal('read-only information'), 'down');
    if (region.status === 'FOUND') add(region.region.index,
      { type: 'SWIPE', direction: 'up' }, 'scroll_discovery', 'Reveal further entries in the unique observed vertical content list.',
      'Visible list content changes within the same authorized app; observe again for the requested information.', [], { kind: 'SCROLL_CHANGED', label: '' });
    const distinguishable = candidates.filter(candidate => candidate.semanticRole !== 'read_navigation' ||
      candidates.filter(other => other.semanticRole === 'read_navigation' && normalizeUiText(other.verification.label) === normalizeUiText(candidate.verification.label)).length === 1);
    return distinguishable.slice(0, 6);
  }
  const criterion = subgoal.criterion;
  const target = criterion.kind === 'SEARCH_RESULTS' ? goal.spec.resultType === 'browser' ? 'address_bar' : 'search_button' :
    criterion.kind === 'TARGET_VISIBLE' || criterion.kind === 'DESTINATION' ? criterion.target : undefined;
  if (target) {
    const match = matchUiTarget(snapshot, target, true);
    if (match.status === 'MATCH' && match.node && verifyClickTransition(snapshot, snapshot, target) !== undefined) add(snapshot.nodes.indexOf(match.node), { type: 'CLICK', target }, 'goal_control',
      'Activate the unique observed control required by the current subgoal.', 'Executor must revalidate this element and verify the expected UI transition.');
    const loading = snapshot.nodes.findIndex(n => n.packageName === goal.packageName && /ProgressBar/.test(n.className));
    if (!candidates.length && loading >= 0) add(loading, { type: 'WAIT_FOR', target, timeoutMs: 10000 }, 'loading_condition',
      'Wait for the required control while an observed loading indicator is present.', 'The required target becomes visible and enabled.');
  }
  return candidates.slice(0, 6);
}

export function candidateChoiceSchema(candidates: ActionCandidate[], snapshotId: string, subgoalId: string) {
  const choices: [string, ...string[]] = [candidates[0]?.candidateId ?? 'OBSERVE_AGAIN', ...candidates.slice(1).map(c => c.candidateId), 'OBSERVE_AGAIN', 'ABSTAIN'];
  return z.object({ choice: z.enum(choices), snapshotId: z.literal(snapshotId), subgoalId: z.literal(subgoalId), reason: z.string().trim().min(1).max(120) }).strict();
}

export function resolveCandidateChoice(candidates: ActionCandidate[], choice: unknown, goal: AgentGoal, snapshot: Observation): ActionCandidate | undefined {
  const parsed = candidateChoiceSchema(candidates, snapshot.snapshotId, goal.subgoals[goal.currentSubgoal]?.id ?? '').parse(choice);
  if (parsed.choice === 'ABSTAIN' || parsed.choice === 'OBSERVE_AGAIN') return;
  const candidate = candidates.find(row => row.candidateId === parsed.choice);
  if (!candidate || candidate.snapshotId !== snapshot.snapshotId || candidate.subgoalId !== goal.subgoals[goal.currentSubgoal]?.id ||
    candidate.fingerprint !== geometryFingerprint(snapshot)) throw new Error('Candidate does not belong to the current goal observation.');
  return candidate;
}

export function revalidateCandidate(candidate: ActionCandidate, goal: AgentGoal, fresh: Observation): boolean {
  const contextualRoute = candidate.semanticRole === 'capability_navigation' && Boolean(candidate.routeContext);
  if (candidate.subgoalId !== goal.subgoals[goal.currentSubgoal]?.id || Date.now() - fresh.timestamp < 0 || Date.now() - fresh.timestamp > 5000 ||
    !contextualRoute && candidate.fingerprint !== geometryFingerprint(fresh)) return false;
  return generateActionCandidates(goal, fresh).some(row => row.semanticRole === candidate.semanticRole && row.anchorResourceId === candidate.anchorResourceId &&
    JSON.stringify(row.action) === JSON.stringify(candidate.action) && JSON.stringify(row.layers) === JSON.stringify(candidate.layers) &&
    JSON.stringify(row.routeContext) === JSON.stringify(candidate.routeContext) &&
    row.goalRelation === candidate.goalRelation && JSON.stringify(row.verification) === JSON.stringify(candidate.verification) && JSON.stringify(row.preconditions) === JSON.stringify(candidate.preconditions));
}
