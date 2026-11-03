import { z } from 'zod';
import { isLocalMutation, isLocalSameOrigin } from '../android/agent/request-origin';
import { workerRequest } from '../android/agent/worker-client';
import { ReplayCheckpointSchema } from './replay-contracts';
import { bindSkillParameters, loadSkillProgram, SkillProgramError, programError } from './skill-program';
import { teachDashboard } from './teach-api';
import { teachStorageError } from './db/teach-errors';
import type { OfflineTeachDashboard } from './teach-dashboard';

const params=z.record(z.string().max(64),z.union([z.string().max(500),z.number().int()])).refine(p=>Object.keys(p).length<=20);
const requestSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('OFFLINE_PREVIEW'),parameters:params}).strict(),
  z.object({mode:z.literal('SUPERVISED'),parameters:params,deviceId:z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/),requestId:z.uuid(),authorizationId:z.uuid(),confirmedExperimental:z.literal(true)}).strict(),
]);
export interface ReplayApiDependencies {
  dashboard?:OfflineTeachDashboard;
  supervisedAllowed?:()=>boolean;
  worker?:(path:'/teach'|'/replay',command:unknown)=>Promise<unknown>;
  storageBinding?:()=>Promise<void>;
  runtime?:()=>Promise<unknown>;
}
/** Read-only availability, never enables owner mode or creates a Session. OFF does not contact Worker/DB. */
export async function skillReplayOptionsResponse(request:Request,provided:ReplayApiDependencies={}){
  if(request.method!=='GET')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
  if(!isLocalSameOrigin(request))return Response.json({code:'LOCAL_ORIGIN_REQUIRED'},{status:403});
  const enabled=(provided.supervisedAllowed??(()=>process.env.TEACH_ENABLE_SUPERVISED_REPLAY==='1'))();
  if(!enabled)return Response.json({supervisedEnabled:false,devices:[],reason:'SUPERVISED_REPLAY_DISABLED'},{headers:{'Cache-Control':'no-store'}});
  try{
    const read=provided.runtime??(async()=>{const response=await workerRequest('GET');if(!response.ok)programError('REPLAY_WORKER_UNAVAILABLE');return response.json();});
    const state=z.object({devices:z.array(z.object({serial:z.string(),physicalId:z.string().optional(),status:z.string(),identityVerified:z.boolean().optional()})),
      ownerTestModes:z.array(z.object({id:z.uuid(),deviceId:z.string(),physicalId:z.string(),expiresAt:z.number()}))}).parse(await read());
    const devices=state.devices.filter(d=>d.status==='device'&&d.identityVerified&&/^android:[a-f0-9]{64}$/.test(d.physicalId??'')).map(d=>{
      const owner=state.ownerTestModes.find(m=>m.deviceId===d.serial&&m.physicalId===d.physicalId&&m.expiresAt>Date.now());
      return {deviceId:d.serial,physicalId:d.physicalId,...(owner?{authorizationId:owner.id,expiresAt:owner.expiresAt}:{})};
    });return Response.json({supervisedEnabled:true,devices,reason:devices.some(d=>d.authorizationId)?'OWNER_SCOPE_AVAILABLE':'OWNER_AUTHORIZATION_REQUIRED'},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({supervisedEnabled:false,devices:[],reason:'REPLAY_WORKER_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
async function worker(path:'/teach'|'/replay',command:unknown){
  let response:Response;try{response=await workerRequest('POST',command,path);}catch{programError('REPLAY_WORKER_OUTCOME_UNKNOWN');}
  const payload=await response.json().catch(()=>null);
  if(!response.ok||!payload)programError(typeof payload?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(payload.code)?payload.code:'REPLAY_WORKER_REJECTED');return payload;
}
function failure(error:unknown){const e=error instanceof SkillProgramError?error:teachStorageError(error);return Response.json({code:e.code,error:e.message},{status:e.code==='NO_REMOTE_CONSENT'?403:e.code==='NOT_FOUND'?404:/INVALID|PARAMETER|INCOMPATIBLE/.test(e.code)?400:409,headers:{'Cache-Control':'no-store'}});}
/** Offline preview is a plan, never simulated execution or Android evidence. */
export async function skillReplayResponse(request:Request,skillId:string,versionText:string,provided:ReplayApiDependencies={}){
  if(request.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
  if(!isLocalMutation(request))return Response.json({code:'LOCAL_ORIGIN_REQUIRED'},{status:403});
  try{
    if(!z.uuid().safeParse(skillId).success||!/^\d{1,4}$/.test(versionText)||Number(versionText)<1)programError('INVALID_SKILL_REFERENCE');
    const parsed=requestSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)programError('INVALID_REPLAY_REQUEST');const input=parsed.data;
    if(input.mode==='SUPERVISED'&&!(provided.supervisedAllowed??(()=>process.env.TEACH_ENABLE_SUPERVISED_REPLAY==='1'))())programError('SUPERVISED_REPLAY_DISABLED');
    const dashboard=provided.dashboard??teachDashboard(),stored=await dashboard.versionView(skillId,Number(versionText)),program=loadSkillProgram(stored.definition);
    if(!['DRAFT','PENDING_VALIDATION','VERIFIED','PUBLISHED'].includes(stored.status))programError('SKILL_VERSION_STATUS_UNSUPPORTED');
    const bound=bindSkillParameters(program,input.parameters);
    if(input.mode==='OFFLINE_PREVIEW')return Response.json({mode:'OFFLINE_PREVIEW',status:'NOT_DISPATCHED',storageMode:stored.storageMode,
      schemaVersion:1,definitionDigest:program.definitionDigest,compatibility:program.compatibility,steps:program.steps.map(s=>({id:s.step.id,operation:s.step.operation,preconditions:s.preconditions,postcondition:s.postcondition.kind,status:'NOT_DISPATCHED'})),parameters:Object.keys(bound.parameters),modelCalls:0,
      explanation:'Kế hoạch tĩnh; chưa quan sát UI, chưa dispatch, chưa kiểm chứng trên Android.'},{headers:{'Cache-Control':'no-store'}});
    if(!program.compatibility.supported)programError('REPLAY_SKILL_UNSUPPORTED');
    const {repository}=dashboard.recordingPersistence();
    const binding=provided.storageBinding??(async()=>{const expected=process.env.TEACH_EXPECTED_BRANCH_SHA256;if(!expected||!repository.assertRecorderBranchBinding)programError('REPLAY_TEST_BRANCH_BINDING_REQUIRED');await repository.assertRecorderBranchBinding(expected);});
    await binding();await repository.assertConsent();const send=provided.worker??worker;
    const identity=await send('/teach',{type:'IDENTITY',deviceId:input.deviceId}) as {physicalId?:string;serial?:string};
    if(identity.serial!==input.deviceId||!/^android:[a-f0-9]{64}$/.test(identity.physicalId??''))programError('REPLAY_DEVICE_IDENTITY_INVALID');
    const version=await repository.getVersionByNumber(skillId,Number(versionText));
    return Response.json(await send('/replay',{type:'OPEN',requestId:input.requestId,deviceId:input.deviceId,expectedPhysicalId:identity.physicalId,
      skillId,versionId:version.id,version:version.version,contentHash:version.contentHash,definitionDigest:program.definitionDigest,definition:version.definition,parameters:input.parameters,
      authorizationId:input.authorizationId,confirmed:true}),{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failure(error);}
}
export async function skillReplayControlResponse(request:Request,leaseId:string,provided:ReplayApiDependencies={}){
  if(request.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
  if(!isLocalMutation(request))return Response.json({code:'LOCAL_ORIGIN_REQUIRED'},{status:403});
  try{
    const schema=z.discriminatedUnion('type',[z.object({type:z.enum(['STATE','PAUSE','CANCEL'])}).strict(),z.object({type:z.literal('RESUME'),checkpoint:ReplayCheckpointSchema}).strict()]);
    const input=schema.safeParse(await request.json().catch(()=>null)),ownerToken=request.headers.get('x-teach-owner')??'';
    if(!z.uuid().safeParse(leaseId).success||!input.success||!/^[a-f0-9]{64}$/.test(ownerToken))programError('INVALID_REPLAY_CONTROL');
    if(input.data.type==='RESUME'&&!(provided.supervisedAllowed??(()=>process.env.TEACH_ENABLE_SUPERVISED_REPLAY==='1'))())programError('SUPERVISED_REPLAY_DISABLED');
    return Response.json(await(provided.worker??worker)('/replay',{...input.data,leaseId,ownerToken}),{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failure(error);}
}
