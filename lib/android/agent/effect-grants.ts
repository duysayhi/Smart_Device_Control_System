import { randomUUID } from 'node:crypto';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import { isGroundedCandidate } from './grounded-candidates-v2';
import type { GoalNodeV2 } from './goal-graph';
import { capabilityFor } from './capability-registry';
import { arithmeticOracle } from './goal-compiler';
import { normalizeMathDisplay, mathControlValue } from './math-keypad';
import { requestedToggle, requestedPhoto } from './state-target';
import { requestedRecord, recordFieldRole } from './record-forms';
import { assertOwnerTestExecution, ownerEffectAllowed, ownerCandidateNonDestructive, type OwnerTestExecution } from './owner-test-policy';
import { destructiveAffordance } from './ui-affordances';
import { searchCandidateAllowed } from './generic-search';
import { fullControlHardBlock } from './full-control-policy';
import { assertLocalEffectTicket, type LocalEffectTicket } from './local-effect-journal';
import type { LocalEffectJournal } from './local-effect-journal';
import { decidePermission } from './permission-decision';
import { understandOutcomes } from './outcome-spec';
import { TemporalRequestSchema, type TemporalRequest } from './temporal-contract';
import { isClarifiedTemporal } from './temporal-clarification';
import { temporalUiCandidateAllowed } from './temporal-ui';

export interface EffectGrant {
  id: string; deviceId: string; executionId: string; nodeId: string; sessionId: string; packageName: string;
  candidate: GroundedCandidateV2; expiresAt: number;
  ownerAuthorizationId?: string;
}
const grants = new WeakSet<EffectGrant>();
const issuedGrants = new WeakSet<EffectGrant>();
export const isIssuedEffectGrant = (grant: EffectGrant) => issuedGrants.has(grant) && Object.isFrozen(grant) && isGroundedCandidate(grant.candidate);
export class EffectGrantExpired extends Error { constructor() { super('Effect grant expired.'); } }
const owners = new WeakMap<EffectGrant, OwnerTestExecution>();
const localTickets = new WeakMap<EffectGrant, LocalEffectTicket>();
export const effectJournalTicket = (grant: EffectGrant) => localTickets.get(grant);
export function assertEffectGrantAuthorization(grant: EffectGrant) {
  const owner = owners.get(grant);
  if (owner) assertOwnerTestExecution(owner, grant.deviceId, owner.physicalId, grant.executionId);
  if (grant.expiresAt <= Date.now()) throw new EffectGrantExpired();
}
export function issueEffectGrant(candidate: GroundedCandidateV2, node: GoalNodeV2, owner?: OwnerTestExecution, ticket?: LocalEffectTicket): EffectGrant {
  if (ticket && !owner?.fullControl) throw Error('HARD_DENY: local journal tickets require full-control scope.');
  const authorizedSearch = node.capability === 'SEARCH' && candidate.effect === 'READ' && searchCandidateAllowed(candidate, node);
  if (node.capability === 'SEARCH' && !authorizedSearch) throw Error('Search action/query has no issued scope.');
  if (owner) {
    assertOwnerTestExecution(owner, candidate.deviceId, owner.physicalId, candidate.executionId);
    if (owner.fullControl && fullControlHardBlock(node.outcome.span.text)) throw Error('HARD_BLOCKED: excluded effect cannot obtain a UI grant.');
    if (owner.fullControl && candidate.effect === 'LOCAL_WRITE') {
      if (!ticket) throw Error('SAFE_BLOCKED: full-control writes require a journaled pre/post-state contract.');
      assertLocalEffectTicket(ticket, owner, candidate);
    }
    if (!ownerCandidateNonDestructive(candidate)) throw Error('Unknown owner-test command is not proven non-destructive.');
    if (candidate.effect === 'LOCAL_WRITE' && !owner.fullControl && !ownerEffectAllowed(owner, node.outcome, candidate.deviceId, owner.physicalId, candidate.executionId)) throw Error('Owner test mode does not authorize this effect.');
    const queryData = authorizedSearch && candidate.target.label === candidate.target.text && (candidate.target.roles.includes('editable') || /(?:^|[_-])search[_-](?:query|box|bar|text)(?:$|[_-])/.test(candidate.target.resourceId.split('/').at(-1) ?? ''));
    if (destructiveAffordance([queryData ? '' : candidate.target.label, candidate.target.hint, candidate.target.resourceId].join(' '))) throw Error('Destructive owner test candidate denied.');
  }
  if (!isGroundedCandidate(candidate) || !capabilityFor(node.outcome).executable || !node.predicates.length || node.outcome.negated || candidate.nodeId !== node.id ||
    candidate.target.sensitive || candidate.target.destructive || candidate.target.packageName !== node.packageName) throw new Error('Effect is not authorized by a verifiable requested outcome.');
  if (candidate.effect === 'LOCAL_WRITE') {
    const toggle = requestedToggle(node.outcome);
    const authorizedToggle = toggle && candidate.action === 'CLICK' && candidate.desired === toggle.checked && candidate.target.roles.includes('checkable') && candidate.target.checked !== toggle.checked;
    let authorizedCalculation = false;
    if (node.capability === 'CALCULATE') {
      const expression = arithmeticOracle(node.outcome.value).expression;
      authorizedCalculation = candidate.action === 'SET_VALUE' ? candidate.value === expression : candidate.action === 'CLICK' &&
        (candidate.keypad ? normalizeMathDisplay(expression).startsWith(candidate.keypad.after) && candidate.keypad.after.endsWith(candidate.keypad.key) && normalizeMathDisplay(mathControlValue(candidate.target)) === candidate.keypad.key : mathControlValue(candidate.target) === '=');
    }
    const authorizedCapture = requestedPhoto(node.outcome) && candidate.capture === true && candidate.action === 'CLICK' && candidate.target.roles.includes('capture');
    const record = requestedRecord(node.outcome), step = candidate.record;
    const authorizedRecord = record && step && (step.phase === 'FIELD' ? step.field && recordFieldRole(candidate.target) === step.field && Boolean(step.identity) &&
      (typeof record[step.field] === 'boolean' ? candidate.action === 'CLICK' && candidate.target.roles.includes('checkable') && candidate.desired === record[step.field] && candidate.target.checked !== candidate.desired : candidate.action === 'SET_VALUE' && candidate.value === record[step.field]) :
      candidate.action === 'CLICK' && (step.phase === 'SAVE' ? candidate.target.roles.includes('save') && Boolean(step.identity) : ['CREATE', 'REOPEN'].includes(step.phase)));
    if (!authorizedToggle && !authorizedCalculation && !authorizedCapture && !authorizedRecord && !temporalUiCandidateAllowed(candidate, node)) throw new Error('Effect/value exceeds the requested local operation.');
  } else if (!authorizedSearch && node.capability !== 'NAVIGATE' && candidate.action !== 'BACK') throw new Error('Read candidate outside navigation scope.');
  const grant = Object.freeze({ id: randomUUID(), deviceId: candidate.deviceId, executionId: candidate.executionId, nodeId: node.id, sessionId: candidate.sessionId,
    packageName: node.packageName!, candidate, expiresAt: Date.now() + 5000, ...(owner ? { ownerAuthorizationId: owner.id } : {}) });
  if (owner) owners.set(grant, owner);
  if (ticket) localTickets.set(grant, ticket);
  grants.add(grant); issuedGrants.add(grant); return grant;
}
export function consumeEffectGrant(grant: EffectGrant, serial: string, sessionId: string): void {
  assertEffectGrantAuthorization(grant);
  if (!grants.has(grant) || !isGroundedCandidate(grant.candidate) || grant.deviceId !== serial || grant.sessionId !== sessionId || grant.expiresAt <= Date.now()) throw new Error('Grant is revoked, expired, replayed or bound to another Session/device.');
  grants.delete(grant);
}
export function revokeEffectGrant(grant: EffectGrant) { grants.delete(grant); }

export interface TemporalEffectGrant { readonly deviceId: string; readonly executionId: string; readonly nodeId: string; readonly sessionId: string; readonly packageName: string; readonly physicalId: string; readonly request: TemporalRequest; readonly expiresAt: number; readonly source: string }
const temporalGrants = new WeakMap<TemporalEffectGrant, { owner?: OwnerTestExecution; journal?: LocalEffectJournal }>();
const temporalAttempts = new Map<string, number>();
export function issueTemporalEffectGrant(source: string, node: GoalNodeV2, deviceId: string, physicalId: string, executionId: string, sessionId: string, owner?: OwnerTestExecution, journal?: LocalEffectJournal): TemporalEffectGrant {
  const request = TemporalRequestSchema.parse(node.outcome.temporal);
  const exact = understandOutcomes(source).outcomes.some(o => JSON.stringify(o) === JSON.stringify(node.outcome)) || isClarifiedTemporal(source, node.outcome, executionId);
  const permission = decidePermission({ source, stage: 'EFFECT', outcome: node.outcome, owner, deviceId, physicalId, executionId, journal: journal?.authorization });
  if (!exact || node.outcome.negated || node.outcome.ambiguity.length || !node.packageName || !sessionId || permission.decision === 'DENY' || owner?.fullControl && (!journal || journal.owner !== owner || journal.node !== node)) throw Error('HARD_DENY: unbound temporal source, scope or journal.');
  const grant = Object.freeze({ source, deviceId, physicalId, executionId, nodeId: node.id, sessionId, packageName: node.packageName, request: Object.freeze(request), expiresAt: Date.now() + 5000 });
  temporalGrants.set(grant, { owner, journal }); return grant;
}
export function checkTemporalEffectGrant(grant: TemporalEffectGrant, serial: string, sessionId: string) {
  const state = temporalGrants.get(grant);
  if (!state || grant.deviceId !== serial || grant.sessionId !== sessionId || Date.now() >= grant.expiresAt) throw Error('HARD_DENY: temporal grant foreign, expired or consumed.');
  if (state.owner) assertOwnerTestExecution(state.owner, serial, grant.physicalId, grant.executionId);
  state.journal?.validate(); return state;
}
export function consumeTemporalEffectGrant(grant: TemporalEffectGrant, serial: string, sessionId: string) {
  const state = checkTemporalEffectGrant(grant, serial, sessionId), key = JSON.stringify([grant.physicalId, grant.executionId, grant.nodeId]);
  for (const [old, expires] of temporalAttempts) if (expires < Date.now()) temporalAttempts.delete(old);
  if (temporalAttempts.has(key) || temporalAttempts.size >= 4096) throw Error('HARD_DENY: temporal duplicate dispatch or attempt ledger full.');
  temporalAttempts.set(key, Date.now() + 86400000); temporalGrants.delete(grant); return state;
}
