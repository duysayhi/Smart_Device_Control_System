import { z } from 'zod';
import type { SkillStep, TargetDescriptor } from './skill-schema';
import { SkillTargetDescriptorSchema, SKILL_OPERATIONS } from './skill-schema';
const uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ReplayBindingSchema = z.object({ skillId: uuid, versionId: uuid, version: z.number().int().positive(), contentHash: digest,
  definitionDigest: digest, executionId: uuid, deviceId: z.string().min(1).max(256), physicalId: z.string().regex(/^android:[a-f0-9]{64}$/), sessionId: z.string().min(1).max(200) }).strict();
export type ReplayBinding = z.infer<typeof ReplayBindingSchema>;
export type ReplayProvenance = 'ANDROID_RUNTIME' | 'SIMULATED_RECEIPT';
const provenance = z.enum(['ANDROID_RUNTIME','SIMULATED_RECEIPT']);
export const ReplayProofSchema = z.object({ id:uuid,snapshotId:uuid,observedAt:z.number().finite(),stepId:z.string().max(64),predicateDigest:digest,binding:ReplayBindingSchema,provenance }).strict();
export interface ReplayProof { id: string; snapshotId: string; observedAt: number; stepId: string; predicateDigest: string; binding: ReplayBinding; provenance: ReplayProvenance }
export interface ReplayObservation {
  id: string; snapshotId: string; generation: number; observedAt: number; expiresAt: number; binding: ReplayBinding;
  foreground: boolean; blocker: 'NONE' | 'BENIGN_DIALOG' | 'SENSITIVE' | 'UNSUPPORTED_DIALOG';
  candidates: { id: string; operation: SkillStep['operation']; target?: TargetDescriptor; recovery?: 'DISMISS_BENIGN' }[];
  proof?: ReplayProof; provenance: ReplayProvenance;
}
export interface ExecutionReceipt {
  id: string; requestId: string; stepId: string; binding: ReplayBinding; dispatch: 'ACK' | 'NOT_SENT' | 'UNKNOWN';
  verification: 'PASSED' | 'FAILED' | 'UNVERIFIED'; beforeId: string; afterId?: string; provenance: ReplayProvenance; reason?: string;
}
export type ReplayStepResult = ExecutionReceipt;
export const ExecutionReceiptSchema = z.object({id:uuid,requestId:uuid,stepId:z.string().max(64),binding:ReplayBindingSchema,dispatch:z.enum(['ACK','NOT_SENT','UNKNOWN']),verification:z.enum(['PASSED','FAILED','UNVERIFIED']),beforeId:uuid,afterId:uuid.optional(),provenance,reason:z.string().regex(/^[A-Z0-9_]{1,80}$/).optional()}).strict();
export const ReplayObservationSchema = z.object({id:uuid,snapshotId:uuid,generation:z.number().int().positive(),observedAt:z.number().finite(),expiresAt:z.number().finite(),binding:ReplayBindingSchema,
  foreground:z.boolean(),blocker:z.enum(['NONE','BENIGN_DIALOG','SENSITIVE','UNSUPPORTED_DIALOG']),candidates:z.array(z.object({id:z.string().max(80),operation:z.enum(SKILL_OPERATIONS),target:SkillTargetDescriptorSchema.optional(),recovery:z.literal('DISMISS_BENIGN').optional()}).strict()).max(100),proof:ReplayProofSchema.optional(),provenance}).strict();
export type RecoveryDecision = { action: 'OBSERVE_AGAIN' | 'DISMISS_BENIGN' | 'REOPEN_SCOPE' | 'ASK_OWNER' | 'BLOCK'; reason: string };
export const ReplayStatusSchema = z.enum(['CREATED','VALIDATING','READY','ACQUIRING_DEVICE','RUNNING','VERIFYING','RECOVERING','PAUSED','COMPLETED','BLOCKED','FAILED','CANCELLED','INTERRUPTED','UNKNOWN_EFFECT']);
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;
export const ReplayCheckpointSchema = z.object({ contractVersion: z.literal(1), binding: ReplayBindingSchema, status: ReplayStatusSchema,
  revision: z.number().int().positive(), currentStep: z.number().int().min(0).max(20), observationGeneration: z.number().int().min(0),
  verifiedSteps: z.array(z.object({ stepId: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), evidenceId: uuid, snapshotId: uuid }).strict()).max(20),
  recoveryCount: z.number().int().min(0).max(3), pending: z.object({ requestId: uuid, stepId: z.string().max(64), dispatch: z.enum(['PENDING','ACK','NOT_SENT','UNKNOWN']) }).strict().optional(),
  ownership: z.enum(['HELD','RELEASED','RETAINED_PENDING_CLEANUP']), reason: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(),
  provenance: z.enum(['ANDROID_RUNTIME','SIMULATED_RECEIPT']), signature: digest }).strict();
export type ReplayCheckpoint = z.infer<typeof ReplayCheckpointSchema>;
/** Adapter boundary. No coordinates, ADB, Appium, model or SQL in the controller. */
export interface ReplayAdapter {
  readonly binding: ReplayBinding; readonly provenance: ReplayProvenance;
  authorize(): Promise<void>;
  observe(step: SkillStep, signal: AbortSignal): Promise<ReplayObservation>;
  execute(step: SkillStep, observation: ReplayObservation, candidateId: string | undefined, requestId: string, signal: AbortSignal): Promise<ExecutionReceipt>;
  verify(step: SkillStep, receipt: ExecutionReceipt, signal: AbortSignal): Promise<ReplayProof | undefined>;
  recover(decision: RecoveryDecision, observation: ReplayObservation, requestId: string, signal: AbortSignal): Promise<ExecutionReceipt>;
  close(): Promise<{ cleanup: 'PROVEN' | 'UNCERTAIN' }>;
}
