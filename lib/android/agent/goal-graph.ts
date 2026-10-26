import { z } from 'zod';
import { OutcomeSpecV2Schema, OutcomeV2Schema, OutcomeKind, type OutcomeSpecV2, type OutcomeV2 } from './outcome-spec';

export const GoalGraphV2Schema = z.object({
  primitiveBindings: z.array(z.object({ nodeId: z.string(), primitive: z.enum(['OPEN_APP', 'NAVIGATE_TO', 'SEARCH', 'SET_VALUE', 'TOGGLE', 'SELECT_ITEM', 'READ_VALUE', 'CREATE_RECORD', 'CONFIRM']),
    source: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict(), state: z.enum(['BOUND', 'DISCOVERY_REQUIRED']), missing: z.array(z.string()) }).strict()).max(12).optional(),
  version: z.literal(2), id: z.string().min(1), deviceId: z.string().min(1), executionId: z.string().min(1), original: OutcomeSpecV2Schema,
  coverage: z.enum(['COMPLETE', 'UNSUPPORTED_OUTCOME', 'NEEDS_CLARIFICATION']),
  nodes: z.array(z.object({ id: z.string().min(1), outcome: OutcomeV2Schema, dependencies: z.array(z.string()).max(16),
    app: z.string().optional(), packageName: z.string().optional(), capability: OutcomeKind,
    preconditions: z.array(z.string()).max(8), predicates: z.array(z.enum(['FOREGROUND_IS', 'ELEMENT_VISIBLE', 'TEXT_EQUALS', 'VALUE_EQUALS', 'ITEM_SELECTED', 'RECORD_READBACK_MATCHES', 'TEMPORAL_READBACK_MATCHES', 'ARTIFACT_EXISTS', 'ARTIFACT_IDENTITY_MATCHES', 'SEARCH_OUTCOME_MATCHES', 'BROWSER_RESULT_MATCHES', 'INTENT_OUTCOME_VERIFIED'])).max(8),
    inputs: z.array(z.string()).max(16), outputs: z.array(z.string()).max(16), status: z.enum(['PENDING', 'RUNNING', 'VERIFIED', 'SAFE_BLOCKED']), reason: z.string().optional(), evidenceIds: z.array(z.string()).max(16),
  }).strict()).min(1).max(16),
}).strict().superRefine((graph, ctx) => {
  const ids = new Set(graph.nodes.map(node => node.id));
  if (graph.primitiveBindings && (graph.primitiveBindings.length !== graph.nodes.length || graph.primitiveBindings.some((binding, i) =>
    binding.nodeId !== graph.nodes[i].id || binding.source.start !== graph.nodes[i].outcome.span.start || binding.source.end !== graph.nodes[i].outcome.span.end ||
    binding.state === 'DISCOVERY_REQUIRED' && !binding.missing.length))) ctx.addIssue({ code: 'custom', message: 'Primitive binding must preserve its source parent and missing contracts.' });
  if (ids.size !== graph.nodes.length || graph.original.outcomes.length !== graph.nodes.length || graph.nodes.some((node, i) => node.id !== graph.original.outcomes[i].id || JSON.stringify(node.outcome) !== JSON.stringify(graph.original.outcomes[i]) || node.capability !== node.outcome.kind)) ctx.addIssue({ code: 'custom', message: 'Graph must preserve every original outcome exactly.' });
  const reached = new Set<string>();
  for (const node of graph.nodes) {
    if (node.dependencies.some(id => !ids.has(id) || !reached.has(id)) || node.status === 'VERIFIED' && !node.evidenceIds.length) ctx.addIssue({ code: 'custom', message: 'Unverified graph state, cyclic or non-topological dependency.' });
    reached.add(node.id);
  }
});

export type V2NodeStatus = 'PENDING' | 'RUNNING' | 'VERIFIED' | 'SAFE_BLOCKED';
export interface GoalNodeV2 {
  id: string; outcome: OutcomeV2; dependencies: string[]; app?: string; packageName?: string;
  capability: OutcomeV2['kind']; preconditions: string[]; predicates: string[]; inputs: string[]; outputs: string[];
  status: V2NodeStatus; reason?: string; evidenceIds: string[];
}
export interface GoalGraphV2 {
  primitiveBindings?: z.infer<typeof GoalGraphV2Schema>['primitiveBindings'];
  version: 2; id: string; deviceId: string; executionId: string; original: OutcomeSpecV2;
  nodes: GoalNodeV2[]; coverage: 'COMPLETE' | 'UNSUPPORTED_OUTCOME' | 'NEEDS_CLARIFICATION';
}
export interface V2Assistance {
  token: string; category: 'APP_SELECTION' | 'TARGET_SELECTION' | 'PERMISSION' | 'EFFECT_CONFIRMATION' | 'GOAL_INTERPRETATION' | 'FIELD_AMBIGUITY' | 'SAVE_RESULT_AMBIGUITY' | 'ARTIFACT_IDENTITY_AMBIGUITY' | 'UNCERTAIN_WIDGET' | 'DEVICE_UNLOCK' | 'USER_ACTION';
  expiresAt: number; choices: { id: string; label: string }[]; reason: string; sessionRetained: boolean;
}
export interface V2Progress {
  browserResult?: { query: string; ordinal: 1; surface: 'BROWSER_ORGANIC'; url: string; title: string; searchEvidenceId: string; evidenceId: string };
  temporal?: { kind: 'ALARM' | 'TIMER'; identity: string; evidenceId: string; zone: string; request: import('./temporal-contract').TemporalRequest;
    tier?: 'PROVIDER_READBACK' | 'UI_LIST_READBACK' | 'UI_RUNNING_READBACK'; label?: string;
    beforeRows?: import('./temporal-ui').AlarmUiRow[]; afterRows?: import('./temporal-ui').AlarmUiRow[]; remaining?: number[];
    systemCorroboration?: { tier: 'SYSTEM_STATE_READBACK'; time: string } };
  localEffects?: import('./local-effect-journal').LocalEffectRecord[];
  reflections?: { nodeId: string; classification: 'HARD_DENY' | 'SOFT_RETRYABLE_NOT_SENT' | 'UNKNOWN_EFFECT'; code: string; dispatch: 'NOT_SENT' | 'UNKNOWN' | 'ACKNOWLEDGED'; retry: number }[];
  mutations?: Awaited<ReturnType<import('./setting-mutations').SettingMutationController['settle']>>;
  intent?: { name: string; evidenceId: string; evidenceClass: string; value?: string; component?: string };
  discovery?: import('./open-world-plan').DiscoveryPlan;
  uiUnderstanding?: { snapshotId: string; state: string; widgets: number; groups: number; unknown: number };
  sessionId?: string;
  search?: { phase: string; query: string; status?: 'RESULTS' | 'NO_RESULTS'; count?: number;
    userAction?: import('./search-user-action').SearchUserAction;
    submission?: 'EXPLICIT_RPC' | 'LIVE_TRANSITION';
    state?: 'SEARCH_UI_OPENED' | 'QUERY_ENTERED' | 'QUERY_SUBMITTED' | 'RESULTS_OBSERVED' | 'NO_RESULTS_OBSERVED' | 'SEARCH_COMPLETED';
    diagnostic?: { code: string; dispatchState: 'NOT_SENT' | 'UNKNOWN' | 'ACKNOWLEDGED'; cause: string } };
    analysis?: { syntax: 'SYNTACTICALLY_VALID'; semantics: 'SEMANTICALLY_FAITHFUL' | 'UNRESOLVED'; execution: 'EXECUTABLE' | 'EXECUTION_UNSUPPORTED'; source: 'RULES' | 'MODEL_PROPOSED' | 'MODEL_REVIEWED' | 'MODEL_SOURCE_EXACT' | 'INTENT_REVIEWED' };
  ownerAuthorizationId?: string;
  version: 2; graph: GoalGraphV2; currentNode?: string; capability?: string;
  result?: 'AUTO_COMPLETED' | 'ASSISTED_COMPLETED' | 'SAFE_BLOCKED' | 'CANCELLED' | 'FAILED';
  coverage?: { observed: number; eligible: number; offered: number; page: number };
  assistance?: V2Assistance; artifactIds?: string[]; decision?: string;
  availableAffordances?: string[]; navigationTransitions?: number;
  interaction?: { candidateId: string; snapshotId: string; action: string; targetRef: string };
  artifacts?: { id: string; kind: string; provider: string; evidenceId: string; mediaUri?: string; mimeType?: string; size?: number; recordIdentity?: string; recordFields?: string[]; persistenceStrategy?: string }[];
  artifactResolution?: 'EXACT_URI_VIEW';
  completion?: 'NONE' | 'PARTIAL' | 'ALL_VERIFIED';
}

export function readyNode(graph: GoalGraphV2): GoalNodeV2 | undefined {
  return graph.nodes.find(node => node.status === 'PENDING' && node.dependencies.every(id => graph.nodes.find(row => row.id === id)?.status === 'VERIFIED'));
}
export function allOutcomesVerified(graph: GoalGraphV2): boolean {
  return graph.coverage === 'COMPLETE' && graph.nodes.length > 0 && graph.nodes.every(node => node.status === 'VERIFIED' && node.evidenceIds.length > 0);
}
