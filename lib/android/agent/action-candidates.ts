import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Observation } from '../state-observer';
import { matchUiTarget } from '../ui-understanding';
import { navigationLayers } from '../browser-navigation';
import { geometryFingerprint } from '../visual-grounding';
import { assessPlanPolicy, isSensitiveControl } from '../security-policy';
import type { AgentGoal } from './schema';

const CandidateAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PRESS_KEY'), key: z.literal('BACK') }).strict(),
  z.object({ type: z.literal('CLICK'), target: z.string().min(1) }).strict(),
  z.object({ type: z.literal('WAIT_FOR'), target: z.string().min(1), timeoutMs: z.number().int().positive().max(15000) }).strict(),
]);
export const ActionCandidateSchema = z.object({
  candidateId: z.string().min(1), snapshotId: z.string().uuid(), subgoalId: z.string().min(1), fingerprint: z.string(),
  action: CandidateAction, semanticRole: z.enum(['reversible_navigation', 'goal_control', 'loading_condition']),
  description: z.string().min(1).max(180), expectedOutcome: z.string().min(1).max(180),
  targetElementId: z.string().min(1), anchorResourceId: z.string(), layers: z.array(z.string()).max(4),
  evidence: z.object({ enabled: z.literal(true), visible: z.literal(true), policy: z.literal('ALLOW') }).strict(),
}).strict();
export type ActionCandidate = z.infer<typeof ActionCandidateSchema>;
export const CandidateGroundingSchema = ActionCandidateSchema;

export function generateActionCandidates(goal: AgentGoal, snapshot: Observation): ActionCandidate[] {
  const subgoal = goal.subgoals[goal.currentSubgoal];
  if (!subgoal || snapshot.observationStatus !== 'OBSERVED' || snapshot.foregroundPackage !== goal.packageName || goal.spec.isSensitive ||
    snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) ||
      /Dialog/.test(n.className) && isSensitiveControl(n.text + ' ' + n.description) ||
      n.focused && /EditText|AutoCompleteTextView/.test(n.className) && n.text.trim())) return [];
  const fingerprint = geometryFingerprint(snapshot), candidates: ActionCandidate[] = [];
  const add = (index: number, action: ActionCandidate['action'], semanticRole: ActionCandidate['semanticRole'], description: string, expectedOutcome: string, layers: string[] = []) => {
    const node = snapshot.nodes[index], element = snapshot.elements[index];
    if (!node || !element || !node.enabled || node.displayed === false || node.packageName !== goal.packageName ||
      !goal.allowedActionScope.includes(action.type) || isSensitiveControl(node.text + ' ' + node.description)) return;
    const [left, top, right, bottom] = node.bounds, view = snapshot.viewport;
    if (right <= left || bottom <= top || Math.min(right, view.x + view.width) <= Math.max(left, view.x) || Math.min(bottom, view.y + view.height) <= Math.max(top, view.y)) return;
    const policy = assessPlanPolicy({ intent: goal.id, isSensitive: goal.spec.isSensitive, actions: [{ type: 'OPEN_APP', app: goal.spec.app }, action] });
    if (policy.decision !== 'ALLOW') return;
    const candidateId = 'candidate_' + createHash('sha256').update(`${snapshot.snapshotId}:${subgoal.id}:${JSON.stringify(action)}:${index}`).digest('hex').slice(0, 12);
    candidates.push(ActionCandidateSchema.parse({ candidateId, snapshotId: snapshot.snapshotId, subgoalId: subgoal.id, fingerprint,
      action, semanticRole, description, expectedOutcome, targetElementId: element.elementId, anchorResourceId: node.resourceId, layers,
      evidence: { enabled: true, visible: true, policy: 'ALLOW' } }));
  };
  const layers = navigationLayers(snapshot);
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
  const criterion = subgoal.criterion;
  const target = criterion.kind === 'SEARCH_RESULTS' ? goal.spec.resultType === 'browser' ? 'address_bar' : 'search_button' :
    criterion.kind === 'TARGET_VISIBLE' || criterion.kind === 'DESTINATION' ? criterion.target : undefined;
  if (target) {
    const match = matchUiTarget(snapshot, target, true);
    if (match.status === 'MATCH' && match.node) add(snapshot.nodes.indexOf(match.node), { type: 'CLICK', target }, 'goal_control',
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
  if (candidate.subgoalId !== goal.subgoals[goal.currentSubgoal]?.id || Date.now() - fresh.timestamp < 0 || Date.now() - fresh.timestamp > 5000 ||
    candidate.fingerprint !== geometryFingerprint(fresh)) return false;
  return generateActionCandidates(goal, fresh).some(row => row.semanticRole === candidate.semanticRole && row.anchorResourceId === candidate.anchorResourceId &&
    JSON.stringify(row.action) === JSON.stringify(candidate.action) && JSON.stringify(row.layers) === JSON.stringify(candidate.layers));
}
