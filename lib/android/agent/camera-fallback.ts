import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import type { EffectGrant } from './effect-grants';
import { isIssuedEffectGrant } from './effect-grants';
import { GroundedInteractionFailure, consumeNotSentReceipt } from '../grounded-interactions';
import type { MediaInventory } from './media-evidence';
import { isIssuedMediaInventory } from './media-evidence';
import { assertOwnerTestExecution, type OwnerTestExecution } from './owner-test-policy';

export interface CameraFallbackPermit { readonly deviceId: string; readonly executionId: string }
const permits = new WeakMap<CameraFallbackPermit, { candidate: GroundedCandidateV2; owner: OwnerTestExecution; before: MediaInventory; expiresAt: number }>();
const keys = new WeakSet<EffectGrant>();
export function issueCameraFallback(error: GroundedInteractionFailure, candidate: GroundedCandidateV2, owner: OwnerTestExecution, before: MediaInventory): CameraFallbackPermit {
  assertOwnerTestExecution(owner, candidate.deviceId, owner.physicalId, candidate.executionId);
  if (!owner.fullControl || !candidate.capture || !isIssuedMediaInventory(before) || before.deviceId !== owner.deviceId || before.physicalId !== owner.physicalId ||
    !consumeNotSentReceipt(error, candidate)) throw Error('HARD_DENY: camera fallback requires an authentic NOT_SENT receipt and issued pre-state.');
  const permit = Object.freeze({ deviceId: candidate.deviceId, executionId: candidate.executionId });
  permits.set(permit, { candidate, owner, before, expiresAt: Date.now() + 5000 }); return permit;
}
export function consumeCameraFallback(permit: CameraFallbackPermit, grant: EffectGrant): MediaInventory {
  const state = permits.get(permit); permits.delete(permit);
  if (!state || state.expiresAt <= Date.now() || !isIssuedEffectGrant(grant) || !grant.candidate.capture || grant.nodeId !== state.candidate.nodeId || grant.sessionId !== state.candidate.sessionId ||
    grant.deviceId !== state.owner.deviceId || grant.executionId !== state.owner.executionId || grant.packageName !== state.candidate.target.packageName) throw Error('HARD_DENY: stale, foreign or replayed camera-key permit.');
  assertOwnerTestExecution(state.owner, grant.deviceId, state.owner.physicalId, grant.executionId);
  return state.before;
}
export function armCameraKey(grant: EffectGrant) { keys.add(grant); }
export function consumeCameraKey(grant: EffectGrant) { const valid = keys.has(grant); keys.delete(grant); return valid; }
