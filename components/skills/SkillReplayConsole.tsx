'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {SkillReplayPreview,type Preview} from './SkillReplayPreview';
import type {SkillDefinition} from '@/lib/skills/skill-schema';
import {ReplayCheckpointSchema} from '@/lib/skills/replay-schemas';
import {acceptReplaySnapshot,readReplayHandle,REPLAY_CONSOLE_STORAGE_KEY,ReplayHandleSchema,ReplayOptionsSchema,replayReason,replayReference,replaySafeToStartNew,replaySettled,replayStepStatus,
  type ReplayConsoleSnapshot,type ReplayLease,type ReplayOptions} from '@/lib/skills/replay-console-state';

const noop=()=>undefined,button='rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-40';
const noOptions:ReplayOptions={supervisedEnabled:false,devices:[],reason:'CHECKING_REPLAY_AVAILABILITY'};
export function SkillReplayConsole({skillId,version,definition,onBusy=noop,externalBusy=false}:{skillId:string;version:number;definition:SkillDefinition;onBusy?:(busy:boolean)=>void;externalBusy?:boolean}){
  const [options,setOptions]=useState(noOptions),[deviceId,setDeviceId]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [plan,setPlan]=useState<Preview>(),[parameters,setParameters]=useState<Record<string,string|number>>({});
  const [lease,setLease]=useState<ReplayLease>(),[view,setView]=useState<ReplayConsoleSnapshot>(),[working,setWorking]=useState(false);
  const [connection,setConnection]=useState('IDLE'),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[requested,setRequested]=useState(''),[reconnect,setReconnect]=useState(0);
  const mounted=useRef(false),inFlight=useRef(false),leaseRef=useRef<ReplayLease>(undefined),viewRef=useRef<ReplayConsoleSnapshot>(undefined);
  const accept=useCallback((body:unknown,current:ReplayLease)=>{
    if(current.binding.skillId!==skillId||current.binding.version!==version)throw Error('REPLAY_RESPONSE_CONTEXT_MISMATCH');
    const next=acceptReplaySnapshot(body,current,definition,viewRef.current);viewRef.current=next;
    if(mounted.current){setView(next);setConnection('CONNECTED');setError('');setRequested(previous=>{
      if(previous==='PAUSE'&&next.checkpoint.status==='PAUSED'||previous==='RESUME'&&next.checkpoint.status!=='PAUSED'||replaySettled(next.checkpoint))return '';return previous;
    });onBusy(next.checkpoint.ownership!=='RELEASED');}
    if(replaySafeToStartNew(next.checkpoint))try{sessionStorage.removeItem(REPLAY_CONSOLE_STORAGE_KEY);}catch{}
    return next;
  },[skillId,version,definition,onBusy]);
  const availability=useCallback(async()=>{
    try{const response=await fetch('/api/skills/replay',{cache:'no-store'}),body=ReplayOptionsSchema.parse(await response.json());if(mounted.current)setOptions(body);}
    catch{if(mounted.current)setOptions({...noOptions,reason:'REPLAY_AVAILABILITY_UNAVAILABLE'});}
  },[]);
  useEffect(()=>{
    mounted.current=true;void Promise.resolve().then(()=>availability());
    void Promise.resolve().then(()=>{
      if(!mounted.current)return;
      try{const saved=readReplayHandle(sessionStorage);if(!saved)return;const reference=replayReference(saved);
        if(reference.skillId!==skillId||reference.version!==version)throw Error('REPLAY_RECONNECT_REFERENCE_MISMATCH');
        if(saved.kind==='OPEN_PENDING'){setUncertain(true);setConnection('OUTCOME_UNKNOWN');setError('OPEN_OUTCOME_UNKNOWN_NO_RETRY');onBusy(true);return;}
        leaseRef.current=saved;setLease(saved);setConnection('RECONNECTING');onBusy(true);
      }catch{setUncertain(true);setConnection('BLOCKED');setError('REPLAY_RECONNECT_REFERENCE_INVALID');onBusy(true);}
    });return()=>{mounted.current=false;};
  },[skillId,version,availability,onBusy]);
  useEffect(()=>{
    if(!lease)return;let active=true,timer:ReturnType<typeof setTimeout>|undefined,failures=0;
    const poll=async()=>{
      try{const response=await fetch('/api/skills/replay/'+lease.leaseId,{method:'POST',headers:{'Content-Type':'application/json','x-teach-owner':lease.ownerToken},body:JSON.stringify({type:'STATE'})});
        const body=await response.json();if(!active)return;if(!response.ok)throw Error(replayReason(body.code));const next=accept(body,lease);failures=0;
        if(!replaySettled(next.checkpoint))timer=setTimeout(()=>void poll(),1000);
      }catch(cause){if(!active)return;failures++;setConnection(failures>=5?'DISCONNECTED':'RECONNECTING');setError(replayReason(cause instanceof Error?cause.message:undefined,'REPLAY_STATE_UNAVAILABLE'));
        if(failures<5)timer=setTimeout(()=>void poll(),1000);
      }
    };void poll();return()=>{active=false;if(timer)clearTimeout(timer);};
  },[lease,reconnect,accept]);
  useEffect(()=>{const expiries=options.devices.flatMap(d=>d.expiresAt?[d.expiresAt]:[]);if(!expiries.length)return;
    const timer=setTimeout(()=>void availability(),Math.max(50,Math.min(...expiries)-Date.now()+10));return()=>clearTimeout(timer);
  },[options,availability]);
  const cp=view?.checkpoint,held=Boolean(lease&&(!cp||!replaySafeToStartNew(cp))),owner=options.devices.find(d=>d.deviceId===deviceId&&d.authorizationId);
  const canStart=options.supervisedEnabled&&!!owner&&confirmed&&plan?.status==='NOT_DISPATCHED'&&plan.compatibility.supported&&!externalBusy&&!held&&!uncertain&&!working;
  const resumeOwner=options.devices.find(d=>d.deviceId===lease?.binding.deviceId&&d.physicalId===lease?.binding.physicalId&&d.authorizationId&&d.authorizationId===lease?.authorizationId);
  const activeLease=!!cp&&cp.ownership!=='RELEASED',canResume=activeLease&&cp?.status==='PAUSED'&&!cp.pending&&options.supervisedEnabled&&!!resumeOwner&&connection==='CONNECTED'&&!requested;
  async function start(){
    if(inFlight.current||!canStart||!owner||Number(owner.expiresAt)<=Date.now())return;
    inFlight.current=true;setWorking(true);setError('');setConnection('CONNECTING');onBusy(true);
    viewRef.current=undefined;leaseRef.current=undefined;setView(undefined);setLease(undefined);
    const requestId=crypto.randomUUID();let sent=false;
    try{
      sessionStorage.setItem(REPLAY_CONSOLE_STORAGE_KEY,JSON.stringify({kind:'OPEN_PENDING',requestId,skillId,version}));
      sent=true;const response=await fetch(`/api/skills/${skillId}/versions/${version}/replay`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'SUPERVISED',parameters,deviceId:owner.deviceId,requestId,authorizationId:owner.authorizationId,confirmedExperimental:true})});
      const body=await response.json();if(!response.ok)throw Error(replayReason(body.code));
      const checkpoint=ReplayCheckpointSchema.parse(body.checkpoint);
      if(typeof body.leaseId!=='string'||!/^[a-f0-9-]{36}$/.test(body.leaseId)||typeof body.ownerToken!=='string'||!/^[a-f0-9]{64}$/.test(body.ownerToken)||checkpoint.binding.skillId!==skillId||checkpoint.binding.version!==version||checkpoint.binding.deviceId!==owner.deviceId||checkpoint.binding.physicalId!==owner.physicalId)throw Error('REPLAY_RESPONSE_CONTEXT_MISMATCH');
      const opened=ReplayHandleSchema.parse({kind:'LEASE',leaseId:body.leaseId,ownerToken:body.ownerToken,binding:checkpoint.binding,authorizationId:owner.authorizationId}) as ReplayLease;
      viewRef.current=undefined;leaseRef.current=opened;if(mounted.current)setLease(opened);
      try{sessionStorage.setItem(REPLAY_CONSOLE_STORAGE_KEY,JSON.stringify(opened));}catch{if(mounted.current)setError('REPLAY_RECONNECT_STORAGE_UNAVAILABLE');}
      accept(body,opened);
    }catch(cause){if(mounted.current){setUncertain(sent);setConnection(sent?'OUTCOME_UNKNOWN':'BLOCKED');setError(sent?'OPEN_OUTCOME_UNKNOWN_NO_RETRY':replayReason(cause instanceof Error?cause.message:undefined,'REPLAY_STORAGE_UNAVAILABLE'));if(!sent)onBusy(false);}}
    finally{inFlight.current=false;if(mounted.current)setWorking(false);}
  }
  async function control(type:'PAUSE'|'RESUME'|'CANCEL'){
    const current=leaseRef.current;if(inFlight.current||!current||!viewRef.current)return;
    if(type==='RESUME'&&!canResume)return;
    inFlight.current=true;setWorking(true);setRequested(type);setError('');
    try{const response=await fetch('/api/skills/replay/'+current.leaseId,{method:'POST',headers:{'Content-Type':'application/json','x-teach-owner':current.ownerToken},body:JSON.stringify({type,...(type==='RESUME'?{checkpoint:viewRef.current.checkpoint}:{})})});
      const body=await response.json();if(!response.ok)throw Error(replayReason(body.code));accept(body,current);
    }catch(cause){if(mounted.current){setConnection('RECONNECTING');setRequested('');setError(replayReason(cause instanceof Error?cause.message:undefined,'CONTROL_OUTCOME_UNKNOWN'));}}
    finally{inFlight.current=false;if(mounted.current){setWorking(false);setReconnect(n=>n+1);}}
  }
  const onPlan=useCallback((preview:Preview|undefined,values:Record<string,string|number>)=>{setPlan(preview);setParameters(values);},[]);
  const events=view?.history?.events??[],observation=[...events].reverse().find(e=>e.kind==='OBSERVATION'),verification=[...events].reverse().find(e=>e.kind==='VERIFICATION');
  return <section aria-label="Live Replay Console" className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3">
    <h3 className="font-semibold">Live Replay Console — DRAFT / EXPERIMENTAL</h3>
    <p className="text-sm">Kỹ năng {definition.name}, phiên bản {version}. Preview là kế hoạch tĩnh; native replay chỉ chạy khi backend và chủ thiết bị cho phép.</p>
    <SkillReplayPreview skillId={skillId} version={version} definition={definition} disabled={held||working||externalBusy||uncertain} onPlan={onPlan}/>
    <section aria-label="Supervised Native Replay" className="space-y-2 border-t pt-3">
      <h4 className="font-medium">Supervised Native Replay</h4>
      <p role="status">{options.supervisedEnabled?'Backend cho phép xét quyền owner từng thiết bị.':'Native replay TẮT / không khả dụng.'} {options.reason}</p>
      <label className="block text-sm">Thiết bị đã được owner cấp quyền<select aria-label="Thiết bị replay" className="ml-2 rounded border p-2" value={deviceId} disabled={held||working||externalBusy||uncertain} onChange={e=>{setDeviceId(e.target.value);setConfirmed(false);}}>
        <option value="">Chọn thiết bị</option>{options.devices.map(d=><option key={d.deviceId} value={d.deviceId} disabled={!d.authorizationId}>{d.deviceId} — {d.authorizationId?'owner scope':'chưa cấp quyền'}</option>)}
      </select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="Xác nhận replay giám sát" checked={confirmed} disabled={held||working||externalBusy||uncertain||!options.supervisedEnabled} onChange={e=>setConfirmed(e.target.checked)}/>Tôi xác nhận chạy kỹ năng EXPERIMENTAL trên đúng thiết bị đã cấp quyền.</label>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={!canStart} onClick={()=>void start()}>Bắt đầu replay giám sát</button><button className={button} disabled={working} onClick={()=>void availability()}>Cập nhật quyền replay</button></div>
    </section>
    <p role="status">Kết nối: {connection}{requested?' — yêu cầu '+requested+' đang chờ xác minh':''}</p>
    {error&&<p role="alert" className="text-rose-700">{error}. Không tự gửi lại thao tác; dùng đọc trạng thái hoặc đối soát operator.</p>}
    {lease&&<div className="space-y-2">
      <p>Execution {lease.binding.executionId} · Device {lease.binding.deviceId} · Session {lease.binding.sessionId}</p>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={!activeLease||working||!!requested||!['RUNNING','VERIFYING','RECOVERING'].includes(cp?.status??'')} onClick={()=>void control('PAUSE')}>Pause</button>
        <button className={button} disabled={!canResume||working} onClick={()=>void control('RESUME')}>Resume</button>
        <button className={button} disabled={!activeLease||working} onClick={()=>void control('CANCEL')}>Cancel</button>
        <button className={button} disabled={working} onClick={()=>{setConnection('RECONNECTING');setReconnect(n=>n+1);}}>Đọc lại trạng thái / reconnect</button></div>
    </div>}
    {cp&&<div className="space-y-3 text-sm">
      <p role="status">Replay: {cp.status} · {cp.provenance==='SIMULATED_RECEIPT'?'OFFLINE_TEST / SIMULATED_RECEIPT':'ANDROID_RUNTIME — cần nghiệm thu thiết bị'} · {cp.ownership}</p>
      {cp.reason&&<p role="alert">{cp.reason}</p>}
      <ol aria-label="Replay step timeline" className="space-y-1">{definition.steps.map((step,index)=><li key={step.id}>{step.id} · {step.operation} · {replayStepStatus(step.id,index,cp)} · verifier: {step.verify.kind}</li>)}</ol>
      <section aria-label="Observation và verification"><p>Observation: {observation?`generation ${cp.observationGeneration} · ${replayReason(observation.blocker)} · snapshot ${typeof observation.snapshotId==='string'&&/^[a-f0-9-]{36}$/i.test(observation.snapshotId)?observation.snapshotId:'UNAVAILABLE'}`:'Chưa có observation trong journal.'}</p>
        <p>Verification: {verification?replayReason(verification.outcome):'Chưa có readback độc lập trong journal.'}</p></section>
      <section aria-label="Recovery events"><h4>Recovery: {cp.recoveryCount}/3</h4><ul>{events.filter(e=>typeof e.kind==='string'&&e.kind.startsWith('RECOVERY')).map((e,i)=><li key={i}>{replayReason(e.kind)} · {replayReason(e.reason,e.dispatch?replayReason(e.dispatch):'RECOVERY_PENDING')}</li>)}</ul></section>
      <details><summary>Checkpoint và verified prefix</summary><dl><dt>Revision / generation</dt><dd>{cp.revision} / {cp.observationGeneration}</dd><dt>Current step</dt><dd>{cp.currentStep}/{definition.steps.length}</dd><dt>Verified prefix</dt><dd>{cp.verifiedSteps.map(s=>s.stepId).join(' → ')||'Chưa có'}</dd><dt>Pending effect</dt><dd>{cp.pending?.dispatch??'NONE'}</dd><dt>Ownership</dt><dd>{cp.ownership}</dd></dl></details>
    </div>}
  </section>;
}
