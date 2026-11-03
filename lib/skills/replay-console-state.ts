import { z } from 'zod';
import { ReplayBindingSchema, ReplayCheckpointSchema, ReplayStatusSchema, type ReplayCheckpoint } from './replay-schemas';
import type { SkillDefinition } from './skill-schema';

export const REPLAY_CONSOLE_STORAGE_KEY = 'phoneCommanderSkillReplayLeaseV1';
const uuid=z.uuid();
export const ReplayHandleSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('LEASE'),leaseId:uuid,ownerToken:z.string().regex(/^[a-f0-9]{64}$/),binding:ReplayBindingSchema,authorizationId:uuid.optional()}).strict(),
  z.object({kind:z.literal('OPEN_PENDING'),requestId:uuid,skillId:uuid,version:z.number().int().min(1).max(9999)}).strict(),
]);
export type ReplayHandle=z.infer<typeof ReplayHandleSchema>;
export type ReplayLease=Extract<ReplayHandle,{kind:'LEASE'}>;
export const ReplayConsoleSnapshotSchema=z.object({checkpoint:ReplayCheckpointSchema,
  history:z.object({transitions:z.array(ReplayStatusSchema).max(512),events:z.array(z.record(z.string(),z.unknown())).max(100)}).optional()});
export type ReplayConsoleSnapshot=z.infer<typeof ReplayConsoleSnapshotSchema>;
export const ReplayOptionsSchema=z.object({supervisedEnabled:z.boolean(),reason:z.string().regex(/^[A-Z0-9_]{1,80}$/),devices:z.array(z.object({
  deviceId:z.string().min(1).max(256),physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),authorizationId:uuid.optional(),expiresAt:z.number().optional(),
})).max(100)});
export type ReplayOptions=z.infer<typeof ReplayOptionsSchema>;
export const replayReason=(value:unknown,fallback='REPLAY_RESPONSE_INVALID')=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:fallback;
export function readReplayHandle(storage:Pick<Storage,'getItem'>):ReplayHandle|undefined{
  const raw=storage.getItem(REPLAY_CONSOLE_STORAGE_KEY);if(!raw)return;
  if(raw.length>4096)throw Error('REPLAY_RECONNECT_REFERENCE_INVALID');
  let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('REPLAY_RECONNECT_REFERENCE_INVALID');}
  const parsed=ReplayHandleSchema.safeParse(value);if(!parsed.success)throw Error('REPLAY_RECONNECT_REFERENCE_INVALID');return parsed.data;
}
export function replayReference(handle:ReplayHandle){return handle.kind==='LEASE'?{skillId:handle.binding.skillId,version:handle.binding.version}:{skillId:handle.skillId,version:handle.version};}
export const replayTerminal=(cp:ReplayCheckpoint)=>['COMPLETED','BLOCKED','FAILED','CANCELLED','INTERRUPTED','UNKNOWN_EFFECT'].includes(cp.status);
export const replaySettled=(cp:ReplayCheckpoint)=>replayTerminal(cp)&&cp.ownership!=='HELD';
export const replaySafeToStartNew=(cp:ReplayCheckpoint)=>replaySettled(cp)&&cp.ownership==='RELEASED'&&cp.status!=='UNKNOWN_EFFECT'&&!cp.pending;
export function acceptReplaySnapshot(input:unknown,lease:ReplayLease,definition:SkillDefinition,previous?:ReplayConsoleSnapshot):ReplayConsoleSnapshot{
  const parsed=ReplayConsoleSnapshotSchema.safeParse(input);if(!parsed.success)throw Error('REPLAY_RESPONSE_INVALID');const next=parsed.data,cp=next.checkpoint;
  if(Object.keys(lease.binding).some(key=>cp.binding[key as keyof typeof cp.binding]!==lease.binding[key as keyof typeof lease.binding])||
    cp.currentStep!==cp.verifiedSteps.length||cp.currentStep>definition.steps.length||cp.verifiedSteps.some((s,i)=>s.stepId!==definition.steps[i].id)||
    previous&&cp.revision<previous.checkpoint.revision)throw Error('REPLAY_RESPONSE_CONTEXT_MISMATCH');
  return {...next,history:next.history??previous?.history};
}
export function replayStepStatus(stepId:string,index:number,cp?:ReplayCheckpoint){
  if(!cp)return 'NOT_DISPATCHED';if(cp.verifiedSteps.some(s=>s.stepId===stepId))return 'VERIFIED';
  if(cp.pending?.stepId===stepId)return cp.pending.dispatch==='UNKNOWN'?'UNKNOWN_EFFECT':cp.pending.dispatch==='ACK'?'ACK_UNVERIFIED':'DISPATCH_PENDING';
  return cp.currentStep===index?cp.status:'NOT_DISPATCHED';
}
