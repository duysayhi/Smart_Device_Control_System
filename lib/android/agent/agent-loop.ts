import type { Action, ActionPlan } from '../../validators/action-plan.schema';
import { createExecutionContext, type ActionOutcome } from '../condition-executor';
import type { AdbRunner } from '../executor';
import type { Observation, ObserverProgress } from '../state-observer';
import { asAndroidError, checkCancellation, AndroidExecutionError } from '../errors';
import { assertPlanPolicy, assessPlanPolicy, isSensitiveControl, assessObservedReadNavigation, assessObservedRouteControl } from '../security-policy';
import { AgentBudget, AgentLimitError } from './budget';
import { AgentMemory } from './memory';
import { AgentDecisionEngine, currentTarget, searchTarget } from './decision-engine';
import { criterionSatisfied } from './evaluator';
import { DecisionSchema, type AgentDecision, type AgentGoal, type AgentProgress } from './schema';
import { navigationLayers } from '../browser-navigation';
import { geometryFingerprint } from '../visual-grounding';
import { matchUiTarget } from '../ui-understanding';
import { revalidateCandidate, generateActionCandidates, type ActionCandidate } from './action-candidates';
import { verifyReversibleNavigation } from '../action-verifier';
import { goalPackageAllowed, isReadLocationGoal, locationSearchQuery, storageFreeEvidence, understandCurrentScreen, resolveRequiredCapability } from './navigation-semantics';
import { verifyCandidateOutcome } from './candidate-verifier';
import type { HumanTapChoice, VisualSummary } from '../visual-grounding';
import { RecoveryManager, recoverySensitive } from './recovery';
import { discoveredApplication } from './application-discovery';
import { genericNativeGoal, nativeContextSafe, nativeReadControl, applicationUiBlocked } from './native-navigation';
import { resolveAppPackage } from '../capabilities';

export interface AgentExecution {
  deviceId?: string;
  backend: string;
  observe(signal?: AbortSignal): Promise<Observation>;
  execute(action: Action, signal?: AbortSignal, progress?: (value: ObserverProgress) => void, candidate?: ActionCandidate): Promise<ActionOutcome>;
  discoveryMemory(): unknown;
  verificationSnapshot?(): Observation | undefined;
  confirmVisualTap?(choice: HumanTapChoice, plan: ActionPlan, signal?: AbortSignal): Promise<ActionOutcome>;
  close(): Promise<void>;
}
export interface DecisionProvider {
  decide(goal: AgentGoal, snapshot: Observation, memory: AgentMemory, discovery: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<AgentDecision>;
}
class AgentPolicyError extends Error {
  constructor(message: string, readonly category: 'SENSITIVE_ACTION' | 'UNKNOWN_UI' = 'UNKNOWN_UI') { super(message); }
}
export function policyForAgentAction(goal: AgentGoal, action: Action, snapshot: Observation, candidate?: ActionCandidate): ActionPlan {
  const blockedUi = applicationUiBlocked(goal, snapshot);
  if (blockedUi) throw new AgentPolicyError(blockedUi);
  if (recoverySensitive(snapshot) || snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) ||
    /Dialog/.test(n.className) && isSensitiveControl(n.text + ' ' + n.description))) throw new AgentPolicyError('A sensitive overlay changed the authorized navigation scope.', 'SENSITIVE_ACTION');
  if (action.type === 'CLICK' && isSensitiveControl(action.target)) throw new AgentPolicyError('Sensitive action is not authorized.', 'SENSITIVE_ACTION');
  if (!goal.allowedActionScope.includes(action.type)) throw new AgentPolicyError('Action is outside the declared goal scope.');
  if (action.type === 'OPEN_APP') {
    if (action.app !== goal.spec.app) throw new Error('Opening another app is not authorized.');
  } else if (!goalPackageAllowed(goal, snapshot.foregroundPackage)) throw new Error('Foreground changed; this action is not authorized.');
  if (candidate && (!revalidateCandidate(candidate, goal, snapshot) || JSON.stringify(candidate.action) !== JSON.stringify(action))) throw new AgentPolicyError('Grounding no longer authorizes this action.');
  const groundedRead = candidate && action.type === 'CLICK' && ['search_navigation', 'read_navigation'].includes(candidate.semanticRole);
  const groundedRoute = candidate?.semanticRole === 'capability_navigation' && candidate.verification.kind === 'CAPABILITY_ROUTE';
  if (groundedRoute && action.type === 'CLICK') {
    const node = matchUiTarget(snapshot, action.target, true).node;
    if (!node || assessObservedRouteControl(snapshot, node).decision !== 'ALLOW') throw new AgentPolicyError('Independent observed route policy denies this control.');
  }
  if (groundedRead && action.type === 'CLICK') {
    const node = matchUiTarget(snapshot, action.target, false).node;
    if (!node || !(nativeReadControl(goal, snapshot, node) || assessObservedReadNavigation(snapshot, node, goal.spec.targetText ?? '', candidate.semanticRole === 'search_navigation').decision === 'ALLOW')) throw new AgentPolicyError('Observed navigation policy denies this control.');
  }
  if (action.type === 'CLICK' && !groundedRead && !groundedRoute && ![searchTarget(goal), currentTarget(goal)].includes(action.target)) throw new Error('Target is not part of the current verified goal scope.');
  if (action.type === 'WAIT_FOR' && ![searchTarget(goal), currentTarget(goal)].includes(action.target)) throw new Error('Wait target is outside the current goal scope.');
  if (action.type === 'SWIPE' && (!candidate || candidate.semanticRole !== 'scroll_discovery')) throw new AgentPolicyError('No grounded scroll region authorizes the gesture.');
  const requestedQuery = goal.spec.query ?? locationSearchQuery(goal);
  if (action.type === 'INPUT_TEXT' && action.text !== requestedQuery) throw new Error('Input text differs from the user goal.');
  if (action.type === 'PRESS_KEY' && !['BACK', 'ENTER'].includes(action.key)) throw new Error('This key is outside navigation/search scope.');
  if (action.type === 'PRESS_KEY' && action.key === 'BACK' && !groundedRoute && !navigationLayers(snapshot).length &&
    !snapshot.nodes.some(n => /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle')) throw new AgentPolicyError('No observed reversible navigation layer authorizes BACK.');
  if (action.type === 'PRESS_KEY' && action.key === 'BACK' && snapshot.nodes.some(n => n.focused && /EditText|AutoCompleteTextView/.test(n.className) && n.text.trim())) throw new AgentPolicyError('Unsaved focused input prevents automatic BACK navigation.');
  const context: Action[] = [{ type: 'OPEN_APP', app: goal.spec.app }];
  if (action.type === 'INPUT_TEXT' || action.type === 'PRESS_KEY' && action.key === 'ENTER') {
    const input = snapshot.nodes.filter(n => n.packageName === snapshot.foregroundPackage && n.focused && n.enabled && n.displayed !== false &&
      /EditText|AutoCompleteTextView/.test(n.className) && /:id\/(search_edit_text|url_bar|search_query|omnibox|search_src_text)$/.test(n.resourceId));
    if (input.length !== 1 || !requestedQuery) throw new Error('No unique observed search input authorizes this action.');
    if (action.type === 'PRESS_KEY' && action.key === 'ENTER' && input[0].text !== requestedQuery) throw new AgentPolicyError('Search submission query no longer matches the goal.');
    context.push({ type: 'CLICK', target: searchTarget(goal) });
  }
  // These prefixes represent observed authorization context, not actions to send.
  const plan = { intent: goal.id, isSensitive: goal.spec.isSensitive, actions: [...context, action] };
  const risk = assessPlanPolicy(plan);
  const app = discoveredApplication(goal);
  if (app && !goal.spec.isSensitive && action.type === 'OPEN_APP' && snapshot.deviceSerial === app.serial &&
    goal.packageName === app.packageName && resolveAppPackage(action.app) === app.packageName) return plan;
  if (genericNativeGoal(goal) && nativeContextSafe(goal, snapshot) && candidate && action.type === 'SWIPE' && candidate.semanticRole === 'scroll_discovery') return plan;
  if (groundedRead) return plan;
  if (groundedRoute) return plan;
  if (isReadLocationGoal(goal) && action.type === 'INPUT_TEXT' && ['com.android.settings', 'com.android.settings.intelligence'].includes(snapshot.foregroundPackage) &&
    requestedQuery && goal.originalRequest.normalize('NFC').toLowerCase().includes(requestedQuery.normalize('NFC').toLowerCase()) && !isSensitiveControl(requestedQuery)) return plan;
  if (risk.decision !== 'ALLOW') throw new AgentPolicyError(risk.reasons.join(' '), goal.spec.isSensitive || risk.risks.some(r => r === 'SENSITIVE' || r === 'DATA_CHANGE') ? 'SENSITIVE_ACTION' : 'UNKNOWN_UI');
  assertPlanPolicy(plan);
  return plan;
}

export async function runAgent(goal: AgentGoal, budget: AgentBudget, execution: AgentExecution,
  decision: DecisionProvider = new AgentDecisionEngine(), signal?: AbortSignal, onProgress?: (event: AgentProgress) => void,
  assistance?: (visual: VisualSummary, publish: (token: string, expiresAt: number) => void) => Promise<HumanTapChoice>) {
  const memory = new AgentMemory();
  const recovery = new RecoveryManager();
  let recoveryStarted: number | undefined;
  let last: Observation | undefined, terminal: AgentProgress | undefined;
  let expectedDevice = budget.runtimeIdentity?.deviceId ?? execution.deviceId;
  let recognitionMs = 0;
  let currentScreen: AgentProgress['currentScreen'];
  let navigationCandidates: ActionCandidate[] = [];
  const acceptSnapshot = (snapshot: Observation) => {
    expectedDevice ??= snapshot.deviceSerial;
    if (snapshot.deviceSerial !== expectedDevice) throw new AndroidExecutionError('SESSION_ERROR', 'Observation belongs to another device; no action is authorized.');
    const started = performance.now();
    currentScreen = understandCurrentScreen(snapshot, budget.runtimeIdentity?.executionId ?? goal.id);
    recognitionMs += performance.now() - started;
    memory.recordScreen(currentScreen);
    navigationCandidates = generateActionCandidates(goal, snapshot).filter(c => c.semanticRole === 'capability_navigation');
    return snapshot;
  };
  const emit = (status: AgentProgress['status'], reason: string, extra: Partial<AgentProgress> = {}) => {
    const failure = memory.failures.at(-1);
    const event: AgentProgress = { type: 'progress', status, goalId: goal.id, description: goal.description,
      subgoal: goal.subgoals[goal.currentSubgoal]?.description, verifiedSubgoals: goal.subgoals.filter(s => s.status === 'VERIFIED').length,
      subgoalId: goal.subgoals[goal.currentSubgoal]?.id,
      totalSubgoals: goal.subgoals.length, reason: reason.slice(0, 180), screen: last?.screen, foregroundPackage: last?.foregroundPackage,
      resultEvidence: last ? storageFreeEvidence(goal, last) : undefined,
      recovery: recovery.summary(),
      currentScreen,
      navigation: last ? { required: resolveRequiredCapability(goal, last), phase: status === 'BLOCKED' ? 'BLOCKED' :
        recovery.active?.objective === 'NAVIGATE_CAPABILITY' ? 'NAVIGATING' : resolveRequiredCapability(goal, last).ready ? 'READY' : 'MAIN_GOAL',
        candidates: navigationCandidates.map(c => ({ id: c.candidateId, action: c.description, outcome: c.expectedOutcome })),
        lastAction: memory.navigation.at(-1)?.action.type, verification: memory.navigation.at(-1)?.verification,
        actionCount: memory.navigation.length, recognitionMs: Math.round(recognitionMs * 100) / 100,
        navigationMs: memory.navigation.reduce((sum, row) => sum + row.elapsedMs, 0) } : undefined,
      failure: failure?.message ? { code: failure.code, message: failure.message } : undefined, ...budget.summary(), ...extra };
    if (status === 'COMPLETED' && memory.selection && last) event.destinationEvidence = {
      title: memory.selection.title, ordinal: memory.selection.ordinal, url: memory.selection.url, snapshotId: last.snapshotId };
    onProgress?.(event); return event;
  };
  const block = (reason: string, category: NonNullable<AgentProgress['assistance']>['category'] = 'UNKNOWN_UI', visual?: AgentProgress['visual']) => {
    emit('NEED_HUMAN_ASSISTANCE', reason, { assistance: { category, resumable: false, sessionRetained: false, expiresAt: Date.now() + 120000, evidenceId: visual?.id }, visual });
    terminal = emit('BLOCKED', reason, { assistance: { category, resumable: false, sessionRetained: false, expiresAt: Date.now() + 120000, evidenceId: visual?.id }, visual });
  };
  try {
    if (execution.backend !== 'appium') throw new Error('Agent requires the Appium observation backend.');
    while (!terminal) {
      checkCancellation(signal); budget.consume('iterations');
      emit('OBSERVING', 'Read a fresh device snapshot.');
      last = acceptSnapshot(await execution.observe(signal));
      const current = goal.subgoals[goal.currentSubgoal];
      const seen = memory.observe(last, goal.currentSubgoal);
      const prior = memory.actions.at(-1);
      if (prior?.verification === 'SENT' && prior.action.type === 'PRESS_KEY' && prior.action.key === 'BACK') {
        const old = memory.observations.at(-2);
        if (old?.hadDialog && old.fingerprint !== seen.fingerprint && last.foregroundPackage === goal.packageName &&
          !last.nodes.some(n => /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle')) prior.verification = 'VERIFIED';
        const layers = navigationLayers(last);
        if (old?.navigationLayers.length && old.fingerprint !== seen.fingerprint && last.foregroundPackage === goal.packageName &&
          old.navigationLayers.some(layer => !layers.includes(layer)) &&
          (layers.length || matchUiTarget(last, searchTarget(goal), false).status === 'MATCH')) prior.verification = 'VERIFIED';
      }
      const evaluationStarted = performance.now();
      const satisfied = current && criterionSatisfied(goal, current.criterion, last, memory.selection);
      budget.timings.verificationMs += Math.round(performance.now() - evaluationStarted);
      if (satisfied && prior && prior.subgoalId === current.id && ['INPUT_TEXT', 'PRESS_KEY'].includes(prior.action.type)) prior.verification = 'VERIFIED';
      if (seen.repeated) { block('Unchanged screen and goal progress repeated; stop the loop safely.'); break; }
      const recoveryDecision = recovery.next(goal, last, budget, reason => emit('VERIFYING', reason));
      memory.recovery = recovery.summary();
      if (recovery.active && recoveryStarted === undefined) recoveryStarted = performance.now();
      if (!recovery.active && recoveryStarted !== undefined) {
        budget.timings.recoveryMs += Math.round(performance.now() - recoveryStarted); recoveryStarted = undefined;
      }
      emit('DECIDING', 'Choose one next operation from observed state and remaining budget.');
      const callsBefore = budget.counters.reasoning;
      const next = DecisionSchema.parse(recoveryDecision ?? await decision.decide(goal, last, memory, execution.discoveryMemory(), budget, signal));
      const grounding = next.type === 'EXECUTE_ACTION' ? next.grounding : undefined;
      if (grounding && (grounding.snapshotId !== last.snapshotId || !generateActionCandidates(goal, last).some(candidate =>
        candidate.candidateId === grounding.candidateId && candidate.targetElementId === grounding.targetElementId &&
        candidate.semanticRole === grounding.semanticRole && candidate.anchorResourceId === grounding.anchorResourceId &&
        JSON.stringify(candidate.routeContext) === JSON.stringify(grounding.routeContext) &&
        JSON.stringify(candidate.action) === JSON.stringify(grounding.action)))) { block('The candidate is not a member of this snapshot and subgoal.'); break; }
      if ((grounding || budget.counters.reasoning > callsBefore) && ['EXECUTE_ACTION', 'EXPLORE_UI', 'WAIT_FOR_CONDITION'].includes(next.type)) {
        const fresh = acceptSnapshot(await execution.observe(signal));
        const routeStillGrounded = grounding?.semanticRole === 'capability_navigation' && revalidateCandidate(grounding, goal, fresh);
        if (geometryFingerprint(fresh) !== seen.fingerprint && !routeStillGrounded) { emit('OBSERVING', 'UI changed while reasoning; discard the decision and observe again.'); continue; }
        if (next.type === 'EXECUTE_ACTION' && next.grounding && (!revalidateCandidate(next.grounding, goal, fresh) ||
          JSON.stringify(next.grounding.action) !== JSON.stringify(next.action))) { block('The selected candidate is stale or outside the current subgoal.'); break; }
        last = fresh;
      }
      if (next.type === 'COMPLETE_SUBGOAL') {
        if (!current || !criterionSatisfied(goal, current.criterion, last, memory.selection)) { block('Completion claim is not supported by the current snapshot.'); break; }
        current.status = 'VERIFIED'; goal.currentSubgoal++;
        emit('VERIFYING', next.reason); continue;
      }
      if (next.type === 'COMPLETE_GOAL') {
        const final = goal.subgoals.at(-1);
        if (goal.subgoals.some(s => s.status !== 'VERIFIED') || !final || !criterionSatisfied(goal, final.criterion, last, memory.selection)) { block('Final goal criterion is not currently verified.'); break; }
        terminal = emit('COMPLETED', 'All subgoals and the final device state are verified.'); break;
      }
      if (next.type === 'REQUEST_HUMAN_ASSISTANCE') { block(next.reason, next.category); break; }
      if (next.type === 'FAIL_GOAL') { terminal = emit('FAILED', next.reason); break; }
      if (next.type === 'OBSERVE_AGAIN') { emit('OBSERVING', next.reason); continue; }
      if (next.type === 'REPLAN_SUBGOAL') {
        budget.consume('replans');
        const index = goal.subgoals.findIndex(sub => sub.id === next.subgoalId);
        if (index < 0 || index > goal.currentSubgoal) { block('Replan cannot introduce, skip or weaken goal criteria.'); break; }
        goal.subgoals.slice(index).forEach(sub => { sub.status = 'PENDING'; });
        goal.currentSubgoal = index; memory.selection = undefined;
        emit('DECIDING', next.reason); continue;
      }
      const action: Action = next.type === 'EXECUTE_ACTION' ? next.action :
        { type: 'WAIT_FOR', target: next.target, timeoutMs: Math.max(1, Math.min(15000, Math.floor(budget.remaining()))) };
      try { policyForAgentAction(goal, action, last, grounding); }
      catch (error) { block('Independent policy or the current goal scope denies this action.', error instanceof AgentPolicyError ? error.category : 'UNKNOWN_UI'); break; }
      if (memory.alreadyAttempted(action, current?.id ?? '', seen.fingerprint)) {
        const verifiedReopen = action.type === 'OPEN_APP' && budget.counters.replans > 0 && memory.actions.some(row => row.action.type === 'OPEN_APP' && row.verification === 'VERIFIED');
        if (action.type !== 'WAIT_FOR' && !verifiedReopen) { block('This operation was already attempted without new authorized evidence.'); break; }
        budget.consume('retries');
      }
      budget.consume('steps');
      const row = { action, fingerprint: seen.fingerprint, subgoalId: current?.id ?? '', verification: 'FAILED' as 'FAILED' | 'SENT' | 'VERIFIED', reason: next.reason,
        recoverySubtaskId: recovery.active?.subtaskId,
        ...(next.type === 'EXECUTE_ACTION' && next.grounding ? { candidateId: next.grounding.candidateId, candidateSnapshotId: next.grounding.snapshotId } : {}) };
      memory.actions.push(row);
      const navigationRow = grounding?.semanticRole === 'capability_navigation' ? {
        from: last.snapshotId, action, verification: 'FAILED' as 'VERIFIED' | 'SENT' | 'FAILED', capability: resolveRequiredCapability(goal, last).name,
        elapsedMs: 0, to: undefined as string | undefined,
      } : undefined;
      if (navigationRow) { recovery.recordNavigationAttempt(); memory.navigation.push(navigationRow); }
      emit(next.type === 'EXPLORE_UI' ? 'EXPLORING' : 'EXECUTING', next.reason, { action });
      checkCancellation(signal);
      const started = performance.now();
      try {
        const outcome = await execution.execute(action, signal, progress => {
          emit(progress.exploration ? 'EXPLORING' : 'VERIFYING', progress.exploration?.reason ?? 'Executor is validating an observed condition.',
            { action, screen: progress.evidence?.screen ?? last?.screen, foregroundPackage: progress.evidence?.foregroundPackage ?? last?.foregroundPackage });
        }, grounding);
        memory.lastOutcome = outcome; memory.selection = outcome.selection ?? memory.selection;
        row.verification = outcome.verification === 'VERIFIED' ? 'VERIFIED' : 'SENT';
        if (navigationRow) {
          navigationRow.verification = row.verification; navigationRow.elapsedMs = Math.round(performance.now() - started);
          if (row.verification !== 'VERIFIED') { block('Navigation was dispatched without destination verification; parent goal remains suspended.'); break; }
          const destination = execution.verificationSnapshot?.();
          if (destination && outcome.verification === 'VERIFIED') { last = acceptSnapshot(destination); navigationRow.to = destination.snapshotId; }
        }
        emit('VERIFYING', outcome.postcondition ?? 'Observe again to verify the goal, not merely dispatch.');
        // Reuse the executor's actual postcondition read only for completion,
        // never as a snapshot for a subsequent action. Player metadata can hide
        // during playback between two redundant reads.
        const verified = execution.verificationSnapshot?.();
        if (verified && verified.deviceSerial !== expectedDevice) throw new AndroidExecutionError('SESSION_ERROR', 'Postcondition belongs to another device.');
        if (!recovery.active && outcome.verification === 'VERIFIED' && current && verified &&
          Date.now() - verified.timestamp >= 0 && Date.now() - verified.timestamp <= 5000 &&
          criterionSatisfied(goal, current.criterion, verified, memory.selection)) {
          current.status = 'VERIFIED'; goal.currentSubgoal++; last = acceptSnapshot(verified);
          if (goal.subgoals.every(sub => sub.status === 'VERIFIED')) terminal = emit('COMPLETED', 'Final goal criterion independently checked against the executor postcondition snapshot.');
          else emit('VERIFYING', 'Subgoal independently checked against the executor postcondition snapshot.');
        }
      } catch (error) {
        if (error instanceof AgentLimitError) throw error;
        checkCancellation(signal);
        const failure = asAndroidError(error);
        memory.failures.push({ code: failure.code, action, message: failure.message.slice(0, 180) });
        if (failure.selection) memory.selection = failure.selection;
        if (navigationRow) {
          navigationRow.elapsedMs = Math.round(performance.now() - started);
          if (!['DEVICE_ERROR', 'SESSION_ERROR', 'BACKEND_ERROR', 'CANCELLED'].includes(failure.code)) {
            block('Navigation has no verified destination; do not replay the gesture. Human assistance is required.'); break;
          }
        }
        if (!recovery.active && failure.visual?.status === 'HUMAN_REQUIRED' && assistance && execution.confirmVisualTap && action.type === 'CLICK' &&
          failure.visual.ordinalVerified && failure.visual.coherent && !goal.spec.isSensitive) {
          const visual = failure.visual;
          const assistanceStarted = performance.now();
          let choice: HumanTapChoice;
          try {
            choice = await assistance(visual, (token, expiresAt) => emit('NEED_HUMAN_ASSISTANCE', failure.message, {
              assistance: { category: 'INTERACTION_POSITION', resumable: true, sessionRetained: true, token, expiresAt, evidenceId: visual.id }, visual }));
          } finally { budget.timings.assistanceMs += Math.round(performance.now() - assistanceStarted); }
          budget.check(); checkCancellation(signal);
          emit('VERIFYING', 'Confirmation received; revalidate screen pixels, hierarchy and policy before any tap.');
          const plan = { intent: goal.id, isSensitive: false, actions: [{ type: 'OPEN_APP' as const, app: goal.spec.app }, action] };
          const outcome = await execution.confirmVisualTap(choice, plan, signal);
          memory.lastOutcome = outcome; memory.selection = outcome.selection ?? memory.selection;
          row.verification = outcome.verification === 'VERIFIED' ? 'VERIFIED' : 'SENT';
          const verified = execution.verificationSnapshot?.();
          if (outcome.verification === 'VERIFIED' && current && goal.currentSubgoal === goal.subgoals.length - 1 &&
            goal.subgoals.slice(0, -1).every(sub => sub.status === 'VERIFIED') && verified && Date.now() - verified.timestamp >= 0 && Date.now() - verified.timestamp <= 5000 &&
            criterionSatisfied(goal, current.criterion, verified, memory.selection)) {
            current.status = 'VERIFIED'; goal.currentSubgoal++; last = acceptSnapshot(verified);
            terminal = emit('COMPLETED', 'Human-confirmed activation and the requested destination independently verified in the original Session.');
          } else emit('VERIFYING', 'Confirmed tap sent; completion still requires destination evidence.');
          continue;
        }
        if (failure.visual || ['AMBIGUOUS', 'CONFIG_ERROR', 'SCROLL_LIMIT_REACHED'].includes(failure.code)) {
          block(failure.visualFailure ?? failure.message, failure.code === 'CONFIG_ERROR' ? 'SENSITIVE_ACTION' : 'INTERACTION_POSITION', failure.visual); break;
        }
        if (['DEVICE_ERROR', 'SESSION_ERROR', 'BACKEND_ERROR'].includes(failure.code)) { terminal = emit('FAILED', failure.message); break; }
        if (recovery.active) {
          budget.consume('retries');
          emit('OBSERVING', 'Recovery postcondition is uncertain; observe once without replaying the action.');
          continue;
        }
        budget.consume('retries');
        emit('OBSERVING', 'Postcondition was not verified; observe once before deciding whether another operation is safe.');
      } finally { budget.timings.executionMs += Math.round(performance.now() - started); }
    }
  } catch (error) {
    const cancelled = signal?.aborted && signal.reason?.name !== 'TimeoutError';
    terminal = emit(cancelled || error instanceof AndroidExecutionError && error.code === 'CANCELLED' ? 'CANCELLED' : error instanceof AgentLimitError ? 'BLOCKED' : 'FAILED',
      error instanceof AgentLimitError ? error.message : error instanceof AndroidExecutionError ? error.message : 'Agent stopped because a decision or backend operation could not be safely validated.',
      error instanceof AndroidExecutionError ? { failure: { code: error.code, message: error.message } } : {});
  } finally {
    if (recoveryStarted !== undefined) budget.timings.recoveryMs += Math.round(performance.now() - recoveryStarted);
    if (terminal?.status === 'CANCELLED' || terminal?.status === 'FAILED' || terminal?.status === 'BLOCKED') recovery.stop(terminal.status, terminal.reason);
    else if (recovery.active) recovery.stop('BLOCKED', terminal?.reason ?? 'Execution stopped.');
    memory.recovery = recovery.summary();
    try { await execution.close(); }
    catch { terminal = emit('FAILED', 'Session cleanup failed; do not start another execution until the device lock is inspected.'); }
  }
  const result = { ...terminal!, recovery: recovery.summary(), type: 'complete' as const, ...budget.summary() };
  onProgress?.(result);
  return { result, memory };
}

export async function createAgentExecution(goal: AgentGoal, budget: AgentBudget, serial: string, run: AdbRunner, signal?: AbortSignal) {
  const app = discoveredApplication(goal);
  if (app && app.serial !== serial) throw new AndroidExecutionError('SESSION_ERROR', 'Application discovery belongs to a different device.');
  if (app && resolveAppPackage(goal.spec.app) !== app.packageName) throw new AndroidExecutionError('CONFIG_ERROR', 'Goal app no longer matches its discovered launcher.');
  if ((process.env.ANDROID_EXECUTOR_BACKEND ?? 'appium') !== 'appium') throw new Error('Agent requires Appium; no automatic backend switch is allowed.');
  let verifiedSnapshot: Observation | undefined;
  let activeCandidate: ActionCandidate | undefined;
  let executing = false;
  const execution = await createExecutionContext(serial, [{ type: 'OPEN_APP', app: goal.spec.app }], run, signal, {
    executionId: budget.runtimeIdentity?.executionId,
    beforeSnapshot: source => budget.recordSnapshot(source), beforeScroll: () => budget.consume('scrolls'),
    onWebVerification: value => { budget.webVerification.push(value); if (budget.webVerification.length > 24) budget.webVerification.shift(); },
    onObservation: ms => { budget.timings.observationMs += ms; }, onVerification: ms => { budget.timings.verificationMs += ms; },
    onVerifiedSnapshot: snapshot => { verifiedSnapshot = snapshot; },
    beforeKey: (action, snapshot) => { policyForAgentAction(goal, action, snapshot, activeCandidate); },
    beforeAction: (action, snapshot) => { policyForAgentAction(goal, action, snapshot, activeCandidate); },
    verifyAction: (_action, before, after) => activeCandidate ? verifyCandidateOutcome(goal, activeCandidate, before, after) : undefined,
    allowedPackage: packageName => goalPackageAllowed(goal, packageName),
    verifyNavigation: (before, after) => activeCandidate ? verifyCandidateOutcome(goal, activeCandidate, before, after) : verifyReversibleNavigation(before, after),
  });
  return { ...execution, deviceId: serial, verificationSnapshot: () => verifiedSnapshot,
    async execute(action: Action, signal?: AbortSignal, progress?: (value: ObserverProgress) => void, candidate?: ActionCandidate) {
      if (executing) throw new AndroidExecutionError('SESSION_ERROR', 'Another action is already active in this execution.');
      executing = true;
      activeCandidate = candidate;
      try { return await execution.execute(action, signal, progress); }
      finally { activeCandidate = undefined; executing = false; }
    },
    async close() { verifiedSnapshot = undefined; await execution.close(); } };
}
