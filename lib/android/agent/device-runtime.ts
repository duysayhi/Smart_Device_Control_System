import { randomUUID } from 'node:crypto';
import type { AndroidAdbDevice } from '../../../types/device';
import { AgentBudget } from './budget';
import type { AgentGoal, AgentProgress } from './schema';
import type { AgentExecution } from './agent-loop';
import { runAgent } from './agent-loop';
import { planGoal } from './goal-planner';
import { createAgentExecution } from './agent-loop';
import { listAndroidDevices, runAdb } from '../adb';
import { asAndroidError, checkCancellation, AndroidExecutionError } from '../errors';
import type { Observation } from '../state-observer';
import { waitForHuman, submitHumanChoice } from './human-assistance';
import { type DeviceTask, type RuntimeCommandValue, terminalTask } from './runtime-schema';
import { discoverApplication } from './application-discovery';
import { acquireDeviceLock, readDeviceOwnership } from '../appium/session-manager';
import { androidV2Adapter, runAgentV2, type V2Adapter } from './agent-v2';
import { submitAssistanceV2 } from './human-assistance-v2';
import { OwnerTestPolicy, assertOwnerTestExecution, type OwnerTestExecution, type OwnerTestMode } from './owner-test-policy';
import { decidePermission } from './permission-decision';
import { prepareV2, type PreparedV2 } from './prepared-v2';
import type { PreparedView } from '../unified-agent/contracts';
import { requireDemoCapabilities } from '../unified-agent/demo-catalog';
import { TeachSession, TeachRuntimeError } from './teach-session';
import type { TeachCommandValue } from './teach-contracts';
import { captureAndroidScreenshot } from '../adb';
import { focusedWindowPrivacy } from './teach-frame-privacy';
import { readTransportIdentity } from '../transport-identity';
import { UnifiedSkillReplayAdapter, type ReplayCommandValue } from './skill-replay-adapter';
import { loadSkillProgram, bindSkillParameters } from '../../skills/skill-program';
import { SkillReplayController } from '../../skills/skill-replay';
import { searchQuery } from './generic-search';
import { androidRuntimeDigest, teachRuntimeDigest } from './runtime-storage';
import { appendTeachLifecycle, createTeachLifecycle, parseTeachLifecycle, teachLifecycleState, lifecycleDigest, type TeachLifecycleEvent } from './teach-lifecycle';
import { verifyNativeSessionAbsent } from '../appium/session-lifecycle';
import { AppiumClient } from '../appium/client';
import {administrativeAdmission,parseAdministrativeAdmission,AdministrativeClearanceSchema} from '../../skills/legacy-retirement-contracts';
import {verifyOwnerCertificate,verifyOwnerDatabaseReadback,ownerCertificateDigest,readOwnerPublicAuthority,ownerAuthenticationRuntimeSha256} from '../../owner-auth/certificates';
import {inspectRetirementNativeState,type RetirementNativeInspection} from '../../skills/retirement-native-preflight';

export interface RuntimeAdapter {
  administrativeAuthority?():Promise<{publicKey:string;credentialHash:string}>;
  inspectAdministrativeState?(serial:string,physicalId:string):Promise<RetirementNativeInspection>;
  verifyTeachCleanup?(nativeSessionId:string,physicalId:string,deviceId:string,nativeServerSha256:string):Promise<boolean>;
  teachIdentity?(serial: string): ReturnType<typeof readTransportIdentity>;
  teachFrame?: { capture(serial: string): Promise<Buffer>; privacy(serial: string, packageName: string): Promise<'SAFE_WINDOW'|'SECURE_WINDOW'|'UNKNOWN'> };
  v2?(serial: string, budget: AgentBudget): V2Adapter;
  reserve?(serial: string, executionId: string): Promise<() => Promise<void>>;
  discover(): Promise<AndroidAdbDevice[]>;
  plan(request: string, budget: AgentBudget, signal: AbortSignal, serial?: string): Promise<AgentGoal>;
  open(goal: AgentGoal, budget: AgentBudget, serial: string, signal: AbortSignal): Promise<AgentExecution>;
}
export const androidRuntimeAdapter: RuntimeAdapter = {
  async reserve(serial, executionId) {
    const identity = (await listAndroidDevices()).find(device => device.serial === serial);
    if (!identity || identity.status !== 'device') throw new Error('Device disconnected before planning.');
    const release = await acquireDeviceLock('device-reservation:' + (identity.physicalId ?? serial));
    try { await release.recordSession('', executionId, serial); return release; }
    catch (error) { await release(); throw error; }
  },
  discover: listAndroidDevices,
  async plan(request, budget, signal, serial) {
    if (!serial) throw new Error('Application discovery requires the selected device.');
    return (await planGoal(request, budget, undefined, signal, app => discoverApplication(serial, app, runAdb, signal))).goal;
  },
  open: (goal, budget, serial, signal) => createAgentExecution(goal, budget, serial, runAdb, signal),
};
interface PreparedEntry { source: string; deviceId: string; physicalId: string; engine: 'V1' | 'V2'; expiresAt: number; ownerId?: string; goal?: AgentGoal; v2?: PreparedV2 }
interface RuntimeEntry { task: DeviceTask; controller: AbortController; done?: Promise<void>; memory?: unknown; disconnected: boolean; ownerScope?: OwnerTestExecution; prepared?: PreparedEntry; attestationFailed?:boolean }
export class DeviceRuntimeRegistry {
  private readonly administrativeOwnerSource=(()=>{try{return ownerAuthenticationRuntimeSha256();}catch{return undefined;}})();
  private administrativeFences=new Map<string,{physicalId:string;release:()=>Promise<void>}>();
  private administrativeReauthorizing=new Set<string>();
  administrativeReauthorizationPending(){return this.administrativeReauthorizing.size>0;}
  private async reauthorizeAdministrative(command:Extract<TeachCommandValue,{type:'ADMIN_REAUTHORIZE_STAGE'|'ADMIN_REAUTHORIZE_COMMIT'|'CONTINUATION_STAGE'|'CONTINUATION_COMMIT'}>){
    const authority=await(this.adapter.administrativeAuthority?.()??readOwnerPublicAuthority());
    const certificate=verifyOwnerCertificate(command.certificate,authority.publicKey,authority.credentialHash),b=certificate.binding;
    const continuation=command.type.startsWith('CONTINUATION_');
    const entry=this.entries.get(b.executionId),old=entry?.task.administrativeAdmission;
    if(b.purpose!==(continuation?'G3_CONTINUATION':'CLEARANCE_REAUTHORIZATION')||!entry||!old||entry.task.teachLifecycle||entry.task.status!=='CANCELLED'||!entry.task.finishedAt||
      entry.task.latest?.counters?.steps!==0||entry.task.latest?.counters?.snapshots!==0||b.sessionId!==old.recordingRef||b.requestId!==entry.task.batchId||
      b.physicalId!==entry.task.physicalId||b.journalSha256!==old.originalJournalSha256||b.runtimeSha256!==this.lifecycleSource.teachRuntimeSha256||
      b.runtimeSha256!==teachRuntimeDigest()||b.ownerAuthSha256!==this.administrativeOwnerSource||b.ownerAuthSha256!==ownerAuthenticationRuntimeSha256())throw new TeachRuntimeError('ADMIN_REAUTH_BINDING_INVALID');
    if(this.administrativeReauthorizing.has(b.physicalId))throw new TeachRuntimeError('ADMIN_REAUTH_CONCURRENT');
    this.administrativeReauthorizing.add(b.physicalId);
    try{
      if(command.type==='ADMIN_REAUTHORIZE_COMMIT'||command.type==='CONTINUATION_COMMIT'){
        const proof=verifyOwnerDatabaseReadback(command.readback,authority.publicKey,certificate);
        if(command.executionId!==b.executionId||command.stageId!==old.stageId||old.status!=='REAUTH_STAGED'||old.expiresAt<=Date.now()||
          !this.administrativeFences.has(old.stageId)||old.approvalSha256!==ownerCertificateDigest(certificate)||old.freshRequestId!==b.freshRequestId||
          proof.originalRevision!==b.revision+(continuation?0:2)||proof.clearanceId!==b.newClearanceId||old.clearanceId!==b.newClearanceId||
          proof.successorRef!==b.successorSessionId||proof.successorOwnership!=='HELD')throw new TeachRuntimeError('ADMIN_REAUTH_COMMIT_INVALID');
        const {digest,...marker}=old;void digest;
        entry.task.administrativeAdmission=administrativeAdmission({...marker,status:'AUTHORIZED',databaseRevision:proof.originalRevision,
          successorRef:proof.successorRef,freshSpecSha256:b.freshSpecSha256,readbackValidUntil:proof.observedAt+5000});
        this.changed();await this.flushCheckpoint();return {status:'AUTHORIZED',cleanup:'UNVERIFIED'};
      }
      const prior=AdministrativeClearanceSchema.parse(command.previousClearance);
      if((continuation?old.status!=='DISPATCHED'||old.successorRef!==b.previousSessionId||old.successorExecutionId!==b.previousExecutionId:old.status!=='RETIRED'||!!old.successorRef||!!old.successorExecutionId)||old.databaseRevision!==b.revision||old.digest!==b.priorMarkerSha256||
        (!continuation&&(old.clearanceId!==prior.id||old.freshRequestId!==prior.requestId||old.sourceSha256!==prior.sourceSha256||old.expiresAt!==prior.expiresAt))||
        ownerCertificateDigest(prior)!==b.priorClearanceSha256||(!continuation&&!!prior.successorSessionId)||b.freshRequestId===old.freshRequestId||b.newClearanceId===old.clearanceId||
        command.expiresAt<=Date.now()||command.expiresAt>Date.now()+600000||(old.reauthorizations?.length??0)>=16)throw new TeachRuntimeError('ADMIN_REAUTH_PRIOR_INVALID');
      if(continuation){
        const previous=this.entries.get(b.previousExecutionId!),journal=previous?.task.teachLifecycle;
        if(!journal||previous!.attestationFailed||journal.binding.recordingRef!==b.previousSessionId||journal.binding.physicalId!==b.physicalId||journal.binding.executionId!==b.previousExecutionId||journal.binding.requestId!==old.freshRequestId||previous!.task.deviceId!==command.deviceId||!previous!.task.finishedAt)throw new TeachRuntimeError('CONTINUATION_PREDECESSOR_MISMATCH');
        const state=teachLifecycleState(journal),ack=journal.events.at(-1);
        if(state.digest!==b.previousLifecycleSha256||state.pending!=='NONE'||state.cleanup!=='PROVEN'||!state.bindingVerified||!state.nativeSessionId||!state.nativeServerSha256||ack?.kind==='DB_RELEASE_CONFIRMED'&&ack.databaseRevision!==b.previousRevision)throw new TeachRuntimeError('CONTINUATION_CLEANUP_REQUIRED');
        const client=this.adapter===androidRuntimeAdapter?new AppiumClient():undefined;
        let absent=false;try{absent=this.adapter.verifyTeachCleanup?await this.adapter.verifyTeachCleanup(state.nativeSessionId,b.physicalId,command.deviceId,state.nativeServerSha256):client?client.endpointFingerprint()===state.nativeServerSha256&&!await readDeviceOwnership(command.deviceId,runAdb)&&await verifyNativeSessionAbsent(client,state.nativeSessionId):false;}catch{throw new TeachRuntimeError('CONTINUATION_NATIVE_ABSENCE_UNVERIFIED');}
        if(!absent||teachLifecycleState(previous!.task.teachLifecycle).digest!==state.digest)throw new TeachRuntimeError('CONTINUATION_NATIVE_ABSENCE_UNVERIFIED');
      }
      if(this.activeByPhysical.has(b.physicalId)||this.activeBySerial.has(command.deviceId)||command.deviceId!==entry.task.deviceId)throw new TeachRuntimeError('ADMIN_REAUTH_DEVICE_BUSY');
      for(const other of this.entries.values())if(other.task.physicalId===b.physicalId&&other.task.teachLifecycle){
        const state=teachLifecycleState(other.task.teachLifecycle);
        if(state.pending!=='NONE'||state.cleanup!=='PROVEN')throw new TeachRuntimeError('ADMIN_REAUTH_EFFECT_UNRESOLVED');
      }
      const device=(await this.adapter.discover()).find(d=>d.serial===command.deviceId&&d.status==='device'&&d.identityVerified&&d.physicalId===b.physicalId);
      if(!device)throw new TeachRuntimeError('ADMIN_REAUTH_IDENTITY_MISMATCH');
      // A restored journal is not a private lease. Reuse the fence or acquire through the normal lock; stale locks remain blocked.
      const held=this.administrativeFences.get(old.stageId),release=held?.release??await this.adapter.reserve?.(command.deviceId,old.stageId);
      if(!release||held&&held.physicalId!==b.physicalId)throw new TeachRuntimeError('ADMIN_REAUTH_RESERVATION_REQUIRED');
      let persisted=false;
      try{
        const inspection=await(this.adapter.inspectAdministrativeState?.(command.deviceId,b.physicalId)??inspectRetirementNativeState(command.deviceId,b.physicalId));
        if(inspection.state!=='CLEAR'||inspection.physicalId!==b.physicalId||inspection.at>Date.now()||Date.now()-inspection.at>5000||!/^[a-f0-9]{64}$/.test(inspection.digest))throw new TeachRuntimeError('ADMIN_REAUTH_SAFETY_'+inspection.reason);
        verifyOwnerCertificate(certificate,authority.publicKey,authority.credentialHash);
        if(held&&this.administrativeFences.get(old.stageId)!==held)throw new TeachRuntimeError('ADMIN_REAUTH_RESERVATION_LOST');
        if(entry.task.administrativeAdmission?.digest!==old.digest)throw new TeachRuntimeError('ADMIN_REAUTH_CONCURRENT_CHANGE');
        const stageId=randomUUID();
        const previous={stageId:old.stageId,clearanceId:old.clearanceId!,freshRequestId:old.freshRequestId,sourceSha256:old.sourceSha256,ownerAuthSha256:old.ownerAuthSha256,
          approvalSha256:old.approvalSha256,expiresAt:old.expiresAt,databaseRevision:b.revision,digest:old.digest};
        entry.task.administrativeAdmission=administrativeAdmission({version:1,stageId,recordingRef:old.recordingRef,originalRequestId:old.originalRequestId,
          originalJournalSha256:old.originalJournalSha256,physicalId:b.physicalId,freshRequestId:b.freshRequestId,sourceSha256:b.runtimeSha256,
          ownerAuthSha256:b.ownerAuthSha256!,approvalSha256:ownerCertificateDigest(certificate),expiresAt:command.expiresAt,status:'REAUTH_STAGED',
          databaseRevision:b.revision,clearanceId:b.newClearanceId,reauthorizations:[...(old.reauthorizations??[]),previous]});
        // On disk error retain the old physical fence, but leave RAM blocked. No rollback/retry of a potentially persisted stage.
        this.administrativeFences.set(stageId,{physicalId:b.physicalId,release});this.administrativeFences.delete(old.stageId);persisted=true;
        this.changed();await this.flushCheckpoint();return {stageId,status:'REAUTH_STAGED',cleanup:'UNVERIFIED',inspection};
      }catch(error){if(!held&&!persisted)await release();throw error;}
    }finally{this.administrativeReauthorizing.delete(b.physicalId);}
  }
  private restoredJournalSha256?:string;
  private administrativeEntry(physicalId:string){return [...this.entries.values()].find(e=>e.task.administrativeAdmission?.physicalId===physicalId);}
  private administrativeSuccessorClosed(physicalId:string){const marker=this.administrativeEntry(physicalId)?.task.administrativeAdmission;if(!marker||marker.status!=='DISPATCHED')return false;const successor=[...this.entries.values()].find(e=>e.task.teachLifecycle?.binding.recordingRef===marker.successorRef)?.task.teachLifecycle;return !!successor&&teachLifecycleState(successor).cleanup==='PROVEN'&&teachLifecycleState(successor).pending==='NONE';}
  private async administrativeCommand(command:Extract<TeachCommandValue,{type:'ADMIN_STAGE'|'ADMIN_COMMIT'|'ADMIN_AUTHORIZE_FRESH'}>){
    const authority=await(this.adapter.administrativeAuthority?.()??readOwnerPublicAuthority()),certificate=verifyOwnerCertificate(command.certificate,authority.publicKey,authority.credentialHash),binding=certificate.binding;
    if(binding.runtimeSha256!==this.lifecycleSource.teachRuntimeSha256||binding.runtimeSha256!==teachRuntimeDigest()||!binding.ownerAuthSha256||binding.ownerAuthSha256!==this.administrativeOwnerSource||binding.ownerAuthSha256!==ownerAuthenticationRuntimeSha256())throw new TeachRuntimeError('ADMIN_SOURCE_CHANGED');
    const executionId=command.type==='ADMIN_STAGE'?binding.executionId:command.executionId,entry=this.entries.get(executionId);if(!entry||binding.executionId!==executionId||entry.task.physicalId!==binding.physicalId||entry.task.batchId!==binding.requestId)throw new TeachRuntimeError('ADMIN_EXACT_BINDING_MISMATCH');
    if(command.type==='ADMIN_STAGE'){
      if(binding.purpose!=='ADMIN_ORPHAN_DISPOSITION'||binding.journalSha256!==this.restoredJournalSha256||entry.task.administrativeAdmission||entry.task.teachLifecycle||entry.task.deviceId!==command.deviceId||entry.task.status!=='CANCELLED'||!entry.task.finishedAt||entry.task.latest?.counters?.steps!==0||entry.task.latest?.counters?.snapshots!==0)throw new TeachRuntimeError('ADMIN_LEGACY_BINDING_OR_EFFECT_UNSUPPORTED');
      if(command.expiresAt<=Date.now()||command.expiresAt>Date.now()+900000||this.activeByPhysical.has(binding.physicalId)||this.activeBySerial.has(command.deviceId))throw new TeachRuntimeError('ADMIN_DEVICE_BUSY_OR_EXPIRED');
      for(const other of this.entries.values())if(other.task.physicalId===binding.physicalId&&other.task.teachLifecycle){const state=teachLifecycleState(other.task.teachLifecycle);if(state.pending!=='NONE'||state.cleanup!=='PROVEN')throw new TeachRuntimeError('ADMIN_OTHER_EFFECT_OR_CLEANUP_UNRESOLVED');}
      const device=(await this.adapter.discover()).find(d=>d.serial===command.deviceId&&d.status==='device'&&d.identityVerified&&d.physicalId===binding.physicalId);if(!device)throw new TeachRuntimeError('ADMIN_PHYSICAL_IDENTITY_MISMATCH');
      const stageId=randomUUID(),release=await this.adapter.reserve?.(command.deviceId,stageId);if(!release)throw new TeachRuntimeError('ADMIN_RESERVATION_REQUIRED');
      try{const inspection=await(this.adapter.inspectAdministrativeState?.(command.deviceId,binding.physicalId)??inspectRetirementNativeState(command.deviceId,binding.physicalId));if(inspection.state!=='CLEAR'||inspection.physicalId!==binding.physicalId||inspection.at>Date.now()||Date.now()-inspection.at>5000)throw new TeachRuntimeError('ADMIN_SAFETY_'+inspection.reason);
        verifyOwnerCertificate(command.certificate,authority.publicKey,authority.credentialHash);if(entry.task.administrativeAdmission||this.activeByPhysical.has(binding.physicalId))throw new TeachRuntimeError('ADMIN_CONCURRENT_CHANGE');entry.task.administrativeAdmission=administrativeAdmission({version:1,stageId,recordingRef:binding.sessionId,originalRequestId:binding.requestId,originalJournalSha256:binding.journalSha256,physicalId:binding.physicalId,freshRequestId:binding.freshRequestId,sourceSha256:binding.runtimeSha256,ownerAuthSha256:binding.ownerAuthSha256,approvalSha256:ownerCertificateDigest(certificate),expiresAt:command.expiresAt,status:'STAGED'});this.changed();await this.flushCheckpoint();this.administrativeFences.set(stageId,{physicalId:binding.physicalId,release});return {stageId,status:'STAGED',cleanup:'UNVERIFIED',inspection};
      }catch(error){await release();throw error;}
    }
    const old=entry.task.administrativeAdmission;if(!old||old.stageId!==command.stageId||old.recordingRef!==binding.sessionId||old.freshRequestId!==binding.freshRequestId||!this.administrativeFences.has(command.stageId)||old.expiresAt<=Date.now())throw new TeachRuntimeError('ADMIN_FENCE_MISSING_OR_EXPIRED');
    const proof=verifyOwnerDatabaseReadback(command.readback,authority.publicKey,certificate),{digest:ignored,...marker}=old;void ignored;
    if(command.type==='ADMIN_COMMIT'){
      if(binding.purpose!=='ADMIN_ORPHAN_DISPOSITION'||old.status!=='STAGED'||old.approvalSha256!==ownerCertificateDigest(certificate)||proof.originalRevision!==binding.revision+1||proof.successorRef)throw new TeachRuntimeError('ADMIN_DB_COMMIT_BINDING_INVALID');
      entry.task.administrativeAdmission=administrativeAdmission({...marker,status:'RETIRED',clearanceId:proof.clearanceId,databaseRevision:proof.originalRevision});
    }else{
      if(binding.purpose!=='FRESH_ADMISSION'||!binding.freshSpecSha256||old.status!=='RETIRED'||binding.revision!==old.databaseRevision||proof.originalRevision!==binding.revision+1||proof.clearanceId!==old.clearanceId||!proof.successorRef||proof.successorRef!==binding.successorSessionId||proof.successorOwnership!=='HELD')throw new TeachRuntimeError('ADMIN_FRESH_DB_BINDING_INVALID');
      entry.task.administrativeAdmission=administrativeAdmission({...marker,status:'AUTHORIZED',successorRef:proof.successorRef,freshSpecSha256:binding.freshSpecSha256,approvalSha256:ownerCertificateDigest(certificate),readbackValidUntil:proof.observedAt+5000});
    }
    this.changed();await this.flushCheckpoint();return {status:entry.task.administrativeAdmission.status,cleanup:'UNVERIFIED'};
  }
  private readonly lifecycleSource={runtimeSha256:androidRuntimeDigest(),teachRuntimeSha256:teachRuntimeDigest()};
  private lifecycleWrites=new Map<string,Promise<void>>();
  private recoveryReferences=new Map<string,{executionId:string;authorizationId:string;revision:number;digest:string;expiresAt:number;work?:Promise<unknown>;releaseAck?:Promise<unknown>}>();
  private lifecycleEvent(entry:RuntimeEntry,event:TeachLifecycleEvent):Promise<void>{
    const work=(this.lifecycleWrites.get(entry.task.executionId)??Promise.resolve()).then(async()=>{
      if(entry.attestationFailed||!entry.task.teachLifecycle)throw new TeachRuntimeError('TEACH_JOURNAL_UNAVAILABLE');
      if(this.adapter===androidRuntimeAdapter&&['CREATE_INTENT','EFFECT_PENDING'].includes(event.kind)&&(androidRuntimeDigest()!==this.lifecycleSource.runtimeSha256||teachRuntimeDigest()!==this.lifecycleSource.teachRuntimeSha256))throw new TeachRuntimeError('TEACH_SOURCE_CHANGED_BEFORE_DISPATCH');
      entry.task.teachLifecycle=appendTeachLifecycle(entry.task.teachLifecycle,event);this.changed();await this.flushCheckpoint();
    }).catch(error=>{entry.attestationFailed=true;throw error instanceof TeachRuntimeError?error:new TeachRuntimeError('TEACH_JOURNAL_UNAVAILABLE');});
    this.lifecycleWrites.set(entry.task.executionId,work.catch(()=>undefined));return work;
  }
  private recoveryOwner(entry:RuntimeEntry,authorizationId:string){
    const mode=this.ownerPolicy.list().find(m=>m.id===authorizationId&&m.deviceId===entry.task.deviceId&&m.physicalId===entry.task.physicalId);
    if(!mode)throw new TeachRuntimeError('RECOVERY_OWNER_AUTHORIZATION_REQUIRED');
    return this.ownerPolicy.bind(mode.deviceId,mode.physicalId,entry.task.executionId);
  }
  private async verifyRecovery(entry:RuntimeEntry,authorizationId:string){
    const scope=this.recoveryOwner(entry,authorizationId),record=entry.task.teachLifecycle;
    if(entry.attestationFailed||!record)throw new TeachRuntimeError('RECOVERY_ATTESTATION_MISSING');
    const state=teachLifecycleState(record);
    if(record.binding.executionId!==entry.task.executionId||record.binding.requestId!==entry.task.batchId||record.binding.physicalId!==entry.task.physicalId||
      !state.nativeSessionId||!state.nativeServerSha256||!state.bindingVerified||!state.nativeClosed||!state.deleteAck||!state.absenceVerified||state.cleanup!=='PROVEN'||state.pending!=='NONE')throw new TeachRuntimeError('RECOVERY_CLEANUP_UNPROVEN');
    if(this.activeByPhysical.has(record.binding.physicalId)||this.activeBySerial.has(entry.task.deviceId))throw new TeachRuntimeError('RECOVERY_DEVICE_BUSY');
    const current=(await this.adapter.discover()).find(d=>d.serial===entry.task.deviceId&&d.status==='device'&&d.identityVerified&&d.physicalId===record.binding.physicalId);
    if(!current)throw new TeachRuntimeError('RECOVERY_PHYSICAL_IDENTITY_MISMATCH');
    const client=this.adapter===androidRuntimeAdapter?new AppiumClient():undefined;
    const verified=this.adapter.verifyTeachCleanup?await this.adapter.verifyTeachCleanup(state.nativeSessionId,record.binding.physicalId,entry.task.deviceId,state.nativeServerSha256):client?
      client.endpointFingerprint()===state.nativeServerSha256&&!await readDeviceOwnership(entry.task.deviceId,runAdb)&&await verifyNativeSessionAbsent(client,state.nativeSessionId):false;
    assertOwnerTestExecution(scope,entry.task.deviceId,record.binding.physicalId,entry.task.executionId);
    if(!verified||teachLifecycleState(entry.task.teachLifecycle).digest!==state.digest)throw new TeachRuntimeError('RECOVERY_INDEPENDENT_VERIFICATION_FAILED');
    return {record:structuredClone(record),state,verifiedAt:Date.now()};
  }
  private async recoverTeach(command:Extract<TeachCommandValue,{type:'RECOVERY_PREPARE'|'RECOVERY_CONFIRM'|'RECOVERY_RELEASE_ACK'}>){
    if(command.type==='RECOVERY_PREPARE'){
      const entry=this.entries.get(command.executionId);
      if(!entry||entry.task.deviceId!==command.deviceId||entry.task.physicalId!==command.physicalId)throw new TeachRuntimeError('RECOVERY_EXACT_SESSION_MISMATCH');
      this.recoveryOwner(entry,command.authorizationId);
      if(!entry.task.teachLifecycle)throw new TeachRuntimeError('RECOVERY_ATTESTATION_MISSING');
      if(entry.task.teachLifecycle.binding.recordingRef!==command.recordingRef)throw new TeachRuntimeError('RECOVERY_EXACT_SESSION_MISMATCH');
      const verified=await this.verifyRecovery(entry,command.authorizationId);
      for(const [key,value]of this.recoveryReferences)if(value.expiresAt<=Date.now())this.recoveryReferences.delete(key);
      if(this.recoveryReferences.size>=100)throw new TeachRuntimeError('RECOVERY_CAPACITY');
      const reference=randomUUID(),expiresAt=Date.now()+60000;
      this.recoveryReferences.set(reference,{executionId:entry.task.executionId,authorizationId:command.authorizationId,revision:verified.state.revision,digest:verified.state.digest,expiresAt});
      return {reference,expiresAt,revision:verified.state.revision,digest:verified.state.digest,binding:verified.record.binding,cleanup:'PROVEN',pending:'NONE',nativeSessionId:verified.state.nativeSessionId,nativeServerSha256:verified.state.nativeServerSha256,requiresOwnerConfirmation:true};
    }
    const ref=this.recoveryReferences.get(command.reference),entry=ref&&this.entries.get(ref.executionId);
    if(!ref||!entry||ref.expiresAt<=Date.now()||ref.authorizationId!==command.authorizationId||command.type==='RECOVERY_CONFIRM'&&ref.revision!==command.revision)throw new TeachRuntimeError('RECOVERY_REFERENCE_INVALID');
    this.recoveryOwner(entry,command.authorizationId);
    if(command.type==='RECOVERY_RELEASE_ACK'){
      if(!ref.work)throw new TeachRuntimeError('RECOVERY_CONFIRMATION_REQUIRED');await ref.work;this.recoveryOwner(entry,command.authorizationId);
      ref.releaseAck??=this.lifecycleEvent(entry,{kind:'DB_RELEASE_CONFIRMED',actorScopeHash:lifecycleDigest(command.authorizationId),recoveryReferenceHash:lifecycleDigest(command.reference),databaseRevision:command.databaseRevision}).then(()=>({recorded:true}));return ref.releaseAck;
    }
    if(ref.work)return ref.work;
    ref.work=(async()=>{
      const verified=await this.verifyRecovery(entry,command.authorizationId);
      if(verified.state.digest!==ref.digest||verified.state.revision!==ref.revision)throw new TeachRuntimeError('RECOVERY_REVISION_CONFLICT');
      await this.lifecycleEvent(entry,{kind:'RECOVERY_CONFIRMED',actorScopeHash:lifecycleDigest(command.authorizationId),recoveryReferenceHash:lifecycleDigest(command.reference)});
      this.recoveryOwner(entry,command.authorizationId);
      const state=teachLifecycleState(entry.task.teachLifecycle);
      return {binding:entry.task.teachLifecycle!.binding,nativeSessionId:state.nativeSessionId,nativeServerSha256:state.nativeServerSha256,cleanup:'PROVEN',pending:'NONE',independentlyVerified:true,verifiedAt:verified.verifiedAt,revision:state.revision,digest:state.digest};
    })();return ref.work;
  }
  private readonly skillReplays=new Map<string,SkillReplayController>();
  async replay(command:ReplayCommandValue):Promise<unknown>{
    if(command.type!=='OPEN'){
      const session=this.teachSessions.get(command.leaseId),controller=this.skillReplays.get(command.leaseId);
      if(!session||!controller)throw new TeachRuntimeError('REPLAY_RECONCILIATION_REQUIRED');session.authorize(command.ownerToken);
      if(command.type==='STATE')return {checkpoint:controller.view(),history:controller.history()};
      if(command.type==='PAUSE')return {checkpoint:controller.pause()};
      if(command.type==='CANCEL')return {checkpoint:await controller.cancel()};
      if(command.type==='RESUME'){void controller.resume(command.checkpoint).catch(()=>undefined);return {checkpoint:controller.view()};}
      throw new TeachRuntimeError('INVALID_REPLAY_COMMAND');
    }
    const binding=JSON.stringify(command),old=this.teachStarts.get(command.requestId);
    if(old){if(old.binding!==binding)throw new TeachRuntimeError('REPLAY_REQUEST_BINDING_MISMATCH');return old.work;}
    if(this.teachStarts.size>=100)throw new TeachRuntimeError('TEACH_CAPACITY');
    const work=Promise.resolve().then(async()=>{
      const program=loadSkillProgram(command.definition),bound=bindSkillParameters(program,command.parameters);
      if(!program.compatibility.supported||program.definitionDigest!==command.definitionDigest)throw new TeachRuntimeError('REPLAY_SKILL_UNSUPPORTED_OR_CHANGED');
      const mode=this.ownerPolicy.list().find(m=>m.id===command.authorizationId&&m.deviceId===command.deviceId&&m.physicalId===command.expectedPhysicalId);
      if(!mode)throw new TeachRuntimeError('REPLAY_OWNER_AUTHORIZATION_REQUIRED');
      const input=bound.steps.find(s=>s.operation==='INPUT_TEXT');
      const query=input?.operation==='INPUT_TEXT'&&typeof input.arguments.value==='string'?input.arguments.value:'';
      if(query&&searchQuery(query)!==query)throw new TeachRuntimeError('REPLAY_QUERY_NOT_LOSSLESS_IN_RUNTIME');
      const opened=await this.openTeach({type:'OPEN',requestId:command.requestId,recordingRef:command.requestId,deviceId:command.deviceId,expectedPhysicalId:command.expectedPhysicalId,appRef:bound.appScope.alias,query},true);
      const session=this.teachSessions.get(opened.leaseId)!,entry=this.entries.get(opened.executionId)!;
      try{
        const owner=this.ownerPolicy.bind(command.deviceId,command.expectedPhysicalId,opened.executionId);entry.ownerScope=owner;entry.task.ownerTestMode=mode;entry.task.request='Supervised skill replay v'+command.version;
        const validate=async()=>{assertOwnerTestExecution(owner,command.deviceId,command.expectedPhysicalId,opened.executionId);
          const current=(await this.adapter.discover()).find(d=>d.serial===command.deviceId&&d.status==='device'&&d.identityVerified&&d.physicalId===command.expectedPhysicalId);
          if(!current)throw new TeachRuntimeError('REPLAY_DEVICE_IDENTITY_LOST');
        };
        const adapter=new UnifiedSkillReplayAdapter({skillId:command.skillId,versionId:command.versionId,version:command.version,contentHash:command.contentHash,
          definitionDigest:program.definitionDigest,executionId:opened.executionId,deviceId:command.deviceId,physicalId:command.expectedPhysicalId,sessionId:opened.sessionId},
          this.adapter===androidRuntimeAdapter?'ANDROID_RUNTIME':'SIMULATED_RECEIPT',session,validate,()=>entry.controller.abort());
        const controller=new SkillReplayController(program,command.parameters,adapter,async(checkpoint,event)=>{
          const events=entry.task.skillReplay?.events??[];events.push(event);entry.task.skillReplay={checkpoint,events:events.slice(-100)};
          const terminal=['COMPLETED','BLOCKED','FAILED','CANCELLED','INTERRUPTED','UNKNOWN_EFFECT'].includes(checkpoint.status);
          entry.task.status=checkpoint.ownership==='RETAINED_PENDING_CLEANUP'?'BLOCKED':terminal&&checkpoint.ownership==='RELEASED'?
            checkpoint.status==='COMPLETED'?'COMPLETED':checkpoint.status==='CANCELLED'?'CANCELLED':'BLOCKED':'RUNNING';
          if(terminal&&checkpoint.ownership==='RELEASED')entry.task.finishedAt=Date.now();
          entry.task.latest={type:terminal&&checkpoint.ownership==='RELEASED'?'complete':'progress',status:entry.task.status==='COMPLETED'?'COMPLETED':entry.task.status==='CANCELLED'?'CANCELLED':entry.task.status==='BLOCKED'?'BLOCKED':'EXECUTING',reason:checkpoint.reason??String(event.kind),description:'Skill replay: '+checkpoint.status};
          this.changed();await this.flushCheckpoint();
        });
        this.skillReplays.set(opened.leaseId,controller);
        // Cancellation can meet a failed checkpoint write. Its terminal reason/ownership
        // remains in controller.view(); do not leave an unhandled cleanup rejection.
        entry.controller.signal.addEventListener('abort',()=>{void controller.cancel().catch(()=>undefined);},{once:true});
        void controller.run().catch(()=>undefined).finally(()=>{
          const checkpoint=controller.view();
          if(checkpoint.reason==='CHECKPOINT_STORAGE_UNAVAILABLE'){
            entry.task.skillReplay={checkpoint,events:entry.task.skillReplay?.events??[]};entry.task.status='BLOCKED';entry.task.latest={type:'complete',status:'BLOCKED',reason:'CHECKPOINT_STORAGE_UNAVAILABLE'};this.changed();
          }
        });
        return {leaseId:opened.leaseId,ownerToken:opened.ownerToken,checkpoint:controller.view()};
      }catch(error){await session.close('INTERRUPTED');throw error;}
    });this.teachStarts.set(command.requestId,{binding,work});return work;
  }
  private teachSessions = new Map<string, TeachSession>();
  private teachStarts = new Map<string, { binding: string; work: Promise<unknown> }>();
  hasTeachSessions() { return [...this.teachSessions.values()].some(s => s.view().cleanup !== 'PROVEN'); }
  async teach(command: TeachCommandValue): Promise<unknown> {
    if(command.type==='CONTINUATION_PREFLIGHT'){
      const device=(await this.adapter.discover()).find(d=>d.serial===command.deviceId&&d.status==='device'&&d.identityVerified&&d.physicalId===command.expectedPhysicalId);
      if(!device||this.activeByPhysical.has(command.expectedPhysicalId)||this.activeBySerial.has(command.deviceId))throw new TeachRuntimeError('CONTINUATION_PREFLIGHT_DEVICE_UNAVAILABLE');
      const inspection=await(this.adapter.inspectAdministrativeState?.(command.deviceId,command.expectedPhysicalId)??inspectRetirementNativeState(command.deviceId,command.expectedPhysicalId));
      // Advisory read only. Stage still obtains a reservation and rechecks independently after Passkey.
      return {...inspection,advisory:true,nativeOpenAuthorized:false};
    }
    if(command.type==='ADMIN_REAUTHORIZE_STAGE'||command.type==='ADMIN_REAUTHORIZE_COMMIT'||command.type==='CONTINUATION_STAGE'||command.type==='CONTINUATION_COMMIT')return this.reauthorizeAdministrative(command);
    if(command.type==='ADMIN_STAGE'||command.type==='ADMIN_COMMIT'||command.type==='ADMIN_AUTHORIZE_FRESH')return this.administrativeCommand(command);
    if(command.type==='RECOVERY_PREPARE'||command.type==='RECOVERY_CONFIRM'||command.type==='RECOVERY_RELEASE_ACK')return this.recoverTeach(command);
    if (command.type === 'DEVICES') {
      const devices = await this.adapter.discover();
      return { devices: await Promise.all(devices.map(async device => {
        const busy = this.activeBySerial.has(device.serial) || Boolean(device.physicalId && this.activeByPhysical.has(device.physicalId)) ||
          this.adapter === androidRuntimeAdapter && Boolean(await readDeviceOwnership(device.serial, runAdb));
        const readiness = !busy && device.status === 'device' && this.adapter === androidRuntimeAdapter ? await androidV2Adapter(device.serial,new AgentBudget()).readiness?.(AbortSignal.timeout(5000)) : undefined;
        return { ...device, busy, readiness };
      })) };
    }
    if (command.type === 'IDENTITY') {
      const device = (await this.adapter.discover()).find(d => d.serial === command.deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
      if (!device) throw new TeachRuntimeError('DEVICE_IDENTITY_UNAVAILABLE');
      const administrative=this.administrativeEntry(device.physicalId!)?.task.administrativeAdmission,ownFence=!!administrative&&this.administrativeFences.has(administrative.stageId);
      if (this.activeBySerial.has(device.serial) || this.activeByPhysical.has(device.physicalId!) || this.adapter === androidRuntimeAdapter && !ownFence && await readDeviceOwnership(device.serial,runAdb)) throw new TeachRuntimeError('DEVICE_UNAVAILABLE_OR_BUSY');
      const identity = this.adapter.teachIdentity ? await this.adapter.teachIdentity(device.serial) : this.adapter === androidRuntimeAdapter ? await readTransportIdentity(runAdb, device.serial, true) : undefined;
      if (!identity || identity.physicalId !== device.physicalId) throw new TeachRuntimeError('DEVICE_IDENTITY_CHANGED');
      return { ...identity, serial: device.serial };
    }
    if (command.type === 'OPEN') {
      const binding = JSON.stringify(command), old = this.teachStarts.get(command.requestId);
      if (old) { if (old.binding !== binding) throw new TeachRuntimeError('TEACH_REPLAY_BINDING_MISMATCH'); return old.work; }
      if([...this.entries.values()].some(e=>e.task.batchId===command.requestId||e.task.teachLifecycle?.binding.requestId===command.requestId))throw new TeachRuntimeError('TEACH_ADMISSION_ALREADY_JOURNALED_NO_REOPEN');
      if (this.teachStarts.size >= 100) throw new TeachRuntimeError('TEACH_CAPACITY');
      const work = Promise.resolve().then(() => this.openTeach(command)); this.teachStarts.set(command.requestId, { binding, work }); return work;
    }
    const session = this.teachSessions.get(command.leaseId);
    if (!session) throw new TeachRuntimeError('TEACH_SESSION_NOT_FOUND');
    if(this.skillReplays.has(command.leaseId))throw new TeachRuntimeError('SESSION_PURPOSE_MISMATCH');
    session.authorize(command.ownerToken);
    if (command.type === 'STATE') return session.view();
    if (command.type === 'FRAME') return session.frame();
    if (command.type === 'PAUSE') return session.pause();
    if (command.type === 'RESUME') return session.resume();
    if (command.type === 'STEP') {
      const receipt=await session.step(command),entry=this.entries.get(session.executionId);
      if(entry){
        const event:AgentProgress={type:'progress',status:'EXECUTING',description:'Manual recorder: '+receipt.operation,
          reason:receipt.dispatch+' / '+receipt.verification,...(receipt.reason?{waitingFor:receipt.reason}:{})};
        entry.task.latest=event;entry.task.events.push(event);if(entry.task.events.length>24)entry.task.events.shift();this.changed();
      }
      return receipt;
    }
    if (command.type === 'CANCEL') {
      const closing = session.close('CANCELLED');
      this.entries.get(session.executionId)?.controller.abort();
      return closing;
    }
    return session.close('REVIEWING');
  }
  private async openTeach(command: Extract<TeachCommandValue, { type: 'OPEN' }>,authorizedReplay=false) {
    const device = (await this.adapter.discover()).find(d => d.serial === command.deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
    if (!device?.physicalId || device.physicalId !== command.expectedPhysicalId || this.activeByPhysical.has(device.physicalId) || this.activeBySerial.has(device.serial) || this.activeBySerial.size >= 4) throw new TeachRuntimeError('DEVICE_UNAVAILABLE_OR_BUSY');
    const physicalId = device.physicalId, executionId = randomUUID(), controller = new AbortController();
    const original=this.administrativeEntry(physicalId),admin=original?.task.administrativeAdmission;let handedReservation:(()=>Promise<void>)|undefined;
    if(admin&&!(authorizedReplay&&this.administrativeSuccessorClosed(physicalId))){const fence=this.administrativeFences.get(admin.stageId);
      if(admin.status!=='AUTHORIZED'||!fence||admin.expiresAt<=Date.now()||(admin.readbackValidUntil??0)<=Date.now()||admin.sourceSha256!==teachRuntimeDigest()||admin.ownerAuthSha256!==ownerAuthenticationRuntimeSha256()||command.administrativeClearance!==admin.clearanceId||command.requestId!==admin.freshRequestId||command.recordingRef!==admin.successorRef||admin.freshSpecSha256!==ownerCertificateDigest({appRef:command.appRef,query:command.query}))throw new TeachRuntimeError('ADMIN_FRESH_ADMISSION_REQUIRED_OR_RECONCILIATION');
      const {digest:ignored,...value}=admin;void ignored;original!.task.administrativeAdmission=administrativeAdmission({...value,status:'DISPATCHED',successorExecutionId:executionId});this.changed();await this.flushCheckpoint();handedReservation=fence.release;
    }else if(!admin&&command.administrativeClearance)throw new TeachRuntimeError('ADMIN_CLEARANCE_NOT_ISSUED');
    if([...this.entries.values()].some(e=>{const l=e.task.teachLifecycle;if(!l||l.binding.provenance!=='ANDROID_RUNTIME'||l.binding.physicalId!==physicalId)return false;const s=teachLifecycleState(l);return s.pending!=='NONE'||s.cleanup!=='PROVEN';}))throw new TeachRuntimeError('TEACH_ORPHAN_RECONCILIATION_REQUIRED');
    const task: DeviceTask = { executionId, batchId: command.requestId, deviceId: device.serial, physicalId, request: 'Teach recorder: ' + command.appRef,
      agentVersion: 2, status: 'RUNNING', createdAt: Date.now(), connectionState: 'device', events: [] };
    let complete!: () => void;
    const entry: RuntimeEntry = { task, controller, disconnected: false, done: new Promise<void>(resolve => { complete = resolve; }) };
    task.teachLifecycle=createTeachLifecycle({recordingRef:command.recordingRef,executionId,requestId:command.requestId,physicalId,runtimeSha256:this.lifecycleSource.runtimeSha256??'',teachRuntimeSha256:this.lifecycleSource.teachRuntimeSha256??'',provenance:this.adapter===androidRuntimeAdapter?'ANDROID_RUNTIME':'SIMULATED_RECEIPT'});
    // Same scheduling indices as normal tasks. The existing reservation is still authoritative.
    this.activeBySerial.set(device.serial, executionId); this.activeByPhysical.set(physicalId, executionId); this.entries.set(executionId, entry); this.changed();
    const budget = new AgentBudget({ timeMs: 300000, steps: 20, snapshots: 200, reasoning: 0, retries: 0, replans: 0 });
    budget.nativeLifecycle=event=>this.lifecycleEvent(entry,event);
    budget.runtimeIdentity = { executionId, deviceId: device.serial, physicalId };
    let release: (() => Promise<void>) | undefined, execution: Awaited<ReturnType<import('./agent-v2').V2Adapter['open']>> | undefined;
    try {
      await this.flushCheckpoint();
      release = handedReservation??await this.adapter.reserve?.(device.serial, executionId);
      if(handedReservation&&admin)this.administrativeFences.delete(admin.stageId);
      if (!release) throw new TeachRuntimeError('RESERVATION_REQUIRED');
      await this.lifecycleEvent(entry,{kind:'RESERVATION_ACQUIRED'});
      const adapter = this.adapter.v2?.(device.serial, budget) ?? (this.adapter === androidRuntimeAdapter ? androidV2Adapter(device.serial, budget) : undefined);
      if (!adapter || !adapter.readiness || await adapter.readiness(controller.signal) !== 'READY') throw new TeachRuntimeError('DEVICE_NOT_READY');
      const app = (await adapter.catalog.resolve(command.appRef, 'LAUNCH', controller.signal)).app;
      if (!app || app.serial !== device.serial) throw new TeachRuntimeError('APP_SELECTION_REQUIRED');
      await this.lifecycleEvent(entry,{kind:'APP_RESOLVED'});
      const nativeSetupStarted=performance.now();
      execution = await adapter.open([app], controller.signal);
      budget.timings.sessionSetupMs=Math.round(performance.now()-nativeSetupStarted);
      // Existing legacy test adapters need not implement native hooks. Such rows remain
      // explicitly simulated/unattested and cannot become native cleanup evidence.
      const hasNativeBinding=!!teachLifecycleState(task.teachLifecycle).nativeSessionId;
      if(!hasNativeBinding&&this.adapter!==androidRuntimeAdapter){
        await this.lifecycleEvent(entry,{kind:'CREATE_INTENT',nativeServerSha256:'0'.repeat(64)});
        await this.lifecycleEvent(entry,{kind:'NATIVE_BOUND',nativeSessionId:execution.sessionId()!});
        await this.lifecycleEvent(entry,{kind:'BINDING_VERIFIED'});await this.lifecycleEvent(entry,{kind:'NATIVE_READY'});
      }
      const measuredRead = async (args: string[], timeoutMs: number) => {
        const start = performance.now(); try { return await runAdb(args, timeoutMs); }
        finally { const ms = performance.now() - start; budget.profiling.adbCount++; budget.profiling.adbMs += ms; budget.measure('ADB', 'TEACH_READ', ms); }
      };
      const session = new TeachSession(command.recordingRef, device.serial, physicalId, executionId, command.appRef, command.query, app, execution, budget, controller.signal, {
        lifecycle:event=>this.lifecycleEvent(entry,event),
        provenance:this.adapter===androidRuntimeAdapter?'ANDROID_RUNTIME':'SIMULATED_RECEIPT',
        ready: () => adapter.readiness!(controller.signal),
        capture: async () => {
          if(this.adapter.teachFrame)return this.adapter.teachFrame.capture(device.serial);
          if(this.adapter!==androidRuntimeAdapter)throw new TeachRuntimeError('CAPTURE_UNAVAILABLE');
          const start = performance.now(); try { return await captureAndroidScreenshot(device.serial); }
          finally { const ms=performance.now()-start;budget.profiling.adbCount++;budget.profiling.adbMs+=ms;budget.measure('ADB','TEACH_FRAME',ms); }
        },
        privacy: async packageName => this.adapter.teachFrame ? this.adapter.teachFrame.privacy(device.serial,packageName) : this.adapter===androidRuntimeAdapter
          ? focusedWindowPrivacy((await measuredRead(['-s',device.serial,'shell','dumpsys','window','windows'],5000)).stdout,packageName) : 'UNKNOWN',
        cleanup: async () => {
          await release!(); this.activeBySerial.delete(device.serial); this.activeByPhysical.delete(physicalId);
          const state=teachLifecycleState(task.teachLifecycle);
          if(state.nativeClosed)await this.lifecycleEvent(entry,{kind:'CLEANUP_PROVEN'});
          else await this.lifecycleEvent(entry,{kind:'CLEANUP_FAILED'});
        },
        closed: async view => {
          task.status = view.cleanup === 'PROVEN' ? 'CANCELLED' : 'BLOCKED';
          task.latest = { type: 'complete', status: task.status, reason: view.cleanup === 'PROVEN' ? 'Recorder closed: '+(view.closeReason??'RUNTIME_INTERRUPTED')+'. Skill completion has not been claimed.' : 'Recorder cleanup uncertain; physical ownership retained.', ...budget.summary() };
          if (view.cleanup === 'PROVEN') task.finishedAt = Date.now(); this.changed();await this.flushCheckpoint(); complete();
        },
      });
      this.teachSessions.set(session.leaseId, session); return { ...session.view(), ownerToken: session.ownerToken };
    } catch (error) {
      let cleaned = true;
      try {
        await execution?.close();
        const state=teachLifecycleState(task.teachLifecycle);
        if(state.createIntent&&!state.nativeClosed)cleaned=false;
        else {await release?.();await this.lifecycleEvent(entry,{kind:'CLEANUP_PROVEN'});}
      } catch { cleaned = false; }
      if (cleaned) { this.activeBySerial.delete(device.serial); this.activeByPhysical.delete(physicalId); task.finishedAt = Date.now(); }
      task.status = 'BLOCKED'; task.latest = { type: 'complete', status: 'BLOCKED', reason: cleaned ? 'Recorder admission rejected before a recorded action.' : 'Recorder setup cleanup uncertain; ownership retained.' };
      this.changed(); complete(); throw error instanceof TeachRuntimeError ? error : new TeachRuntimeError('RECORDER_ADMISSION_FAILED');
    }
  }
  private prepared = new Map<string, PreparedEntry>();
  async prepare(source: string, deviceId: string, engine: 'V1' | 'V2'): Promise<PreparedView> {
    if (decidePermission({ source, stage: 'REQUEST' }).decision === 'DENY') throw Error('HARD_DENY: no preparation authorized.');
    requireDemoCapabilities(source);
    const device = (await this.adapter.discover()).find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
    if (!device?.physicalId || this.activeByPhysical.has(device.physicalId)) throw Error('Device must be verified and idle before analysis.');
    const budget = new AgentBudget(), signal = AbortSignal.timeout(budget.limits.timeMs);
    const ownerId = this.ownerPolicy.list().find(m => m.deviceId === deviceId && m.physicalId === device.physicalId)?.id;
    const entry: PreparedEntry = { source, deviceId, physicalId: device.physicalId, engine, expiresAt: 0, ownerId };
    if (engine === 'V1') entry.goal = await this.adapter.plan(source, budget, signal, deviceId);
    else {
      const adapter = this.adapter.v2?.(deviceId, budget) ?? (this.adapter === androidRuntimeAdapter ? androidV2Adapter(deviceId, budget) : undefined);
      if (!adapter) throw Error('V2 adapter unavailable.');
      entry.v2 = await prepareV2(source, deviceId, adapter, budget, signal);
      for (const node of entry.v2.graph.nodes) {
        if (node.outcome.intent?.request.name === 'READ_STATE') continue;
        const app = node.outcome.temporal ? await adapter.resolveTemporalApp?.(node.outcome.temporal, signal) : node.outcome.intent ? await adapter.resolveIntentApp?.(node.outcome.intent.request, signal) : (await adapter.catalog.resolve(node.app, node.capability, signal)).app;
        if (!app || app.serial !== deviceId) throw Error('ASK: application or capability handler is missing or ambiguous.');
      }
    }
    if (entry.goal?.originalRequest !== source && engine === 'V1') throw Error('Prepared source mismatch.');
    budget.timings.planningMs = performance.now() - budget.started;
    const reference = randomUUID(); entry.expiresAt = Date.now() + 90000;
    for (const [id, old] of this.prepared) if (old.expiresAt <= Date.now()) this.prepared.delete(id);
    if (this.prepared.size >= 100) throw Error('Too many pending plans.');
    this.prepared.set(reference, entry);
    return { reference, expiresAt: entry.expiresAt, summary: entry.v2?.summary ?? source, metrics: budget.summary(),
      steps: entry.goal?.subgoals.map(s => s.description) ?? entry.v2!.graph.nodes.map(n => n.capability === 'VERIFY_PLAYBACK' ? 'Xác minh đúng video và tiến độ phát qua hai lần đọc mới' : n.outcome.span.text),
      confirmations: engine === 'V2' ? ['Existing interpretation/effect confirmation and Human Assistance remain enforced by V2.'] : ['Existing independent policy and native/DOM postconditions.'] };
  }
  async startPrepared(reference: string): Promise<DeviceTask[]> {
    const entry = this.prepared.get(reference);
    if (!entry || entry.expiresAt <= Date.now()) throw Error('Plan expired, used or lost after restart; analyze again.');
    const device = (await this.adapter.discover()).find(d => d.serial === entry.deviceId && d.status === 'device' && d.identityVerified && d.physicalId === entry.physicalId);
    const ownerId = this.ownerPolicy.list().find(m => m.deviceId === entry.deviceId && m.physicalId === entry.physicalId)?.id;
    if (!device || ownerId !== entry.ownerId || Date.now() >= entry.expiresAt || this.prepared.get(reference) !== entry) {
      // Diagnostic only. Keep every original admission condition fail-closed;
      // never include authorization IDs or mutable plan contents in this error.
      const reasons = [!device ? 'VERIFIED_DEVICE_UNAVAILABLE' : '', ownerId !== entry.ownerId ? 'OWNER_BINDING_CHANGED' : '',
        Date.now() >= entry.expiresAt ? 'EXPIRED' : '', this.prepared.get(reference) !== entry ? 'REFERENCE_CHANGED' : ''].filter(Boolean);
      throw Error('Plan device, permission, expiry or replay binding changed. ' + reasons.join(','));
    }
    this.prepared.delete(reference);
    return this.start({ type: 'START', requestId: reference, jobs: [{ deviceId: entry.deviceId, goal: entry.source,
      ...(entry.engine === 'V2' ? { agentVersion: 2, ...(ownerId ? { ownerAuthorizedTest: true } : {}) } : {}) }] }, entry);
  }
  private readonly ownerPolicy = new OwnerTestPolicy();
  ownerTestModes() { return this.ownerPolicy.list(); }
  ownerPolicyAudit() { return this.ownerPolicy.history(); }
  async setOwnerTestMode(input: Extract<RuntimeCommandValue, { type: 'SET_OWNER_TEST_MODE' }>, beforeEnable?: (mode: OwnerTestMode) => void) {
    if (!input.enabled) {
      const current = this.ownerPolicy.list().find(mode => mode.deviceId === input.deviceId);
      if (current && current.physicalId !== input.physicalId) throw Error('Owner test physical identity mismatch.');
      const disabled = this.ownerPolicy.disable(input.deviceId, input.authorizationId!);
      if (disabled) for (const entry of this.entries.values()) if (entry.ownerScope?.id === input.authorizationId) {
        if([...this.skillReplays.values()].some(controller=>controller.view().binding.executionId===entry.task.executionId))entry.controller.abort();
        else this.cancel(entry.task.executionId, entry.task.deviceId);
      }
      this.changed(); return disabled;
    }
    const device = (await this.adapter.discover()).find(d => d.serial === input.deviceId && d.status === 'device');
    if (!device?.physicalId || device.physicalId !== input.physicalId || !device.identityVerified) throw Error('Owner test mode requires a currently identity-verified physical device.');
    if (this.activeBySerial.has(input.deviceId) || this.activeByPhysical.has(input.physicalId)) throw Error('Enable owner test mode only while the device is idle.');
    this.ownerPolicy.enable(input.deviceId, input.physicalId, beforeEnable, { fullControl: input.fullControl, rollbackOnFailure: input.rollbackOnFailure }); this.changed(); return true;
  }
  private entries = new Map<string, RuntimeEntry>();
  // Scheduling index only. acquireDeviceLock remains the authoritative device owner.
  private activeBySerial = new Map<string, string>();
  private activeByPhysical = new Map<string, string>();
  private requests = new Map<string, { jobs: string; ids: string[] }>();
  constructor(private readonly adapter: RuntimeAdapter = androidRuntimeAdapter, private readonly changed: () => void = () => {},private readonly flushCheckpoint:()=>Promise<void>=async()=>{}) {}
  restore(tasks: DeviceTask[],journalSha256?:string) {
    this.restoredJournalSha256=journalSha256;
    for(const task of tasks)if(task.administrativeAdmission){const a=parseAdministrativeAdmission(task.administrativeAdmission);if(a.physicalId!==task.physicalId||a.originalRequestId!==task.batchId)throw Error('ADMINISTRATIVE_TASK_BINDING_INVALID');}
    for (const source of tasks)if(source.teachLifecycle){const binding=parseTeachLifecycle(source.teachLifecycle).binding;
      if(binding.executionId!==source.executionId||binding.requestId!==source.batchId||binding.physicalId!==source.physicalId)throw new TeachRuntimeError('TEACH_ATTESTATION_BINDING_CORRUPT');}
    const retained=[...tasks.filter(t=>t.teachLifecycle||t.administrativeAdmission),...tasks.filter(t=>!t.teachLifecycle&&!t.administrativeAdmission).slice(-40)];
    for (const source of retained) {
      const task: DeviceTask = structuredClone(source);
      if (!terminalTask(task.status)) {
        task.status = 'BLOCKED'; task.finishedAt = Date.now(); task.events = [];
        task.latest = { type: 'complete', status: 'BLOCKED', reason: 'Worker restarted; no automatic resume. Inspect the device lock and start a fresh execution.' };
      }
      this.entries.set(task.executionId, { task, controller: new AbortController(), disconnected: task.status === 'DISCONNECTED' });
    }
    const batches = new Set([...this.entries.values()].map(entry => entry.task.batchId));
    for (const batchId of batches) {
      const tasks = [...this.entries.values()].map(entry => entry.task).filter(task => task.batchId === batchId);
      this.requests.set(batchId, { jobs: JSON.stringify(tasks.map(task => ({ deviceId: task.deviceId, goal: task.request, ...(task.agentVersion ? { agentVersion: task.agentVersion } : {}), ...(task.ownerTestMode ? { ownerAuthorizedTest: true } : {}) }))), ids: tasks.map(task => task.executionId) });
    }
  }
  list(): DeviceTask[] { return [...this.entries.values()].map(entry => structuredClone(entry.task)); }
  persisted(): DeviceTask[] {
    return this.list().map(task => ({ ...task, events: [], latest: task.latest && { ...task.latest, visual: undefined, assistance: undefined, cancellationToken: undefined,
      v2: task.latest.v2 && { ...task.latest.v2, assistance: undefined } } }));
  }
  async refreshConnections() {
    const devices = await this.adapter.discover();
    for (const mode of this.ownerPolicy.list()) {
      const device = devices.find(d => d.serial === mode.deviceId && d.status === 'device' && d.identityVerified && d.physicalId === mode.physicalId);
      if (!device) this.ownerPolicy.disable(mode.deviceId, mode.id);
    }
    for (const entry of this.entries.values()) {
      if (entry.ownerScope && !terminalTask(entry.task.status)) {
        try { assertOwnerTestExecution(entry.ownerScope, entry.task.deviceId, entry.task.physicalId!, entry.task.executionId); }
        catch { this.cancel(entry.task.executionId, entry.task.deviceId); }
      }
      const state = devices.find(d => d.serial === entry.task.deviceId)?.status ?? 'disconnected';
      entry.task.connectionState = state;
      if (this.activeBySerial.get(entry.task.deviceId) === entry.task.executionId && state !== 'device') {
        entry.disconnected = true; entry.controller.abort();
        entry.task.status = 'DISCONNECTED'; this.changed();
      }
    }
    return devices;
  }
  async start(input: Extract<RuntimeCommandValue, { type: 'START' }>, prepared?: PreparedEntry): Promise<DeviceTask[]> {
    const existing = this.requests.get(input.requestId), jobsKey = JSON.stringify(input.jobs);
    if (existing) {
      if (existing.jobs !== jobsKey) throw new Error('Request ID cannot be reused for different jobs.');
      return existing.ids.map(id => structuredClone(this.entries.get(id)!.task));
    }
    // Existing hard-deny requests retain their zero-effect BLOCKED audit task.
    // Validate every other job before discovery or scheduling any part of a batch.
    for (const job of input.jobs) if (decidePermission({ source: job.goal, stage: 'REQUEST' }).decision !== 'DENY') requireDemoCapabilities(job.goal);
    const devices = await this.adapter.discover();
    // Discovery can yield; check idempotency again before the atomic scheduling section.
    if (this.requests.has(input.requestId)) return this.start(input, prepared);
    const serials = input.jobs.map(job => job.deviceId);
    if (new Set(serials).size !== serials.length) throw new Error('A batch cannot contain the same device twice.');
    const physicalIds = serials.map(serial => devices.find(d => d.serial === serial)?.physicalId ?? serial);
    if(physicalIds.some(physical=>this.administrativeEntry(physical)&&!this.administrativeSuccessorClosed(physical)))throw Error('ADMINISTRATIVE_ADMISSION_QUARANTINE');
    if (new Set(physicalIds).size !== physicalIds.length) throw new Error('USB/Wi-Fi transports in this batch refer to the same physical device.');
    if (this.activeBySerial.size + serials.length > 4) throw new Error('At most four device executions may be active.');
    for (const serial of serials) {
      if (this.activeBySerial.has(serial)) throw new Error('Device already has a scheduled execution: ' + serial);
      const device = devices.find(d => d.serial === serial && d.status === 'device');
      if (!device || device.connectionType === 'Wi-Fi' && !device.identityVerified) throw new Error('Device must be an authorized, identity-verified Android transport: ' + serial);
      if (this.activeByPhysical.has(device.physicalId ?? serial)) throw new Error('Physical device already has an Agent through another transport.');
    }
    // Validate all authorization requests before atomically scheduling any job.
    for (const job of input.jobs) if (job.ownerAuthorizedTest) {
      const device = devices.find(d => d.serial === job.deviceId)!;
      if (job.agentVersion !== 2 || !device.identityVerified || !device.physicalId || !this.ownerPolicy.list().some(mode => mode.deviceId === job.deviceId && mode.physicalId === device.physicalId)) throw Error('Owner test mode is not enabled for this exact verified V2 device.');
    }
    if (prepared && (prepared.expiresAt <= Date.now() || input.jobs.length !== 1 || input.jobs[0].goal !== prepared.source || input.jobs[0].deviceId !== prepared.deviceId ||
      devices.find(d => d.serial === prepared.deviceId)?.physicalId !== prepared.physicalId || this.ownerPolicy.list().find(m => m.deviceId === prepared.deviceId && m.physicalId === prepared.physicalId)?.id !== prepared.ownerId)) throw Error('Prepared plan changed before scheduling.');
    this.prune();
    const created = input.jobs.map(job => {
      const device = devices.find(d => d.serial === job.deviceId)!;
      const task: DeviceTask = { executionId: randomUUID(), batchId: input.requestId, deviceId: job.deviceId, physicalId: device.physicalId,
        connectionMode: device.connectionType, request: job.goal, ...(job.agentVersion ? { agentVersion: job.agentVersion } : {}), status: 'QUEUED', createdAt: Date.now(), connectionState: 'device', events: [] };
      const ownerScope = job.ownerAuthorizedTest ? this.ownerPolicy.bind(task.deviceId, task.physicalId!, task.executionId) : undefined;
      if (ownerScope) task.ownerTestMode = this.ownerPolicy.list().find(mode => mode.id === ownerScope.id);
      const entry: RuntimeEntry = { task, controller: new AbortController(), disconnected: false, ownerScope, prepared };
      return entry;
    });
    for (const entry of created) {
      this.entries.set(entry.task.executionId, entry); this.activeBySerial.set(entry.task.deviceId, entry.task.executionId);
      this.activeByPhysical.set(entry.task.physicalId ?? entry.task.deviceId, entry.task.executionId);
    }
    this.requests.set(input.requestId, { jobs: jobsKey, ids: created.map(e => e.task.executionId) }); this.changed();
    for (const entry of created) entry.done = Promise.resolve().then(() => this.execute(entry));
    return created.map(entry => structuredClone(entry.task));
  }
  cancel(executionId: string, deviceId: string): boolean {
    // Recorder cancellation must carry its per-session owner capability via /teach.
    if([...this.teachSessions.values()].some(session=>session.executionId===executionId))return false;
    const entry = this.entries.get(executionId);
    if (!entry || entry.task.deviceId !== deviceId || !this.activeBySerial.has(deviceId) || terminalTask(entry.task.status)) return false;
    entry.task.cancelRequested = true; entry.controller.abort(); this.changed(); return true;
  }
  cancelBatch(batchId: string): number {
    let count = 0;
    for (const { task } of this.entries.values()) if (task.batchId === batchId && this.cancel(task.executionId, task.deviceId)) count++;
    return count;
  }
  confirm(input: Extract<RuntimeCommandValue, { type: 'ASSIST' }>): boolean {
    const task = this.entries.get(input.executionId)?.task;
    if (!task || task.deviceId !== input.deviceId || task.status !== 'WAITING_HUMAN' || task.cancelRequested ||
      task.latest?.assistance?.token !== input.token || task.latest.assistance.evidenceId !== input.evidenceId) return false;
    return submitHumanChoice(input.token, { evidenceId: input.evidenceId, confirmed: true, x: input.x, y: input.y });
  }
  confirmV2(input: Extract<RuntimeCommandValue, { type: 'ASSIST_V2' }>): boolean {
    const task = this.entries.get(input.executionId)?.task;
    if (!task || task.deviceId !== input.deviceId || task.status !== 'WAITING_HUMAN' || task.cancelRequested || task.latest?.v2?.assistance?.token !== input.token) return false;
    return submitAssistanceV2(input);
  }
  async settled(executionId: string) { await this.entries.get(executionId)?.done; }
  async shutdown() {
    if(this.administrativeReauthorizationPending())throw new TeachRuntimeError('ADMIN_REAUTH_IN_PROGRESS');
    for (const entry of this.entries.values()) if (this.activeBySerial.get(entry.task.deviceId) === entry.task.executionId) entry.controller.abort();
    await Promise.all([...this.entries.values()].map(entry => entry.done));
    // These are inspection reservations only, never a native Session. Preserve
    // the durable ADMIN marker and DB quarantine; restart cannot reuse the lease.
    for(const [id,fence]of this.administrativeFences){await fence.release();this.administrativeFences.delete(id);}
  }
  private prune() {
    // Recovery evidence is not ordinary display history. Retain lifecycle rows
    // until a separately approved retention policy can prove they are dispensable.
    const finished = [...this.entries.values()].filter(entry => !entry.task.teachLifecycle && !entry.task.administrativeAdmission && !this.activeBySerial.has(entry.task.deviceId) && terminalTask(entry.task.status));
    while (this.entries.size > 36 && finished.length) {
      const entry = finished.shift()!; this.entries.delete(entry.task.executionId);
      this.requests.delete(entry.task.batchId);
    }
  }
  private async execute(entry: RuntimeEntry) {
    const { task, controller } = entry, budget = new AgentBudget();
    budget.runtimeIdentity = { executionId: task.executionId, deviceId: task.deviceId };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(budget.limits.timeMs), ...(entry.ownerScope ? [AbortSignal.timeout(Math.max(0, entry.ownerScope.expiresAt - Date.now()))] : [])]);
    let execution: AgentExecution | undefined, loopOwnsCleanup = false;
    let releaseReservation: (() => Promise<void>) | undefined;
    const publish = (event: AgentProgress) => {
      task.latest = structuredClone(event);
      task.events.push({ ...structuredClone(event), visual: undefined, assistance: event.assistance && { ...event.assistance, token: undefined },
        v2: event.v2 && { ...structuredClone(event.v2), assistance: undefined } });
      if (task.events.length > 24) task.events.shift();
      task.status = entry.disconnected ? 'DISCONNECTED' : event.status === 'NEED_HUMAN_ASSISTANCE' && (event.assistance?.resumable || event.v2?.assistance) ? 'WAITING_HUMAN' :
        event.type === 'complete' && ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(event.status) ? event.status as DeviceTask['status'] : 'RUNNING';
      if (event.failure?.code === 'DEVICE_ERROR') { entry.disconnected = true; task.status = 'DISCONNECTED'; }
      this.changed();
    };
    try {
      if (decidePermission({ source: task.request, stage: 'REQUEST' }).decision === 'DENY') {
        publish({ type: 'complete', status: 'BLOCKED', reason: 'HARD_BLOCKED: excluded destructive/security/purchase request; no device effect.', ...budget.summary() });
        return;
      }
      releaseReservation = await this.adapter.reserve?.(task.deviceId, task.executionId);
      checkCancellation(signal); task.status = 'RUNNING';
      publish({ type: 'progress', status: 'PLANNING', reason: 'Validating this device goal and its safety scope.', description: task.request });
      if (task.agentVersion === 2) {
        const adapter = this.adapter.v2?.(task.deviceId, budget) ?? (this.adapter === androidRuntimeAdapter ? androidV2Adapter(task.deviceId, budget) : undefined);
        if (!adapter) throw new Error('No V2 runtime adapter is registered.');
        await runAgentV2(task.request, task.deviceId, task.executionId, task.physicalId ?? task.deviceId, budget, adapter, publish, signal, undefined, entry.ownerScope, entry.prepared?.v2);
        return;
      }
      const planStart = performance.now(), goal = entry.prepared?.goal ?? await this.adapter.plan(task.request, budget, signal, task.deviceId);
      budget.timings.planningMs = Math.round(performance.now() - planStart); checkCancellation(signal);
      const setupStart = performance.now(); execution = await this.adapter.open(goal, budget, task.deviceId, signal);
      const owned = execution;
      const ownSnapshot = (snapshot: Observation) => {
        if (snapshot.deviceSerial !== task.deviceId) throw new AndroidExecutionError('SESSION_ERROR', 'Observation belongs to another device; execution stopped.');
        return snapshot;
      };
      execution = { backend: owned.backend, observe: async signal => ownSnapshot(await owned.observe(signal)),
        execute: (action, signal, progress, candidate) => owned.execute(action, signal, progress, candidate), discoveryMemory: () => owned.discoveryMemory(),
        verificationSnapshot: () => { const snapshot = owned.verificationSnapshot?.(); return snapshot && ownSnapshot(snapshot); },
        confirmVisualTap: owned.confirmVisualTap ? (choice, plan, signal) => owned.confirmVisualTap!(choice, plan, signal) : undefined,
        close: () => owned.close() };
      budget.timings.sessionSetupMs = Math.round(performance.now() - setupStart); loopOwnsCleanup = true;
      const result = await runAgent(goal, budget, execution, undefined, signal, publish,
        (visual, ready) => waitForHuman({ ...visual, expiresAt: Math.min(visual.expiresAt, Date.now() + budget.remaining()) }, signal, ready));
      entry.memory = result.memory;
    } catch (error) {
      const failure = asAndroidError(error);
      if (failure.code === 'DEVICE_ERROR') entry.disconnected = true;
      publish({ type: 'complete', status: controller.signal.aborted ? 'CANCELLED' : 'FAILED', reason: failure.message,
        failure: { code: failure.code, message: failure.message }, ...budget.summary() });
    } finally {
      if (execution && !loopOwnsCleanup) {
        try { await execution.close(); } catch { publish({ type: 'complete', status: 'FAILED', reason: 'Session cleanup failed; inspect the retained device lock.' }); }
      }
      if (entry.disconnected) task.status = 'DISCONNECTED';
      task.finishedAt = Date.now();
      // Tokens/screenshots are ephemeral and never needed for finished executions.
      if (task.latest) { task.latest.visual = undefined; task.latest.assistance = undefined; if (task.latest.v2) task.latest.v2.assistance = undefined; }
      this.activeBySerial.delete(task.deviceId); this.changed();
      this.activeByPhysical.delete(task.physicalId ?? task.deviceId);
      await releaseReservation?.();
    }
  }
}
