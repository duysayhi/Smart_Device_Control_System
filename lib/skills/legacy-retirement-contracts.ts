import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {TeachSession} from './teach-repository';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const AdministrativeClearanceSchema=z.object({id:z.uuid(),requestId:z.uuid(),sourceSha256:hash,expiresAt:z.number().int().positive(),
 successorSessionId:z.uuid().optional(),consumptionAuthSha256:hash.optional(),consumedAt:z.number().int().positive().optional()}).strict();
export type AdministrativeClearance=z.infer<typeof AdministrativeClearanceSchema>;
export const LegacyRetirementAuditSchema=z.object({approvalId:z.uuid(),sessionId:z.uuid(),executionId:z.uuid(),requestId:z.uuid(),physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),beforeRevision:z.number().int().positive(),
 action:z.enum(['DISPOSE','REQUARANTINE']),actorRef:z.literal('local-owner'),authenticationEventSha256:hash,acceptedAt:z.number().int().positive(),riskAccepted:z.literal(true),
 reason:z.literal('MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION'),cleanupClaim:z.literal('UNVERIFIED'),pendingAssessment:z.literal('HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE'),originalJournalSha256:hash,evidenceDigests:z.array(hash).min(1).max(32),preflightDigest:hash}).strict();
export type LegacyRetirementAudit=z.infer<typeof LegacyRetirementAuditSchema>;
export const ClearanceReauthorizationAuditSchema=z.object({
 approvalId:z.uuid(),action:z.literal('REAUTHORIZE'),sessionId:z.uuid(),executionId:z.uuid(),requestId:z.uuid(),
 physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),beforeRevision:z.number().int().positive(),actorRef:z.literal('local-owner'),
 authenticationEventSha256:hash,acceptedAt:z.number().int().positive(),riskAccepted:z.literal(true),cleanupClaim:z.literal('UNVERIFIED'),
 pendingAssessment:z.literal('HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE'),originalJournalSha256:hash,priorMarkerSha256:hash,preflightDigest:hash,
 previousClearance:AdministrativeClearanceSchema,newClearance:AdministrativeClearanceSchema,
}).strict().refine(v=>!v.previousClearance.successorSessionId&&!v.newClearance.successorSessionId&&v.previousClearance.id!==v.newClearance.id&&v.previousClearance.requestId!==v.newClearance.requestId,'Only an unused clearance can be superseded');
export type ClearanceReauthorizationAudit=z.infer<typeof ClearanceReauthorizationAuditSchema>;
export interface AdministrativeSession {session:TeachSession;audit:unknown[];clearance:AdministrativeClearance|null;recordedActions:number;snapshots:number}
const PriorAdmissionSchema=z.object({stageId:z.uuid(),clearanceId:z.uuid(),freshRequestId:z.uuid(),sourceSha256:hash,ownerAuthSha256:hash,approvalSha256:hash,expiresAt:z.number().int().positive(),databaseRevision:z.number().int().positive(),digest:hash}).strict();
export const AdministrativeAdmissionSchema=z.object({version:z.literal(1),stageId:z.uuid(),recordingRef:z.uuid(),originalRequestId:z.uuid(),originalJournalSha256:hash,physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),freshRequestId:z.uuid(),sourceSha256:hash,ownerAuthSha256:hash,approvalSha256:hash,expiresAt:z.number().int().positive(),status:z.enum(['STAGED','RETIRED','AUTHORIZED','DISPATCHED','REAUTH_STAGED']),databaseRevision:z.number().int().positive().optional(),clearanceId:z.uuid().optional(),successorRef:z.uuid().optional(),freshSpecSha256:hash.optional(),successorExecutionId:z.uuid().optional(),readbackValidUntil:z.number().int().positive().optional(),reauthorizations:z.array(PriorAdmissionSchema).max(16).optional(),digest:hash}).strict();
export type AdministrativeAdmission=z.infer<typeof AdministrativeAdmissionSchema>;
export function administrativeAdmission(input:Omit<AdministrativeAdmission,'digest'>):AdministrativeAdmission{const payload=AdministrativeAdmissionSchema.omit({digest:true}).parse(input);return {...payload,digest:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};}
export function parseAdministrativeAdmission(input:unknown){const value=AdministrativeAdmissionSchema.parse(input),{digest,...payload}=value;if(administrativeAdmission(payload).digest!==digest)throw Error('ADMINISTRATIVE_JOURNAL_INVALID');return value;}
