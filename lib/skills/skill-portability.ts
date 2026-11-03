import type { SkillStep, TargetDescriptor } from './skill-schema';
import type { ReplayObservation } from './replay-contracts';
import { semanticTargetMatches } from './skill-program';

export const SKILL_PORTABILITY_POLICY_VERSION = 1 as const;
export type PortableMatch = 'EXACT' | 'SEARCH_LABEL_EQUIVALENT';
const searchLabels = new Set(['search', 'tìm kiếm', 'tim kiem']);
const label = (value: unknown) => typeof value === 'string' ? value.normalize('NFC').trim().toLocaleLowerCase('en-US') : '';
/** Equivalence is deliberately limited to observed search roles, never arbitrary text or resource IDs. */
export function portableTargetMatch(expected: TargetDescriptor, actual: TargetDescriptor): PortableMatch | undefined {
  if (semanticTargetMatches(expected, actual)) return 'EXACT';
  if (expected.semanticRole !== actual.semanticRole || expected.containerRole !== actual.containerRole ||
    !['search_action', 'search_field'].includes(expected.semanticRole)) return;
  if (searchLabels.has(label(expected.label)) && searchLabels.has(label(actual.label))) return 'SEARCH_LABEL_EQUIVALENT';
}
export type PortableResolution = { status: 'NOT_REQUIRED' } | { status: 'RESOLVED'; candidateId: string; match: PortableMatch; policyVersion: 1 } |
  { status: 'BLOCKED'; reason: 'SEMANTIC_TARGET_MISSING' | 'SEMANTIC_TARGET_AMBIGUOUS' };
/** Input candidates must already be backend-grounded for the current observation. This issues no authority. */
export function resolvePortableTarget(step: SkillStep, observation: ReplayObservation): PortableResolution {
  if (!('target' in step.arguments) && !['BACK', 'SUBMIT_SEARCH'].includes(step.operation)) return { status: 'NOT_REQUIRED' };
  const matches = observation.candidates.flatMap(candidate => {
    if (candidate.recovery || candidate.operation !== step.operation) return [];
    const match = 'target' in step.arguments ? candidate.target && portableTargetMatch(step.arguments.target, candidate.target) : 'EXACT';
    return match ? [{ candidate, match }] : [];
  });
  if (matches.length !== 1) return { status: 'BLOCKED', reason: matches.length ? 'SEMANTIC_TARGET_AMBIGUOUS' : 'SEMANTIC_TARGET_MISSING' };
  return { status: 'RESOLVED', candidateId: matches[0].candidate.id, match: matches[0].match, policyVersion: SKILL_PORTABILITY_POLICY_VERSION };
}
