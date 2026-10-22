import type { V2Execution } from './agent-v2';
import type { GoalNodeV2, V2Progress } from './goal-graph';
import type { AgentBudget } from './budget';
import type { Observation } from '../state-observer';
import type { OwnerTestExecution } from './owner-test-policy';
import { beginSearch, closeSearch, searchTransitionSatisfied, observeLiveSearch, searchOutcomeDiagnostic, noteSearchKeyboard } from './generic-search';
import type { KeyboardVisibility } from './keyboard-visibility';
import { generateGroundedCandidates, revalidateGroundedCandidate, type GroundedCandidateV2 } from './grounded-candidates-v2';
import { issueEffectGrant } from './effect-grants';
import { verifySearchOutcome } from './verification-registry';
import { GroundedInteractionFailure, consumeNotSentReceipt } from '../grounded-interactions';
import { searchUserAction, type SearchUserAction } from './search-user-action';

export class SearchBlocked extends Error {}
export class SearchNeedsUserAction extends SearchBlocked {
  constructor(readonly userAction: SearchUserAction) { super('NEEDS_USER_ACTION: ' + userAction.reason); }
}

export async function runGenericSearch(input: { node: GoalNodeV2; deviceId: string; executionId: string; execution: V2Execution; budget: AgentBudget; signal?: AbortSignal; ownerScope?: OwnerTestExecution;
  fresh(carry?: Observation): Promise<Observation>; choose(candidates: GroundedCandidateV2[]): Promise<string>;
  keyboard?(): Promise<KeyboardVisibility>;
  userAction?(action: SearchUserAction): Promise<void>;
  progress(state: NonNullable<V2Progress['search']>, candidate?: GroundedCandidateV2): void }) {
  const { node, execution, budget, signal } = input;
  const scope = beginSearch(node, input.deviceId, input.executionId, execution.sessionId()!);
  const attempts = new Set<string>(); let submitted = false, renewals = 0, carry: Observation | undefined;
  try {
    for (let i = 0; i < 10; i++) {
      signal?.throwIfAborted(); budget.consume('iterations');
      input.progress({ phase: 'DISCOVER_SEARCH_CAPABILITY', query: scope.query });
      const snapshot = await input.fresh(carry); carry = undefined;
      const live = observeLiveSearch(scope, snapshot);
      if (live) {
        input.progress({ phase: 'VERIFY_LIVE_SEARCH_TRANSITION', query: scope.query });
        if (live === 'VERIFIED') { submitted = true; break; }
        continue;
      }
      const candidates = generateGroundedCandidates(node, snapshot, input.executionId, execution.sessionId()!, false, 0, '', false, undefined, Boolean(input.ownerScope), scope).candidates;
      const action = !candidates.some(c => c.search) ? searchUserAction(snapshot) : undefined;
      if (action) {
        input.progress({ phase: 'NEEDS_USER_ACTION', query: scope.query, userAction: action });
        if (!input.userAction) throw new SearchNeedsUserAction(action);
        await input.userAction(action);
        // Assistance never replaces a fresh normal-surface observation.
        carry = undefined; continue;
      }
      if (!candidates.length) {
        if (snapshot.nodes.some(n => n.displayed !== false && /ProgressBar/.test(n.className))) { input.progress({ phase: 'WAIT_SEARCH_UI_READY', query: scope.query }); continue; }
        throw new SearchBlocked('SEARCH_AFFORDANCE_UNAVAILABLE_OR_AMBIGUOUS: no search control was guessed.');
      }
      const id = candidates.length === 1 ? candidates[0].id : await input.choose(candidates);
      if (candidates.length === 1) budget.profiling.singletonCandidatesSkipped++;
      const selected = candidates.find(c => c.id === id); if (!selected) throw Error('Search choice is outside the grounded manifest.');
      // Dispatch independently reads native state again; reuse only this still-fresh selection observation.
      const fresh = Date.now() - snapshot.timestamp <= 2000 ? snapshot : await input.fresh(), c = revalidateGroundedCandidate(selected, node, fresh, input.executionId, execution.sessionId()!, false, '', false, false, undefined, scope);
      if (!c) { budget.consume('replans'); input.progress({ phase: 'REOBSERVE_CHANGED_SEARCH_UI', query: scope.query }); continue; }
      const key = c.search!.phase + ':' + c.target.resourceId + ':' + c.target.label + ':' + c.target.index;
      if (attempts.has(key)) throw new SearchBlocked('SEARCH_EFFECT_REPLAY_BLOCKED');
      attempts.add(key); budget.consume('steps');
      if (['OPEN', 'MENU', 'RESET'].includes(c.search!.phase)) budget.consume('recoverySubtasks');
      input.progress({ phase: c.search!.phase === 'ENTER' ? 'ENTER_SEARCH_QUERY' : c.search!.phase === 'SUBMIT' ? 'SUBMIT_SEARCH' : 'NAVIGATE_TO_SEARCH', query: scope.query }, c);
      const start = performance.now();
      try { carry = await execution.interactV2(issueEffectGrant(c, node, input.ownerScope), signal); }
      catch (error) {
        signal?.throwIfAborted();
        if (error instanceof GroundedInteractionFailure) {
          input.progress({ phase: 'SEARCH_DIAGNOSTIC', query: scope.query, diagnostic: { code: error.diagnosticCode, dispatchState: error.dispatchState, cause: error.message } });
          if (renewals < 1 && consumeNotSentReceipt(error, c)) {
            renewals++; budget.consume('retries'); budget.consume('replans'); attempts.delete(key);
            input.progress({ phase: 'REGROUND_NOT_SENT', query: scope.query, diagnostic: { code: error.diagnosticCode, dispatchState: 'NOT_SENT', cause: 'Issued receipt consumed; fresh observation and a new single-use grant required.' } });
            continue;
          }
          const observed = await input.fresh();
          if (error.dispatchState === 'ACKNOWLEDGED' && (c.search!.phase === 'SUBMIT' || searchTransitionSatisfied(c, observed))) {
            if (c.search!.phase === 'SUBMIT') { submitted = true; break; }
            continue;
          }
          throw new SearchBlocked(`SEARCH_${error.dispatchState}_${error.diagnosticCode}: no replay. ${error.message}`);
        }
        const cause = error instanceof Error ? error.message.slice(0, 100) : 'Unknown backend response';
        throw new SearchBlocked('SEARCH_DISPATCH_UNCERTAIN: no replay. ' + cause);
      }
      finally { budget.timings.executionMs += performance.now() - start; }
      input.progress({ phase: c.search!.phase, query: scope.query, state: c.search!.phase === 'ENTER' ? 'QUERY_ENTERED' : c.search!.phase === 'SUBMIT' ? 'QUERY_SUBMITTED' : 'SEARCH_UI_OPENED' });
      if (c.search!.phase === 'SUBMIT') { submitted = true; break; }
    }
    if (!submitted) throw new SearchBlocked('SEARCH_SUBMIT_NOT_VERIFIED');
    const deadline = Date.now() + Math.min(15000, budget.remaining());
    do {
      input.progress({ phase: 'VERIFY_SEARCH_OUTCOME', query: scope.query });
      const snapshot = await input.fresh(carry), started = performance.now(); carry = undefined;
      if (input.keyboard) noteSearchKeyboard(scope, await input.keyboard());
      const proof = verifySearchOutcome(scope, snapshot, { deviceId: input.deviceId, executionId: input.executionId, nodeId: node.id, packageName: node.packageName! });
      budget.timings.verificationMs += performance.now() - started;
      if (proof) {
        input.progress({ phase: 'VERIFY_SEARCH_OUTCOME', ...proof.search!, state: proof.search!.status === 'RESULTS' ? 'RESULTS_OBSERVED' : 'NO_RESULTS_OBSERVED' });
        input.progress({ phase: 'OUTCOME_VERIFIED', ...proof.search!, state: 'SEARCH_COMPLETED' }); return proof;
      }
    } while (Date.now() < deadline && (budget.consume('iterations'), true));
    throw new SearchBlocked('SEARCH_OUTCOME_UNVERIFIED: ' + searchOutcomeDiagnostic(scope));
  } finally { closeSearch(scope); }
}
