import { randomUUID } from 'node:crypto';
import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';
import { navigationLayers } from '../browser-navigation';
import { isSensitiveControl } from '../security-policy';
import { matchUiTarget } from '../ui-understanding';
import type { AgentBudget } from './budget';
import type { AgentDecision, AgentGoal } from './schema';
import { goalPackageAllowed, hasUnsavedInput, visibleNode } from './navigation-semantics';
import { criterionSatisfied } from './evaluator';
import { generateActionCandidates } from './action-candidates';
import { genericNativeGoal } from './native-navigation';

export type SubtaskStatus = 'PENDING' | 'RUNNING' | 'SUSPENDED' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
type RecoveryKind = 'DISMISS_LAYER' | 'RESTORE_FOREGROUND' | 'WAIT_READY' | 'DISCOVER_TARGET';
export interface SubtaskSpec {
  subtaskId: string; parentGoalId: string; parentSubtaskId?: string;
  triggerReason: string; triggerSnapshotId: string; fingerprint: string;
  description: string; objective: RecoveryKind; completionCriteria: string;
  allowedActionScope: string[]; status: SubtaskStatus; attempts: number;
  recoveryBudget: { timeMs: number; attempts: number }; createdAt: number;
  parentSubgoal: number; target?: string; layers: string[]; hadDialog: boolean;
  elapsedMs: number; verificationSnapshotId?: string; outcome?: string;
}
export interface RecoveryProgress {
  parentStatus: 'RUNNING' | 'SUSPENDED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  active?: SubtaskSpec; history: SubtaskSpec[];
}
const dialog = (s: Observation) => s.nodes.some(n => /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle');
const loading = (s: Observation) => s.nodes.some(n => n.packageName === s.foregroundPackage && n.displayed !== false && /ProgressBar/.test(n.className));
export function recoverySensitive(s: Observation): boolean {
  return s.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName)) ||
    (dialog(s) || navigationLayers(s).length > 0) && s.nodes.some(n => isSensitiveControl(n.text + ' ' + n.description) ||
      /captcha|recaptcha|hcaptcha|verify you are human|xac minh ban la nguoi/.test((n.text + ' ' + n.description).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
}

// Execution-local bookkeeping only: the existing Agent Loop owns all I/O and budgets.
export class RecoveryManager {
  readonly history: SubtaskSpec[] = [];
  private stack: SubtaskSpec[] = [];
  private fingerprints = new Set<string>();
  private missing = new Map<string, number>();
  private parentStatus: RecoveryProgress['parentStatus'] = 'RUNNING';
  get active() { return this.stack.at(-1); }
  summary(): RecoveryProgress {
    const copy = (task: SubtaskSpec) => ({ ...task, layers: [...task.layers], allowedActionScope: [...task.allowedActionScope], recoveryBudget: { ...task.recoveryBudget } });
    const active = this.active && copy(this.active);
    if (active) active.elapsedMs = Date.now() - active.createdAt;
    return { parentStatus: this.parentStatus, active, history: this.history.map(copy) };
  }
  private finish(status: SubtaskStatus, outcome: string, snapshot?: Observation) {
    const task = this.stack.pop()!;
    task.status = status; task.outcome = outcome;
    task.elapsedMs = Date.now() - task.createdAt;
    if (snapshot) task.verificationSnapshotId = snapshot.snapshotId;
    if (this.active) this.active.status = 'RUNNING';
    this.parentStatus = this.active ? 'SUSPENDED' : 'RUNNING';
  }
  stop(status: 'BLOCKED' | 'FAILED' | 'CANCELLED', reason: string) {
    while (this.active) this.finish(status, reason);
    this.parentStatus = status;
  }
  private begin(kind: RecoveryKind, reason: string, target: string | undefined, goal: AgentGoal, s: Observation, budget: AgentBudget): boolean {
    const key = kind + ':' + geometryFingerprint(s);
    if (this.fingerprints.has(key) || this.stack.length >= budget.limits.recoveryDepth ||
      this.history.length >= budget.limits.recoverySubtasks) return false;
    budget.consume('recoverySubtasks');
    const scope = kind === 'DISMISS_LAYER' ? ['PRESS_KEY'] : kind === 'RESTORE_FOREGROUND' ? ['OPEN_APP'] : ['WAIT_FOR'];
    if (scope.some(action => !goal.allowedActionScope.includes(action))) return false;
    if (this.active) this.active.status = 'SUSPENDED';
    const task: SubtaskSpec = { subtaskId: randomUUID(), parentGoalId: goal.id, parentSubtaskId: this.active?.subtaskId,
      parentSubgoal: goal.currentSubgoal, triggerReason: reason, triggerSnapshotId: s.snapshotId, fingerprint: geometryFingerprint(s),
      description: reason, objective: kind, completionCriteria: kind === 'DISMISS_LAYER' ? 'Observed obstructing layer removed in the same app.' :
        kind === 'RESTORE_FOREGROUND' ? 'Authorized foreground app independently observed.' : 'Required target visible in a fresh ready snapshot.',
      allowedActionScope: scope, status: 'PENDING', attempts: 0, recoveryBudget: { timeMs: Math.min(budget.limits.recoveryTimeMs, budget.remaining()), attempts: budget.limits.recoveryAttempts },
      createdAt: Date.now(), target, layers: navigationLayers(s), hadDialog: dialog(s), elapsedMs: 0 };
    this.fingerprints.add(key); this.history.push(task); this.stack.push(task);
    task.status = 'RUNNING'; this.parentStatus = 'SUSPENDED'; return true;
  }
  next(goal: AgentGoal, s: Observation, budget: AgentBudget,
    publish: (reason: string) => void): AgentDecision | undefined {
    budget.check();
    const block = (reason: string): AgentDecision => {
      this.stop('BLOCKED', reason); publish(reason);
      return { type: 'REQUEST_HUMAN_ASSISTANCE', category: recoverySensitive(s) ? 'SENSITIVE_ACTION' : 'UNKNOWN_UI', reason };
    };
    if (s.observationStatus !== 'OBSERVED' || Date.now() - s.timestamp < 0 || Date.now() - s.timestamp > 5000) {
      if (this.active) return block('Recovery requires a fresh, observed snapshot.');
      return undefined;
    }
    if (recoverySensitive(s)) return block('Sensitive or human-verification UI cannot be recovered automatically.');
    if (budget.limits.recoverySubtasks === 0) return undefined;
    const targetCriterion = goal.subgoals[goal.currentSubgoal]?.criterion;
    const target = targetCriterion?.kind === 'SEARCH_RESULTS' ? goal.spec.resultType === 'browser' ? 'address_bar' : 'search_button' :
      targetCriterion?.kind === 'TARGET_VISIBLE' ? targetCriterion.target : undefined;
    const ready = (name?: string) => {
      const match = name && matchUiTarget(s, name, false);
      return Boolean(match && match.status === 'MATCH' && match.node && visibleNode(s, match.node));
    };
    const sameApp = goalPackageAllowed(goal, s.foregroundPackage);
    if (this.stack.some(task => Date.now() - task.createdAt >= task.recoveryBudget.timeMs || goal.currentSubgoal !== task.parentSubgoal)) {
      return block('Recovery deadline or suspended parent context is no longer valid.');
    }
    // Child completion is verified before its suspended parent is reconsidered.
    while (this.active) {
      const task = this.active;
      const complete = task.objective === 'RESTORE_FOREGROUND' ? s.foregroundPackage === goal.packageName :
        task.objective === 'DISMISS_LAYER' ? sameApp && geometryFingerprint(s) !== task.fingerprint &&
          (!task.hadDialog || !dialog(s)) && (!task.layers.length || !navigationLayers(s).includes(task.layers.at(-1)!)) :
          sameApp && !loading(s) && ready(task.target);
      if (!complete) break;
      this.finish('COMPLETED', 'Obstacle independently resolved in a fresh snapshot.', s);
      publish(this.active ? 'Child recovery verified; resume the suspended recovery task.' : 'Recovery verified; re-evaluate the parent goal from fresh UI.');
    }
    if (this.active && (Date.now() - this.active.createdAt >= this.active.recoveryBudget.timeMs ||
      goal.currentSubgoal !== this.active.parentSubgoal)) return block('Recovery deadline or suspended parent context is no longer valid.');
    if (!this.active && targetCriterion && criterionSatisfied(goal, targetCriterion, s) && !dialog(s) && !navigationLayers(s).length) return undefined;
    let kind: RecoveryKind | undefined, reason = '';
    if (sameApp && (dialog(s) || navigationLayers(s).length)) { kind = 'DISMISS_LAYER'; reason = 'Dismiss the observed non-sensitive obstruction, then verify removal.'; }
    else if (!sameApp && goal.currentSubgoal > 0) { kind = 'RESTORE_FOREGROUND'; reason = 'Restore the authorized app without replaying the interrupted interaction.'; }
    else if (sameApp && target && !genericNativeGoal(goal) && loading(s) && !ready(target)) { kind = 'WAIT_READY'; reason = 'Observe the loading condition until the required control is ready.'; }
    else if (sameApp && target && !genericNativeGoal(goal) && !ready(target) && targetCriterion?.kind === 'TARGET_VISIBLE') { kind = 'DISCOVER_TARGET'; reason = 'Discover the missing goal target using the existing bounded UI Explorer.'; }
    else if (!this.active && sameApp && target && !ready(target) && targetCriterion?.kind === 'SEARCH_RESULTS' &&
      !s.nodes.some(n => n.focused && /EditText|AutoCompleteTextView/.test(n.className))) {
      const key = goal.currentSubgoal + ':' + geometryFingerprint(s);
      const count = (this.missing.get(key) ?? 0) + 1; this.missing.set(key, count);
      if (count < 2) return { type: 'OBSERVE_AGAIN', reason: 'Search control temporarily missing; take another fresh observation without dispatch.' };
      kind = 'WAIT_READY'; reason = 'Required search control is persistently missing; bounded recovery observation.';
    }
    if (kind && this.active?.objective !== kind) {
      if (hasUnsavedInput(goal, s)) return block('Unsaved input prevents automatic recovery navigation.');
      if (!this.begin(kind, reason, target, goal, s, budget)) return block('Recovery depth, count or duplicate obstacle limit reached.');
      if (kind === 'RESTORE_FOREGROUND') budget.consume('replans');
      publish(reason);
    }
    const task = this.active;
    if (!task) return undefined;
    if (task.attempts >= task.recoveryBudget.attempts) return block('Recovery attempt limit reached without independent completion evidence.');
    // Never replay a mutation, even if an earlier child changed the layout.
    if (task.attempts && task.objective !== 'WAIT_READY') return block('Recovery action has no verified result; do not dispatch it again.');
    task.attempts++;
    if (task.objective === 'DISMISS_LAYER') return { type: 'EXECUTE_ACTION', action: { type: 'PRESS_KEY', key: 'BACK' }, reason: task.description,
      grounding: generateActionCandidates(goal, s).find(candidate => candidate.action.type === 'PRESS_KEY' && candidate.action.key === 'BACK') };
    if (task.objective === 'RESTORE_FOREGROUND') return { type: 'EXECUTE_ACTION', action: { type: 'OPEN_APP', app: goal.spec.app }, reason: task.description };
    if (task.objective === 'DISCOVER_TARGET') return { type: 'EXPLORE_UI', target: task.target!, reason: task.description };
    return { type: 'EXECUTE_ACTION', action: { type: 'WAIT_FOR', target: task.target!,
      timeoutMs: Math.max(1, Math.floor(Math.min(10000, budget.remaining(), task.recoveryBudget.timeMs - (Date.now() - task.createdAt)))) }, reason: task.description };
  }
}
