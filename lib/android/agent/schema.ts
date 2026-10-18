import { z } from 'zod';
import { ActionSchema } from '../../validators/action-plan.schema';
import { CandidateGroundingSchema } from './action-candidates';

export const GoalSpecSchema = z.object({
  app: z.string().trim().min(1).max(150),
  operation: z.enum(['OPEN_APP', 'FIND_ELEMENT', 'FIND_PLACE', 'SEARCH', 'OPEN_RESULT', 'OPEN_PAGE']),
  query: z.string().trim().min(1).max(300).optional(),
  targetText: z.string().trim().min(1).max(150).optional(),
  resultType: z.enum(['video', 'browser']).optional(),
  ordinal: z.number().int().min(1).max(99).optional(),
  isSensitive: z.boolean(),
}).strict();
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export const CriterionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FOREGROUND'), packageName: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('SEARCH_RESULTS'), query: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('TARGET_VISIBLE'), target: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('READ_LOCATION'), target: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('NATIVE_PAGE'), target: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('DESTINATION'), resultType: z.enum(['video', 'browser']), ordinal: z.number().int().min(1).max(99), target: z.string().min(1) }).strict(),
]);
export type Criterion = z.infer<typeof CriterionSchema>;
export const AgentLimitsSchema = z.object({
  timeMs: z.number().int().min(1000).max(300000).default(240000),
  steps: z.number().int().min(1).max(20).default(18),
  snapshots: z.number().int().min(1).max(200).default(120),
  scrolls: z.number().int().min(0).max(30).default(24),
  reasoning: z.number().int().min(0).max(8).default(4),
  retries: z.number().int().min(0).max(3).default(2),
  replans: z.number().int().min(0).max(4).default(2),
  iterations: z.number().int().min(1).max(80).default(40),
  recoveryDepth: z.number().int().min(1).max(2).default(2),
  recoverySubtasks: z.number().int().min(0).max(3).default(3),
  recoveryAttempts: z.number().int().min(1).max(3).default(2),
  recoveryTimeMs: z.number().int().min(500).max(30000).default(15000),
}).strict();
export type AgentLimits = z.infer<typeof AgentLimitsSchema>;
export const GoalSchema = z.object({
  id: z.string().uuid(), originalRequest: z.string().min(1).max(2000), description: z.string().min(1).max(2000),
  spec: GoalSpecSchema, packageName: z.string().min(1),
  subgoals: z.array(z.object({ id: z.string(), description: z.string(), criterion: CriterionSchema,
    status: z.enum(['PENDING', 'VERIFIED']) }).strict()).min(1).max(8),
  currentSubgoal: z.number().int().min(0).max(8), limits: AgentLimitsSchema,
  allowedActionScope: z.array(z.string()).max(8), safetyRequirements: z.array(z.string()).min(1),
}).strict();
export type AgentGoal = z.infer<typeof GoalSchema>;
const reason = z.string().trim().min(1).max(180);
const strictActions = ActionSchema.options.map(option => option.strict());
const AgentActionSchema = z.union(strictActions as [typeof strictActions[number], typeof strictActions[number], ...typeof strictActions[number][]]);
export const DecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('OBSERVE_AGAIN'), reason }).strict(),
  z.object({ type: z.literal('EXECUTE_ACTION'), action: AgentActionSchema, reason, grounding: CandidateGroundingSchema.optional() }).strict(),
  z.object({ type: z.literal('EXPLORE_UI'), target: z.string().min(1).max(150), reason }).strict(),
  z.object({ type: z.literal('WAIT_FOR_CONDITION'), target: z.string().min(1).max(150), reason }).strict(),
  z.object({ type: z.literal('REPLAN_SUBGOAL'), subgoalId: z.string().min(1), reason }).strict(),
  z.object({ type: z.literal('REQUEST_HUMAN_ASSISTANCE'), category: z.enum(['INTERACTION_POSITION', 'SENSITIVE_ACTION', 'UNKNOWN_UI']), reason }).strict(),
  z.object({ type: z.literal('COMPLETE_SUBGOAL'), reason }).strict(),
  z.object({ type: z.literal('COMPLETE_GOAL'), reason }).strict(),
  z.object({ type: z.literal('FAIL_GOAL'), reason }).strict(),
]);
export type AgentDecision = z.infer<typeof DecisionSchema>;
export type AgentStatus = 'PLANNING' | 'OBSERVING' | 'DECIDING' | 'EXECUTING' | 'EXPLORING' | 'VERIFYING' | 'NEED_HUMAN_ASSISTANCE' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
export interface AgentProgress {
  type: 'progress' | 'complete'; status: AgentStatus; goalId?: string; description?: string;
  subgoal?: string; subgoalId?: string; verifiedSubgoals?: number; totalSubgoals?: number; action?: z.infer<typeof ActionSchema>; reason: string;
  screen?: string; foregroundPackage?: string; counters?: Record<string, number>; timings?: Record<string, number>;
  reasoningMeasurements?: import('./budget').ReasoningMeasurement[];
  snapshotSources?: Record<string, number>;
  webVerification?: import('./budget').AgentBudget['webVerification'];
  assistance?: { category: 'INTERACTION_POSITION' | 'SENSITIVE_ACTION' | 'UNKNOWN_UI'; resumable: boolean; sessionRetained: boolean; expiresAt: number; evidenceId?: string; token?: string };
  resultEvidence?: { label: string; value: string; packageName: string; snapshotId: string; basis?: { used: string; total: string; derived: true } };
  destinationEvidence?: { title: string; ordinal: number; url?: string; snapshotId: string };
  cancellationToken?: string;
  failure?: { code: string; message: string };
  visual?: import('../visual-grounding').VisualSummary;
  recovery?: import('./recovery').RecoveryProgress;
  currentScreen?: import('./navigation-semantics').CurrentScreenState;
  navigation?: {
    required: import('./navigation-semantics').RequiredCapability; phase: 'NAVIGATING' | 'READY' | 'MAIN_GOAL' | 'BLOCKED';
    candidates: { id: string; action: string; outcome: string }[]; lastAction?: string; verification?: string;
    actionCount: number; recognitionMs: number; navigationMs: number;
  };
}
