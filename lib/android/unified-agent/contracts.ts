import { z } from 'zod';
import type { ExecutionStepResult, ExecutionStreamEvent } from '../../../types/execution';
import type { DeviceTask } from '../agent/runtime-schema';

export const Engine = z.enum(['ACTION_PLAN', 'V1', 'V2']);
export type EngineId = z.infer<typeof Engine>;
export const AssistanceReply = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('V2'), token: z.string().uuid(), approved: z.boolean(), choice: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('V1'), token: z.string().uuid(), evidenceId: z.string().uuid(), x: z.number().finite(), y: z.number().finite(), confirmed: z.literal(true) }).strict(),
]);
export type AssistanceResponse = z.infer<typeof AssistanceReply>;
export const AnalyzeInput = z.object({ source: z.string().trim().min(1).max(2000), deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) }).strict();
export class EngineSelectionRemovedError extends Error {
  readonly code = 'ENGINE_SELECTION_REMOVED';
  constructor() { super('ENGINE_SELECTION_REMOVED: engine selection is removed; execution scope is owned by the backend.'); }
}
export function hasEngineSelection(input: unknown): boolean {
  return Boolean(input && typeof input === 'object' && Object.hasOwn(input, 'debugEngine'));
}
export function parseAnalyzeInput(input: unknown) {
  if (hasEngineSelection(input)) throw new EngineSelectionRemovedError();
  return AnalyzeInput.parse(input);
}
export const ClientRequestId = z.string().uuid().length(36);
export const UnifiedCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ANALYZE'), input: AnalyzeInput }).strict(),
  z.object({ type: z.literal('CLARIFY'), reference: z.string().uuid(), choice: z.enum(['am', 'pm']) }).strict(),
  z.object({ type: z.literal('REANALYZE'), reference: z.string().uuid() }).strict(),
  z.object({ type: z.literal('EXECUTE'), reference: z.string().uuid(), clientRequestId: ClientRequestId }).strict(),
  z.object({ type: z.literal('CONFIRM'), executionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('CANCEL'), executionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('ASSIST'), executionId: z.string().uuid(), reply: AssistanceReply }).strict(),
]);
export const PreparedCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PREPARE'), source: AnalyzeInput.shape.source, deviceId: AnalyzeInput.shape.deviceId, engine: z.enum(['V1', 'V2']) }).strict(),
  z.object({ type: z.literal('START_PREPARED'), reference: z.string().uuid() }).strict(),
]);
export interface PlanView {
  reference: string; source: string; deviceId: string; physicalId: string; engine: 'V2';
  catalog: { capability: string; status: 'ENABLED' | 'EXPERIMENTAL'; label: string }[];
  expiresAt: number; summary: string; steps: string[]; confirmations: string[]; reason: string;
  analysisMetrics?: ReturnType<import('../agent/budget').AgentBudget['summary']>;
  clarifiedFrom?: string;
}
export interface ClarificationView {
  reference: string; source: string; deviceId: string; expiresAt: number;
  catalog: PlanView['catalog'];
  kind: 'ALARM_PERIOD'; question: string; choices: { id: 'am' | 'pm'; label: string }[];
}
export type AnalysisView = { plan: PlanView; clarification?: never } | { clarification: ClarificationView; plan?: never };
export interface ExecutionView {
  id: string; plan: PlanView; status: string; rawStatus?: string; reason?: string; workerExecutionId?: string;
  steps?: ExecutionStepResult[]; legacyEvent?: ExecutionStreamEvent; task?: DeviceTask; finishedAt?: number; cancelRequested?: boolean;
}
export interface PreparedView { reference: string; expiresAt: number; steps: string[]; summary: string; confirmations: string[]; metrics?: PlanView['analysisMetrics'] }
