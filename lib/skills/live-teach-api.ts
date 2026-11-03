import { z } from 'zod';
import { isLocalMutation, isLocalSameOrigin } from '../android/agent/request-origin';
import { teachDashboard } from './teach-api';
import { LiveTeachError, LiveTeachService } from './live-teach-service';
import { TeachStorageError, teachStorageError } from './db/teach-errors';
import { SkillProgramError } from './skill-program';
import {ownerPasskeyService} from '../owner-auth/api';
import {OwnerAuthenticationError} from '../owner-auth/store';

const store=globalThis as typeof globalThis & {phoneCommanderTeachLiveG3?:LiveTeachService};
export function liveTeachService() {
  const dashboard=teachDashboard();
  if(dashboard.mode!=='POSTGRESQL_STORAGE')throw new LiveTeachError('LIVE_RECORDER_REQUIRES_POSTGRESQL');
  const {repository,storage}=dashboard.recordingPersistence();
  return store.phoneCommanderTeachLiveG3??=new LiveTeachService(repository,storage,dashboard,undefined,async()=>{
    const fingerprint=process.env.TEACH_EXPECTED_BRANCH_SHA256;
    if(!fingerprint||!/^[a-f0-9]{64}$/.test(fingerprint)||!repository.assertRecorderBranchBinding)throw new LiveTeachError('RECORDER_TEST_BRANCH_BINDING_REQUIRED');
    await repository.assertRecorderBranchBinding(fingerprint);
  },ownerPasskeyService());
}
const operations=['state','frame','stream','events','pair-companion','annotate','step','pause','resume','stop','cancel','compile','review-intent'] as const;
export type RecorderOperation=typeof operations[number];
function liveScreenStream(request:Request,service:LiveTeachService,id:string,token:string) {
  const lease=service.claimScreenStream(id,token),encoder=new TextEncoder();let closed=false;
  const close=()=>{if(!closed){closed=true;lease.close();request.signal.removeEventListener('abort',close);}};
  const body=new ReadableStream<Uint8Array>({
    async pull(controller){
      if(closed)return;
      if(request.signal.aborted){close();controller.close();return;}
      try {
        const frame=await lease.read();
        if(request.signal.aborted){close();controller.close();return;}
        controller.enqueue(encoder.encode(`data:${JSON.stringify(frame)}\n\n`));
        await new Promise(resolve=>setTimeout(resolve,80));
      } catch(error) {
        if(error instanceof LiveTeachError&&error.code==='RECORDER_REQUEST_PENDING'&&!request.signal.aborted){await new Promise(resolve=>setTimeout(resolve,80));return;}
        const code=error instanceof LiveTeachError?error.code:'RECORDER_STREAM_FAILED';
        if(!request.signal.aborted)controller.enqueue(encoder.encode(`event:error\ndata:${JSON.stringify({code})}\n\n`));
        close();controller.close();
      }
    },
    cancel(){close();},
  },{highWaterMark:0});
  request.signal.addEventListener('abort',close,{once:true});
  return new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
export async function liveTeachResponse(request:Request,id?:string,operation?:string,provided?:LiveTeachService) {
  const read=request.method==='GET';
  if(!['GET','POST'].includes(request.method))return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
  if(!(read?isLocalSameOrigin(request):isLocalMutation(request)))return Response.json({code:'LOCAL_ORIGIN_REQUIRED'},{status:403});
  if(id&&(!z.uuid().safeParse(id).success||!operations.includes(operation as RecorderOperation)))return Response.json({code:'RECORDER_ROUTE_NOT_FOUND'},{status:404});
  if(id&&read!==['state','frame','stream','events'].includes(operation!))return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
  try {
    const service=provided??liveTeachService(),token=request.headers.get('x-teach-owner')??'';
    if(id&&operation==='stream')return liveScreenStream(request,service,id,token);
    const input=read?undefined:await request.json().catch(()=>null);
    let result:unknown;
    if(!id) {
      const diagnostic=new URL(request.url).searchParams.get('review-status');
      if(read&&diagnostic)result=await service.admissionStatus(diagnostic);
      else if(read)result=await service.devices();
      else if(['PREPARE_ADMIN_RECOVERY','RETIRE_ADMIN_RECOVERY','PREPARE_ADMIN_FRESH','AUTHORIZE_ADMIN_FRESH','PREPARE_ADMIN_REAUTHORIZATION','AUTHORIZE_ADMIN_REAUTHORIZATION','PREPARE_CONTINUATION','AUTHORIZE_CONTINUATION'].includes(input?.type)){
        const {type,...data}=input;
        if(type==='PREPARE_ADMIN_RECOVERY')result=await service.prepareAdministrativeRecovery(data);
        else if(type==='RETIRE_ADMIN_RECOVERY')result=await service.retireAdministrativeRecovery(data);
        else if(type==='PREPARE_ADMIN_FRESH')result=await service.prepareAdministrativeFresh(data);
        else if(type==='AUTHORIZE_ADMIN_FRESH')result=await service.authorizeAdministrativeFresh(data,request.headers.get('x-teach-client')??'');
        else if(type==='PREPARE_ADMIN_REAUTHORIZATION')result=await service.prepareAdministrativeReauthorization(data);
        else if(type==='PREPARE_CONTINUATION')result=await service.prepareContinuation(data);
        else if(type==='AUTHORIZE_CONTINUATION')result=await service.authorizeContinuation(data,request.headers.get('x-teach-client')??'');
        else result=await service.authorizeAdministrativeReauthorization(data,request.headers.get('x-teach-client')??'');
      }
      else if(input?.type==='PREPARE_DURABLE_RECOVERY'){
        const parsed=z.object({type:z.literal('PREPARE_DURABLE_RECOVERY'),id:z.uuid(),executionId:z.uuid(),deviceId:z.string(),authorizationId:z.uuid()}).strict().safeParse(input);
        if(!parsed.success)throw new LiveTeachError('INVALID_RECOVERY_REQUEST');
        const {type:ignored,...data}=parsed.data;void ignored;result=await service.prepareDurableRecovery(data);
      }else if(input?.type==='RELEASE_DURABLE_RECOVERY'){
        const parsed=z.object({type:z.literal('RELEASE_DURABLE_RECOVERY'),reference:z.uuid(),revision:z.number().int().positive(),authorizationId:z.uuid(),confirmed:z.literal(true)}).strict().safeParse(input);
        if(!parsed.success)throw new LiveTeachError('INVALID_RECOVERY_REQUEST');
        const {type:ignored,...data}=parsed.data;void ignored;result=await service.releaseDurableRecovery(data);
      }
      else if(input?.type==='RECOVER_CLEANUP') {
        const parsed=z.object({type:z.literal('RECOVER_CLEANUP'),id:z.uuid(),leaseId:z.uuid(),confirmed:z.literal(true)}).strict().safeParse(input);
        if(!parsed.success)throw new LiveTeachError('INVALID_RECORDER_REQUEST');
        result=await service.recoverCleanup({id:parsed.data.id,leaseId:parsed.data.leaseId},token);
      } else result=await service.open(input,request.headers.get('x-teach-client')??'');
    } else if(operation==='pair-companion')result=await service.pairCompanion(id,token,input);
    else if(operation==='events')result=await service.observedEvents(id,token);
    else if(operation==='annotate')result=await service.annotate(id,token,input);
    else if(operation==='state')result=await service.state(id,token);
    else if(operation==='frame')result=await service.frame(id,token);
    else if(operation==='step')result=await service.step(id,token,input);
    else if(operation==='compile')result=await service.compile(id,token,input);
    else if(operation==='review-intent')result=service.reviewIntent(id,token,input);
    else result=await service.control(id,token,operation as 'pause'|'resume'|'stop'|'cancel',input);
    return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch(error) {
    const failure=error instanceof LiveTeachError||error instanceof SkillProgramError||error instanceof OwnerAuthenticationError?error:teachStorageError(error);
    const status=failure instanceof TeachStorageError&&failure.code==='NO_REMOTE_CONSENT'?403:
      /OWNER_MISMATCH/.test(failure.code)?403:failure.code==='RECORDER_MEMORY_LOST'?410:
        /^INVALID_/.test(failure.code)?400:/WORKER_UNAVAILABLE|DATABASE_ERROR/.test(failure.code)?503:409;
    return Response.json({code:failure.code,error:failure.message},{status,headers:{'Cache-Control':'no-store'}});
  }
}
