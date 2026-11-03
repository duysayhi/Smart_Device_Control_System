import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText,file);
const {liveTeachResponse}=require('../lib/skills/live-teach-api.ts');
const {LiveTeachError}=require('../lib/skills/live-teach-service.ts');
const id='eeeecebc-a49d-44c9-a1cb-81bba7425392',token='a'.repeat(64);
function request(origin='http://localhost') {return new Request(`http://localhost/api/teach-recorder/${id}/stream`,{headers:{host:'localhost',...(origin?{origin}:{}),'x-teach-owner':token,'x-teach-client':'offline-stream-client'}});}
function service(read,close=()=>undefined) {return {claimScreenStream(session,owner){assert.equal(session,id);assert.equal(owner,token);return {read,close};}};}

test('OFFLINE stream sends bounded SSE frames, reports termination, and releases the stream lease',async()=>{
 let reads=0,closed=0;const frames=[{image:'AA==',width:1080,height:2340,at:Date.now(),status:'RECORDING'}];
 const response=await liveTeachResponse(request(),id,'stream',service(async()=>{if(reads++===0)return frames[0];throw new LiveTeachError('RECORDER_STREAM_NOT_ACTIVE');},()=>closed++));
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/event-stream; charset=utf-8');assert.equal(response.headers.get('cache-control'),'no-store, no-transform');
 const reader=response.body.getReader(),first=await reader.read(),text=new TextDecoder().decode(first.value);assert.match(text,/data:/);assert.match(text,/"width":1080/);
 const end=await reader.read();assert.match(new TextDecoder().decode(end.value),/event:error/);assert.match(new TextDecoder().decode(end.value),/RECORDER_STREAM_NOT_ACTIVE/);assert.equal((await reader.read()).done,true);assert.equal(closed,1);
});

test('OFFLINE duplicate stream claim is rejected before response streaming',async()=>{
 const response=await liveTeachResponse(request(),id,'stream',{claimScreenStream(){throw new LiveTeachError('RECORDER_STREAM_ALREADY_CONNECTED');}});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'RECORDER_STREAM_ALREADY_CONNECTED');
});

test('OFFLINE foreign origin is rejected before a stream lease is claimed',async()=>{
 let claimed=0;const response=await liveTeachResponse(request('https://attacker.invalid'),id,'stream',{claimScreenStream(){claimed++;throw Error('must not be called');}});
 assert.equal(response.status,403);assert.equal(claimed,0);
});

test('OFFLINE stream route is read-only and rejects POST',async()=>{
 const req=new Request(`http://localhost/api/teach-recorder/${id}/stream`,{method:'POST',headers:{host:'localhost',origin:'http://localhost','content-type':'application/json','sec-fetch-site':'same-origin','x-teach-owner':token},body:'{}'});
 let claimed=0;const response=await liveTeachResponse(req,id,'stream',{claimScreenStream(){claimed++;}});
 assert.equal(response.status,405);assert.equal(claimed,0);
});
