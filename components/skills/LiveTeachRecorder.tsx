'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { LiveTeachService } from '@/lib/skills/live-teach-service';
import type { TeachFrame } from '@/lib/android/agent/teach-contracts';
import { mapFramePointer, uniqueControlAt } from '@/lib/skills/frame-geometry';

type View=Awaited<ReturnType<LiveTeachService['state']>>;
type Devices=Awaited<ReturnType<LiveTeachService['devices']>>;
type StepOperation='OPEN_APPLICATION'|'ACTIVATE_CONTROL'|'INPUT_TEXT'|'SUBMIT_SEARCH'|'SCROLL_CONTAINER'|'BACK'|'OBSERVE_UI';
const field='rounded border border-slate-300 bg-white px-3 py-2 text-sm min-w-0';
const button='rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-40';
const storageKey='phoneCommanderTeachG3Lease';
const clarificationChoices=[['SEARCH_BUTTON','Nhấn nút Tìm kiếm'],['OTHER_BUTTON','Nhấn nút khác'],['FIELD','Chọn ô nhập liệu'],['TEXT','Nhập văn bản'],['SUBMIT','Gửi tìm kiếm'],['SCROLL','Vuốt'],['BACK','Quay lại'],['OTHER','Thao tác khác'],['SKIP','Bỏ qua']];
class ClientError extends Error {constructor(readonly code:string){super(code);}}
export function LiveTeachRecorder({onBusy,onSaved}:{onBusy:(busy:boolean)=>void;onSaved:()=>void}) {
  const [devices,setDevices]=useState<Devices['devices']>([]),[deviceId,setDeviceId]=useState('');
  const [streamTransport,setStreamTransport]=useState('ADB_SCREENSHOT_POLLING');
  const [pairingToken,setPairingToken]=useState(''),[clarify,setClarify]=useState<number|'manual'>(),[clarification,setClarification]=useState('SEARCH_BUTTON'),[annotationTarget,setAnnotationTarget]=useState('');
  const [name,setName]=useState('G3_ANDROID_RECORDER_YOUTUBE_SEARCH'),[appAlias,setAppAlias]=useState('youtube');
  const [command,setCommand]=useState('Mở YouTube và tìm marine biology'),[query,setQuery]=useState('marine biology');
  const [view,setView]=useState<View>(),[frame,setFrame]=useState<TeachFrame>(),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [stream,setStream]=useState(true),[streamGeneration,setStreamGeneration]=useState(0),[streamConnected,setStreamConnected]=useState(false),[liveImage,setLiveImage]=useState<string>(),[liveSize,setLiveSize]=useState<{width:number;height:number}>(),[streamFps,setStreamFps]=useState<number>(),[liveAt,setLiveAt]=useState(0);
  const [latency,setLatency]=useState<number>(),[clock,setClock]=useState(0),[memoryLost,setMemoryLost]=useState(false),[hasLease,setHasLease]=useState(false);
  const [parameterize,setParameterize]=useState(false),[parameterName,setParameterName]=useState('query'),[confirmSave,setConfirmSave]=useState(false),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
  const owner=useRef(''),client=useRef(''),inFlight=useRef(false),cancelling=useRef(false),mounted=useRef(false);
  const lease=useRef<{id:string;leaseId:string;ownerToken:string}|undefined>(undefined),pointer=useRef<{x:number;y:number;at:number;frame:TeachFrame}|undefined>(undefined);
  const imageBox=useRef<HTMLDivElement>(null);
  const api=useCallback(async<T,>(url:string,body?:unknown):Promise<T>=>{
    let response:Response;
    try {response=await fetch(url,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'X-Teach-Owner':owner.current,'X-Teach-Client':client.current,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch {throw new ClientError('NETWORK_OUTCOME_UNKNOWN');}
    const result=await response.json().catch(()=>null);if(!response.ok||!result)throw new ClientError(result?.code??'INVALID_RESPONSE');return result as T;
  },[]);
  const perform=useCallback(async(work:()=>Promise<void>)=>{
    if(inFlight.current)return;inFlight.current=true;setPending(true);setError('');
    try {await work();}catch(cause){const code=cause instanceof ClientError?cause.code:'RECORDER_REQUEST_FAILED';
      if(lease.current){try{const current=await api<View>(`/api/teach-recorder/${lease.current.id}/state`);if(mounted.current)setView(current);}catch{/* Read-only reconciliation failed; never retry a mutation. */}}
      if(mounted.current){setError(code);if(/UNKNOWN|RECONCILIATION|RECEIPT_MISMATCH/.test(code))setUncertain(true);}}
    finally{inFlight.current=false;if(mounted.current)setPending(false);}
  },[api]);
  const refreshDevices=useCallback(async()=>{const result=await api<Devices>('/api/teach-recorder');if(mounted.current){setDevices(result.devices);setDeviceId(previous=>previous|| (result.devices.filter(d=>d.state==='ONLINE').length===1?result.devices.find(d=>d.state==='ONLINE')!.id:''));}},[api]);
  useEffect(()=>{
    mounted.current=true;
    // Restore the external tab session asynchronously; no Android operation is replayed.
    void Promise.resolve().then(async()=>{
      if(!mounted.current)return;
      try {
        client.current=sessionStorage.getItem('phoneCommanderTeachG3Client')??crypto.randomUUID();sessionStorage.setItem('phoneCommanderTeachG3Client',client.current);
        const cached=JSON.parse(sessionStorage.getItem(storageKey)??'null');
        if(cached?.id&&cached?.leaseId&&cached?.ownerToken){lease.current=cached;owner.current=cached.ownerToken;setHasLease(true);
          try {const data=await api<View>(`/api/teach-recorder/${cached.id}/state`);if(mounted.current)setView(data);}catch{if(mounted.current)setMemoryLost(true);}}
      }catch{if(mounted.current)setMemoryLost(true);}
      await refreshDevices().catch(cause=>{if(mounted.current)setError(cause instanceof ClientError?cause.code:'DEVICE_LIST_UNAVAILABLE');});
    });
    return()=>{mounted.current=false;};
  },[api,refreshDevices]);
  const ownsDevice=Boolean(view&&view.worker.cleanup!=='PROVEN');
  useEffect(()=>{onBusy(ownsDevice||memoryLost&&hasLease);return()=>onBusy(false);},[onBusy,ownsDevice,memoryLost,hasLease]);
  useEffect(()=>{
    if(!ownsDevice)return;
    const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);
  },[ownsDevice]);
  const recordingId=view?.id;
  useEffect(()=>{
    if(!recordingId||!ownsDevice||!view?.companionPaired)return;
    let active=true,polling=false;
    const poll=async()=>{if(polling||inFlight.current)return;polling=true;try{const next=await api<View>(`/api/teach-recorder/${recordingId}/events`);if(active){setView(next);const unresolved=next.observations.find(e=>!next.annotations.some(a=>a.sequence===e.sequence));if(unresolved)setClarify(current=>current??unresolved.sequence);}}catch{/* Keep the last observation; never redispatch a physical action. */}finally{polling=false;}};
    const timer=setInterval(()=>void poll(),1500);void poll();return()=>{active=false;clearInterval(timer);};
  },[api,recordingId,ownsDevice,view?.companionPaired]);
  useEffect(()=>{
    if(!recordingId||!ownsDevice)return;
    const id=recordingId;let active=true,polling=false,failures=0;
    const poll=async()=>{
      if(!active||polling||inFlight.current||pointer.current)return;polling=true;
      try {
        const start=performance.now(),next=await api<TeachFrame>(`/api/teach-recorder/${id}/frame`);if(active){setClock(Date.now());setFrame(next);setLatency(Math.round(performance.now()-start));}failures=0;
      }catch(cause){if(active){setError(cause instanceof ClientError?cause.code:'FRAME_UNAVAILABLE');if(++failures>=3)setFrame(undefined);}}
      finally{polling=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),2500);
    return()=>{active=false;clearInterval(timer);};
  },[api,recordingId,ownsDevice]);
  useEffect(()=>{
    if(!recordingId||!ownsDevice||!stream)return;
    let active=true,previousAt=0;const samples:number[]=[],controller=new AbortController();
    controller.signal.addEventListener('abort',()=>setStreamConnected(false),{once:true});
    void (async()=>{
      try {
        const response=await fetch(`/api/teach-recorder/${recordingId}/stream`,{cache:'no-store',headers:{'X-Teach-Owner':owner.current,'X-Teach-Client':client.current},signal:controller.signal});
        if(!response.ok||!response.body){const result=await response.json().catch(()=>null);throw new ClientError(result?.code??'RECORDER_STREAM_UNAVAILABLE');}
        setStreamConnected(true);const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
        while(active){const chunk=await reader.read();if(chunk.done)break;pending+=decoder.decode(chunk.value,{stream:true});let boundary:number;
          while((boundary=pending.indexOf('\n\n'))>=0){const event=pending.slice(0,boundary);pending=pending.slice(boundary+2);const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5)).join('\n');if(!data)continue;
            const parsed=JSON.parse(data) as {image?:string;width?:number;height?:number;at?:number;status?:string;code?:string;transport?:string};
            if(event.split(/\r?\n/).some(line=>line==='event:error'))throw new ClientError(parsed.code??'RECORDER_STREAM_FAILED');
            if(!parsed.image||!Number.isInteger(parsed.width)||!Number.isInteger(parsed.height)||!Number.isFinite(parsed.at))continue;
            const now=Date.now();if(previousAt){samples.push(now-previousAt);if(samples.length>20)samples.shift();setStreamFps(Math.round(1000/(samples.reduce((sum,value)=>sum+value,0)/samples.length)*10)/10);}previousAt=now;
            setStreamTransport(parsed.transport??'ADB_SCREENSHOT_POLLING');setLiveImage(`data:image/jpeg;base64,${parsed.image}`);setLiveSize({width:parsed.width!,height:parsed.height!});setLiveAt(parsed.at!);setClock(now);setStreamConnected(true);
          }
        }
      }catch(cause){if(active&&!controller.signal.aborted){setStreamConnected(false);setError(cause instanceof ClientError?cause.code:'RECORDER_STREAM_DISCONNECTED');}}
      finally{if(active)setStreamConnected(false);}
    })();
    return()=>{active=false;controller.abort();};
  },[recordingId,ownsDevice,stream,streamGeneration]);
  const sendStep=(operation:StepOperation,candidateId?:string,touch?:{x:number;y:number},f=frame)=>void perform(async()=>{
    if(!view||!f||Date.now()>=f.expiresAt)throw new ClientError('STALE_FRAME');
    const result=await api<View>(`/api/teach-recorder/${view.id}/step`,{revision:view.revision,requestId:crypto.randomUUID(),frameId:f.id,operation,
      ...(candidateId?{candidateId}:{}),...(touch?{touch}:{}),...(operation==='INPUT_TEXT'?{value:view.query??query}:{})});
    setView(result);setFrame(undefined);
  });
  const control=(operation:'pause'|'resume'|'stop')=>void perform(async()=>{
    if(!view)return;setFrame(undefined);const result=await api<View>(`/api/teach-recorder/${view.id}/${operation}`,{revision:view.revision});setView(result);
  });
  const cancel=async()=>{
    if(!view||cancelling.current)return;cancelling.current=true;
    try {setView(await api<View>(`/api/teach-recorder/${view.id}/cancel`,{revision:view.revision}));setFrame(undefined);}
    catch(cause){setError(cause instanceof ClientError?cause.code:'CLEANUP_UNPROVEN');}
    finally{cancelling.current=false;}
  };
  const recording=view?.worker.status==='RECORDING',available=Boolean(clarify===undefined&&streamConnected&&frame&&clock>0&&clock<frame.expiresAt&&!pending&&!uncertain&&!view?.blockReason&&recording&&liveSize?.width===frame.width&&liveSize?.height===frame.height);
  const pick=(operation:string)=>frame?.controls.find(c=>c.operation===operation);
  const pointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{
    const down=pointer.current;pointer.current=undefined;if(!down||!imageBox.current||pending)return;
    if(clarify!==undefined){const touch=mapFramePointer(imageBox.current.getBoundingClientRect(),down.frame,{x:down.x,y:down.y});const target=touch?uniqueControlAt(down.frame.controls,down.frame,touch):undefined;if(target)setAnnotationTarget(target.id);else setError('ANNOTATION_TARGET_UNRESOLVED');return;}
    if(Date.now()-down.at>600){setError('LONG_PRESS_NOT_SUPPORTED');return;}
    const display=imageBox.current.getBoundingClientRect(),touch=mapFramePointer(display,down.frame,{x:down.x,y:down.y});if(!touch){setError('POINTER_OUTSIDE_FRAME');return;}
    const dy=event.clientY-down.y,dx=event.clientX-down.x;
    if(Math.abs(dy)>30||Math.abs(dx)>30){if(dy>=-30||Math.abs(dx)>Math.abs(dy)){setError('GESTURE_NOT_SUPPORTED');return;}
      const target=uniqueControlAt(down.frame.controls.filter(c=>c.operation==='SCROLL_CONTAINER'),down.frame,touch);if(!target){setError('UNRESOLVED_TARGET');return;}sendStep('SCROLL_CONTAINER',target.id,touch,down.frame);return;}
    const target=uniqueControlAt(down.frame.controls.filter(c=>['ACTIVATE_CONTROL','BACK'].includes(c.operation)),down.frame,touch);if(!target){setError('UNRESOLVED_TARGET');return;}
    sendStep(target.operation as StepOperation,target.id,touch,down.frame);
  };
  const review=view?.review;
  return <section aria-label="Android Live Recorder" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-lg font-semibold">Dạy bằng thao tác trên Android</h1><span className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">LIVE RECORDER · {saved?'DRAFT_SAVED':!view&&pending?'PREPARING':view?.database.status==='COMPILED'?'COMPILED':view?.worker.status??'IDLE'}</span></header>
    <p className="text-sm text-slate-600">Màn hình điện thoại được gửi liên tục qua luồng ảnh cục bộ; ảnh chỉ hiển thị trực tiếp và không lưu vào kỹ năng. Thao tác từ Dashboard đi qua kiểm tra target. Cú chạm trực tiếp trên điện thoại chưa được ghi nhận.</p>
    {error&&<p role="alert" className="rounded border border-rose-200 p-2 text-sm text-rose-700">{error}. {uncertain?'Kết quả chưa xác định; không gửi lại thao tác. Kiểm tra timeline/thư viện hoặc kết thúc phiên an toàn.':''}</p>}
    {memoryLost&&<div className="rounded border border-amber-200 p-3 text-sm">Phiên chưa lưu không được tự khôi phục sau khi server khởi động lại. Không phát lại thao tác.
      <button className={button} disabled={pending||!hasLease} onClick={()=>void perform(async()=>{const cached=lease.current!;await api('/api/teach-recorder',{type:'RECOVER_CLEANUP',id:cached.id,leaseId:cached.leaseId,confirmed:true});sessionStorage.removeItem(storageKey);lease.current=undefined;owner.current='';setHasLease(false);setMemoryLost(false);setView(undefined);})}>Kiểm tra và kết thúc phiên cũ</button></div>}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();void perform(async()=>{
      const result=await api<View&{ownerToken:string}>('/api/teach-recorder',{requestId:crypto.randomUUID(),deviceId,name,appAlias,command,query,confirmed:true});
      owner.current=result.ownerToken;lease.current={id:result.id,leaseId:result.worker.leaseId,ownerToken:result.ownerToken};sessionStorage.setItem(storageKey,JSON.stringify(lease.current));setHasLease(true);
       setView(result);setFrame(undefined);setSaved(false);setConfirmSave(false);setParameterize(false);setUncertain(false);setStream(true);
    });}}>
      <label className="flex flex-col gap-1 text-sm">Điện thoại<select aria-label="Điện thoại ghi thao tác" className={field} value={deviceId} disabled={pending||ownsDevice} onChange={e=>setDeviceId(e.target.value)}><option value="">Chọn thiết bị</option>{devices.map(d=><option key={d.id} value={d.id} disabled={d.state!=='ONLINE'}>{d.label} · {d.state}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm">Tên kỹ năng<input className={field} aria-label="Tên kỹ năng live" value={name} maxLength={120} disabled={pending||ownsDevice} onChange={e=>setName(e.target.value)} required/></label>
      <label className="flex flex-col gap-1 text-sm">App scope<input className={field} aria-label="App scope live" value={appAlias} disabled={pending||ownsDevice} onChange={e=>setAppAlias(e.target.value)} required/></label>
      <label className="flex flex-col gap-1 text-sm">Câu lệnh mẫu<input className={field} value={command} maxLength={500} disabled={pending||ownsDevice} onChange={e=>setCommand(e.target.value)} required/></label>
      <label className="flex flex-col gap-1 text-sm">Query mẫu cho phiên tìm kiếm<input className={field} value={query} maxLength={500} disabled={pending||ownsDevice} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="flex items-end gap-2"><button type="button" className={button} disabled={pending||ownsDevice} onClick={()=>void perform(refreshDevices)}>Làm mới thiết bị</button><button className={button} type="submit" disabled={pending||ownsDevice||Boolean(view&&!saved&&view.worker.status!=='CANCELLED')||memoryLost||uncertain||!devices.some(d=>d.id===deviceId&&d.state==='ONLINE')}>Bắt đầu ghi</button></div>
    </form>
    {!devices.length&&<p className="text-sm text-slate-500">Chưa có Android khả dụng. Không có frame hoặc thao tác mô phỏng thay thế.</p>}
    {view&&<div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 text-xs"><span>{liveSize?`${liveSize.width} × ${liveSize.height} · ${liveSize.width>liveSize.height?'LANDSCAPE':'PORTRAIT'}`:frame?`${frame.width} × ${frame.height} · ${frame.orientation}`:'Chưa có frame'}</span><span>Luồng: {streamConnected?'Đã kết nối':'Đã ngắt'}</span><span>{streamTransport}</span><span>FPS thực: {streamConnected?streamFps??'—':'—'}</span><span>Độ mới: {liveAt?`${Math.max(0,clock-liveAt)} ms`:'—'}</span><span>Grounding: {latency??'—'} ms</span></div>
        <div ref={imageBox} aria-label="Màn hình Android thật" className="relative mx-auto w-full max-w-md overflow-hidden rounded-lg bg-slate-950" style={{aspectRatio:liveSize?`${liveSize.width}/${liveSize.height}`:frame?`${frame.width}/${frame.height}`:'9/16',maxHeight:'65vh',touchAction:'none'}}
          onPointerDown={event=>{if((available||clarify!==undefined&&frame&&clock<frame.expiresAt)&&liveImage){event.currentTarget.setPointerCapture(event.pointerId);pointer.current={x:event.clientX,y:event.clientY,at:Date.now(),frame:frame!};}}}
          onPointerUp={pointerUp} onPointerCancel={()=>{pointer.current=undefined;}}>
          {liveImage?<Image src={liveImage} alt="Luồng màn hình Android thật" fill unoptimized sizes="(max-width: 1024px) 100vw, 50vw" className="object-contain" draggable={false}/>:<div className="flex h-full items-center justify-center p-5 text-center text-sm text-slate-300">{streamConnected?'Đang nhận frame Android…':frame?.imageOmittedReason??'Chờ luồng màn hình Android. Mở ứng dụng bằng nút bên dưới.'}</div>}
        </div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!available} onClick={()=>sendStep('OPEN_APPLICATION')}>Mở ứng dụng</button><button className={button} disabled={!available||!pick('BACK')} onClick={()=>sendStep('BACK',pick('BACK')?.id)}>Back</button><button className={button} disabled title="Chưa có contract/verifier portable">Home</button><button className={button} disabled title="Chưa có primitive được phép trong Teach DSL">Long press</button><button className={button} disabled={!available||!pick('SCROLL_CONTAINER')} onClick={()=>sendStep('SCROLL_CONTAINER',pick('SCROLL_CONTAINER')?.id)}>Cuộn xuống</button></div>
         <label className="flex flex-col gap-1 text-sm">Query được ghi<input className={field} value={view.query??query} readOnly aria-readonly="true" autoComplete="off" disabled={pending||!recording}/></label>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!available||!pick('INPUT_TEXT')} onClick={()=>sendStep('INPUT_TEXT',pick('INPUT_TEXT')?.id)}>Nhập nội dung</button><button className={button} disabled={!available||!pick('SUBMIT_SEARCH')} onClick={()=>sendStep('SUBMIT_SEARCH',pick('SUBMIT_SEARCH')?.id)}>Tìm kiếm</button><button className={button} disabled={!ownsDevice} onClick={()=>{setError('');if(streamConnected)setStream(false);else{setStream(true);setStreamGeneration(g=>g+1);}}}>{streamConnected?'Ngắt Live View':'Kết nối Live View'}</button></div>
        <div className="space-y-1"><p className="text-sm font-medium">Điều khiển semantic khả dụng</p>{frame?.controls.filter(c=>c.operation==='ACTIVATE_CONTROL'||c.operation==='BACK').map(c=><button className={button+' mr-1'} key={c.id} disabled={!available} onClick={()=>sendStep(c.operation as StepOperation,c.id)}>{c.label}</button>)}</div>
      </div>
      <div className="space-y-3">
        {ownsDevice&&!view.companionPaired&&<div className="space-y-2 rounded border p-3"><label className="block text-sm">Token ghép nối từ companion đã được bạn cho phép trên Samsung<input type="password" autoComplete="off" className={field} value={pairingToken} onChange={e=>setPairingToken(e.target.value)} maxLength={64}/></label><button className={button} disabled={pending||!/^[a-f0-9]{64}$/.test(pairingToken)} onClick={()=>void perform(async()=>{setView(await api<View>(`/api/teach-recorder/${view.id}/pair-companion`,{token:pairingToken,confirmed:true}));setPairingToken('');setStreamGeneration(g=>g+1);})}>Ghép companion và dùng luồng MediaProjection</button></div>}
        <button className={button} disabled={pending||!ownsDevice} onClick={()=>{setClarify('manual');setAnnotationTarget('');}}>Đánh dấu thao tác vừa thực hiện</button>
        {clarify!==undefined&&<section aria-label="Làm rõ thao tác" className="space-y-2 rounded border border-amber-300 p-3"><h3>Bạn vừa thực hiện thao tác gì?</h3><p className="text-xs">Chú thích này ghi nhận lời xác nhận của bạn. Thao tác sẽ không được thực hiện lại và chưa có receipt VERIFIED.</p><select aria-label="Thao tác vừa thực hiện" className={field} value={clarification} onChange={e=>setClarification(e.target.value)}>{clarificationChoices.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><label className="block text-sm">Chọn lại target bằng cách chạm Live View hoặc chọn tại đây<select aria-label="Target chú thích" className={field} value={annotationTarget} onChange={e=>setAnnotationTarget(e.target.value)}><option value="">Chưa xác định target</option>{frame?.controls.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button className={button} disabled={pending} onClick={()=>void perform(async()=>{setView(await api<View>(`/api/teach-recorder/${view.id}/annotate`,{requestId:crypto.randomUUID(),...(clarify==='manual'?{}:{sequence:clarify}),choice:clarification,...(annotationTarget?{targetId:annotationTarget,frameId:frame?.id}:{}),physicalActionConfirmed:true}));setClarify(undefined);setAnnotationTarget('');})}>Xác nhận chú thích, không lặp thao tác</button></section>}
        {(view.observations??[]).map(e=><p className="text-xs" key={'observation-'+e.sequence}>Android event {e.sequence}: {e.eventType} · ANDROID_ACCESSIBILITY · UNVERIFIED · nguồn thao tác chưa xác định</p>)}
        {(view.annotations??[]).map(a=><p className="rounded border p-2 text-xs" key={a.id}>PHYSICAL_DEVICE · HUMAN_ANNOTATED · {a.choice} · {a.verification}</p>)}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={pending||!recording} onClick={()=>control('pause')}>Tạm dừng ghi</button><button className={button} disabled={pending||view.worker.status!=='PAUSED'||uncertain} onClick={()=>control('resume')}>Tiếp tục</button><button className={button} disabled={pending||!ownsDevice} onClick={()=>control('stop')}>Kết thúc ghi</button><button className={button} disabled={!ownsDevice} onClick={()=>void cancel()}>Hủy phiên</button></div>
        <p className="text-xs text-slate-500">Ownership: {view.database.ownership} · Cleanup: {view.worker.cleanup} · Model calls: {view.worker.modelCalls} · Appium RPC: {view.worker.metrics.rpcCount} · ADB: {view.worker.metrics.adbCount}</p>
        {view.worker.cleanup==='PROVEN'&&view.database.ownership!=='RELEASED'&&<div className="rounded border border-amber-200 p-3 text-sm">
          <p>Worker đã xác minh cleanup nhưng database còn giữ ownership. Đối soát qua phiên gốc; không mở lại hoặc phát lại thao tác.</p>
          <button className={button} disabled={pending||!hasLease} onClick={()=>void perform(async()=>{
            const cached=lease.current;if(!cached||cached.id!==view.id)throw new ClientError('RECORDER_OWNER_MISMATCH');
            const result=await api<{database:View['database'];automaticResume:boolean}>('/api/teach-recorder',{type:'RECOVER_CLEANUP',id:cached.id,leaseId:cached.leaseId,confirmed:true});
            if(result.database.ownership!=='RELEASED'||result.automaticResume!==false)throw new ClientError('CLEANUP_RECONCILIATION_UNVERIFIED');
            setView(await api<View>(`/api/teach-recorder/${cached.id}/state`));setFrame(undefined);
          })}>Đối soát và nhả ownership đã cleanup</button>
        </div>}
        <ol aria-label="Timeline thao tác thật" className="divide-y rounded border border-slate-200">{view.receipts.map((r,i)=><li className="space-y-1 p-3 text-sm" key={r.id}><strong>{i+1}. {r.operation}</strong><p>{r.dispatch==='NOT_SENT'?'OBSERVED / NOT_DISPATCHED':r.dispatch==='ACK'?'RECORDED':'UNKNOWN_EFFECT'} · {r.dispatch} · {r.verification} · {r.persistence}</p>{r.excluded&&<p>Ý định chưa gửi, đã được chủ phiên loại khỏi Compile; timeline vẫn được giữ.</p>}{r.reason&&<p className="text-amber-800">{r.reason}</p>}
          {r.dispatch==='NOT_SENT'&&!r.action&&!r.evidenceId&&!r.excluded&&<button className={button} disabled={pending} onClick={()=>void perform(async()=>setView(await api<View>(`/api/teach-recorder/${view.id}/review-intent`,{revision:view.revision,receiptId:r.id,confirmed:true})))}>Loại ý định chưa gửi và chọn lại target</button>}
          <details><summary>Bằng chứng</summary><p>Receipt: {r.id}</p><p>Session: {r.sessionId}</p><p>Snapshot trước: {r.beforeSnapshotId}</p><p>Snapshot sau: {r.afterSnapshotId??'Chưa quan sát được'}</p><p>Verifier evidence: {r.evidenceId??'Chưa được xác minh'}</p><p>Ảnh/hierarchy thô không được lưu vào DRAFT.</p></details></li>)}</ol>
        {view.worker.cleanup==='PROVEN'&&!review&&<div className="space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={parameterize} onChange={e=>setParameterize(e.target.checked)}/>Xác nhận tham số hóa giá trị tìm kiếm thành query</label><button className={button} disabled={pending||view.database.status!=='REVIEWING'} onClick={()=>void perform(async()=>{setView(await api<View>(`/api/teach-recorder/${view.id}/compile`,{revision:view.revision,parameterizeQuery:parameterize}));})}>Compile và Review</button></div>}
        {review&&<section aria-label="Review thao tác đã ghi" className="space-y-2 rounded border border-indigo-200 p-3"><h2 className="font-semibold">Review — DRAFT</h2><p className="text-sm">App: {review.compilation.draft?.appScope.alias}. Chưa VERIFIED/PUBLISHED.</p><ol className="text-sm">{review.compilation.draft?.steps.map(s=><li key={s.id}>{s.id}: {s.operation} — {s.verify.kind}</li>)}</ol>{review.compilation.limitations.map(l=><p className="text-xs text-amber-800" key={l}>{l}</p>)}
          {review.compilation.draft?.parameters.query&&<label className="flex flex-col text-sm">Tên tham số query<input className={field} value={parameterName} disabled={pending||saved} onChange={e=>setParameterName(e.target.value)}/></label>}
          <label className="flex gap-2 text-sm"><input aria-label="Xác nhận lưu kỹ năng live" type="checkbox" checked={confirmSave} disabled={pending||saved} onChange={e=>setConfirmSave(e.target.checked)}/>Tôi đã review các bước và tham số; đồng ý lưu DRAFT vào PostgreSQL.</label>
          <button className={button} disabled={pending||!confirmSave||saved||uncertain} onClick={()=>void perform(async()=>{
            try{const result=await api<{storageMode:string;skillId:string;version:number;status:string}>(`/api/teach-sessions/${review.saveSessionId}/save-draft`,{reference:review.reference,confirmed:true,name:view.name,parameterNames:review.compilation.draft?.parameters.query?{query:parameterName}:{}});
              if(result.storageMode!=='POSTGRESQL_STORAGE'||result.status!=='DRAFT'||result.version!==1||!result.skillId)throw new ClientError('SAVE_OUTCOME_UNKNOWN');
              setSaved(true);setView(await api<View>(`/api/teach-recorder/${view.id}/state`));onSaved();}
            catch(cause){if(cause instanceof ClientError&&/UNKNOWN|DATABASE|NETWORK/.test(cause.code)){setUncertain(true);onSaved();}throw cause;}
          })}>{saved?'Đã lưu DRAFT':'Lưu DRAFT đúng một lần'}</button>
        </section>}
      </div>
    </div>}
  </section>;
}
