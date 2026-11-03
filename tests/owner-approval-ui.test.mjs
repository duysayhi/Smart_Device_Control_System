import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {consoleHarness,uiNodes,uiText,load} from './helpers/react-skill-console.mjs';
load('next/image');
function fixture(t,{cancel=false,unknown=false,available=true}={}){
 const originals=new Map();for(const key of ['fetch','window','PublicKeyCredential','navigator','document','location','history','sessionStorage'])originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
 const reference=randomUUID(),successor=randomUUID(),approval=randomUUID(),requests=[],storage=new Map();let authCalls=0;
 const platform={isUserVerifyingPlatformAuthenticatorAvailable:async()=>available};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{PublicKeyCredential:platform}});Object.defineProperty(globalThis,'PublicKeyCredential',{configurable:true,value:platform});Object.defineProperty(globalThis,'document',{configurable:true,value:{title:'',documentElement:{dataset:{}}}});Object.defineProperty(globalThis,'location',{configurable:true,value:{hash:'',pathname:'/owner',search:'?review='+reference}});Object.defineProperty(globalThis,'history',{configurable:true,value:{replaceState(){}}});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)??null}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{credentials:{get:async()=>{authCalls++;if(cancel)throw new DOMException('Cancelled','NotAllowedError');return {id:'YQ',rawId:new ArrayBuffer(1),type:'public-key',getClientExtensionResults:()=>({}),response:{clientDataJSON:new ArrayBuffer(1),authenticatorData:new ArrayBuffer(1),signature:new ArrayBuffer(1)}};}}}});
 globalThis.fetch=async(url,options={})=>{const body=options.body?JSON.parse(options.body):undefined;requests.push({url,body});if(url==='/api/owner-auth'&&!body)return Response.json({enrolled:true,origin:'http://localhost:49861'});if(String(url).startsWith('/api/owner-auth?review='))return Response.json({review:{binding:{purpose:'G3_CONTINUATION',successorSessionId:successor,summary:'Open youtube with the owner-approved query once.'}}});
 if(body?.type==='BEGIN_APPROVAL')return Response.json({reference:randomUUID(),options:{challenge:'YQ',allowCredentials:[{id:'YQ',type:'public-key'}]}});if(body?.type==='FINISH_APPROVAL')return Response.json({approvalRef:approval,expiresAt:Date.now()+60000});if(url==='/api/teach-recorder'){if(unknown)throw Error('Lost reply');return Response.json({id:successor,ownerToken:'a'.repeat(64),worker:{leaseId:randomUUID()}});}assert.fail('Unexpected mock request');};
 const h=consoleHarness({},'app/owner/page.tsx','default');t.after(()=>{h.close();for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 return {h,requests,storage,get authCalls(){return authCalls;},button:()=>h.find(n=>n.type==='button'&&uiText(n).includes('Recorder'))};
}
test('OFFLINE owner continuation requires consent before one combined authenticate-and-open click',async t=>{
 const f=fixture(t);f.h.render();await f.h.settle();assert.equal(f.button().props.disabled,true);f.button().props.onClick();await f.h.settle();assert.equal(f.authCalls,0);
 f.h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.h.render();const button=f.button();button.props.onClick();button.props.onClick();await f.h.settle();assert.equal(f.authCalls,1);assert.equal(f.requests.filter(r=>r.body?.type==='AUTHORIZE_CONTINUATION').length,1);assert.equal(f.requests.find(r=>r.body?.type==='AUTHORIZE_CONTINUATION').body.confirmNativeOpen,true);assert.ok(f.storage.has('phoneCommanderTeachG3Lease'));
});
test('OFFLINE cancelled Windows Hello never posts continuation authorization',async t=>{
 const f=fixture(t,{cancel:true});f.h.render();await f.h.settle();f.h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.h.render();f.button().props.onClick();await f.h.settle();assert.equal(f.authCalls,1);assert.equal(f.requests.filter(r=>r.body?.type==='AUTHORIZE_CONTINUATION').length,0);assert.equal(f.storage.size,0);
});
test('OFFLINE an unknown OPEN reply disables further submits and does not repeat authentication or authorization',async t=>{
 const f=fixture(t,{unknown:true});f.h.render();await f.h.settle();f.h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.h.render();f.button().props.onClick();await f.h.settle();assert.equal(f.button().props.disabled,true);f.button().props.onClick();await f.h.settle();assert.equal(f.authCalls,1);assert.equal(f.requests.filter(r=>r.body?.type==='AUTHORIZE_CONTINUATION').length,1);assert.ok(uiNodes(f.h.tree).length>0);
});


test('OFFLINE unsupported embedded browser explains why consent alone cannot enable the Passkey button',async t=>{
 const f=fixture(t,{available:false});f.h.render();await f.h.settle();f.h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});f.h.render();assert.equal(f.button().props.disabled,true);f.button().props.onClick();await f.h.settle();assert.equal(f.authCalls,0);assert.match(uiText(f.h.tree),/Chrome/);assert.equal(f.requests.filter(r=>r.body?.type==='AUTHORIZE_CONTINUATION').length,0);
});
