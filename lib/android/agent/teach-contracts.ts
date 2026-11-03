import { z } from 'zod';
import type { DeclaredAction } from '../../skills/teach-dashboard';
import type { SanitizedTeachSnapshot } from '../../skills/snapshot-sanitizer';
import { SkillVerifierSchema } from '../../skills/skill-schema';
import {OwnerCertificateSchema,OwnerDatabaseReadbackSchema} from '../../owner-auth/certificates';
import {AdministrativeClearanceSchema} from '../../skills/legacy-retirement-contracts';

const uuid = z.uuid();
const serial = z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/);
const lease = { leaseId: uuid, ownerToken: z.string().regex(/^[a-f0-9]{64}$/) };
const point = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict();
export const TeachCommand = z.discriminatedUnion('type', [
  z.object({type:z.literal('CONTINUATION_PREFLIGHT'),deviceId:serial,expectedPhysicalId:z.string().regex(/^android:[a-f0-9]{64}$/)}).strict(),
  z.object({type:z.literal('ADMIN_REAUTHORIZE_STAGE'),deviceId:serial,certificate:OwnerCertificateSchema,previousClearance:AdministrativeClearanceSchema,expiresAt:z.number().int().positive()}).strict(),
  z.object({type:z.literal('CONTINUATION_STAGE'),deviceId:serial,certificate:OwnerCertificateSchema,previousClearance:AdministrativeClearanceSchema,expiresAt:z.number().int().positive()}).strict(),
  z.object({type:z.literal('ADMIN_REAUTHORIZE_COMMIT'),executionId:uuid,stageId:uuid,certificate:OwnerCertificateSchema,readback:OwnerDatabaseReadbackSchema}).strict(),
  z.object({type:z.literal('CONTINUATION_COMMIT'),executionId:uuid,stageId:uuid,certificate:OwnerCertificateSchema,readback:OwnerDatabaseReadbackSchema}).strict(),
  z.object({type:z.literal('ADMIN_STAGE'),deviceId:serial,certificate:OwnerCertificateSchema,expiresAt:z.number().int().positive()}).strict(),
  z.object({type:z.literal('ADMIN_COMMIT'),executionId:uuid,stageId:uuid,certificate:OwnerCertificateSchema,readback:OwnerDatabaseReadbackSchema}).strict(),
  z.object({type:z.literal('ADMIN_AUTHORIZE_FRESH'),executionId:uuid,stageId:uuid,certificate:OwnerCertificateSchema,readback:OwnerDatabaseReadbackSchema}).strict(),
  z.object({type:z.literal('RECOVERY_PREPARE'),recordingRef:uuid,executionId:uuid,deviceId:serial,physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),authorizationId:uuid}).strict(),
  z.object({type:z.literal('RECOVERY_CONFIRM'),reference:uuid,revision:z.number().int().positive(),authorizationId:uuid,confirmed:z.literal(true)}).strict(),
  z.object({type:z.literal('RECOVERY_RELEASE_ACK'),reference:uuid,authorizationId:uuid,databaseRevision:z.number().int().positive()}).strict(),
  z.object({ type: z.literal('DEVICES') }).strict(),
  z.object({ type: z.literal('IDENTITY'), deviceId: serial }).strict(),
  z.object({ type: z.literal('OPEN'), requestId: uuid, recordingRef: uuid, deviceId: serial,
    administrativeClearance:uuid.optional(),
    expectedPhysicalId: z.string().regex(/^android:[a-f0-9]{64}$/),
    appRef: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), query: z.string().trim().max(500) }).strict(),
  z.object({ type: z.enum(['STATE', 'FRAME', 'PAUSE', 'RESUME', 'STOP', 'CANCEL']), ...lease }).strict(),
  z.object({ type: z.literal('STEP'), ...lease, requestId: uuid, frameId: uuid,
    operation: z.enum(['OPEN_APPLICATION', 'ACTIVATE_CONTROL', 'INPUT_TEXT', 'SUBMIT_SEARCH', 'SCROLL_CONTAINER', 'BACK', 'OBSERVE_UI', 'ASSERT_UI']),
    candidateId: z.string().max(80).optional(), touch: point.optional(), value: z.string().max(500).optional(), expected: SkillVerifierSchema.optional() }).strict(),
]);
export type TeachCommandValue = z.infer<typeof TeachCommand>;
export type TeachStatus = 'PREPARING' | 'RECORDING' | 'PAUSED' | 'REVIEWING' | 'INTERRUPTED' | 'CANCELLED';
export interface TeachReceipt {
  id: string; requestId: string; recordingRef: string; leaseId: string; deviceId: string; physicalId: string;
  executionId: string; sessionId: string; operation: string; dispatch: 'ACK' | 'NOT_SENT' | 'UNKNOWN';
  verification: 'PASSED' | 'FAILED' | 'UNVERIFIED'; evidenceId?: string; reason?: string; at: number;
  action?: DeclaredAction; before: SanitizedTeachSnapshot; after?: SanitizedTeachSnapshot;
  provenance?: 'ANDROID_RUNTIME' | 'SIMULATED_RECEIPT' | 'LEGACY_UNATTESTED';
  beforeSnapshotId: string; afterSnapshotId?: string;
}
export interface TeachSessionView {
  leaseId: string; recordingRef: string; deviceId: string; physicalId: string; executionId: string;
  sessionId: string; status: TeachStatus; revision: number; cleanup: 'PENDING' | 'PROVEN' | 'UNCERTAIN';
  closeReason?: 'OWNER_STOP'|'OWNER_CANCEL'|'HEARTBEAT_EXPIRED'|'BUDGET_EXHAUSTED'|'ABORT_SIGNAL'|'RUNTIME_INTERRUPTED';
  receipts: TeachReceipt[]; expiresAt: number; modelCalls: 0;
  metrics: { rpcCount: number; adbCount: number; elapsedMs: number };
}
export interface TeachFrame {
  id: string; recordingRef: string; deviceId: string; physicalId: string; sessionId: string;
  snapshotId: string; at: number; expiresAt: number; width: number; height: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE'; transport: 'SCREENSHOT_POLLING'; minimumIntervalMs: 2000;
  image?: string; imageOmittedReason?: string;
  controls: { id: string; operation: string; label: string; rectangle: [number, number, number, number] }[];
}
