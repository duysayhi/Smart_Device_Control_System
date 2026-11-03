import {CompanionTransport,type CompanionEvent} from './companion-transport';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {readFile,stat,mkdir,lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import { z } from 'zod';
import { workerRequest } from '../android/agent/worker-client';
import { captureAndroidScreenshot } from '../android/adb';
import sharp from 'sharp';
import { decidePermission } from '../android/agent/permission-decision';
import type { TeachFrame, TeachReceipt, TeachSessionView } from '../android/agent/teach-contracts';
import type { TransportIdentity } from '../android/transport-identity';
import type { TeachRepository, TeachSession } from './teach-repository';
import type { TeachStorageService } from './teach-storage-service';
import type { OfflineTeachDashboard, DeclaredAction } from './teach-dashboard';
import { sensitiveMetadata, sensitiveValue } from './skill-safety';
import { TeachStorageError } from './db/teach-errors';
import { compileRecordedSkill, type RecordedCompilation } from './recorded-skill-compiler';
import { RecoveryPreparedSchema, RecoveryProofSchema, lifecycleDigest, parseTeachLifecycle, teachLifecycleState } from '../android/agent/teach-lifecycle';
import {runtimeDirectory,teachRuntimeDigest} from '../android/agent/runtime-storage';
import {ownerAuthenticationRuntimeSha256,ownerCertificateDigest} from '../owner-auth/certificates';
import {OwnerPasskeyService,type OwnerOperation} from '../owner-auth/passkey';
import {LegacyRetirementAuditSchema,AdministrativeClearanceSchema,ClearanceReauthorizationAuditSchema,parseAdministrativeAdmission,type AdministrativeClearance} from './legacy-retirement-contracts';

const safe = (max: number) => z.string().trim().min(1).max(max).refine(v => !sensitiveValue(v));
const uuid = z.uuid();
const openInput = z.object({ requestId: uuid, deviceId: z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/), name: safe(120),
  appAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), command: safe(500), query: z.string().trim().max(500).refine(v => !sensitiveValue(v)), confirmed: z.literal(true) }).strict();
const stepInput = z.object({ revision: z.number().int().positive(), requestId: uuid, frameId: uuid,
  operation: z.enum(['OPEN_APPLICATION','ACTIVATE_CONTROL','INPUT_TEXT','SUBMIT_SEARCH','SCROLL_CONTAINER','BACK','OBSERVE_UI']),
  candidateId: z.string().max(80).optional(), value: z.string().max(500).optional(),
  touch: z.object({x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1)}).strict().optional() }).strict();
const revisionInput = z.object({revision:z.number().int().positive()}).strict();
const compileInput = revisionInput.extend({parameterizeQuery:z.boolean()}).strict();
export class LiveTeachError extends Error {
  constructor(readonly code: string) { super(code); }
}
function reject(code: string): never { throw new LiveTeachError(code); }
function parse<S extends z.ZodType>(schema:S,input:unknown):z.output<S> {
  const parsed=schema.safeParse(input); if(!parsed.success) reject('INVALID_RECORDER_REQUEST'); return parsed.data;
}
type Worker = (command:unknown)=>Promise<unknown>;
async function realWorker(command:unknown) {
  let response:Response;
  try { response=await workerRequest('POST',command,'/teach'); } catch { return reject('WORKER_UNAVAILABLE_OR_OUTCOME_UNKNOWN'); }
  const body=await response.json().catch(()=>null);
  if(!response.ok) reject(typeof body?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(body.code)?body.code:'WORKER_COMMAND_REJECTED');
  return body;
}
interface LiveRecord {
  id:string; name:string; appAlias:string; query:string; client:string; token:string; worker:TeachSessionView; database:TeachSession;
  revision:number; busy:boolean; actions:DeclaredAction[]; receipts:(TeachReceipt & {persistence:'PERSISTED'|'NOT_PERSISTED';excluded?:boolean})[];
  streamCheckedAt?:number;companion?:CompanionTransport;observations?:CompanionEvent[];annotations?:{id:string;sequence?:number;choice:string;source:'PHYSICAL_DEVICE';provenance:'HUMAN_ANNOTATED';verification:'UNVERIFIED';at:number;target?:TeachFrame['controls'][number]}[];lastFrame?:TeachFrame;
  blocked?:string;
  attempts:Map<string,{binding:string;work:Promise<unknown>}>;
  controls:Map<string,Promise<unknown>>;
  review?:Awaited<ReturnType<OfflineTeachDashboard['prepareRecordedReview']>>;
  semanticCompilation?:RecordedCompilation;
}
interface AdministrativePlan {binding:OwnerOperation;deviceId:string;expiresAt:number;stageId?:string;clearance?:AdministrativeClearance;work?:Promise<unknown>;consumption?:{approvalHash:string;client?:string};parent?:AdministrativePlan;open?:z.infer<typeof openInput>;previous?:{clearance:AdministrativeClearance;audit:unknown[]}}
/** Orchestrates trusted Worker receipts and existing Teach storage. It never dispatches Android. */
export class LiveTeachService {
  private records=new Map<string,LiveRecord>();
  private starts=new Map<string,{binding:string;work:Promise<unknown>}>();
  private cleanups=new Map<string,string>();
  private activeScreenStreams=new Set<string>();
  private durableCleanups=new Map<string,{physicalId:string;expiresAt:number}>();
  private recoveryPlans=new Map<string,{id:string;physicalId:string;executionId:string;authorizationId:string;dbRevision:number;prepared:z.infer<typeof RecoveryPreparedSchema>;work?:Promise<unknown>}>();
  private administrativePlans=new Map<string,AdministrativePlan>();
  private freshAdmissions=new Map<string,{session:TeachSession;clearanceId:string;openHash:string;expiresAt:number}>();
  constructor(private readonly repository:TeachRepository,private readonly storage:TeachStorageService,
    private readonly dashboard:OfflineTeachDashboard,private readonly worker:Worker=realWorker,
    private readonly storageBinding:()=>Promise<void>=async()=>{reject('RECORDER_TEST_BRANCH_BINDING_REQUIRED');},
    private readonly owner?:OwnerPasskeyService,private readonly administrativeJournal=join(runtimeDirectory(),'tasks.json')) {}
  private async administrativeEvidence(id:string,executionId:string,deviceId:string){
    await this.storageBinding();const session=await this.repository.getSession(id);await this.repository.assertConsent(session.deviceId);
    const file=this.administrativeJournal;if((await stat(file)).size>5000000)reject('ADMIN_JOURNAL_TOO_LARGE');const bytes=await readFile(file),tasks=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(tasks))reject('ADMIN_JOURNAL_INVALID');const rows=tasks.filter(t=>t.executionId===executionId),task=rows[0];
    if(rows.length!==1||task.deviceId!==deviceId||task.physicalId!==session.physicalId||task.status!=='CANCELLED'||!task.finishedAt||task.teachLifecycle||task.administrativeAdmission||task.latest?.counters?.steps!==0||task.latest?.counters?.snapshots!==0||session.status!=='INTERRUPTED'||session.ownership!=='RETAINED_PENDING_CLEANUP')reject('ADMIN_LEGACY_EVIDENCE_MISMATCH');
    return {session,requestId:uuid.parse(task.batchId),journalSha256:createHash('sha256').update(bytes).digest('hex'),migrationSha256:createHash('sha256').update(await readFile(join(process.cwd(),'db','teach','proposals','20_admin_orphan_quarantine.sql'))).digest('hex')};
  }
  async prepareAdministrativeRecovery(input:unknown){
    if(!this.owner)reject('OWNER_AUTHENTICATION_REQUIRED');
    const data=parse(z.object({id:uuid,executionId:uuid,deviceId:z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/)}).strict(),input),evidence=await this.administrativeEvidence(data.id,data.executionId,data.deviceId),runtimeSha256=teachRuntimeDigest();
    if(!runtimeSha256||!(await this.owner.status()).issuerReady)reject('OWNER_AUTHENTICATION_NOT_READY');
    if(!this.repository.administrativeSession||!this.repository.retireLegacy||!this.repository.admitAuthorizedFresh)reject('ADMIN_REPOSITORY_UNAVAILABLE');
    // SELECT requires the proposed migration to have been separately approved/applied.
    const installed=await this.repository.administrativeSession(data.id);if(installed.audit.length||installed.clearance)reject('ADMIN_ALREADY_RECONCILED');if(installed.recordedActions!==0||installed.snapshots!==0)reject('ADMIN_LEGACY_EFFECT_EVIDENCE_UNSUPPORTED');
    for(const[k,v]of this.administrativePlans)if(v.expiresAt<=Date.now())this.administrativePlans.delete(k);if(this.administrativePlans.size>=100)reject('ADMIN_CAPACITY');
    const binding:OwnerOperation={purpose:'ADMIN_ORPHAN_DISPOSITION',sessionId:data.id,executionId:data.executionId,requestId:evidence.requestId,physicalId:evidence.session.physicalId,revision:evidence.session.revision,journalSha256:evidence.journalSha256,runtimeSha256,ownerAuthSha256:ownerAuthenticationRuntimeSha256(),migrationSha256:evidence.migrationSha256,freshRequestId:randomUUID(),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',summary:'Administrative retirement: original cleanup remains UNVERIFIED. Current safety inspection must prove no active UNKNOWN effect. This does not authorize native OPEN.'};
    const review=this.owner.prepareReview(binding);this.administrativePlans.set(review.reference,{binding,deviceId:data.deviceId,expiresAt:review.expiresAt});return {reference:review.reference,review,cleanup:'UNVERIFIED',requiresRiskAcceptance:true,nativeOpenAuthorized:false};
  }
  retireAdministrativeRecovery(input:unknown){
    const data=parse(z.object({reference:uuid,approvalRef:uuid,riskAccepted:z.literal(true)}).strict(),input),plan=this.administrativePlans.get(data.reference);
    if(!plan||plan.parent||plan.expiresAt<=Date.now()||!this.owner)reject('ADMIN_REFERENCE_INVALID');if(plan.work){if(plan.consumption?.approvalHash!==ownerCertificateDigest(data.approvalRef))reject('ADMIN_APPROVAL_REPLAY_BINDING_MISMATCH');return plan.work;}
    const approval=this.owner.consumeApproval(data.approvalRef,plan.binding);if(!approval.certificate)reject('OWNER_CERTIFICATE_REQUIRED');
    plan.consumption={approvalHash:ownerCertificateDigest(data.approvalRef)};plan.work=Promise.resolve().then(async()=>{
      const evidence=await this.administrativeEvidence(plan.binding.sessionId,plan.binding.executionId,plan.deviceId);
      if(evidence.session.revision!==plan.binding.revision||evidence.journalSha256!==plan.binding.journalSha256||evidence.migrationSha256!==plan.binding.migrationSha256||teachRuntimeDigest()!==plan.binding.runtimeSha256||ownerAuthenticationRuntimeSha256()!==plan.binding.ownerAuthSha256)reject('ADMIN_REVIEW_STALE');
      const before=await this.repository.administrativeSession!(plan.binding.sessionId);if(before.recordedActions!==0||before.snapshots!==0||before.audit.length||before.clearance)reject('ADMIN_LEGACY_EFFECT_EVIDENCE_UNSUPPORTED');
      const expiresAt=Date.now()+600000,staged=await this.worker({type:'ADMIN_STAGE',deviceId:plan.deviceId,certificate:approval.certificate,expiresAt}) as {stageId:string;status:string;inspection:{state:string;physicalId:string;at:number;digest:string}};
      if(!uuid.safeParse(staged.stageId).success||staged.status!=='STAGED'||staged.inspection.state!=='CLEAR'||staged.inspection.physicalId!==plan.binding.physicalId||staged.inspection.at>Date.now()||Date.now()-staged.inspection.at>5000||!/^[a-f0-9]{64}$/.test(staged.inspection.digest))reject('ADMIN_INSPECTION_INVALID');
      plan.stageId=staged.stageId;const clearance:AdministrativeClearance={id:randomUUID(),requestId:plan.binding.freshRequestId,sourceSha256:plan.binding.runtimeSha256,expiresAt};
      // Promise is retained on failure too: no automatic mutation replay after uncertain COMMIT.
      const audit=LegacyRetirementAuditSchema.parse({approvalId:randomUUID(),sessionId:plan.binding.sessionId,executionId:plan.binding.executionId,requestId:plan.binding.requestId,physicalId:plan.binding.physicalId,beforeRevision:plan.binding.revision,action:'DISPOSE',actorRef:'local-owner',authenticationEventSha256:ownerCertificateDigest(approval.certificate),acceptedAt:Date.now(),riskAccepted:true,reason:'MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION',cleanupClaim:'UNVERIFIED',pendingAssessment:'HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE',originalJournalSha256:plan.binding.journalSha256,evidenceDigests:[plan.binding.journalSha256,staged.inspection.digest],preflightDigest:staged.inspection.digest});
      await this.repository.retireLegacy!(plan.binding.sessionId,plan.binding.revision,audit,clearance);
      const readback=await this.repository.administrativeSession!(plan.binding.sessionId);
      if(readback.session.ownership!=='ADMIN_DISPOSED_UNVERIFIED'||readback.session.status!=='INTERRUPTED'||readback.session.revision!==plan.binding.revision+1||readback.session.physicalId!==plan.binding.physicalId||readback.clearance?.id!==clearance.id||readback.clearance.requestId!==clearance.requestId||readback.clearance.sourceSha256!==clearance.sourceSha256||readback.clearance.successorSessionId||readback.audit.length!==1||ownerCertificateDigest(LegacyRetirementAuditSchema.parse(readback.audit[0]))!==ownerCertificateDigest(audit))reject('ADMIN_DATABASE_READBACK_MISMATCH');
      const proof=await this.owner!.certifyDatabaseReadback(approval,{originalSessionId:plan.binding.sessionId,originalRevision:readback.session.revision,originalOwnership:'ADMIN_DISPOSED_UNVERIFIED',physicalId:readback.session.physicalId,clearanceId:clearance.id,freshRequestId:clearance.requestId,sourceSha256:clearance.sourceSha256,observedAt:Date.now()});
      await this.worker({type:'ADMIN_COMMIT',executionId:plan.binding.executionId,stageId:staged.stageId,certificate:approval.certificate,readback:proof});plan.clearance=clearance;
      return {status:'ADMIN_DISPOSED_UNVERIFIED',cleanup:'UNVERIFIED',originalSessionId:plan.binding.sessionId,revision:readback.session.revision,nativeOpenAuthorized:false,freshRequestId:clearance.requestId};
    });return plan.work;
  }
  async prepareAdministrativeFresh(input:unknown){
    const data=parse(z.object({reference:uuid,open:openInput}).strict(),input),parent=this.administrativePlans.get(data.reference);
    if(!parent?.clearance||!parent.stageId||parent.clearance.expiresAt<=Date.now()||!this.owner||data.open.requestId!==parent.binding.freshRequestId||data.open.deviceId!==parent.deviceId)reject('ADMIN_FRESH_REFERENCE_INVALID');
    if(sensitiveMetadata(data.open.name)||decidePermission({source:data.open.command,stage:'REQUEST'}).decision==='DENY')reject('HARD_DENY');
    await this.storageBinding();await this.repository.assertConsent();const current=await this.repository.administrativeSession!(parent.binding.sessionId);
    if(current.session.ownership!=='ADMIN_DISPOSED_UNVERIFIED'||current.session.revision!==parent.binding.revision+1||current.clearance?.id!==parent.clearance.id||current.clearance.successorSessionId||teachRuntimeDigest()!==parent.binding.runtimeSha256||ownerAuthenticationRuntimeSha256()!==parent.binding.ownerAuthSha256)reject('ADMIN_FRESH_REVIEW_STALE');
    if(this.administrativePlans.size>=100)reject('ADMIN_CAPACITY');
    const binding:OwnerOperation={...parent.binding,purpose:'FRESH_ADMISSION',revision:current.session.revision,successorSessionId:randomUUID(),freshSpecSha256:ownerCertificateDigest({appRef:data.open.appAlias,query:data.open.query}),summary:'Authorize exactly one fresh Recorder OPEN: '+data.open.appAlias+'; query '+data.open.query+'. No automatic retry or replay. Original cleanup remains UNVERIFIED.'};
    const review=this.owner.prepareReview(binding);this.administrativePlans.set(review.reference,{binding,deviceId:parent.deviceId,expiresAt:review.expiresAt,parent,open:data.open});return {reference:review.reference,review,nativeOpenRequiresSeparateConfirmation:true};
  }
  authorizeAdministrativeFresh(input:unknown,client:string){
    const data=parse(z.object({reference:uuid,approvalRef:uuid,confirmNativeOpen:z.literal(true)}).strict(),input),plan=this.administrativePlans.get(data.reference),parent=plan?.parent;
    if(!plan||!parent?.clearance||!parent.stageId||!plan.open||!this.owner||plan.expiresAt<=Date.now()||!uuid.safeParse(client).success)reject('ADMIN_FRESH_REFERENCE_INVALID');if(plan.work){if(plan.consumption?.approvalHash!==ownerCertificateDigest(data.approvalRef)||plan.consumption?.client!==client)reject('ADMIN_APPROVAL_REPLAY_BINDING_MISMATCH');return plan.work;}
    const approval=this.owner.consumeApproval(data.approvalRef,plan.binding);if(!approval.certificate)reject('OWNER_CERTIFICATE_REQUIRED');
    plan.consumption={approvalHash:ownerCertificateDigest(data.approvalRef),client};plan.work=Promise.resolve().then(async()=>{
      await this.storageBinding();await this.repository.assertConsent();if(teachRuntimeDigest()!==plan.binding.runtimeSha256||ownerAuthenticationRuntimeSha256()!==plan.binding.ownerAuthSha256)reject('ADMIN_SOURCE_CHANGED');
      const child=await this.repository.admitAuthorizedFresh!(plan.binding.sessionId,plan.binding.revision,parent.clearance!,plan.binding.successorSessionId!,ownerCertificateDigest(approval.certificate));
      const current=await this.repository.administrativeSession!(plan.binding.sessionId),persisted=await this.repository.getSession(child.id);
      if(child.id!==plan.binding.successorSessionId||persisted.physicalId!==plan.binding.physicalId||persisted.ownership!=='HELD'||persisted.status!=='CREATED'||current.session.ownership!=='ADMIN_DISPOSED_UNVERIFIED'||current.session.physicalId!==plan.binding.physicalId||current.session.deviceId!==persisted.deviceId||current.session.revision!==plan.binding.revision+1||current.clearance?.id!==parent.clearance!.id||current.clearance?.successorSessionId!==child.id||current.clearance.consumptionAuthSha256!==ownerCertificateDigest(approval.certificate))reject('ADMIN_FRESH_DATABASE_READBACK_MISMATCH');
      const observedAt=Date.now(),proof=await this.owner!.certifyDatabaseReadback(approval,{originalSessionId:plan.binding.sessionId,originalRevision:current.session.revision,originalOwnership:'ADMIN_DISPOSED_UNVERIFIED',physicalId:current.session.physicalId,clearanceId:parent.clearance!.id,freshRequestId:parent.clearance!.requestId,sourceSha256:parent.clearance!.sourceSha256,successorRef:child.id,successorOwnership:'HELD',observedAt});
      await this.worker({type:'ADMIN_AUTHORIZE_FRESH',executionId:plan.binding.executionId,stageId:parent.stageId,certificate:approval.certificate,readback:proof});
      this.freshAdmissions.set(plan.open!.requestId,{session:persisted,clearanceId:parent.clearance!.id,openHash:ownerCertificateDigest(plan.open),expiresAt:observedAt+5000});return this.open(plan.open,client);
    });return plan.work;
  }
  private async reauthorizationEvidence(id:string,executionId:string,deviceId:string){
    await this.storageBinding();
    if(!this.repository.administrativeSession||!this.repository.reauthorizeAndAdmitFresh||!this.repository.assertReauthorizationReady)reject('ADMIN_REAUTH_REPOSITORY_UNAVAILABLE');
    await this.repository.assertReauthorizationReady();
    const current=await this.repository.administrativeSession(id);await this.repository.assertConsent(current.session.deviceId);
    if(current.session.ownership!=='ADMIN_DISPOSED_UNVERIFIED'||current.session.status!=='INTERRUPTED'||!current.clearance||current.clearance.successorSessionId||
      current.recordedActions!==0||current.snapshots!==0||current.audit.length<1||current.audit.length>=32)reject('ADMIN_REAUTH_DATABASE_STATE_INVALID');
    if((await stat(this.administrativeJournal)).size>5000000)reject('ADMIN_JOURNAL_TOO_LARGE');
    const tasks=JSON.parse(await readFile(this.administrativeJournal,'utf8'));
    if(!Array.isArray(tasks))reject('ADMIN_JOURNAL_INVALID');
    const rows=tasks.filter(t=>t.executionId===executionId),task=rows[0];
    if(rows.length!==1||task.deviceId!==deviceId||task.physicalId!==current.session.physicalId||task.teachLifecycle||task.status!=='CANCELLED'||!task.finishedAt||
      task.latest?.counters?.steps!==0||task.latest?.counters?.snapshots!==0||!task.administrativeAdmission)reject('ADMIN_REAUTH_JOURNAL_BINDING_INVALID');
    const marker=parseAdministrativeAdmission(task.administrativeAdmission),clearance=AdministrativeClearanceSchema.parse(current.clearance);
    if(marker.status!=='RETIRED'||marker.recordingRef!==id||marker.originalRequestId!==task.batchId||marker.physicalId!==current.session.physicalId||
      marker.databaseRevision!==current.session.revision||marker.clearanceId!==clearance.id||marker.freshRequestId!==clearance.requestId||
      marker.sourceSha256!==clearance.sourceSha256||marker.expiresAt!==clearance.expiresAt||marker.successorRef||marker.successorExecutionId)reject('ADMIN_REAUTH_MARKER_MISMATCH');
    const original=current.audit.map(a=>LegacyRetirementAuditSchema.safeParse(a)).find(a=>a.success&&a.data.action==='DISPOSE');
    if(!original?.success||original.data.sessionId!==id||original.data.executionId!==executionId||original.data.requestId!==task.batchId||
      original.data.physicalId!==marker.physicalId||original.data.originalJournalSha256!==marker.originalJournalSha256)reject('ADMIN_REAUTH_ORIGINAL_AUDIT_MISMATCH');
    return {current,marker,migrationSha256:createHash('sha256').update(await readFile(join(process.cwd(),'db','teach','proposals','21_clearance_reauthorization.sql'))).digest('hex')};
  }
  async prepareAdministrativeReauthorization(input:unknown){
    if(!this.owner||(await this.owner.status()).issuerReady!==true)reject('OWNER_AUTHENTICATION_NOT_READY');
    const data=parse(z.object({id:uuid,executionId:uuid,open:openInput.omit({requestId:true})}).strict(),input);
    if(sensitiveMetadata(data.open.name)||decidePermission({source:data.open.command,stage:'REQUEST'}).decision==='DENY')reject('HARD_DENY');
    const evidence=await this.reauthorizationEvidence(data.id,data.executionId,data.open.deviceId),runtimeSha256=teachRuntimeDigest();
    if(!runtimeSha256)reject('ADMIN_SOURCE_UNAVAILABLE');
    for(const[k,v]of this.administrativePlans)if(v.expiresAt<=Date.now())this.administrativePlans.delete(k);
    if(this.administrativePlans.size>=100)reject('ADMIN_CAPACITY');
    // Canonical schema order must match open()'s exact request digest, including the backend-generated request ID.
    const open=parse(openInput,{...data.open,requestId:randomUUID()});
    const binding:OwnerOperation={purpose:'CLEARANCE_REAUTHORIZATION',sessionId:data.id,executionId:data.executionId,requestId:evidence.marker.originalRequestId,
      physicalId:evidence.marker.physicalId,revision:evidence.current.session.revision,journalSha256:evidence.marker.originalJournalSha256,runtimeSha256,
      ownerAuthSha256:ownerAuthenticationRuntimeSha256(),migrationSha256:evidence.migrationSha256,freshRequestId:open.requestId,successorSessionId:randomUUID(),
      newClearanceId:randomUUID(),priorClearanceSha256:ownerCertificateDigest(evidence.current.clearance),priorMarkerSha256:evidence.marker.digest,
      freshSpecSha256:ownerCertificateDigest({appRef:open.appAlias,query:open.query}),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',
      summary:'Reauthorize an unused clearance with a new Passkey approval and one fresh Recorder OPEN: '+open.appAlias+'; query '+open.query+'. Keep old authorization/audit; original cleanup remains UNVERIFIED. No automatic retry.'};
    const review=this.owner.prepareReview(binding);
    this.administrativePlans.set(review.reference,{binding,deviceId:open.deviceId,expiresAt:review.expiresAt,open,previous:{clearance:evidence.current.clearance!,audit:evidence.current.audit}});
    return {reference:review.reference,review,nativeOpenRequiresSeparateConfirmation:true,previousClearanceId:evidence.current.clearance!.id};
  }
  authorizeAdministrativeReauthorization(input:unknown,client:string){
    const data=parse(z.object({reference:uuid,approvalRef:uuid,confirmNativeOpen:z.literal(true),riskAccepted:z.literal(true)}).strict(),input);
    const plan=this.administrativePlans.get(data.reference);
    if(!plan?.previous||!plan.open||plan.binding.purpose!=='CLEARANCE_REAUTHORIZATION'||!this.owner||plan.expiresAt<=Date.now()||!uuid.safeParse(client).success)reject('ADMIN_REAUTH_REFERENCE_INVALID');
    if(plan.work){if(plan.consumption?.approvalHash!==ownerCertificateDigest(data.approvalRef)||plan.consumption.client!==client)reject('ADMIN_APPROVAL_REPLAY_BINDING_MISMATCH');return plan.work;}
    const approval=this.owner.consumeApproval(data.approvalRef,plan.binding);if(!approval.certificate)reject('OWNER_CERTIFICATE_REQUIRED');
    plan.consumption={approvalHash:ownerCertificateDigest(data.approvalRef),client};
    // Retain failure as well as success: a lost DB/Worker reply must never trigger a second mutation.
    plan.work=Promise.resolve().then(async()=>{
      const b=plan.binding,evidence=await this.reauthorizationEvidence(b.sessionId,b.executionId,plan.deviceId);
      if(evidence.current.session.revision!==b.revision||evidence.marker.digest!==b.priorMarkerSha256||ownerCertificateDigest(evidence.current.clearance)!==b.priorClearanceSha256||
        evidence.migrationSha256!==b.migrationSha256||teachRuntimeDigest()!==b.runtimeSha256||ownerAuthenticationRuntimeSha256()!==b.ownerAuthSha256)reject('ADMIN_REAUTH_REVIEW_STALE');
      const expiresAt=Date.now()+600000,staged=await this.worker({type:'ADMIN_REAUTHORIZE_STAGE',deviceId:plan.deviceId,certificate:approval.certificate,previousClearance:plan.previous!.clearance,expiresAt}) as {stageId:string;status:string;inspection:{state:string;physicalId:string;at:number;digest:string}};
      if(!uuid.safeParse(staged.stageId).success||staged.status!=='REAUTH_STAGED'||staged.inspection.state!=='CLEAR'||staged.inspection.physicalId!==b.physicalId||
        staged.inspection.at>Date.now()||Date.now()-staged.inspection.at>5000||!/^[a-f0-9]{64}$/.test(staged.inspection.digest))reject('ADMIN_REAUTH_INSPECTION_INVALID');
      const clearance:AdministrativeClearance={id:b.newClearanceId!,requestId:b.freshRequestId,sourceSha256:b.runtimeSha256,expiresAt};
      const audit=ClearanceReauthorizationAuditSchema.parse({approvalId:randomUUID(),action:'REAUTHORIZE',sessionId:b.sessionId,executionId:b.executionId,requestId:b.requestId,
        physicalId:b.physicalId,beforeRevision:b.revision,actorRef:'local-owner',authenticationEventSha256:ownerCertificateDigest(approval.certificate),acceptedAt:Date.now(),riskAccepted:true,
        cleanupClaim:'UNVERIFIED',pendingAssessment:'HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE',originalJournalSha256:b.journalSha256,priorMarkerSha256:b.priorMarkerSha256,
        preflightDigest:staged.inspection.digest,previousClearance:plan.previous!.clearance,newClearance:clearance});
      const child=await this.repository.reauthorizeAndAdmitFresh!(b.sessionId,b.revision,audit,b.successorSessionId!);
      const current=await this.repository.administrativeSession!(b.sessionId),persisted=await this.repository.getSession(child.id);
      const storedAudit=ClearanceReauthorizationAuditSchema.parse(current.audit.at(-1));
      if(child.id!==b.successorSessionId||persisted.id!==child.id||persisted.physicalId!==b.physicalId||persisted.ownership!=='HELD'||persisted.status!=='CREATED'||
        current.session.id!==b.sessionId||current.session.status!=='INTERRUPTED'||current.session.ownership!=='ADMIN_DISPOSED_UNVERIFIED'||current.session.physicalId!==b.physicalId||
        current.session.deviceId!==persisted.deviceId||current.session.revision!==b.revision+2||current.clearance?.id!==clearance.id||current.clearance.requestId!==clearance.requestId||
        current.clearance.sourceSha256!==clearance.sourceSha256||current.clearance.expiresAt!==clearance.expiresAt||current.clearance.successorSessionId!==child.id||
        current.clearance.consumptionAuthSha256!==audit.authenticationEventSha256||ownerCertificateDigest(storedAudit)!==ownerCertificateDigest(audit)||
        ownerCertificateDigest(current.audit.slice(0,-1))!==ownerCertificateDigest(plan.previous!.audit))reject('ADMIN_REAUTH_DATABASE_READBACK_MISMATCH');
      const observedAt=Date.now(),proof=await this.owner!.certifyDatabaseReadback(approval,{originalSessionId:b.sessionId,originalRevision:current.session.revision,
        originalOwnership:'ADMIN_DISPOSED_UNVERIFIED',physicalId:b.physicalId,clearanceId:clearance.id,freshRequestId:clearance.requestId,sourceSha256:clearance.sourceSha256,
        successorRef:child.id,successorOwnership:'HELD',observedAt});
      await this.worker({type:'ADMIN_REAUTHORIZE_COMMIT',executionId:b.executionId,stageId:staged.stageId,certificate:approval.certificate,readback:proof});
      this.freshAdmissions.set(plan.open!.requestId,{session:persisted,clearanceId:clearance.id,openHash:ownerCertificateDigest(plan.open),expiresAt:observedAt+5000});
      return this.open(plan.open,client);
    });return plan.work;
  }
  private async continuationEvidence(id:string,executionId:string,previousId:string,previousExecutionId:string,deviceId:string){
    await this.storageBinding();
    if(!this.repository.getContinuation||!this.repository.assertContinuationReady||!this.repository.continueAndAdmitFresh||!this.repository.continuationPredecessor||!this.repository.administrativeSession)reject('CONTINUATION_REPOSITORY_UNAVAILABLE');
    await this.repository.assertContinuationReady();
    const current=await this.repository.administrativeSession(id),previous=await this.repository.getSession(previousId);
    await this.repository.assertConsent(current.session.deviceId);
    if(current.session.status!=='INTERRUPTED'||current.session.ownership!=='ADMIN_DISPOSED_UNVERIFIED'||!current.clearance?.successorSessionId||previous.ownership!=='RELEASED'||previous.physicalId!==current.session.physicalId||previous.deviceId!==current.session.deviceId||!(await this.repository.continuationPredecessor(id,previousId)))reject('CONTINUATION_DATABASE_STATE_INVALID');
    if((await stat(this.administrativeJournal)).size>5000000)reject('ADMIN_JOURNAL_TOO_LARGE');
    const tasks=JSON.parse(await readFile(this.administrativeJournal,'utf8'));if(!Array.isArray(tasks))reject('ADMIN_JOURNAL_INVALID');
    const parents=tasks.filter(t=>t.executionId===executionId),children=tasks.filter(t=>t.executionId===previousExecutionId),task=parents[0],child=children[0];
    if(parents.length!==1||children.length!==1||task.deviceId!==deviceId||child.deviceId!==deviceId||task.physicalId!==current.session.physicalId||task.teachLifecycle||task.status!=='CANCELLED'||!task.finishedAt||!child.finishedAt||!child.teachLifecycle)reject('CONTINUATION_JOURNAL_BINDING_INVALID');
    const marker=parseAdministrativeAdmission(task.administrativeAdmission),journal=parseTeachLifecycle(child.teachLifecycle),state=teachLifecycleState(journal),ack=journal.events.at(-1);
    if(!current.audit.some((a)=>{const v=LegacyRetirementAuditSchema.safeParse(a);return v.success&&v.data.action==='DISPOSE'&&v.data.sessionId===id&&v.data.executionId===executionId&&v.data.requestId===marker.originalRequestId&&v.data.originalJournalSha256===marker.originalJournalSha256;})||marker.status!=='DISPATCHED'||marker.recordingRef!==id||marker.originalRequestId!==task.batchId||marker.successorRef!==previousId||marker.successorExecutionId!==previousExecutionId||marker.physicalId!==previous.physicalId||marker.databaseRevision!==current.session.revision||journal.binding.recordingRef!==previousId||journal.binding.executionId!==previousExecutionId||journal.binding.requestId!==marker.freshRequestId||journal.binding.physicalId!==previous.physicalId||!state.bindingVerified||!state.nativeSessionId||!state.nativeServerSha256||state.cleanup!=='PROVEN'||state.pending!=='NONE'||ack?.kind==='DB_RELEASE_CONFIRMED'&&ack.databaseRevision!==previous.revision||this.dashboard.mode==='POSTGRESQL_STORAGE'&&journal.binding.provenance!=='ANDROID_RUNTIME')reject('CONTINUATION_CLEANUP_BINDING_INVALID');
    return {current,previous,marker,state,migrationSha256:createHash('sha256').update(await readFile(join(process.cwd(),'db','teach','proposals','22_g3_continuation.sql'))).digest('hex')};
  }
  async prepareContinuation(input:unknown){
    if(!this.owner||(await this.owner.status()).issuerReady!==true)reject('OWNER_AUTHENTICATION_NOT_READY');
    const data=parse(z.object({id:uuid,executionId:uuid,previousId:uuid,previousExecutionId:uuid,open:openInput.omit({requestId:true})}).strict(),input);
    if(sensitiveMetadata(data.open.name)||decidePermission({source:data.open.command,stage:'REQUEST'}).decision==='DENY')reject('HARD_DENY');
    const e=await this.continuationEvidence(data.id,data.executionId,data.previousId,data.previousExecutionId,data.open.deviceId),runtimeSha256=teachRuntimeDigest();if(!runtimeSha256)reject('ADMIN_SOURCE_UNAVAILABLE');
    const preflight=await this.worker({type:'CONTINUATION_PREFLIGHT',deviceId:data.open.deviceId,expectedPhysicalId:e.previous.physicalId}) as {state:string;reason:string;physicalId:string;at:number};
    if(preflight.state!=='CLEAR'||preflight.physicalId!==e.previous.physicalId||preflight.at>Date.now()||Date.now()-preflight.at>5000)reject('CONTINUATION_PREFLIGHT_'+(/^[A-Z0-9_]{1,60}$/.test(preflight.reason)?preflight.reason:'UNAVAILABLE'));
    for(const[k,v]of this.administrativePlans)if(v.expiresAt<=Date.now())this.administrativePlans.delete(k);if(this.administrativePlans.size>=100)reject('ADMIN_CAPACITY');
    const open=parse(openInput,{...data.open,requestId:randomUUID()}),binding:OwnerOperation={purpose:'G3_CONTINUATION',sessionId:data.id,executionId:data.executionId,requestId:e.marker.originalRequestId,physicalId:e.previous.physicalId,revision:e.current.session.revision,journalSha256:e.marker.originalJournalSha256,runtimeSha256,ownerAuthSha256:ownerAuthenticationRuntimeSha256(),migrationSha256:e.migrationSha256,freshRequestId:open.requestId,successorSessionId:randomUUID(),newClearanceId:randomUUID(),priorClearanceSha256:ownerCertificateDigest(e.current.clearance),priorMarkerSha256:e.marker.digest,previousSessionId:data.previousId,previousExecutionId:data.previousExecutionId,previousRevision:e.previous.revision,previousLifecycleSha256:e.state.digest,freshSpecSha256:ownerCertificateDigest({appRef:open.appAlias,query:open.query}),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',summary:'Continue after verified cleanup and database release. Preserve parent audit and consumed clearance. Authorize one fresh OPEN for '+open.appAlias+'; query '+open.query+'. Unknown outcomes require reconciliation; never retry OPEN.'};
    const review=this.owner.prepareReview(binding);this.administrativePlans.set(review.reference,{binding,deviceId:open.deviceId,expiresAt:review.expiresAt,open,previous:{clearance:e.current.clearance!,audit:e.current.audit}});return {reference:review.reference,review,nativeOpenRequiresSeparateConfirmation:true};
  }
  authorizeContinuation(input:unknown,client:string){
    const data=parse(z.object({reference:uuid,approvalRef:uuid,confirmNativeOpen:z.literal(true),riskAccepted:z.literal(true)}).strict(),input),plan=this.administrativePlans.get(data.reference);
    if(!plan?.open||!plan.previous||plan.binding.purpose!=='G3_CONTINUATION'||!this.owner||plan.expiresAt<=Date.now()||!uuid.safeParse(client).success)reject('CONTINUATION_REFERENCE_INVALID');
    if(plan.work){if(plan.consumption?.approvalHash!==ownerCertificateDigest(data.approvalRef)||plan.consumption.client!==client)reject('ADMIN_APPROVAL_REPLAY_BINDING_MISMATCH');return plan.work;}
    const approval=this.owner.consumeApproval(data.approvalRef,plan.binding);if(!approval.certificate)reject('OWNER_CERTIFICATE_REQUIRED');
    plan.consumption={approvalHash:ownerCertificateDigest(data.approvalRef),client};
    plan.work=Promise.resolve().then(async()=>{
      const b=plan.binding,e=await this.continuationEvidence(b.sessionId,b.executionId,b.previousSessionId!,b.previousExecutionId!,plan.deviceId);
      if(e.current.session.revision!==b.revision||e.previous.revision!==b.previousRevision||e.state.digest!==b.previousLifecycleSha256||e.marker.digest!==b.priorMarkerSha256||ownerCertificateDigest(e.current.clearance)!==b.priorClearanceSha256||e.migrationSha256!==b.migrationSha256||teachRuntimeDigest()!==b.runtimeSha256||ownerAuthenticationRuntimeSha256()!==b.ownerAuthSha256)reject('CONTINUATION_REVIEW_STALE');
      const expiresAt=Date.now()+600000,staged=await this.worker({type:'CONTINUATION_STAGE',deviceId:plan.deviceId,certificate:approval.certificate,previousClearance:plan.previous!.clearance,expiresAt}) as {stageId:string;status:string;inspection:{state:string;physicalId:string;at:number;digest:string}};
      if(!uuid.safeParse(staged.stageId).success||staged.status!=='REAUTH_STAGED'||staged.inspection.state!=='CLEAR'||staged.inspection.physicalId!==b.physicalId||staged.inspection.at>Date.now()||Date.now()-staged.inspection.at>5000||!/^[a-f0-9]{64}$/.test(staged.inspection.digest))reject('CONTINUATION_INSPECTION_INVALID');
      const audit={binding:b,authenticationSha256:ownerCertificateDigest(approval.certificate),inspectionSha256:staged.inspection.digest,expiresAt},child=await this.repository.continueAndAdmitFresh!(audit),persisted=await this.repository.getSession(child.id),parent=await this.repository.administrativeSession!(b.sessionId),previous=await this.repository.getSession(b.previousSessionId!);
      if(lifecycleDigest(await this.repository.getContinuation!(b.newClearanceId!))!==lifecycleDigest(audit)||child.id!==b.successorSessionId||persisted.ownership!=='HELD'||persisted.status!=='CREATED'||persisted.physicalId!==b.physicalId||parent.session.revision!==b.revision||ownerCertificateDigest(parent)!==ownerCertificateDigest(e.current)||previous.ownership!=='RELEASED'||previous.revision!==b.previousRevision)reject('CONTINUATION_DATABASE_READBACK_MISMATCH');
      const observedAt=Date.now(),proof=await this.owner!.certifyDatabaseReadback(approval,{originalSessionId:b.sessionId,originalRevision:b.revision,originalOwnership:'ADMIN_DISPOSED_UNVERIFIED',physicalId:b.physicalId,clearanceId:b.newClearanceId!,freshRequestId:b.freshRequestId,sourceSha256:b.runtimeSha256,successorRef:child.id,successorOwnership:'HELD',observedAt});
      await this.worker({type:'CONTINUATION_COMMIT',executionId:b.executionId,stageId:staged.stageId,certificate:approval.certificate,readback:proof});
      this.freshAdmissions.set(plan.open!.requestId,{session:persisted,clearanceId:b.newClearanceId!,openHash:ownerCertificateDigest(plan.open),expiresAt:observedAt+5000});return this.open(plan.open,client);
    });return plan.work;
  }
  async admissionStatus(reference:string){
    if(!uuid.safeParse(reference).success)reject('INVALID_RECORDER_REQUEST');
    const plan=this.administrativePlans.get(reference);
    if(!plan||plan.binding.purpose!=='G3_CONTINUATION')return {state:'REFERENCE_UNAVAILABLE',nativeRetryAuthorized:false};
    if(!plan.work)return {state:'NOT_SUBMITTED',expiresAt:plan.expiresAt,nativeRetryAuthorized:false};
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([plan.work.then(result=>({state:'OPEN_RETURNED',recordingRef:(result as {id?:string})?.id,nativeRetryAuthorized:false}),error=>({state:'FAILED',code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'ADMISSION_OUTCOME_REQUIRES_RECONCILIATION',nativeRetryAuthorized:false})),new Promise(resolve=>{timer=setTimeout(()=>resolve({state:'PENDING',nativeRetryAuthorized:false}),250);})]);}finally{if(timer)clearTimeout(timer);}
  }
  cleanupProven(sessionId:string) {return this.cleanups.has(sessionId)||(this.durableCleanups.get(sessionId)?.expiresAt??0)>Date.now();}
  async prepareDurableRecovery(input:unknown){
    const data=parse(z.object({id:uuid,executionId:uuid,deviceId:z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/),authorizationId:uuid}).strict(),input);
    await this.storageBinding();const session=await this.storage.getSession(data.id);
    const prepared=RecoveryPreparedSchema.parse(await this.worker({type:'RECOVERY_PREPARE',recordingRef:session.id,executionId:data.executionId,deviceId:data.deviceId,physicalId:session.physicalId,authorizationId:data.authorizationId}));
    if(prepared.binding.recordingRef!==session.id||prepared.binding.physicalId!==session.physicalId||prepared.binding.executionId!==data.executionId||prepared.expiresAt<=Date.now()||
      this.dashboard.mode==='POSTGRESQL_STORAGE'&&prepared.binding.provenance!=='ANDROID_RUNTIME')reject('RECOVERY_EXACT_SESSION_MISMATCH');
    if(session.ownership==='RELEASED')return {status:'ALREADY_RELEASED',id:session.id,revision:session.revision,automaticResume:false};
    if(!['HELD','RETAINED_PENDING_CLEANUP'].includes(session.ownership)||session.status==='CREATED')reject('RECOVERY_DATABASE_STATE_INVALID');
    for(const[k,v]of this.recoveryPlans)if(v.prepared.expiresAt<=Date.now())this.recoveryPlans.delete(k);
    if(this.recoveryPlans.size>=100)reject('RECOVERY_CAPACITY');
    this.recoveryPlans.set(prepared.reference,{id:session.id,physicalId:session.physicalId,executionId:data.executionId,authorizationId:data.authorizationId,dbRevision:session.revision,prepared});
    return {reference:prepared.reference,id:session.id,executionId:data.executionId,physicalId:session.physicalId,revision:session.revision,expiresAt:prepared.expiresAt,cleanup:'PROVEN',requiresOwnerConfirmation:true,automaticResume:false,
      evidence:{journalRevision:prepared.revision,digest:prepared.digest,nativeSessionHash:lifecycleDigest(prepared.nativeSessionId),nativeServerSha256:prepared.nativeServerSha256,runtimeSha256:prepared.binding.runtimeSha256,teachRuntimeSha256:prepared.binding.teachRuntimeSha256,pending:'NONE'}};
  }
  async releaseDurableRecovery(input:unknown){
    const data=parse(z.object({reference:uuid,revision:z.number().int().positive(),authorizationId:uuid,confirmed:z.literal(true)}).strict(),input),plan=this.recoveryPlans.get(data.reference);
    if(!plan||plan.prepared.expiresAt<=Date.now()||plan.authorizationId!==data.authorizationId||plan.dbRevision!==data.revision)reject('RECOVERY_REFERENCE_INVALID');
    // Worker rechecks current owner authority even for duplicate confirmations.
    const proof=RecoveryProofSchema.parse(await this.worker({type:'RECOVERY_CONFIRM',reference:data.reference,revision:plan.prepared.revision,authorizationId:data.authorizationId,confirmed:true}));
    if(proof.binding.recordingRef!==plan.id||proof.binding.executionId!==plan.executionId||proof.binding.physicalId!==plan.physicalId||proof.nativeSessionId!==plan.prepared.nativeSessionId||proof.nativeServerSha256!==plan.prepared.nativeServerSha256||
      Date.now()-proof.verifiedAt>5000||proof.verifiedAt>Date.now()||this.dashboard.mode==='POSTGRESQL_STORAGE'&&proof.binding.provenance!=='ANDROID_RUNTIME')reject('RECOVERY_PROOF_INVALID');
    if(plan.work)return plan.work;
    plan.work=(async()=>{
      await this.storageBinding();const current=await this.storage.getSession(plan.id);
      if(current.physicalId!==plan.physicalId)reject('RECOVERY_EXACT_SESSION_MISMATCH');
      if(current.ownership==='RELEASED')return {status:'ALREADY_RELEASED',database:current,automaticResume:false};
      if(current.revision!==plan.dbRevision)reject('RECOVERY_DATABASE_REVISION_CONFLICT');
      this.durableCleanups.set(current.id,{physicalId:current.physicalId,expiresAt:proof.verifiedAt+5000});
      let released:TeachSession;
      try{released=await this.storage.releaseAfterCleanup({sessionId:current.id,revision:current.revision});}
      finally{this.durableCleanups.delete(current.id);}
      let audit='RECORDED';
      try{const readback=await this.storage.getSession(current.id);if(readback.ownership!=='RELEASED'||readback.physicalId!==plan.physicalId)reject('RECOVERY_READBACK_FAILED');
        await this.worker({type:'RECOVERY_RELEASE_ACK',reference:data.reference,authorizationId:data.authorizationId,databaseRevision:readback.revision});}
      catch{audit='PENDING_RECONCILIATION';}
      return {status:'RELEASED_AFTER_VERIFIED_CLEANUP',database:released,audit,automaticResume:false};
    })();return plan.work;
  }
  private async retainAdmissionUncertainty(session:TeachSession) {
    // An uncertain admission is not an Android ACK. Retain the already verified
    // physical scope conservatively until a trusted original Worker cleanup exists.
    const recording=await this.storage.transitionSession({sessionId:session.id,revision:session.revision,status:'RECORDING'});
    return this.storage.transitionSession({sessionId:recording.id,revision:recording.revision,status:'INTERRUPTED'});
  }
  async devices() {
    const result=await this.worker({type:'DEVICES'}) as {devices:{serial:string;status:string;physicalId?:string;identityVerified?:boolean;model?:string;busy?:boolean;readiness?:string}[]};
    return {mode:'LIVE_RECORDER',devices:result.devices.map(d=>({id:d.serial,label:(d.model??'Android')+' · …'+d.serial.slice(-4),
      state:d.status==='unauthorized'?'UNAUTHORIZED':d.status!=='device'?'OFFLINE':d.busy?'BUSY':!d.identityVerified?'UNAUTHORIZED':d.readiness==='UNLOCK_REQUIRED'?'LOCKED':d.readiness&&d.readiness!=='READY'?'UNKNOWN':'ONLINE',physicalId:d.physicalId}))};
  }
  open(input:unknown,client:string) {
    if(!uuid.safeParse(client).success) reject('INVALID_CLIENT_ID');
    const data=parse(openInput,input);
    if(sensitiveMetadata(data.name)||decidePermission({source:data.command,stage:'REQUEST'}).decision==='DENY') reject('HARD_DENY');
    const binding=JSON.stringify([client,data]),old=this.starts.get(data.requestId);
    if(old) {if(old.binding!==binding)reject('REQUEST_OWNER_MISMATCH');return old.work;}
    if(this.starts.size>=100)reject('RECORDER_CAPACITY');
    const work=Promise.resolve().then(async()=>{
      await this.storageBinding();await this.repository.assertConsent();
      if((await this.repository.listSkills()).some(s=>s.name.normalize('NFC').trim()===data.name.normalize('NFC').trim()))reject('SKILL_NAME_ALREADY_EXISTS');
      const identity=await this.worker({type:'IDENTITY',deviceId:data.deviceId}) as TransportIdentity & {serial:string};
      if(identity.serial!==data.deviceId||!/^android:[a-f0-9]{64}$/.test(identity.physicalId))reject('DEVICE_IDENTITY_MISMATCH');
      if(!this.repository.getOwnedSession)reject('RECORDER_OWNERSHIP_LOOKUP_REQUIRED');
      const authorized=this.freshAdmissions.get(data.requestId),owned=await this.repository.getOwnedSession(identity.physicalId);
      if(authorized&&(authorized.expiresAt<=Date.now()||authorized.openHash!==ownerCertificateDigest(data)||authorized.session.physicalId!==identity.physicalId||owned?.id!==authorized.session.id))reject('ADMIN_FRESH_OPEN_BINDING_INVALID');
      if(!authorized&&owned)reject('TEACH_OWNERSHIP_BUSY');
      let database=authorized?authorized.session:await this.storage.createSession({device:{serial:identity.serial,hardwareSerial:identity.hardwareSerial,model:identity.model,
        manufacturer:identity.manufacturer,...(identity.osVersion?{androidVersion:identity.osVersion}:{})},command:data.command});
      if(database.physicalId!==identity.physicalId)reject('DEVICE_IDENTITY_MISMATCH');
      let opened:TeachSessionView & {ownerToken:string};
      try {if(authorized)this.freshAdmissions.delete(data.requestId);opened=await this.worker({type:'OPEN',requestId:data.requestId,recordingRef:database.id,deviceId:data.deviceId,expectedPhysicalId:identity.physicalId,appRef:data.appAlias,query:data.query,...(authorized?{administrativeClearance:authorized.clearanceId}:{})}) as typeof opened;}
      catch(error) {
        if(!(error instanceof LiveTeachError)||error.code==='WORKER_UNAVAILABLE_OR_OUTCOME_UNKNOWN')await this.retainAdmissionUncertainty(database);
        throw error;
      }
      if(!opened||opened.recordingRef!==database.id||opened.physicalId!==database.physicalId||opened.deviceId!==data.deviceId||!uuid.safeParse(opened.leaseId).success||
        !/^[a-f0-9]{64}$/.test(opened.ownerToken)||!opened.sessionId){await this.retainAdmissionUncertainty(database);reject('WORKER_RECEIPT_MISMATCH');}
      const record:LiveRecord={id:database.id,name:data.name,appAlias:data.appAlias,query:data.query,client,token:opened.ownerToken,worker:opened,database,revision:1,busy:false,actions:[],receipts:[],attempts:new Map(),controls:new Map()};
      this.records.set(record.id,record);
      try {database=await this.storage.transitionSession({sessionId:database.id,revision:database.revision,status:'RECORDING'});record.database=database;}
      catch(error) {
        const stopped=await this.worker({type:'CANCEL',leaseId:opened.leaseId,ownerToken:opened.ownerToken}).catch(()=>undefined) as TeachSessionView|undefined;
        if(stopped?.cleanup==='PROVEN'&&stopped.recordingRef===record.id&&stopped.physicalId===record.database.physicalId)this.cleanups.set(record.id,stopped.physicalId);
        throw error;
      }
      return {...this.view(record),ownerToken:record.token};
    });
    this.starts.set(data.requestId,{binding,work});return work;
  }
  private record(id:string,token:string):LiveRecord {
    const record=this.records.get(id);if(!record)reject('RECORDER_MEMORY_LOST');
    const a=Buffer.from(token),b=Buffer.from(record.token);if(a.length!==b.length||!timingSafeEqual(a,b))reject('RECORDER_OWNER_MISMATCH');return record;
  }
  private view(r:LiveRecord) {return {id:r.id,name:r.name,appAlias:r.appAlias,query:r.query,revision:r.revision,mode:'LIVE_RECORDER' as const,
    worker:r.worker,database:{status:r.database.status,ownership:r.database.ownership},receipts:r.receipts,observations:r.observations??[],annotations:r.annotations??[],companionPaired:!!r.companion,review:r.review,semanticCompilation:r.semanticCompilation,blockReason:r.blocked};}
  private async command(r:LiveRecord,type:string,body:object={}) {
    try{return await this.worker({type,leaseId:r.worker.leaseId,ownerToken:r.token,...body});}
    catch(error){if(type==='STEP'&&(!(error instanceof LiveTeachError)||!['STALE_FRAME','TEACH_INVALID_STATE','TEACH_ACTION_LIMIT'].includes(error.code)))r.blocked='STEP_OUTCOME_REQUIRES_RECONCILIATION';throw error;}
  }
  private match(r:LiveRecord,view:TeachSessionView) {
    if(view.recordingRef!==r.id||view.deviceId!==r.worker.deviceId||view.physicalId!==r.database.physicalId||view.executionId!==r.worker.executionId||view.sessionId!==r.worker.sessionId||view.leaseId!==r.worker.leaseId){r.blocked='WORKER_RECEIPT_MISMATCH';reject('WORKER_RECEIPT_MISMATCH');}
  }
  async state(id:string,token:string) {
    const r=this.record(id,token),view=await this.command(r,'STATE') as TeachSessionView;this.match(r,view);r.worker=view;
    r.database=await this.storage.getSession(r.id);return this.view(r);
  }
  async frame(id:string,token:string):Promise<TeachFrame> {
    const r=this.record(id,token);if(r.busy)reject('RECORDER_REQUEST_PENDING');
    const frame=await this.command(r,'FRAME') as TeachFrame;
    if(frame.recordingRef!==r.id||frame.deviceId!==r.worker.deviceId||frame.physicalId!==r.database.physicalId||frame.sessionId!==r.worker.sessionId)reject('WORKER_RECEIPT_MISMATCH');r.lastFrame=frame;return frame;
  }
  async pairCompanion(id:string,token:string,input:unknown){
    const data=parse(z.object({token:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict(),input),r=this.record(id,token);
    if(r.busy||r.companion)reject('COMPANION_PAIRING_BUSY');r.busy=true;
    try{const state=await this.command(r,'STATE') as TeachSessionView;this.match(r,state);if(state.cleanup!=='PENDING'||!['RECORDING','PAUSED'].includes(state.status)||r.database.ownership!=='HELD')reject('RECORDER_STREAM_NOT_ACTIVE');r.companion=await CompanionTransport.pair(r.worker.deviceId,data.token);return this.view(r);}finally{r.busy=false;}
  }
  async observedEvents(id:string,token:string){
    const r=this.record(id,token);if(r.busy)reject('RECORDER_REQUEST_PENDING');if(!r.companion)return this.view(r);
    const state=await this.command(r,'STATE') as TeachSessionView;this.match(r,state);if(state.cleanup!=='PENDING')reject('RECORDER_STREAM_NOT_ACTIVE');
    const rows=await r.companion.events();r.observations=rows;return this.view(r);
  }
  async annotate(id:string,token:string,input:unknown){
    const r=this.record(id,token),data=parse(z.object({requestId:uuid,sequence:z.number().int().nonnegative().optional(),choice:z.enum(['SEARCH_BUTTON','OTHER_BUTTON','FIELD','TEXT','SUBMIT','SCROLL','BACK','OTHER','SKIP']),frameId:uuid.optional(),targetId:z.string().max(80).optional(),physicalActionConfirmed:z.literal(true)}).strict(),input);
    if(r.busy||!['RECORDING','PAUSED'].includes(r.worker.status))reject('RECORDER_STALE_OR_INVALID_STATE');
    const previous=r.annotations?.find(a=>a.id===data.requestId);if(previous){if(previous.choice!==data.choice||previous.sequence!==data.sequence||previous.target?.id!==data.targetId)reject('ANNOTATION_REQUEST_MISMATCH');return this.view(r);}
    if((r.annotations?.length??0)>=100)reject('ANNOTATION_LIMIT');if(data.sequence!==undefined&&!r.observations?.some(e=>e.sequence===data.sequence))reject('OBSERVATION_NOT_FOUND');
    const target=data.targetId?r.lastFrame?.controls.find(c=>c.id===data.targetId):undefined;
    if(data.targetId&&(!target||!r.lastFrame||r.lastFrame.id!==data.frameId||r.lastFrame.expiresAt<Date.now()))reject('ANNOTATION_TARGET_STALE');
    r.busy=true;
    try{
      const state=await this.command(r,'STATE') as TeachSessionView;this.match(r,state);r.worker=state;if(state.cleanup!=='PENDING'||!['RECORDING','PAUSED'].includes(state.status))reject('RECORDER_STREAM_NOT_ACTIVE');
      const annotation={id:data.requestId,...(data.sequence!==undefined?{sequence:data.sequence}:{}),choice:data.choice,source:'PHYSICAL_DEVICE' as const,provenance:'HUMAN_ANNOTATED' as const,verification:'UNVERIFIED' as const,at:Date.now(),...(target?{target}: {})};
      const parts=['data','teach-mode','observations',r.id];let directory=process.cwd();
      for(const part of parts){directory=join(directory,part);await mkdir(directory,{recursive:true});const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())reject('ANNOTATION_STORAGE_UNSAFE');}
      const observation=r.observations?.find(e=>e.sequence===data.sequence);
      await writeFile(join(directory,data.requestId+'.json'),JSON.stringify({version:1,recordingRef:r.id,physicalId:r.database.physicalId,annotation,observation:observation??null,missingObservationReason:observation?null:'NO_NATIVE_EVENT',nativeDispatchReceipt:null}),{flag:'wx',mode:0o600});
      r.annotations??=[];r.annotations.push(annotation);return this.view(r);
    }catch(error){r.blocked='ANNOTATION_PERSISTENCE_REQUIRES_RECONCILIATION';throw error;}finally{r.busy=false;}
  }
  async screenStreamFrame(id:string,token:string) {
    const r=this.record(id,token);if(r.busy)reject('RECORDER_REQUEST_PENDING');
    let state=r.worker;
    if(Date.now()-(r.streamCheckedAt??0)>=1000){state=await this.command(r,'STATE') as TeachSessionView;this.match(r,state);r.worker=state;r.streamCheckedAt=Date.now();}
    if(state.cleanup==='PROVEN'||!['RECORDING','PAUSED'].includes(state.status))reject('RECORDER_STREAM_NOT_ACTIVE');
    if(r.companion){const frame=await r.companion.frame(),meta=await sharp(Buffer.from(frame.image,'base64'),{limitInputPixels:16000000}).metadata();if(!meta.width||!meta.height||meta.width>frame.width||Math.abs(meta.width/meta.height-frame.width/frame.height)>0.005)reject('COMPANION_GEOMETRY_INVALID');return {...frame,status:state.status};}
    const png=await captureAndroidScreenshot(r.worker.deviceId),source=sharp(png,{limitInputPixels:16000000}),meta=await source.metadata();
    if(!meta.width||!meta.height)reject('RECORDER_STREAM_FRAME_INVALID');
    const image=await sharp(png,{limitInputPixels:16000000}).resize({width:720,withoutEnlargement:true}).jpeg({quality:72}).toBuffer();
    if(image.byteLength>1024*1024)reject('RECORDER_STREAM_FRAME_TOO_LARGE');
    return {image:image.toString('base64'),width:meta.width,height:meta.height,at:Date.now(),status:state.status,transport:'ADB_SCREENSHOT_POLLING'};
  }
  claimScreenStream(id:string,token:string) {
    this.record(id,token);if(this.activeScreenStreams.has(id))reject('RECORDER_STREAM_ALREADY_CONNECTED');
    this.activeScreenStreams.add(id);let closed=false;
    return {read:()=>{if(closed)reject('RECORDER_STREAM_CLOSED');return this.screenStreamFrame(id,token);},close:()=>{if(!closed){closed=true;this.activeScreenStreams.delete(id);this.records.get(id)?.companion?.stopFrames();}}};
  }
  step(id:string,token:string,input:unknown) {
    const r=this.record(id,token),data=parse(stepInput,input),binding=JSON.stringify(data),old=r.attempts.get(data.requestId);
    if(old){if(old.binding!==binding)reject('REQUEST_BINDING_MISMATCH');return old.work;}
    if(r.blocked)reject(r.blocked);
    if(r.busy||data.revision!==r.revision||r.database.status!=='RECORDING'||r.worker.status!=='RECORDING'||r.review)reject('RECORDER_STALE_OR_INVALID_STATE');
    if(r.receipts.some(a=>a.persistence!=='PERSISTED'&&!a.excluded))reject('RECORDING_PERSISTENCE_UNRESOLVED');
    r.busy=true;
    const work=Promise.resolve().then(async()=>{
      await this.repository.assertConsent(r.database.deviceId);
      const {revision:ignored,...step}=data;void ignored;
      const receipt=await this.command(r,'STEP',step) as TeachReceipt;
      this.match(r,{...r.worker,...receipt});
      if(receipt.requestId!==data.requestId||receipt.operation!==data.operation||!uuid.safeParse(receipt.id).success||!['ACK','NOT_SENT','UNKNOWN'].includes(receipt.dispatch)){r.blocked='WORKER_RECEIPT_MISMATCH';reject('WORKER_RECEIPT_MISMATCH');}
      if(r.receipts.some(a=>a.id===receipt.id))reject('DUPLICATE_WORKER_RECEIPT');
      const row={...receipt,persistence:'NOT_PERSISTED' as 'PERSISTED'|'NOT_PERSISTED'};r.receipts.push(row);
      if(receipt.action) {
        const actions=[...r.actions,receipt.action];
        try {await this.storage.recordObservedAction({sessionId:r.id,name:r.name,appAlias:r.appAlias,actions,receipt:receipt.dispatch,before:receipt.before,...(receipt.after?{after:receipt.after}:{}),
          runtime:{receiptId:receipt.id,executionId:receipt.executionId,sessionIdentity:receipt.sessionId,physicalId:receipt.physicalId,beforeObservationId:receipt.beforeSnapshotId,
            ...(receipt.afterSnapshotId?{afterObservationId:receipt.afterSnapshotId}:{}),result:receipt.verification,...(receipt.evidenceId?{evidenceId:receipt.evidenceId}:{})}});}
        catch(error){
          const current=await this.command(r,'STATE').catch(()=>undefined) as TeachSessionView|undefined;
          if(current){this.match(r,current);r.worker=current;if(current.status==='RECORDING')r.worker=await this.command(r,'PAUSE') as TeachSessionView;}
          throw error;
        }
        r.actions=actions;row.persistence='PERSISTED';
      }
      const state=await this.command(r,'STATE') as TeachSessionView;this.match(r,state);r.worker=state;
      return this.view(r);
    }).finally(()=>{r.busy=false;r.revision++;}).then(()=>this.view(r));
    r.attempts.set(data.requestId,{binding,work});return work;
  }
  control(id:string,token:string,operation:'pause'|'resume'|'stop'|'cancel',input:unknown) {
    const r=this.record(id,token),data=parse(revisionInput,input);
    const key=operation+':'+data.revision,old=r.controls.get(key);if(old)return old;
    if(r.worker.cleanup==='PROVEN')return Promise.resolve(this.view(r));
    if(r.busy&&operation!=='cancel'||(operation==='cancel'?data.revision>r.revision:data.revision!==r.revision))reject('RECORDER_STALE_OR_INVALID_STATE');
    if(operation==='resume'&&(r.blocked||r.receipts.some(a=>a.persistence!=='PERSISTED'&&!a.excluded||a.dispatch==='UNKNOWN')))reject('RECORDING_PERSISTENCE_UNRESOLVED');
    r.busy=true;
    const work=Promise.resolve().then(async()=>{
    try {
      const view=await this.command(r,operation.toUpperCase()) as TeachSessionView;this.match(r,view);r.worker=view;
      if(operation==='cancel')await Promise.allSettled([...r.attempts.values()].map(a=>a.work));
      if(operation==='stop'||operation==='cancel') {
        if(view.cleanup!=='PROVEN') {
          r.database=await this.storage.transitionSession({sessionId:r.id,revision:r.database.revision,status:'INTERRUPTED'});
          throw new TeachStorageError('CLEANUP_UNPROVEN');
        }
        if(r.companion){await r.companion.close();r.companion=undefined;}
        this.cleanups.set(r.id,view.physicalId);
        try {r.database=await this.storage.transitionSession({sessionId:r.id,revision:r.database.revision,status:operation==='cancel'?'CANCELLED':view.status==='INTERRUPTED'?'INTERRUPTED':'REVIEWING'});}
        catch(error) {
          // Revocation stops new writes, but the existing cleanup-only service may
          // mark the recording INTERRUPTED and release a proven native cleanup.
          if(!(error instanceof TeachStorageError)||error.code!=='NO_REMOTE_CONSENT')throw error;
        }
        finally {r.database=await this.storage.releaseAfterCleanup({sessionId:r.id,revision:(await this.storage.getSession(r.id)).revision});}
      }
    } finally {r.busy=false;r.revision++;}
    return this.view(r);
    });r.controls.set(key,work);return work;
  }
  async compile(id:string,token:string,input:unknown) {
    const r=this.record(id,token),data=parse(compileInput,input);
    if(r.blocked||r.busy||data.revision!==r.revision||r.database.status!=='REVIEWING'||r.database.ownership!=='RELEASED'||r.worker.cleanup!=='PROVEN')reject('RECORDER_NOT_READY_FOR_REVIEW');
    if(r.annotations?.some(a=>a.choice!=='SKIP'))reject('PHYSICAL_ACTION_VERIFICATION_REQUIRED');
    if(!r.actions.length||r.receipts.some(a=>!a.excluded&&(a.verification!=='PASSED'||a.persistence!=='PERSISTED'||!a.action)))reject('RECORDING_EVIDENCE_INCOMPLETE');
    if(r.actions.some(a=>a.operation==='INPUT_TEXT')&&!data.parameterizeQuery)reject('PARAMETER_REVIEW_REQUIRED');
    const rows=r.receipts.filter(receipt=>!receipt.excluded);
    const normalized=compileRecordedSkill({contractVersion:1,name:r.name,appAlias:r.appAlias,ownerParameterizationConfirmed:data.parameterizeQuery,
      origin:rows[0]?.provenance==='ANDROID_RUNTIME'?'ANDROID_RUNTIME':'SIMULATED_RECEIPT',recordingRef:r.id,deviceId:r.worker.deviceId,physicalId:r.database.physicalId,
      executionId:r.worker.executionId,sessionId:r.worker.sessionId,actions:rows.map((row,index)=>{
        const {persistence,excluded:ignored,...receipt}=row;void ignored;return {order:index+1,persistence,receipt};
      })});
    const result=normalized.compilation;r.semanticCompilation=normalized;
    if(result.status!=='DRAFT')return {...this.view(r),compilation:result};
    r.busy=true;
    try {
      r.database=await this.storage.transitionSession({sessionId:r.id,revision:r.database.revision,status:'COMPILED'});
      r.review=await this.dashboard.prepareRecordedReview({sourceSessionId:r.id,name:r.name,appAlias:r.appAlias,actions:r.actions});
    } finally {r.busy=false;r.revision++;}
    return this.view(r);
  }
  reviewIntent(id:string,token:string,input:unknown) {
    const r=this.record(id,token),data=parse(z.object({revision:z.number().int().positive(),receiptId:uuid,confirmed:z.literal(true)}).strict(),input);
    if(r.busy||data.revision!==r.revision)reject('RECORDER_STALE_OR_INVALID_STATE');
    const receipt=r.receipts.find(a=>a.id===data.receiptId);
    if(!receipt||receipt.dispatch!=='NOT_SENT'||receipt.action||receipt.evidenceId||receipt.verification==='PASSED')reject('CANNOT_EXCLUDE_EXECUTED_OR_UNKNOWN_ACTION');
    receipt.excluded=true;r.revision++;return this.view(r);
  }
  async recoverCleanup(input:unknown,token:string) {
    const data=parse(z.object({id:uuid,leaseId:uuid}).strict(),input);
    const database=await this.storage.getSession(data.id);
    const state=await this.worker({type:'STATE',leaseId:data.leaseId,ownerToken:token}) as TeachSessionView;
    if(state.recordingRef!==database.id||state.physicalId!==database.physicalId)reject('WORKER_RECEIPT_MISMATCH');
    if(database.ownership==='RELEASED')return {mode:'LIVE_RECORDER',status:database.status,database,automaticResume:false};
    const stopped=await this.worker({type:'STOP',leaseId:data.leaseId,ownerToken:token}) as TeachSessionView;
    if(stopped.recordingRef!==database.id||stopped.physicalId!==database.physicalId||stopped.sessionId!==state.sessionId||stopped.cleanup!=='PROVEN')throw new TeachStorageError('CLEANUP_UNPROVEN');
    this.cleanups.set(database.id,database.physicalId);
    return {mode:'LIVE_RECORDER',status:'INTERRUPTED',database:await this.storage.releaseAfterCleanup({sessionId:database.id,revision:database.revision}),automaticResume:false};
  }
}
