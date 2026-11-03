import { proposePrimitiveDecomposition, type PrimitiveProposal } from './primitive-decomposition';
import type { PlanningApp } from './source-slots';
import type { JsonReasoner } from './ollama';
import type { AgentBudget } from './budget';
import { assertSafeSource } from '../safety-envelope';
import { commandMask, foldIntent, type OutcomeSpecV2 } from './outcome-spec';
import { enterSearchBoundary, politeWords } from './natural-phrasing';

export function needsPhrasingReview(request: string, original: OutcomeSpecV2): boolean {
  const first = original.outcomes[0], second = original.outcomes[1];
  const gap = second ? commandMask(request).slice(first.span.end, second.span.start).trim() : undefined;
  return Boolean(enterSearchBoundary(commandMask(request))) && gap !== undefined && ['', 'de', 'to'].includes(gap) ||
    original.outcomes.some(o => new RegExp('^(?:' + politeWords + ')\\s+').test(foldIntent(o.span.text)));
}

export async function proposeReviewedPhrasing(request: string, apps: readonly PlanningApp[], reasoner: JsonReasoner, budget: AgentBudget, signal?: AbortSignal, forceModel = false): Promise<PrimitiveProposal> {
  assertSafeSource(request);
  const proposal = await proposePrimitiveDecomposition(request, reasoner, budget, signal, { apps, forceModel });
  for (const outcome of proposal.spec.outcomes) {
    if (outcome.negated) throw Error('NEEDS_CLARIFICATION: negated outcomes cannot authorize an action.');
    if (!outcome.app) continue;
    const name = foldIntent(outcome.app).trim();
    const matching = new Set(apps.filter(a => [a.packageName, a.label].some(label => label && foldIntent(label).trim() === name)).map(a => a.packageName));
    if (matching.size !== 1) throw Error('NEEDS_CLARIFICATION: installed display label/package is unknown or ambiguous.');
  }
  return proposal;
}
