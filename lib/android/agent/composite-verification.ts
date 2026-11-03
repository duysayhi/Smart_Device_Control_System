import type { Observation } from '../state-observer';
import type { EvidencePredicateV2, VerifiedEvidence } from './evidence-predicates';
import { verifyPredicate, type VerificationContext } from './verification-registry';

export interface VerificationContract {
  all: readonly EvidencePredicateV2[];
  purpose: 'OUTCOME' | 'TRANSITION';
}
export function verifyAll(contract: VerificationContract, snapshot: Observation, context: VerificationContext): {
  status: 'VERIFIED' | 'SAFE_BLOCKED'; evidence: VerifiedEvidence[]; missing: string[];
} {
  // A changed screen or foreground app is not proof of a new content/write outcome.
  if (!contract.all.length || contract.all.length > 8 || contract.purpose === 'OUTCOME' && contract.all.some(p => p.kind === 'STATE_CHANGED') && contract.all.every(p => ['STATE_CHANGED', 'FOREGROUND_IS'].includes(p.kind)))
    return { status: 'SAFE_BLOCKED', evidence: [], missing: ['INSUFFICIENT_COMPLETION_CONTRACT'] };
  if (contract.purpose === 'OUTCOME' && contract.all.some(p => p.kind === 'EXPLICIT_EMPTY_RESULT' || p.kind === 'LIST_NONEMPTY_CORRELATED_WITH_VALUE') &&
    !contract.all.some(p => p.kind === 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED')) return { status: 'SAFE_BLOCKED', evidence: [], missing: ['QUERY_COMMIT_CONTRACT_REQUIRED'] };
  const evidence: VerifiedEvidence[] = [], missing: string[] = [];
  for (const predicate of contract.all) {
    const result = verifyPredicate(predicate, snapshot, context);
    if (result.evidence) evidence.push(result.evidence); else missing.push(`${predicate.kind}:${result.reason}`);
  }
  return { status: missing.length ? 'SAFE_BLOCKED' : 'VERIFIED', evidence: missing.length ? [] : evidence, missing };
}
