'use client';
import React,{useRef,useState} from 'react';
import type { SkillDefinition } from '@/lib/skills/skill-schema';
export interface Preview {mode:'OFFLINE_PREVIEW';status:'NOT_DISPATCHED';explanation:string;compatibility:{supported:boolean;issues:{code:string}[]};steps:{id:string;operation:string;preconditions:string[];postcondition:string;status:'NOT_DISPATCHED'}[]}
export function SkillReplayPreview({skillId,version,definition,disabled=false,onPlan}:{skillId:string;version:number;definition:SkillDefinition;disabled?:boolean;onPlan?:(preview:Preview|undefined,parameters:Record<string,string|number>)=>void}){
  const [parameters,setParameters]=useState<Record<string,string>>({}),[preview,setPreview]=useState<Preview>(),[pending,setPending]=useState(false),[error,setError]=useState('');const inFlight=useRef(false);
  return <section aria-label="Offline Replay Preview" className="mt-3 space-y-2 rounded border border-slate-200 p-3">
    <h3 className="font-medium">Offline Replay Preview — DRAFT / EXPERIMENTAL</h3>
    <p className="text-sm text-slate-600">Chỉ xem kế hoạch và kiểm tra tham số. Không quan sát UI, không chạy Android; chưa VERIFIED/PUBLISHED.</p>
    <form className="space-y-2" onSubmit={event=>{event.preventDefault();if(inFlight.current||disabled)return;inFlight.current=true;setPending(true);setError('');onPlan?.(undefined,{});
      void(async()=>{try{
        const values=Object.fromEntries(Object.entries(definition.parameters).filter(([key])=>parameters[key]!==undefined&&parameters[key]!=='').map(([key,p])=>[key,p.type==='integer'?Number(parameters[key]):parameters[key]]));
        const response=await fetch(`/api/skills/${skillId}/versions/${version}/replay`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'OFFLINE_PREVIEW',parameters:values})});
        const body=await response.json();if(!response.ok)throw Error('PREVIEW_FAILED');setPreview(body);onPlan?.(body,values);
      }catch{setError('Không thể tạo preview. Kiểm tra tham số hoặc trạng thái storage; chưa gửi thao tác Android.');}finally{inFlight.current=false;setPending(false);}})();}}>
      {Object.entries(definition.parameters).map(([key,p])=><label key={key} className="flex flex-col text-sm">{key}<input aria-label={'Tham số replay '+key} className="rounded border border-slate-300 px-3 py-2" type={p.type==='integer'?'number':'text'} required={p.required} maxLength={p.maxLength} autoComplete="off" disabled={pending||disabled} value={parameters[key]??''} onChange={e=>{setParameters(old=>({...old,[key]:e.target.value}));setPreview(undefined);onPlan?.(undefined,{});}}/></label>)}
      <button className="rounded border px-3 py-2 text-sm disabled:opacity-40" disabled={pending||disabled}>Xem kế hoạch replay offline</button>
    </form>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {preview&&<div className="space-y-2 text-sm"><p>{preview.explanation}</p><p>{preview.compatibility.supported?'Có contract replay; nghiệm thu thiết bị thật còn PENDING.':'BLOCKED — capability chưa đủ contract.'}</p>{preview.compatibility.issues.map(issue=><p key={issue.code}>{issue.code}</p>)}<ol>{preview.steps.map(step=><li key={step.id}>{step.id}: {step.operation} — {step.status}<p>Trước: {step.preconditions.join(', ')}. Sau: {step.postcondition}</p></li>)}</ol></div>}
  </section>;
}
