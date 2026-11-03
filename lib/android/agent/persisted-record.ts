import type { Observation } from '../state-observer';
import type { V2Execution } from './agent-v2';
import type { GoalNodeV2, V2Assistance } from './goal-graph';
import type { AgentBudget } from './budget';
import type { AgentProgress } from './schema';
import { requestedRecord, observedRecordIdentity, recordFieldRole, exactRecordFields, type RecordState } from './record-forms';
import { generateGroundedCandidates, revalidateGroundedCandidate } from './grounded-candidates-v2';
import { observedAffordances } from './ui-affordances';
import { issueEffectGrant } from './effect-grants';
import { verifyRecordReadback } from './verification-registry';
import { beginRecordDraft, resolvePersistedRecord } from './record-persistence';
import type { OwnerTestExecution } from './owner-test-policy';
import type { LocalEffectJournal } from './local-effect-journal';

export async function runPersistedRecord(input: { node: GoalNodeV2; deviceId: string; executionId: string; execution: V2Execution; snapshot: Observation; budget: AgentBudget; signal?: AbortSignal;
  ownerScope?: OwnerTestExecution; journal?: LocalEffectJournal;
  fresh(): Promise<Observation>; emit(status: AgentProgress['status'], reason: string): void;
  help(category: V2Assistance['category'], choices: { id: string; label: string }[], reason: string): Promise<string> }) {
  const { node, execution, budget, signal } = input, values = requestedRecord(node.outcome);
  if (!values) throw Error('RECORD_SCHEMA_UNAVAILABLE');
  let snapshot = input.snapshot;
  const attempted = new Set<string>();
  const act = async (state: RecordState) => {
    signal?.throwIfAborted(); budget.check();
    let candidates = generateGroundedCandidates(node, snapshot, input.executionId, execution.sessionId()!, false, 0, '', false, state).candidates;
    if (candidates.length !== 1) {
      await input.help(node.capability === 'SET_STRUCTURED_STATE' ? 'UNCERTAIN_WIDGET' : 'FIELD_AMBIGUITY', [{ id: 'continue', label: 'I resolved the form ambiguity on the phone' }], 'No unique observed field/control or proven time format. Resolve the form without saving, then continue.');
      snapshot = await input.fresh();
      candidates = generateGroundedCandidates(node, snapshot, input.executionId, execution.sessionId()!, false, 0, '', false, state).candidates;
    }
    if (candidates.length !== 1) throw Error('FORM_TARGET_AMBIGUOUS: no field/control was guessed.');
    if (state.phase === 'FIELD' && candidates[0].desired !== undefined && candidates[0].target.checked === candidates[0].desired) return candidates[0];
    if (state.phase === 'FIELD' && node.capability === 'CREATE_RECORD' && candidates[0].target.text.trim() && candidates[0].target.text !== candidates[0].value) throw Error('FORM_FIELD_CHANGED: do not overwrite unexpected text.');
    const fresh = await input.fresh(), candidate = revalidateGroundedCandidate(candidates[0], node, fresh, input.executionId, execution.sessionId()!, false, '', false, false, state);
    if (!candidate) throw Error('FORM_STATE_CHANGED: no stale write dispatched.');
    const key = state.phase + ':' + (state.field ?? '');
    if (attempted.has(key)) throw Error('FORM_MUTATION_REPLAY_BLOCKED');
    attempted.add(key); budget.consume('steps');
    const ticket = candidate.effect === 'LOCAL_WRITE' ? await input.journal?.prepare(candidate) : undefined;
    const grant = issueEffectGrant(candidate, node, input.ownerScope, ticket), start = performance.now();
    input.emit('EXECUTING', `Record ${state.phase}${state.field ? ': ' + state.field : ''}; bound values and one-shot grant.`);
    try { snapshot = await execution.interactV2(grant, signal); }
    catch { throw Error('FORM_MUTATION_UNCERTAIN: no save/input retry.'); }
    finally { budget.timings.executionMs += Math.round(performance.now() - start); }
    if (snapshot.deviceSerial !== input.deviceId || snapshot.foregroundPackage !== node.packageName || snapshot.observationStatus !== 'OBSERVED' || Date.now() - snapshot.timestamp > 5000 || snapshot.timestamp > Date.now()) throw Error('FORM_POSTCONDITION_FOREIGN_OR_STALE');
    return candidate;
  };
  await input.help('EFFECT_CONFIRMATION', [{ id: 'allow', label: 'Create one record: ' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('; ') }], 'Approve only these exact fields and one Save, followed by exit/reopen verification.');
  snapshot = await input.fresh();
  const baseline = snapshot;
  let created = false;
  if (!observedRecordIdentity(snapshot)) { await act({ phase: 'CREATE' }); created = true; }
  if (!created) throw Error('DRAFT_NOT_PROVEN_NEW: no existing record/alarm will be overwritten.');
  const draftScope = beginRecordDraft(baseline, snapshot, values, input.executionId);
  if (!draftScope) throw Error('PERSISTENCE_IDENTITY_UNAVAILABLE: no draft identity or complete baseline for a registered post-Save strategy; Save is not authorized.');
  const identity = draftScope.id;
  const draft = snapshot, fields = observedAffordances(draft, input.executionId, execution.sessionId()!).filter(row => recordFieldRole(row));
  if (node.capability === 'CREATE_RECORD' && fields.some(row => row.roles.includes('editable') && row.text.trim())) throw Error('FORM_NOT_EMPTY: existing data will not be overwritten.');
  for (const field of Object.keys(values)) await act({ phase: 'FIELD', field, identity, draftScope });
  if (!exactRecordFields(snapshot, values)) throw Error('FORM_VALUES_NOT_VERIFIED: Save is not authorized.');
  await act({ phase: 'SAVE', identity, draftScope });
  const list = snapshot;
  if (!resolvePersistedRecord(draftScope, list, input.executionId)) {
    await input.help('SAVE_RESULT_AMBIGUITY', [{ id: 'continue', label: 'I returned to the record list without saving again' }], 'Save was sent once. Return to the list for identity readback; Save will not be replayed.');
    snapshot = await input.fresh();
  }
  const persistedList = snapshot;
  const match = resolvePersistedRecord(draftScope, persistedList, input.executionId);
  if (!match) throw Error('PERSISTED_RECORD_NOT_FOUND: Save is not proof of persistence.');
  await act({ phase: 'REOPEN', identity: match.identity, draftScope });
  snapshot = await input.fresh();
  const proof = verifyRecordReadback(draft, persistedList, snapshot, values, match.identity, { deviceId: input.deviceId, executionId: input.executionId, nodeId: node.id, packageName: node.packageName! }, draftScope);
  if (!proof) throw Error('PERSISTED_RECORD_READBACK_MISMATCH');
  input.emit('VERIFYING', 'Record identity and exact fields verified after exit and reopen.');
  return proof;
}
