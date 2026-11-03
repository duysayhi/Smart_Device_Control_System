import { createHash } from 'node:crypto';
import { z } from 'zod';

const digest=z.string().regex(/^[a-f0-9]{64}$/),nativeId=z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const Binding=z.object({recordingRef:z.uuid(),executionId:z.uuid(),requestId:z.uuid(),physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),
  runtimeSha256:digest,teachRuntimeSha256:digest,provenance:z.enum(['ANDROID_RUNTIME','SIMULATED_RECEIPT'])}).strict();
const Kind=z.enum(['ADMISSION_INTENT','RESERVATION_ACQUIRED','APP_RESOLVED','CREATE_INTENT','NATIVE_BOUND','BINDING_VERIFIED','NATIVE_READY','EFFECT_PENDING','EFFECT_RESOLVED',
  'CLOSE_INTENT','DELETE_INTENT','DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED','CLEANUP_PROVEN','CLEANUP_FAILED','RECOVERY_CONFIRMED','DB_RELEASE_CONFIRMED']);
const EventInput=z.object({kind:Kind,closeReason:z.enum(['OWNER_STOP','OWNER_CANCEL','HEARTBEAT_EXPIRED','BUDGET_EXHAUSTED','ABORT_SIGNAL','RUNTIME_INTERRUPTED']).optional(),nativeSessionId:nativeId.optional(),nativeServerSha256:digest.optional(),effectRequestId:z.uuid().optional(),dispatch:z.enum(['ACK','NOT_SENT','UNKNOWN']).optional(),actorScopeHash:digest.optional(),recoveryReferenceHash:digest.optional(),databaseRevision:z.number().int().positive().optional()}).strict();
const Event=EventInput.extend({revision:z.number().int().positive(),at:z.number().int().nonnegative(),previousDigest:digest,digest}).strict();
const Lifecycle=z.object({contractVersion:z.literal(1),binding:Binding,events:z.array(Event).min(1).max(128)}).strict();
export type TeachLifecycle=z.infer<typeof Lifecycle>;
export type TeachLifecycleBinding=z.infer<typeof Binding>;
export const TeachLifecycleBindingSchema=Binding;
export const RecoveryPreparedSchema=z.object({reference:z.uuid(),expiresAt:z.number().int(),revision:z.number().int().positive(),digest,binding:Binding,cleanup:z.literal('PROVEN'),pending:z.literal('NONE'),nativeSessionId:nativeId,nativeServerSha256:digest,requiresOwnerConfirmation:z.literal(true)}).strict();
export const RecoveryProofSchema=z.object({binding:Binding,nativeSessionId:nativeId,nativeServerSha256:digest,cleanup:z.literal('PROVEN'),pending:z.literal('NONE'),independentlyVerified:z.literal(true),verifiedAt:z.number().int(),revision:z.number().int().positive(),digest}).strict();
export type TeachLifecycleEvent=z.infer<typeof EventInput>;
export class TeachAttestationError extends Error {constructor(readonly code='TEACH_ATTESTATION_INVALID'){super(code);}}
const fail=():never=>{throw new TeachAttestationError();};
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export const lifecycleDigest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface LifecycleState {nativeSessionId?:string;nativeServerSha256?:string;createIntent:boolean;bindingVerified:boolean;nativeReady:boolean;deleteIntent:boolean;deleteAck:boolean;absenceVerified:boolean;nativeClosed:boolean;cleanup:'UNPROVEN'|'PROVEN'|'FAILED';pending:'NONE'|'PENDING'|'UNKNOWN';pendingRequest?:string;recoveryActor?:string;recoveryReference?:string;revision:number;digest:string}
function reduce(binding:TeachLifecycleBinding,events:TeachLifecycle['events']):LifecycleState {
 const state:LifecycleState={createIntent:false,bindingVerified:false,nativeReady:false,deleteIntent:false,deleteAck:false,absenceVerified:false,nativeClosed:false,cleanup:'UNPROVEN',pending:'NONE',revision:0,digest:lifecycleDigest(binding)};
 for(const e of events){
  if(e.revision!==state.revision+1||e.previousDigest!==state.digest)fail();
  const {digest:stored,...payload}=e;if(lifecycleDigest({binding,...payload})!==stored)fail();
  if(e.closeReason&&e.kind!=='CLOSE_INTENT')fail();
  if(e.nativeSessionId&&state.nativeSessionId&&state.nativeSessionId!==e.nativeSessionId)fail();
  if(e.kind!=='NATIVE_BOUND'&&e.nativeSessionId)fail();
  if(e.kind!=='CREATE_INTENT'&&e.nativeServerSha256)fail();
  if(e.kind!=='EFFECT_PENDING'&&e.kind!=='EFFECT_RESOLVED'&&e.effectRequestId)fail();
  if(e.kind!=='EFFECT_RESOLVED'&&e.dispatch)fail();
  if(!['RECOVERY_CONFIRMED','DB_RELEASE_CONFIRMED'].includes(e.kind)&&(e.actorScopeHash||e.recoveryReferenceHash||e.databaseRevision))fail();
  switch(e.kind){
   case 'ADMISSION_INTENT':if(state.revision)fail();break;
   case 'RESERVATION_ACQUIRED':case 'APP_RESOLVED':if(state.createIntent||!state.revision)fail();break;
   case 'CREATE_INTENT':if(state.createIntent||!state.revision||!e.nativeServerSha256)fail();state.createIntent=true;state.nativeServerSha256=e.nativeServerSha256;break;
   case 'NATIVE_BOUND':if(!state.createIntent||state.nativeSessionId||!e.nativeSessionId)fail();state.nativeSessionId=e.nativeSessionId;break;
   case 'BINDING_VERIFIED':if(!state.nativeSessionId||state.bindingVerified||state.deleteIntent)fail();state.bindingVerified=true;break;
   case 'NATIVE_READY':if(!state.bindingVerified||state.nativeReady||state.deleteIntent)fail();state.nativeReady=true;break;
   case 'EFFECT_PENDING':if(!state.nativeReady||state.pending!=='NONE'||state.deleteIntent||!e.effectRequestId)fail();state.pending='PENDING';state.pendingRequest=e.effectRequestId;break;
   case 'EFFECT_RESOLVED':if(state.pending!=='PENDING'||e.effectRequestId!==state.pendingRequest||!e.dispatch)fail();state.pending=e.dispatch==='UNKNOWN'?'UNKNOWN':'NONE';state.pendingRequest=undefined;break;
   case 'CLOSE_INTENT':break;
   case 'DELETE_INTENT':if(!state.nativeSessionId||state.deleteIntent||state.pending==='PENDING')fail();state.deleteIntent=true;break;
   case 'DELETE_ACK':if(!state.deleteIntent||state.deleteAck)fail();state.deleteAck=true;break;
   case 'ABSENCE_VERIFIED':if(!state.deleteAck||state.absenceVerified)fail();state.absenceVerified=true;break;
   case 'NATIVE_CLOSED':if(!state.absenceVerified||state.nativeClosed)fail();state.nativeClosed=true;break;
   case 'CLEANUP_PROVEN':if(state.createIntent&&!state.nativeClosed||state.pending==='PENDING'||state.cleanup==='PROVEN')fail();state.cleanup='PROVEN';break;
   case 'CLEANUP_FAILED':state.cleanup='FAILED';break;
   case 'RECOVERY_CONFIRMED':
    if(state.cleanup!=='PROVEN'||state.pending!=='NONE'||!state.bindingVerified||!e.actorScopeHash||!e.recoveryReferenceHash||e.databaseRevision)fail();
    state.recoveryActor=e.actorScopeHash;state.recoveryReference=e.recoveryReferenceHash;break;
   case 'DB_RELEASE_CONFIRMED':
    if(state.cleanup!=='PROVEN'||state.pending!=='NONE'||!e.databaseRevision||!e.actorScopeHash||!e.recoveryReferenceHash||e.actorScopeHash!==state.recoveryActor||e.recoveryReferenceHash!==state.recoveryReference)fail();break;
  }
  if(!state.revision&&e.kind!=='ADMISSION_INTENT')fail();state.revision=e.revision;state.digest=e.digest;
 }
 return state;
}
export function parseTeachLifecycle(input:unknown):TeachLifecycle {const parsed=Lifecycle.safeParse(input);if(!parsed.success)throw new TeachAttestationError();reduce(parsed.data.binding,parsed.data.events);return parsed.data;}
export function teachLifecycleState(input:unknown):LifecycleState {const parsed=parseTeachLifecycle(input);return reduce(parsed.binding,parsed.events);}
export function appendTeachLifecycle(value:TeachLifecycle,event:TeachLifecycleEvent):TeachLifecycle {
 const before=parseTeachLifecycle(value),state=reduce(before.binding,before.events),input=EventInput.parse(event);
 const payload={...input,revision:state.revision+1,at:Date.now(),previousDigest:state.digest};
 return parseTeachLifecycle({...before,events:[...before.events,{...payload,digest:lifecycleDigest({binding:before.binding,...payload})}]});
}
export function createTeachLifecycle(input:TeachLifecycleBinding):TeachLifecycle {
 const binding=Binding.parse(input),payload={kind:'ADMISSION_INTENT' as const,revision:1,at:Date.now(),previousDigest:lifecycleDigest(binding)};
 return parseTeachLifecycle({contractVersion:1,binding,events:[{...payload,digest:lifecycleDigest({binding,...payload})}]});
}
