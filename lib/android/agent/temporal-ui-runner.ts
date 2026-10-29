import { setTimeout as delay } from 'node:timers/promises';
import type { V2Execution } from './agent-v2';
import type { AgentBudget } from './budget';
import type { Observation } from '../state-observer';
import type { GoalNodeV2 } from './goal-graph';
import type { OwnerTestExecution } from './owner-test-policy';
import { LocalEffectJournal } from './local-effect-journal';
import { issueEffectGrant } from './effect-grants';
import { generateGroundedCandidates } from './grounded-candidates-v2';
import { GroundedInteractionFailure } from '../grounded-interactions';
import { observedAffordances } from './ui-affordances';
import {
  beginTemporalUi, setTemporalUiPhase, temporalFormValues, temporalFormExact, temporalUiSteps,
  temporalUiPrecondition, noteTemporalTimerRead, verifyTemporalUi, alarmDeltaReason,
  runningTimer,
  type TemporalUiPhase,
} from './temporal-ui';

export async function runTemporalUi(input: {
  source: string; node: GoalNodeV2; executionId: string; execution: V2Execution; budget: AgentBudget;
  owner?: OwnerTestExecution; signal?: AbortSignal; fresh(): Promise<Observation>;
  registerJournal(journal: LocalEffectJournal): void;
  confirm(): Promise<unknown>; emit(reason: string): void;
}) {
  const { node, execution, budget, signal } = input, request = node.outcome.temporal!;
  if (!execution.temporalUiInventoryV2) throw Error('TEMPORAL_UI_EXECUTOR_UNAVAILABLE');
  const inventory = () => { signal?.throwIfAborted(); budget.check(); return execution.temporalUiInventoryV2!(node.packageName!, request, signal); };
  let before = await inventory(), snapshot = await input.fresh(); temporalUiPrecondition(before, request);
  const journal = input.owner?.fullControl ? await LocalEffectJournal.begin(input.owner, input.source, node, snapshot, before) : undefined;
  if (journal) input.registerJournal(journal);
  await input.confirm();
  const ready = await inventory(); temporalUiPrecondition(ready, request);
  if (JSON.stringify(ready.rows) !== JSON.stringify(before.rows) || ready.zone !== before.zone) throw Error('UI_BASELINE_CHANGED: no write sent.');
  before = ready; const scope = beginTemporalUi(node, before, input.executionId, input.source);
  const act = async (phase: TemporalUiPhase, optional = false) => {
    budget.check(); signal?.throwIfAborted(); setTemporalUiPhase(scope, phase); snapshot = await input.fresh();
    const candidates = generateGroundedCandidates(node, snapshot, input.executionId, execution.sessionId()!, false, 0, '', false, undefined, Boolean(input.owner), undefined, scope).candidates;
    if (!candidates.length && optional) return;
    if (candidates.length !== 1) throw Error('TEMPORAL_UI_' + phase + '_AMBIGUOUS: no target guessed.');
    const candidate = candidates[0];
    // Widget contents are independently read back; no-op fields need no mutation.
    const role = phase === 'HOUR' ? 'hour' : phase === 'MINUTE' ? 'minute' : phase === 'SECOND' ? 'second' : undefined;
    if (role && temporalFormValues(scope, snapshot)[role] === Number(candidate.value)) return;
    if (phase === 'PERIOD' && (candidate.target.selected || candidate.target.checked)) return;
    const ticket = await journal?.prepare(candidate);
    const grant = issueEffectGrant(candidate, node, input.owner, ticket);
    budget.consume('steps'); input.emit('UI temporal ' + phase + ': one grounded single-use grant.');
    const start = performance.now();
    try { snapshot = await execution.interactV2(grant, signal); }
    catch (error) {
      signal?.throwIfAborted();
      if (phase !== 'COMMIT' || !(error instanceof GroundedInteractionFailure) || error.dispatchState === 'NOT_SENT') throw error;
      input.emit('Save/Start attempted once; bounded readback only, never replay.');
    } finally { budget.timings.executionMs += performance.now() - start; }
  };
  if (request.kind === 'ALARM') await act('CREATE');
  await act('HOUR'); await act('MINUTE');
  if (request.kind === 'TIMER') await act('SECOND');
  else { await act('PERIOD', true); await act('LABEL', true); }
  snapshot = await input.fresh();
  if (!temporalFormExact(scope, snapshot)) throw Error('TEMPORAL_UI_FORM_READBACK_MISMATCH: commit not authorized.');
  // Verify that the final form still exposes exactly one authorized commit control.
  setTemporalUiPhase(scope, 'COMMIT');
  if (temporalUiSteps(scope, snapshot).length !== 1) throw Error('TEMPORAL_UI_COMMIT_AMBIGUOUS');
  if (request.kind === 'TIMER' && observedAffordances(snapshot, input.executionId, scope.sessionId).some(a => /^(pause|resume|tam dung|tiep tuc)$/i.test(a.label))) throw Error('TIMER_ALREADY_RUNNING');
  await act('COMMIT');
  const verifying = performance.now();
  try {
    if (request.kind === 'ALARM') {
      let first;
      const deadline = performance.now() + Math.min(15000, budget.remaining());
      do {
        signal?.throwIfAborted();
        try {
          const view = await inventory(), reason = alarmDeltaReason(before.rows, view.rows, request, scope.label);
          if (!reason) { first = view; break; }
          if (reason !== 'NEW_ROW_COUNT_NOT_ONE' || view.rows.length !== before.rows.length) throw Error('UI_LIST_' + reason);
        } catch (error) {
          if (!(error instanceof Error) || !/TEMPORAL_TAB_AMBIGUOUS|UI_LIST_UNREADABLE/.test(error.message)) throw error;
        }
      } while (performance.now() < deadline);
      if (!first) throw Error('UI_ALARM_NEW_ROW_NOT_OBSERVED: no Save replay.');
      const second = await inventory(); let proof = verifyTemporalUi(scope, first, second);
      if (execution.temporalCorroborateV2) proof = await execution.temporalCorroborateV2(proof, signal);
      await journal?.verifiedTemporalUi(proof); return proof;
    }
    let first = await input.fresh();
    const deadline = performance.now() + Math.min(10000, budget.remaining());
    while (runningTimer(first) === undefined && performance.now() < deadline) first = await input.fresh();
    if (runningTimer(first) === undefined) throw Error('UI_TIMER_RUNNING_DECREASE_UNVERIFIED: no running countdown observed; no Start replay.');
    noteTemporalTimerRead(scope, first);
    await delay(1500, undefined, { signal });
    const second = await input.fresh(); noteTemporalTimerRead(scope, second);
    const proof = verifyTemporalUi(scope, first, second); await journal?.verifiedTemporalUi(proof); return proof;
  } finally { budget.timings.verificationMs += performance.now() - verifying; }
}
