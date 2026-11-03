import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import Module from 'node:module';import React from 'react';import {randomUUID} from 'node:crypto';
import {load,uiNodes,uiText} from './helpers/react-skill-console.mjs';
function fixture(t,{cleanup='PROVEN',ownership='HELD',deny=false}={}){
 const previous={fetch:globalThis.fetch,storage:globalThis.sessionStorage},id=randomUUID(),leaseId=randomUUID(),token='a'.repeat(64),calls=[],cache=new Map();
 let view={id,name:'Offline cleanup',appAlias:'youtube',revision:1,mode:'LIVE_RECORDER',database:{status:'RECORDING',ownership},receipts:[],worker:{leaseId,recordingRef:id,deviceId:'A',physicalId:'android:'+'b'.repeat(64),executionId:randomUUID(),sessionId:'OFFLINE-CLEANUP',status:'INTERRUPTED',cleanup,receipts:[],modelCalls:0,metrics:{rpcCount:1,adbCount:1,elapsedMs:1}}};
 cache.set('phoneCommanderTeachG3Lease',JSON.stringify({id,leaseId,ownerToken:token}));
 globalThis.sessionStorage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)};
 globalThis.fetch=async(url,init={})=>{const body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});
  if(body){assert.equal(url,'/api/teach-recorder');assert.equal(body.type,'RECOVER_CLEANUP');assert.equal(body.id,id);assert.equal(body.leaseId,leaseId);assert.equal(body.confirmed,true);assert.equal(init.headers['X-Teach-Owner'],token);
   if(deny)return Response.json({code:'CLEANUP_UNPROVEN'},{status:409});view={...view,database:{status:'INTERRUPTED',ownership:'RELEASED'}};return Response.json({database:view.database,automaticResume:false});}
  if(String(url).endsWith('/state'))return Response.json(view);
  if(String(url).endsWith('/frame'))return Response.json({id:randomUUID(),controls:[],width:400,height:900,expiresAt:Date.now()+5000,imageOmittedReason:'CAPTURE_SAFETY_UNKNOWN'});
  assert.equal(url,'/api/teach-recorder');return Response.json({devices:[]});};
 const slots=[],effects=new Map();let cursor=0,tree;
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((x,i)=>!Object.is(x,b[i]));
 const hooks={...React,useState(v){const i=cursor++;slots[i]??={value:typeof v==='function'?v():v};return [slots[i].value,x=>{slots[i].value=typeof x==='function'?x(slots[i].value):x;}];},useRef(v){const i=cursor++;slots[i]??={value:{current:v}};return slots[i].value;},useCallback(fn,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))slots[i]={value:fn,deps};return slots[i].value;},useEffect(fn,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))effects.set(i,{fn,deps});}};
 const file=path.resolve('components/skills/LiveTeachRecorder.tsx'),original=Module._load;delete load.cache[file];
 Module._load=function(name,parent,main){return name==='react'&&parent?.filename===file?hooks:original.call(this,name,parent,main);};
 let Component;try{Component=load(file).LiveTeachRecorder;}finally{Module._load=original;}
 const props={onBusy:()=>{},onSaved:()=>assert.fail('Cleanup cannot save a skill')};
 const render=()=>{cursor=0;tree=Component(props);for(const[i,e]of effects){slots[i]?.cleanup?.();slots[i]={deps:e.deps,cleanup:e.fn()};}effects.clear();};
 t.after(()=>{for(const s of slots)s?.cleanup?.();globalThis.fetch=previous.fetch;if(previous.storage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous.storage;});
 return {calls,render,async settle(){for(let i=0;i<10;i++){await new Promise(setImmediate);render();}},button:()=>uiNodes(tree).find(n=>n.type==='button'&&uiText(n)==='Đối soát và nhả ownership đã cleanup'),text:()=>uiText(tree)};
}
test('OFFLINE auto-closed native session exposes explicit cleanup reconciliation without replay or new grants',async t=>{
 const f=fixture(t);f.render();await f.settle();assert.equal(f.calls.filter(x=>x.body).length,0);const b=f.button();assert.ok(b);assert.equal(b.props.disabled,false);
 b.props.onClick();b.props.onClick();await f.settle();assert.equal(f.calls.filter(x=>x.body).length,1);assert.equal(f.button(),undefined);assert.match(f.text(),/Ownership: RELEASED/);
});
test('OFFLINE backend cleanup refusal remains held and never retries or reports RELEASED',async t=>{
 const f=fixture(t,{deny:true});f.render();await f.settle();f.button().props.onClick();await f.settle();assert.equal(f.calls.filter(x=>x.body).length,1);assert.match(f.text(),/CLEANUP_UNPROVEN/);assert.match(f.text(),/Ownership: HELD/);assert.ok(f.button());
});
for(const [label,options]of [['UNKNOWN cleanup',{cleanup:'UNCERTAIN'}],['already released',{ownership:'RELEASED'}]])test('OFFLINE '+label+' does not offer proven-cleanup reconciliation or dispatch',async t=>{
 const f=fixture(t,options);f.render();await f.settle();assert.equal(f.button(),undefined);assert.equal(f.calls.filter(x=>x.body).length,0);
});
