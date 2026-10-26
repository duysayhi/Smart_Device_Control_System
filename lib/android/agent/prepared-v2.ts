import { randomUUID } from 'node:crypto';
import { compileOutcomes } from './goal-compiler';
import { proposeIntentOutcomes } from './intent-capabilities';
import { registerReviewedOutcomes } from './outcome-spec';
import { needsPhrasingReview, proposeReviewedPhrasing } from './reviewed-phrasing';
import { proposePrimitiveDecomposition, bindReviewedPrimitives, primitiveCatalog } from './primitive-decomposition';
import { proposeOutcomes, compileReviewedProposal, semanticOptions } from './outcome-proposal';
import { createStructuredReasoner } from './reasoning-provider';
import { bindCommandSource } from './cloud-command';
import type { V2Adapter } from './agent-v2';
import type { AgentBudget } from './budget';
import type { GoalGraphV2 } from './goal-graph';

export interface PreparedV2 { graph: GoalGraphV2; review: boolean; summary: string }

// Preparation uses the existing constrained planners, never a Session or an effect grant.
export async function prepareV2(request: string, deviceId: string, adapter: V2Adapter, budget: AgentBudget, signal: AbortSignal): Promise<PreparedV2> {
  const executionId = randomUUID(), reasoner = bindCommandSource(createStructuredReasoner(), request);
  let graph = compileOutcomes(request, deviceId, executionId), review = false, summary = request;
  const intents = adapter.resolveIntentApp ? proposeIntentOutcomes(request) : undefined;
  if (intents) { registerReviewedOutcomes(intents); graph = compileOutcomes(intents, deviceId, executionId); }
  const natural = needsPhrasingReview(request, graph.original);
  const hasReadState = graph.nodes.some(n => n.outcome.intent?.request.name === 'READ_STATE');
  if (!intents && !hasReadState && (natural && graph.coverage === 'COMPLETE' && !graph.nodes.some(n => n.outcome.temporal) ||
    graph.coverage !== 'COMPLETE' && graph.original.outcomes.some(o => o.kind === 'UNKNOWN') && graph.original.outcomes.every(o => !o.negated))) {
    if (natural || semanticOptions(request).some(rows => rows[0].a === 'unsupported')) {
      const p = adapter.planningApps ? await proposeReviewedPhrasing(request, await adapter.planningApps(signal), reasoner, budget, signal)
        : await proposePrimitiveDecomposition(request, reasoner, budget, signal);
      if (p.steps.some(s => s.negated || !primitiveCatalog[s.primitive].implemented)) throw Error('DISCOVERY_REQUIRED: missing primitive executor or scope.');
      graph = bindReviewedPrimitives(p, deviceId, executionId); summary = p.summary;
    } else {
      const p = await proposeOutcomes(request, reasoner, budget, signal);
      graph = compileReviewedProposal(p, deviceId, executionId); summary = p.summary;
    }
    review = true;
  }
  if (graph.coverage !== 'COMPLETE') throw Error(graph.nodes.filter(n => n.reason).map(n => n.reason).join('; ') || graph.coverage);
  return { graph, review, summary };
}
