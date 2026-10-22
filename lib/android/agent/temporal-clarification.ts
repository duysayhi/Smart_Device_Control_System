import { parseTemporal } from './temporal-contract';
import { validateOutcomeSpans, registerReviewedOutcomes, type OutcomeSpecV2, type OutcomeV2 } from './outcome-spec';

const clarified = new Map<string, { source: string; outcomes: Set<string>; expiresAt: number }>();
export function isClarifiedTemporal(source: string, outcome: OutcomeV2, executionId: string): boolean {
  const state = clarified.get(executionId);
  return Boolean(state && state.expiresAt > Date.now() && state.source === source && state.outcomes.has(JSON.stringify(outcome)));
}
// Only called after a backend Human Assistance token returns an explicit AM/PM choice.
export function clarifyTemporal(spec: OutcomeSpecV2, outcomeId: string, period: string, executionId: string): OutcomeSpecV2 {
  validateOutcomeSpans(spec);
  const outcome = spec.outcomes.find(o => o.id === outcomeId);
  if (!outcome || outcome.negated || outcome.ambiguity.length !== 1 || outcome.ambiguity[0] !== 'AM_PM_REQUIRED' || !['am', 'pm'].includes(period)) throw Error('HARD_DENY: invalid temporal clarification.');
  const parsed = parseTemporal(outcome.span.text + ' ' + period.toUpperCase());
  if (!parsed?.request || parsed.request.kind !== 'ALARM') throw Error('AM_PM_REQUIRED: unsupported clarification; no time guessed.');
  for (const [id, record] of clarified) if (record.expiresAt < Date.now()) clarified.delete(id);
  if (clarified.size >= 128 && !clarified.has(executionId)) throw Error('Temporal clarification capacity exceeded.');
  const resolved: OutcomeV2 = { ...outcome, temporal: parsed.request, ambiguity: [] };
  const state = clarified.get(executionId) ?? { source: spec.request, outcomes: new Set<string>(), expiresAt: Date.now() + 120000 };
  if (state.source !== spec.request) throw Error('HARD_DENY: execution source changed.');
  state.outcomes.add(JSON.stringify(resolved)); clarified.set(executionId, state);
  const result = { ...spec, outcomes: spec.outcomes.map(o => o.id === outcomeId ? resolved : o) };
  registerReviewedOutcomes(result); return result;
}
export function clearTemporalClarification(executionId: string) { clarified.delete(executionId); }
