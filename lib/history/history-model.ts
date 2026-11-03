import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DeviceTask } from '../android/agent/runtime-schema';
import type { AndroidAdbDevice } from '../../types/device';
import { GoalGraphV2Schema } from '../android/agent/goal-graph';

export class HistoryError extends Error {
  constructor(readonly code:string) { super(code); this.name='HistoryError'; }
}
export const hashHistory=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
export function historyId(text:string) { const h=hashHistory(text);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
const publicReasons=new Set(['COMPLETED','CANCELLED','FAILED','BLOCKED','SAFE_BLOCKED','HARD_DENY','TIMEOUT','DEVICE_ERROR','CONFIG_ERROR','UNKNOWN_EFFECT','DISPATCH_OUTCOME_UNKNOWN','POSTCONDITION_UNVERIFIED','CHECKPOINT_STORAGE_UNAVAILABLE','REPLAY_TIMEOUT','NEEDS_CLARIFICATION','UNSUPPORTED_OUTCOME','UNSUPPORTED_PHRASING','OWNER_TEST_DESTRUCTIVE_INTENT','DEVICE_LOCKED','DEVICE_DISCONNECTED']);
export const historyCode=(value:unknown)=>{const code=typeof value==='string'?value.split(':',1)[0]:'';return publicReasons.has(code)?code:'REDACTED_REASON';};
export const physicalHash=(value:unknown)=>typeof value==='string'&&/^android:[a-f0-9]{64}$/.test(value)?value.slice(8):undefined;
export const safeNumber=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=2147483647?Math.round(value):null;
const safeHardware=(value:unknown)=>typeof value==='string'&&/^[\p{L}\p{N} ._()+-]{1,100}$/u.test(value)?value:undefined;
export const HistoryTaskSchema=z.object({executionId:z.uuid(),deviceId:z.string().min(1).max(256),request:z.string().max(2000),status:z.enum(['QUEUED','RUNNING','WAITING_HUMAN','COMPLETED','BLOCKED','FAILED','CANCELLED','DISCONNECTED']),createdAt:z.number().int().nonnegative(),finishedAt:z.number().int().nonnegative().optional(),physicalId:z.string().optional()}).passthrough();
export interface HistoryDevice { serialHash:string; physicalHash:string; model:string; manufacturer?:string; androidVersion?:string; transport:'USB'|'Wi-Fi'; status:string; at:number }
export function historyDevice(device:AndroidAdbDevice,at:number):HistoryDevice|undefined {
  const identity=physicalHash(device.physicalId),model=safeHardware(device.model);
  if(!identity||!device.identityVerified||!model||model===device.serial||!['device','offline','unauthorized'].includes(device.status))return;
  return {serialHash:hashHistory(device.serial),physicalHash:identity,model,manufacturer:safeHardware(device.manufacturer),androidVersion:safeHardware(device.osVersion),transport:device.connectionType,
    status:device.status==='device'?'CONNECTED':device.status==='offline'?'OFFLINE':device.status==='unauthorized'?'UNAUTHORIZED':'ERROR',at};
}
export interface HistoryStep {id:string;order:number;capability:string;status:string;evidence:{id:string;ref:string;tier:string}[]}
export interface HistorySnapshot {id:string;physicalHash?:string;serialHash:string;source:'LIVE_WORKER'|'LEGACY_IMPORT';sourceAt:number;createdAt:number;finishedAt?:number;
  status:string;sourceStatus:string;engine:string;reason:string;requestHash:string;digest:string|null;modelCalls:number|null;rpc:number|null;adb:number|null;duration:number|null;
  aggregate:{verified:number|null;total:number|null};steps:HistoryStep[];providers:{id:string;provider:string;model:string|null;elapsed:number|null;prompt:number|null;completion:number|null;http:number|null}[]}
/** Projection only: no raw command, nested UI, authorization, arbitrary reason or model payload crosses this boundary. */
export function mapHistoryTask(input:DeviceTask,source:HistorySnapshot['source'],sourceAt:number,runtimeDigest?:string):HistorySnapshot {
  const result=HistoryTaskSchema.safeParse(input);if(!result.success)throw new HistoryError('INVALID_HISTORY_TASK');
  if(input.finishedAt!==undefined&&input.finishedAt<input.createdAt)throw new HistoryError('INVALID_HISTORY_TIME');
  const unknown=input.skillReplay?.checkpoint.status==='UNKNOWN_EFFECT'||input.latest?.v2?.reflections?.some(r=>r.classification==='UNKNOWN_EFFECT')||input.latest?.v2?.localEffects?.some(r=>r.dispatch==='UNKNOWN');
  const sourceStatus=unknown?'UNKNOWN_EFFECT':input.status;
  const statuses:Record<string,string>={WAITING_HUMAN:'WAITING_APPROVAL',DISCONNECTED:'UNVERIFIED',UNKNOWN_EFFECT:'UNVERIFIED'};
  const graph=GoalGraphV2Schema.safeParse(input.latest?.v2?.graph),steps:HistoryStep[]=[];
  if(graph.success&&graph.data.executionId===input.executionId&&graph.data.deviceId===input.deviceId)for(const [index,node] of graph.data.nodes.entries()) {
    const references=node.evidenceIds.filter(id=>z.uuid().safeParse(id).success);
    steps.push({id:historyId(input.executionId+':step:'+node.id),order:index+1,capability:node.capability,
      status:node.status==='VERIFIED'&&references.length?'VERIFIED':node.status==='SAFE_BLOCKED'?'BLOCKED':node.status==='RUNNING'?'RUNNING':'PENDING',
      evidence:references.map(ref=>({id:historyId(input.executionId+':evidence:'+node.id+':'+ref),ref,tier:source==='LEGACY_IMPORT'?'LEGACY_WORKER_REFERENCE':'WORKER_REGISTRY_REFERENCE'}))});
  }
  const providers=(input.latest?.reasoningMeasurements??[]).slice(0,100).flatMap((measurement,index)=>{
    // A rejected/queued planner measurement is not proof of an HTTP model request.
    if(!measurement.provider||!['ollama','groq','OLLAMA','GROQ'].includes(measurement.provider)||!measurement.httpStatus)return [];
    return [{id:historyId(input.executionId+':provider:'+index),provider:measurement.provider.toLowerCase(),model:typeof measurement.model==='string'&&/^[a-zA-Z0-9._:/-]{1,150}$/.test(measurement.model)?measurement.model:null,
      elapsed:safeNumber(measurement.elapsedMs),prompt:safeNumber(measurement.promptTokens),completion:safeNumber(measurement.outputTokens),http:measurement.httpStatus&&measurement.httpStatus>=100&&measurement.httpStatus<=599?measurement.httpStatus:null}];
  });
  return {id:input.executionId,physicalHash:physicalHash(input.physicalId),serialHash:hashHistory(input.deviceId),source,sourceAt,createdAt:input.createdAt,finishedAt:input.finishedAt,
    status:statuses[sourceStatus]??sourceStatus,sourceStatus,engine:input.agentVersion===2?'GOAL_V2':'GOAL_V1',reason:historyCode(input.latest?.failure?.code??input.latest?.reason),
    requestHash:hashHistory(input.request),digest:runtimeDigest&&/^[a-f0-9]{64}$/.test(runtimeDigest)?runtimeDigest:null,
    modelCalls:null,rpc:safeNumber(input.latest?.profiling?.rpcCount),adb:safeNumber(input.latest?.profiling?.adbCount),duration:safeNumber(input.latest?.timings?.totalMs),
    aggregate:{verified:safeNumber(input.latest?.verifiedSubgoals),total:safeNumber(input.latest?.totalSubgoals)},steps,providers};
}

export const HistoryQuerySchema=z.object({kind:z.enum(['executions','devices','connections','detail']).default('executions'),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),
  deviceId:z.uuid().optional(),id:z.uuid().optional(),status:z.string().regex(/^[A-Z_]{1,40}$/).optional(),engine:z.enum(['ACTION_PLAN','GOAL_V1','GOAL_V2','UNIFIED','HYBRID']).optional(),transport:z.enum(['USB','Wi-Fi']).optional(),
  from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),q:z.string().max(100).optional()}).strict().refine(q=>q.kind!=='detail'||!!q.id).refine(q=>!q.from||!q.to||Date.parse(q.from)<=Date.parse(q.to));
export type HistoryQuery=z.infer<typeof HistoryQuerySchema>;
