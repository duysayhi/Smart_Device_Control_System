import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {consoleHarness,uiText} from './helpers/react-skill-console.mjs';
const load=createRequire(import.meta.url);
const {compileSkill}=load('../lib/skills/skill-compiler.ts'),{loadSkillProgram}=load('../lib/skills/skill-program.ts');
const {REPLAY_CONSOLE_STORAGE_KEY}=load('../lib/skills/replay-console-state.ts');
const {SkillReplayPreview}=load('../components/skills/SkillReplayPreview.tsx');
const definition=()=>compileSkill({name:'Console OFFLINE_TEST',appAlias:'youtube',actions:[{operation:'OPEN_APPLICATION',appRef:'youtube'},{operation:'ACTIVATE_CONTROL',purpose:'SEARCH',target:{semanticRole:'search_action',label:'Search',containerRole:'toolbar'}},{operation:'INPUT_TEXT',target:{semanticRole:'search_field',label:'Search',containerRole:'search'},value:'marine biology'},{operation:'SUBMIT_SEARCH'}]}).draft;
function fixture(options={}){
  const d=definition(),skillId=randomUUID(),leaseId=randomUUID(),ownerToken='e'.repeat(64),authorizationId=randomUUID(),busy=[],calls=[],cache=new Map();
  let cp={contractVersion:1,binding:{skillId,versionId:randomUUID(),version:1,definitionDigest:loadSkillProgram(d).definitionDigest,contentHash:'a'.repeat(64),executionId:randomUUID(),deviceId:'OFFLINE-A',physicalId:'android:'+'b'.repeat(64),sessionId:'SIMULATED-SESSION'},status:options.restore?'PAUSED':'RUNNING',revision:1,currentStep:0,observationGeneration:0,verifiedSteps:[],recoveryCount:0,ownership:'HELD',provenance:'SIMULATED_RECEIPT',signature:'c'.repeat(64)};
  const handle={kind:'LEASE',leaseId,ownerToken,binding:cp.binding,authorizationId},oldFetch=global.fetch,oldStorage=global.sessionStorage;
  if(options.restore)cache.set(REPLAY_CONSOLE_STORAGE_KEY,JSON.stringify(handle));
  if(options.pending)cache.set(REPLAY_CONSOLE_STORAGE_KEY,JSON.stringify({kind:'OPEN_PENDING',requestId:randomUUID(),skillId,version:1}));
  global.sessionStorage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>{if(options.storageFailure)throw Error('fixture disk unavailable');cache.set(k,v);},removeItem:k=>cache.delete(k)};
  const snapshot=()=>({checkpoint:structuredClone(cp),history:{transitions:['CREATED',cp.status],events:options.events??[{kind:'OBSERVATION',generation:1,blocker:'NONE',snapshotId:randomUUID()},{kind:'VERIFICATION',outcome:'UNVERIFIED'}]}});
  global.fetch=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):undefined;calls.push({url:String(url),body,headers:init.headers});
    if(String(url)==='/api/skills/replay')return Response.json({supervisedEnabled:!!options.enabled,reason:options.enabled?'OWNER_SCOPE_AVAILABLE':'SUPERVISED_REPLAY_DISABLED',devices:options.enabled?[{deviceId:'OFFLINE-A',physicalId:cp.binding.physicalId,...(options.noOwner?{}:{authorizationId,expiresAt:Date.now()+60000})}]:[]});
    if(body?.mode==='SUPERVISED'){if(options.openUnknown)throw Error('synthetic-private-transport');if(options.openDeferred)await options.openDeferred;return Response.json({leaseId,ownerToken,...snapshot()});}
    assert.equal(String(url),'/api/skills/replay/'+leaseId);assert.equal(init.headers['x-teach-owner'],ownerToken);
    if(body.type==='PAUSE')cp={...cp,status:'PAUSED',revision:cp.revision+1};
    if(body.type==='RESUME'){assert.deepEqual(body.checkpoint,cp);cp={...cp,status:'RUNNING',revision:cp.revision+1};}
    if(body.type==='CANCEL')cp={...cp,status:'CANCELLED',revision:cp.revision+1,ownership:'RELEASED'};
    return Response.json(snapshot());
  };
  const props={skillId,version:1,definition:d,onBusy:v=>busy.push(v)},h=consoleHarness(props);
  function prepare(){h.find(n=>n.type===SkillReplayPreview).props.onPlan({mode:'OFFLINE_PREVIEW',status:'NOT_DISPATCHED',compatibility:{supported:true,issues:[]},steps:[]},{query:'hải dương học'});h.render();h.find(n=>n.type==='select').props.onChange({target:{value:'OFFLINE-A'}});h.render();h.find(n=>n.props?.['aria-label']==='Xác nhận replay giám sát').props.onChange({target:{checked:true}});h.render();}
  return {h,props,calls,busy,cache,handle,prepare,get cp(){return cp;},set cp(v){cp=v;},close(){h.close();global.fetch=oldFetch;if(oldStorage===undefined)delete global.sessionStorage;else global.sessionStorage=oldStorage;}};
}
test('G5.1 SSR console is native OFF and performs no observation, grant or Worker call',()=>{
  const old=global.fetch;global.fetch=()=>assert.fail('SSR no IO');try{const C=load('../components/skills/SkillReplayConsole.tsx').SkillReplayConsole,html=renderToStaticMarkup(React.createElement(C,{skillId:randomUUID(),version:1,definition:definition()}));assert.match(html,/Native replay TẮT/);assert.match(html,/disabled=""[^>]*>Bắt đầu replay giám sát/);assert.match(html,/chưa VERIFIED\/PUBLISHED/);assert.doesNotMatch(html,/ANDROID_RUNTIME/);}finally{global.fetch=old;}
});
for(const options of [{enabled:false},{enabled:true,noOwner:true}])test('G5.1 flag/owner gate never produces a native OPEN: '+JSON.stringify(options),async()=>{
  const f=fixture(options);try{f.h.render();await f.h.settle();f.prepare();assert.equal(f.h.button('Bắt đầu replay giám sát').props.disabled,true);await f.h.button('Bắt đầu replay giám sát').props.onClick();await f.h.settle();assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,0);}finally{f.close();}
});
test('G5.1 one native click is one OPEN; parameters/owner binding persist only as a reconnect reference, no token in UI',async()=>{
  let release;const promise=new Promise(r=>{release=r;}),f=fixture({enabled:true,openDeferred:promise});try{f.h.render();await f.h.settle();f.prepare();const start=f.h.button('Bắt đầu replay giám sát');assert.equal(start.props.disabled,false);start.props.onClick();start.props.onClick();assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,1);release();await f.h.settle();
    const request=f.calls.find(c=>c.body?.mode==='SUPERVISED');assert.deepEqual(request.body.parameters,{query:'hải dương học'});assert.equal(request.body.authorizationId,f.handle.authorizationId);
    assert.match(uiText(f.h.tree),/SIMULATED_RECEIPT/);assert.doesNotMatch(uiText(f.h.tree),new RegExp(f.handle.ownerToken));assert.ok(!f.cache.get(REPLAY_CONSOLE_STORAGE_KEY).includes('hải dương học'));assert.ok(f.busy.includes(true));
  }finally{release?.();f.close();}
});
test('G5.1 Pause/Resume/Cancel use the same lease and exact checkpoint, and read-only refresh never starts or resumes',async()=>{
  const f=fixture({enabled:true,restore:true});try{f.h.render();await f.h.settle();assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,0);assert.equal(f.calls.filter(c=>c.body?.type==='RESUME').length,0);
    assert.equal(f.h.button('Resume').props.disabled,false);f.h.button('Resume').props.onClick();await f.h.settle();assert.equal(f.h.button('Pause').props.disabled,false);f.h.button('Pause').props.onClick();await f.h.settle();assert.equal(f.cp.status,'PAUSED');
    f.h.button('Cancel').props.onClick();await f.h.settle();assert.equal(f.cp.status,'CANCELLED');assert.equal(f.cp.ownership,'RELEASED');for(const type of ['RESUME','PAUSE','CANCEL'])assert.equal(f.calls.filter(c=>c.body?.type===type).length,1);assert.equal(f.cache.has(REPLAY_CONSOLE_STORAGE_KEY),false);assert.equal(f.busy.at(-1),false);
  }finally{f.close();}
});
test('G5.1 native flag OFF and lost owner prevent Resume but original-lease Cancel remains available',async()=>{
  for(const options of [{enabled:false},{enabled:true,noOwner:true}]){const f=fixture({...options,restore:true});try{f.h.render();await f.h.settle();assert.equal(f.h.button('Resume').props.disabled,true);assert.equal(f.h.button('Cancel').props.disabled,false);f.h.button('Cancel').props.onClick();await f.h.settle();assert.equal(f.calls.filter(c=>c.body?.type==='CANCEL').length,1);assert.equal(f.calls.filter(c=>c.body?.type==='RESUME').length,0);}finally{f.close();}}
});
test('G5.1 unknown OPEN is never retried across double clicks or remount; pending handle contains no parameters',async()=>{
  const f=fixture({enabled:true,openUnknown:true});try{f.h.render();await f.h.settle();f.prepare();f.h.button('Bắt đầu replay giám sát').props.onClick();await f.h.settle();assert.match(uiText(f.h.tree),/OPEN_OUTCOME_UNKNOWN_NO_RETRY/);assert.equal(f.h.button('Bắt đầu replay giám sát').props.disabled,true);assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,1);assert.ok(!f.cache.get(REPLAY_CONSOLE_STORAGE_KEY).includes('hải dương học'));
    f.h.close();const restored=consoleHarness(f.props);try{restored.render();await restored.settle();assert.match(uiText(restored.tree),/OUTCOME_UNKNOWN/);assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,1);assert.equal(f.calls.filter(c=>c.body?.type==='RESUME').length,0);}finally{restored.close();}
  }finally{f.close();}
});
test('G5.1 unverified ACK, UNKNOWN effect and wrong physical checkpoint never render a verified step or permit Resume',async()=>{
  const f=fixture({enabled:true,restore:true});try{f.cp={...f.cp,status:'UNKNOWN_EFFECT',ownership:'RELEASED',pending:{requestId:randomUUID(),stepId:'s1',dispatch:'UNKNOWN'}};f.h.render();await f.h.settle();assert.match(uiText(f.h.tree),/UNKNOWN_EFFECT/);assert.equal(f.h.button('Resume').props.disabled,true);assert.equal(f.h.button('Bắt đầu replay giám sát').props.disabled,true);assert.doesNotMatch(uiText(f.h.tree),/s1 · OPEN_APPLICATION · VERIFIED/);
  }finally{f.close();}
  const wrong=fixture({restore:true});try{wrong.cp={...wrong.cp,binding:{...wrong.cp.binding,physicalId:'android:'+'f'.repeat(64)}};wrong.h.render();await wrong.h.settle();assert.match(uiText(wrong.h.tree),/REPLAY_RESPONSE_CONTEXT_MISMATCH/);assert.equal(wrong.h.button('Resume').props.disabled,true);assert.equal(wrong.calls.filter(c=>c.body?.mode==='SUPERVISED').length,0);}finally{wrong.close();}
});
test('G5.1 storage unavailable prevents OPEN; diagnostic never echoes transport/private values',async()=>{
  const f=fixture({enabled:true,storageFailure:true});try{f.h.render();await f.h.settle();f.prepare();f.h.button('Bắt đầu replay giám sát').props.onClick();await f.h.settle();assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,0);assert.doesNotMatch(uiText(f.h.tree),/fixture disk unavailable/);}finally{f.close();}
});
test('G5.1 console shows verified prefix and recovery/verification journal summaries without reflecting raw snapshot text',async()=>{
  const f=fixture({enabled:true,restore:true,events:[{kind:'OBSERVATION',blocker:'NONE',snapshotId:'synthetic-private-snapshot-text'},{kind:'VERIFICATION',outcome:'PASSED'},{kind:'RECOVERY_PENDING',reason:'OBSERVED_BENIGN_DIALOG'},{kind:'RECOVERY_RECEIPT',dispatch:'ACK'}]});
  try{f.cp={...f.cp,status:'COMPLETED',currentStep:4,observationGeneration:7,recoveryCount:1,ownership:'RELEASED',verifiedSteps:f.props.definition.steps.map(s=>({stepId:s.id,evidenceId:randomUUID(),snapshotId:randomUUID()}))};f.h.render();await f.h.settle();
    const text=uiText(f.h.tree);assert.match(text,/s1 → s2 → s3 → s4/);assert.match(text,/Recovery:\s*1\/3/);assert.match(text,/RECOVERY_RECEIPT/);assert.match(text,/Verification: PASSED/);assert.doesNotMatch(text,/synthetic-private-snapshot-text/);assert.equal(f.busy.at(-1),false);assert.equal(f.calls.filter(c=>c.body?.mode==='SUPERVISED').length,0);
  }finally{f.close();}
});
