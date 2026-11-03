import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
const load=createRequire(import.meta.url),root=path.resolve('.');
Module._extensions['.ts']=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);};
const {compileSkill}=load('../lib/skills/skill-compiler.ts');
const {loadSkillProgram}=load('../lib/skills/skill-program.ts');
const {SkillReplayController}=load('../lib/skills/skill-replay.ts');
const {predicateDigest}=load('../lib/skills/replay-contracts.ts');
const target={semanticRole:'search_action',label:'Search',containerRole:'toolbar'},field={semanticRole:'search_field',label:'Search',containerRole:'search'};
function program(){return loadSkillProgram(compileSkill({name:'Offline search',appAlias:'youtube',actions:[{operation:'OPEN_APPLICATION',appRef:'youtube'},{operation:'ACTIVATE_CONTROL',purpose:'SEARCH',target},{operation:'INPUT_TEXT',target:field,value:'marine biology'},{operation:'SUBMIT_SEARCH'}]}).draft);}
function fixture(options={}){
  let p=program();if(options.shortStep){p.definition.steps[1].timeoutMs=10;p=loadSkillProgram(p.definition);}
  const binding={skillId:randomUUID(),versionId:randomUUID(),version:1,contentHash:'a'.repeat(64),definitionDigest:p.definitionDigest,executionId:randomUUID(),deviceId:'SIMULATED-A',physicalId:'android:'+'b'.repeat(64),sessionId:'SIMULATED-SESSION'};
  let stage=options.keyboard?'input':'home',entered=false,foreground=!options.home,dialog=false,generation=0,verifiedReads=0,closed=0,recoveries=0,owner=true,dispatches=[];
  const receipts=new Map(),journal=[];
  const proof=(step)=>({id:randomUUID(),snapshotId:randomUUID(),observedAt:Date.now(),stepId:step.id,predicateDigest:predicateDigest(step),binding,provenance:'SIMULATED_RECEIPT'});
  const satisfied=step=>foreground&&!dialog&&(step.operation==='OPEN_APPLICATION'||step.operation==='ACTIVATE_CONTROL'&&stage==='input'||step.operation==='INPUT_TEXT'&&entered||step.operation==='SUBMIT_SEARCH'&&stage==='results');
  const adapter={binding,provenance:'SIMULATED_RECEIPT',async authorize(){if(!owner||options.missingOwner)throw Error('missing owner');},
    async observe(step){if(options.workerUnavailable)throw Error('simulated worker unavailable');if(options.disconnected&&generation>0)throw Error('simulated disconnect');generation++;
      const candidates=[];
      if(dialog&&options.popup==='benign')candidates.push({id:'dismiss-'+generation,operation:'BACK',recovery:'DISMISS_BENIGN'});
      if(!dialog&&stage==='home'&&!options.missing)candidates.push({id:'search-'+generation,operation:'ACTIVATE_CONTROL',target:{...target,resourceIdHint:options.resolution?'changed:id/search':undefined}});
      if(!dialog&&stage==='home'&&options.duplicate)candidates.push({id:'other-'+generation,operation:'ACTIVATE_CONTROL',target});
      if(!dialog&&stage==='input'&&!entered)candidates.push({id:'field-'+generation,operation:'INPUT_TEXT',target:field});
      if(!dialog&&stage==='input'&&entered)candidates.push({id:'submit-'+generation,operation:'SUBMIT_SEARCH'});
      return {id:randomUUID(),snapshotId:randomUUID(),generation,observedAt:Date.now(),expiresAt:Date.now()+(options.stale?-1:5000),binding:options.wrongDevice?{...binding,deviceId:'OTHER'}:binding,
        foreground,blocker:dialog?options.popup==='sensitive'?'SENSITIVE':options.popup==='unsupported'?'UNSUPPORTED_DIALOG':'BENIGN_DIALOG':'NONE',candidates,
        ...(satisfied(step)&&!(options.failedVerifier&&step.operation==='SUBMIT_SEARCH')?{proof:proof(step)}:{}),provenance:'SIMULATED_RECEIPT'};
    },
    async execute(step,observation,candidateId,requestId,signal){
      const signature=JSON.stringify([step,observation.id,candidateId]),old=receipts.get(requestId);if(old){assert.equal(old.signature,signature);return old.receipt;}
      const dispatch='ACK';dispatches.push({operation:step.operation,stepId:step.id,requestId});
      if(options.timeout)throw Error('simulated RPC timeout');
      if(options.hold)await new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('cancelled'));else signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});
      if(step.operation==='OPEN_APPLICATION')foreground=true;
      if(step.operation==='ACTIVATE_CONTROL')stage='input';
      if(step.operation==='INPUT_TEXT'){entered=true;if(options.popup)dialog=true;if(options.background)foreground=false;}
      if(step.operation==='SUBMIT_SEARCH')stage='results';
      const receipt={id:randomUUID(),requestId,stepId:step.id,binding:options.wrongReceipt?{...binding,sessionId:'OTHER'}:binding,dispatch:options.unknown?'UNKNOWN':dispatch,
        verification:options.unknown?'UNVERIFIED':options.failedVerifier?'FAILED':'PASSED',beforeId:randomUUID(),afterId:randomUUID(),provenance:'SIMULATED_RECEIPT'};
      receipts.set(requestId,{signature,receipt});return receipt;
    },
    async verify(step){verifiedReads++;if(options.failedVerifier||options.slow&&step.operation==='SUBMIT_SEARCH'&&verifiedReads<5)return;
      if(options.wrongProof)return {...proof(step),stepId:'other'};return satisfied(step)?proof(step):undefined;
    },
    async recover(decision,observation,requestId){recoveries++;assert.equal(journal.at(-1).kind,'RECOVERY_PENDING');
      if(decision.action==='DISMISS_BENIGN'){assert.equal(observation.blocker,'BENIGN_DIALOG');dialog=false;}else foreground=true;
      return {id:randomUUID(),requestId,stepId:'recovery',binding,dispatch:'ACK',verification:options.failedRecovery?'FAILED':'PASSED',beforeId:randomUUID(),afterId:randomUUID(),provenance:'SIMULATED_RECEIPT'};
    },async close(){closed++;return {cleanup:options.cleanupFail?'UNCERTAIN':'PROVEN'};}
  };
  let controller;controller=new SkillReplayController(p,{query:options.query??'OpenAI'},adapter,(checkpoint,event)=>{journal.push({...event,status:checkpoint.status});if(options.pause&&event.kind==='STEP_VERIFIED'&&checkpoint.currentStep===1)controller.pause();});
  return {controller,adapter,p,journal,receipts,dispatches,proof,get closed(){return closed;},get recoveries(){return recoveries;},get verifiedReads(){return verifiedReads;},revoke(){owner=false;}};
}
const scenarios=[
  {name:'normal YouTube search',options:{},status:'COMPLETED',dispatch:3,recovery:0},
  {name:'search control missing',options:{missing:true},status:'BLOCKED',dispatch:0,recovery:0},
  {name:'search control duplicated',options:{duplicate:true},status:'BLOCKED',dispatch:0,recovery:0},
  {name:'keyboard already open',options:{keyboard:true},status:'COMPLETED',dispatch:2,recovery:0},
  {name:'search results loading slowly',options:{slow:true},status:'COMPLETED',dispatch:3,recovery:0},
  {name:'result rendering changes; search has no result identity dependency',options:{changedResults:true},status:'COMPLETED',dispatch:3,recovery:0},
  {name:'benign popup covering results',options:{popup:'benign'},status:'COMPLETED',dispatch:3,recovery:1},
  {name:'popup with unsupported recovery',options:{popup:'unsupported'},status:'BLOCKED',dispatch:2,recovery:0},
  {name:'rotation regenerates semantic candidates without coordinates',options:{rotation:true},status:'COMPLETED',dispatch:3,recovery:0},
  {name:'resolution change does not affect semantic identity',options:{resolution:true},status:'COMPLETED',dispatch:3,recovery:0},
  {name:'app at home before launch',options:{home:true},status:'COMPLETED',dispatch:4,recovery:0},
  {name:'background switch reopens scope but never repeats verified input',options:{background:true},status:'COMPLETED',dispatch:3,recovery:1},
  {name:'device disconnect',options:{disconnected:true},status:'INTERRUPTED',dispatch:0,recovery:0},
  {name:'worker unavailable',options:{workerUnavailable:true},status:'INTERRUPTED',dispatch:0,recovery:0},
  {name:'Appium timeout has UNKNOWN dispatch outcome',options:{timeout:true},status:'UNKNOWN_EFFECT',dispatch:1,recovery:0},
  {name:'ACK and verifier failure never completes',options:{failedVerifier:true},status:'BLOCKED',dispatch:1,recovery:0},
  {name:'effect UNKNOWN never retries',options:{unknown:true},status:'UNKNOWN_EFFECT',dispatch:1,recovery:0},
  {name:'stale candidate never dispatched',options:{stale:true},status:'INTERRUPTED',dispatch:0,recovery:0},
  {name:'sensitive dialog is owner assistance, never consent acceptance',options:{popup:'sensitive'},status:'BLOCKED',dispatch:2,recovery:0},
  {name:'wrong physical context before dispatch',options:{wrongDevice:true},status:'INTERRUPTED',dispatch:0,recovery:0},
  {name:'wrong native Session in receipt is unknown not success',options:{wrongReceipt:true},status:'UNKNOWN_EFFECT',dispatch:1,recovery:0},
  {name:'wrong proof never completes',options:{wrongProof:true},status:'UNKNOWN_EFFECT',dispatch:1,recovery:0},
  {name:'missing owner permission never dispatches',options:{missingOwner:true},status:'BLOCKED',dispatch:0,recovery:0},
  {name:'failed recovery is not retried',options:{popup:'benign',failedRecovery:true},status:'BLOCKED',dispatch:2,recovery:1},
];
for(const row of scenarios)test('SIMULATED_UI / SIMULATED_RECEIPT / OFFLINE_TEST: '+row.name,async()=>{
  const f=fixture(row.options),definition=structuredClone(f.p.definition),result=await f.controller.run();
  assert.equal(result.status,row.status);assert.equal(f.dispatches.length,row.dispatch);assert.equal(f.recoveries,row.recovery);assert.equal(result.provenance,'SIMULATED_RECEIPT');
  assert.deepEqual(f.p.definition,definition);assert.equal(f.closed,1);assert.equal(result.ownership,'RELEASED');
  assert.ok(f.dispatches.every(d=>f.journal.some(e=>e.kind==='DISPATCH_PENDING'&&e.stepId===d.stepId)));
  if(result.status==='COMPLETED'){assert.equal(result.verifiedSteps.length,4);assert.equal(result.pending,undefined);}else assert.notEqual(result.status,'COMPLETED');
  if(row.options.unknown||row.options.timeout){assert.equal(result.pending.dispatch,'UNKNOWN');assert.equal(f.controller.reconcile(result).canResume,false);}
});
for(const name of ['only two results when third requested','advertisement among ordinal results','Shorts mixed with regular videos','ordinal target ambiguous','result target stale'])test('OFFLINE unsupported ordinal safety: '+name,()=>{
  const invalid=program().definition;invalid.steps.push({...invalid.steps[0],id:'select',operation:'SELECT_RESULT_BY_ORDINAL',arguments:{ordinal:3}});
  assert.throws(()=>loadSkillProgram(invalid),/INCOMPATIBLE/);assert.equal(fixture().dispatches.length,0);
});
test('G5 duplicate start requests share one operation; verified effects are never replayed',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.controller.run(),f.controller.run()]);assert.deepEqual(a,b);assert.equal(f.dispatches.length,3);assert.deepEqual(await f.controller.run(),a);assert.equal(f.dispatches.length,3);
});
test('G5 browser refresh reconciles same checkpoint without dispatch; pause/resume stays in same Session',async()=>{
  const f=fixture({pause:true}),paused=await f.controller.run();assert.equal(paused.status,'PAUSED');assert.equal(f.closed,0);assert.equal(f.dispatches.length,0);
  const refresh=f.controller.reconcile(paused);assert.equal(refresh.automaticResume,false);assert.equal(refresh.canResume,true);assert.equal(f.dispatches.length,0);
  const finished=await f.controller.resume(paused);assert.equal(finished.status,'COMPLETED');assert.equal(finished.binding.sessionId,paused.binding.sessionId);assert.equal(f.dispatches.length,3);
});
test('G5 corrupted checkpoint, wrong execution and public hash cannot grant resume',async()=>{
  const f=fixture({pause:true}),paused=await f.controller.run();
  for(const changed of [{...paused,currentStep:2},{...paused,signature:'a'.repeat(64)},{...paused,binding:{...paused.binding,executionId:randomUUID()}}])assert.throws(()=>f.controller.resume(changed),/CHECKPOINT/);
  assert.equal(f.dispatches.length,0);await f.controller.cancel();assert.equal(f.closed,1);
});
test('G5 Next/Worker restart cannot trust a client checkpoint or lost owner capability',async()=>{
  const old=fixture({pause:true}),checkpoint=await old.controller.run(),restarted=fixture();
  assert.throws(()=>restarted.controller.resume(checkpoint),/CHECKPOINT/);assert.equal(restarted.dispatches.length,0);await old.controller.cancel();
  const lost=fixture({pause:true}),paused=await lost.controller.run();lost.revoke();const result=await lost.controller.resume(paused);
  assert.notEqual(result.status,'COMPLETED');assert.equal(lost.dispatches.length,0);assert.equal(lost.closed,1);
});
test('G5 cancellation while an RPC may have sent retains UNKNOWN and never repeats effect',async()=>{
  const f=fixture({hold:true}),running=f.controller.run();while(!f.dispatches.length)await new Promise(resolve=>setTimeout(resolve,5));
  const stopped=await f.controller.cancel();await running;assert.equal(stopped.status,'UNKNOWN_EFFECT');assert.equal(f.dispatches.length,1);assert.equal(f.closed,1);
});
test('G5 independent cleanup failure prevents a COMPLETED claim and retains ownership',async()=>{
  const f=fixture({cleanupFail:true}),result=await f.controller.run();assert.equal(result.status,'INTERRUPTED');assert.equal(result.ownership,'RETAINED_PENDING_CLEANUP');assert.equal(result.reason,'CLEANUP_UNPROVEN');
});
test('G5 journal unavailable before any RPC blocks and cleans the original Session without a fake success',async()=>{
  const f=fixture(),controller=new SkillReplayController(f.p,{query:'OpenAI'},f.adapter,()=>{throw Error('synthetic disk failure');});const result=await controller.run();
  assert.equal(result.status,'INTERRUPTED');assert.equal(result.reason,'CHECKPOINT_STORAGE_UNAVAILABLE');assert.equal(f.dispatches.length,0);assert.equal(f.closed,1);
});
test('G5 checkpoint publication waits for the existing journal flush and survives JSON round-trip',async()=>{
  const f=fixture({pause:true}),paused=await f.controller.run(),wire=JSON.parse(JSON.stringify(paused));assert.deepEqual(f.controller.reconcile(wire).checkpoint,paused);await f.controller.cancel();
});
test('G5 step timeout interrupts an in-flight effect once and never auto-retries',async()=>{
  const f=fixture({hold:true,shortStep:true});const controller=new SkillReplayController(f.p,{query:'OpenAI'},f.adapter);
  const keepAlive=setInterval(()=>undefined,50);try{const result=await controller.run();assert.equal(result.status,'UNKNOWN_EFFECT');assert.equal(f.dispatches.length,1);assert.equal(f.closed,1);}finally{clearInterval(keepAlive);}
});
test('G5 altered program metadata or adapter identity cannot change the bound execution',async()=>{
  const f=fixture();f.p.definition.steps[1].timeoutMs=123;assert.throws(()=>new SkillReplayController(f.p,{query:'OpenAI'},f.adapter),/PROGRAM_INTEGRITY_INVALID/);
  const other=fixture();other.adapter.binding.physicalId='android:'+'c'.repeat(64);const result=await other.controller.run();assert.equal(result.status,'INTERRUPTED');assert.equal(other.dispatches.length,0);
});
