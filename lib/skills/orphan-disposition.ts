import { createHash } from 'node:crypto';
import { z } from 'zod';

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),physical=z.string().regex(/^android:[a-f0-9]{64}$/);
export const ADMIN_DISPOSED_UNVERIFIED='ADMIN_DISPOSED_UNVERIFIED' as const;
const sources=['DEVICE_IDENTITY','WORKER_TASKS','DEVICE_RESERVATIONS','PHYSICAL_LOCKS','APPIUM_SESSIONS','PENDING_EFFECT_RECONCILIATION'] as const;
export const OrphanBindingSchema=z.object({sessionId:uuid,executionId:uuid,requestId:uuid,physicalId:physical,revision:z.number().int().positive(),originalJournalSha256:hash}).strict();
export type OrphanBinding=z.infer<typeof OrphanBindingSchema>;
const inspection=z.object({binding:OrphanBindingSchema,status:z.literal('INTERRUPTED'),ownership:z.literal('RETAINED_PENDING_CLEANUP'),
  legacyAttestation:z.literal('MISSING'),evidenceDigests:z.array(hash).min(1).max(32),pending:z.enum(['NONE','PENDING','UNKNOWN','UNATTESTED']),
  observations:z.array(z.object({source:z.enum(sources),at:z.number().int().nonnegative(),digest:hash,physicalId:physical,verdict:z.enum(['CLEAR','CONFLICT','UNKNOWN'])}).strict()).length(sources.length)}).strict();
const owner=z.object({subject:z.literal('local-owner'),purpose:z.literal('ADMIN_ORPHAN_DISPOSITION'),binding:OrphanBindingSchema,
  authenticationEventSha256:hash,authenticatedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),revoked:z.boolean()}).strict();
const approval=z.object({approvalId:uuid,binding:OrphanBindingSchema,authenticationEventSha256:hash,riskAccepted:z.literal(true),
  risk:z.literal('MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION'),acceptedAt:z.number().int().nonnegative()}).strict();
export interface OrphanDispositionAudit {
  approvalId:string;sessionId:string;executionId:string;requestId:string;physicalId:string;beforeRevision:number;
  action:'DISPOSE'|'REQUARANTINE';actorRef:'local-owner';authenticationEventSha256:string;acceptedAt:number;
  riskAccepted:true;reason:'MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION';cleanupClaim:'UNVERIFIED';pendingAssessment:'NONE';
  originalJournalSha256:string;evidenceDigests:string[];preflightDigest:string;
}
export interface AdministrativeDispositionRecord {sessionId:string;physicalId:string;status:'INTERRUPTED';ownership:typeof ADMIN_DISPOSED_UNVERIFIED|'RETAINED_PENDING_CLEANUP';revision:number;audit:OrphanDispositionAudit[]}
/** Extension contract only. No production adapter/API invokes the proposed migration. */
export interface AdministrativeDispositionRepository {
  recordAdministrativeDisposition(binding:OrphanBinding,audit:OrphanDispositionAudit):Promise<AdministrativeDispositionRecord>;
  readAdministrativeDisposition(sessionId:string):Promise<AdministrativeDispositionRecord>;
}
export type OrphanDispositionReview={verdict:'BLOCKED';reason:string}|{verdict:'READY_FOR_OWNER_REVIEW';audit:OrphanDispositionAudit;cleanup:'UNVERIFIED';admission:'QUARANTINED'};
const digest=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
const sameBinding=(a:OrphanBinding,b:OrphanBinding)=>JSON.stringify(a)===JSON.stringify(b);
/** Pure readiness evaluation. Inputs must come from backend readers/authentication, never a client proof.
 * READY is a review artifact, not an execution authorization or native cleanup assertion. */
export function reviewOrphanDisposition(input:unknown,now:number):OrphanDispositionReview {
  const parsed=z.object({inspection,owner,approval}).strict().safeParse(input);
  const deny=(reason:string):OrphanDispositionReview=>({verdict:'BLOCKED',reason});
  if(!parsed.success||!Number.isSafeInteger(now)||now<0)return deny('INVALID_REVIEW_INPUT');
  const {inspection:i,owner:o,approval:a}=parsed.data;
  if(!sameBinding(i.binding,o.binding)||!sameBinding(i.binding,a.binding))return deny('EXACT_ORIGINAL_BINDING_MISMATCH');
  if(o.revoked||o.authenticatedAt>now||o.expiresAt<=now||now-o.authenticatedAt>120000)return deny('OWNER_AUTHENTICATION_REQUIRED');
  if(a.authenticationEventSha256!==o.authenticationEventSha256||a.acceptedAt<o.authenticatedAt||a.acceptedAt>now||now-a.acceptedAt>60000)return deny('RISK_ACCEPTANCE_INVALID');
  if(i.pending!=='NONE')return deny('PENDING_EFFECT_UNRECONCILED');
  if(new Set(i.observations.map(v=>v.source)).size!==sources.length)return deny('PREFLIGHT_SOURCE_MISSING');
  if(i.observations.some(v=>v.physicalId!==i.binding.physicalId))return deny('PHYSICAL_IDENTITY_MISMATCH');
  if(i.observations.some(v=>v.verdict!=='CLEAR'||v.at>now||now-v.at>5000))return deny('FRESH_PREFLIGHT_REQUIRED');
  const {revision,...binding}=i.binding;
  return {verdict:'READY_FOR_OWNER_REVIEW',cleanup:'UNVERIFIED',admission:'QUARANTINED',audit:{approvalId:a.approvalId,...binding,beforeRevision:revision,
    action:'DISPOSE',actorRef:'local-owner',authenticationEventSha256:o.authenticationEventSha256,acceptedAt:a.acceptedAt,riskAccepted:true,
    reason:a.risk,cleanupClaim:'UNVERIFIED',pendingAssessment:'NONE',evidenceDigests:[...i.evidenceDigests],
    preflightDigest:digest([...i.observations].sort((x,y)=>x.source.localeCompare(y.source)))}};
}
