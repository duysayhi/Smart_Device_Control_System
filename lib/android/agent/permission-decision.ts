import { forbiddenSource } from '../safety-envelope';
import { assertOwnerTestExecution, type OwnerTestExecution } from './owner-test-policy';
import { fullControlHardBlock } from './full-control-policy';
import { validateOutcomeSpans, type OutcomeSpecV2, type OutcomeV2 } from './outcome-spec';
import { requestedPhoto } from './state-target';
import { requestedRecord } from './record-forms';
import { commandMask, understandOutcomes } from './outcome-spec';
import { proposeIntentOutcomes, intentCapabilities } from './intent-capabilities';
import { isClarifiedTemporal } from './temporal-clarification';

export type PermissionVerdict = 'ALLOW' | 'ASK' | 'DENY';
export type PermissionReason = 'SOURCE_SAFE' | 'HARD_BLOCKED' | 'FOREIGN_SCOPE' | 'AMBIGUOUS' | 'INTERPRETATION_REVIEW' | 'SOURCE_EXACT_AUTO_REVIEW' | 'EFFECT_CONFIRMATION' | 'OWNER_LOCAL_EFFECT' | 'JOURNALED_LOCAL_EFFECT' | 'JOURNAL_REQUIRED' | 'LEGACY_POLICY';
export interface PermissionInput {
  source: string; stage: 'REQUEST' | 'INTERPRETATION' | 'EFFECT' | 'LEGACY';
  deviceId?: string; physicalId?: string; executionId?: string; owner?: OwnerTestExecution;
  outcome?: OutcomeV2; plan?: OutcomeSpecV2; journal?: object;
  legacy?: 'ALLOW' | 'CONFIRM' | 'BLOCK';
}
const journalAuthorizations = new WeakMap<object, { owner: OwnerTestExecution; source: string; outcome: string }>();
const localKind = (o: OutcomeV2) => !o.negated && !o.ambiguity.length &&
  (requestedPhoto(o) || Boolean(requestedRecord(o) && o.kind === 'CREATE_RECORD') || o.kind === 'CALCULATE' || Boolean(['ALARM', 'TIMER'].includes(o.kind) && o.temporal));
export function issueJournalAuthorization(owner: OwnerTestExecution, source: string, outcome: OutcomeV2): object {
  assertOwnerTestExecution(owner, owner.deviceId, owner.physicalId, owner.executionId);
  const exact = understandOutcomes(source).outcomes.some(o => JSON.stringify({ ...o, id: '' }) === JSON.stringify({ ...outcome, id: '' })) || isClarifiedTemporal(source, outcome, owner.executionId);
  if (!owner.fullControl || !exact || !localKind(outcome) || forbiddenSource(source) || fullControlHardBlock(source) || source.slice(outcome.span.start, outcome.span.end) !== outcome.span.text) throw Error('HARD_DENY: unproven journal source/effect.');
  const authorization = Object.freeze({}); journalAuthorizations.set(authorization, { owner, source, outcome: JSON.stringify(outcome) }); return authorization;
}
export function decidePermission(input: PermissionInput): { decision: PermissionVerdict; reason: PermissionReason } {
  const reply = (decision: PermissionVerdict, reason: PermissionReason) => ({ decision, reason });
  if (!input.source.trim() || forbiddenSource(input.source) || fullControlHardBlock(input.source)) return reply('DENY', 'HARD_BLOCKED');
  if (input.owner) {
    try { assertOwnerTestExecution(input.owner, input.deviceId ?? '', input.physicalId ?? '', input.executionId ?? ''); }
    catch { return reply('DENY', 'FOREIGN_SCOPE'); }
  }
  if (input.stage === 'REQUEST') return reply('ALLOW', 'SOURCE_SAFE');
  if (input.stage === 'LEGACY') return reply(input.legacy === 'ALLOW' ? 'ALLOW' : input.legacy === 'CONFIRM' ? 'ASK' : 'DENY', 'LEGACY_POLICY');
  if (input.stage === 'INTERPRETATION') {
    const plan = input.plan;
    if (!plan || plan.request !== input.source) return reply('ASK', 'INTERPRETATION_REVIEW');
    const intents = proposeIntentOutcomes(input.source);
    const exactIntents = intents && JSON.stringify(intents) === JSON.stringify(plan) && intents.outcomes.every(o => o.intent && intentCapabilities[o.intent.request.name].implemented);
    try { if (!exactIntents) validateOutcomeSpans(plan); } catch { return reply('DENY', 'AMBIGUOUS'); }
    const parsed = understandOutcomes(input.source);
    const exact = plan.outcomes.length === parsed.outcomes.length && plan.outcomes.every((o, i) => !o.negated && !o.ambiguity.length &&
      (['LAUNCH', 'NAVIGATE', 'SEARCH'].includes(o.kind) || localKind(o)) &&
      JSON.stringify({ ...o, id: '' }) === JSON.stringify({ ...parsed.outcomes[i], id: '' }));
    return input.owner?.fullControl?.autoReview && (exact || exactIntents) ? reply('ALLOW', 'SOURCE_EXACT_AUTO_REVIEW') : reply('ASK', 'INTERPRETATION_REVIEW');
  }
  const outcome = input.outcome;
  if (!outcome || outcome.negated || outcome.ambiguity.length) return reply('ASK', 'AMBIGUOUS');
  if (input.owner?.fullControl) {
    const contract = input.journal && journalAuthorizations.get(input.journal);
    return contract && contract.owner === input.owner && contract.source === input.source && contract.outcome === JSON.stringify(outcome)
      ? reply('ALLOW', 'JOURNALED_LOCAL_EFFECT') : reply('DENY', 'JOURNAL_REQUIRED');
  }
  if (input.owner && ['CAPTURE_MEDIA', 'CREATE_RECORD', 'SET_STRUCTURED_STATE', 'SET_STATE', 'CALCULATE', 'ALARM', 'TIMER'].includes(outcome.kind) &&
    !/\b(send|share|post|publish|payment|purchase|gui|chia se|dang bai|thanh toan|mua hang)\b/.test(commandMask(input.source))) return reply('ALLOW', 'OWNER_LOCAL_EFFECT');
  return reply('ASK', 'EFFECT_CONFIRMATION');
}
