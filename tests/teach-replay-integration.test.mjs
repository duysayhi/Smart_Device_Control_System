import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const load=createRequire(import.meta.url),root=path.resolve('.');
Module._extensions['.ts']=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);};
const {startWorker}=load('../lib/android/agent/worker-server.ts');
const {consumeEffectGrant}=load('../lib/android/agent/effect-grants.ts');
const {beforeSearchDispatch,noteSearchQueryEntered,noteSearchSubmitted}=load('../lib/android/agent/generic-search.ts');
const {GroundedInteractionFailure}=load('../lib/android/grounded-interactions.ts');
const {PostgresTeachRepository}=load('../lib/skills/db/postgres-teach-repository.ts');
const {OfflineTeachDashboard}=load('../lib/skills/teach-dashboard.ts');
const {compileSkill}=load('../lib/skills/skill-compiler.ts');
const {loadSkillProgram}=load('../lib/skills/skill-program.ts');
const {skillReplayResponse,skillReplayControlResponse}=load('../lib/skills/skill-replay-api.ts');
const pkg='org.unprofiled.search',hardwareSerial='OFFLINE-REPLAY-A',manufacturer='Fixture',model='Unprofiled';
const physicalId='android:'+createHash('sha256').update(JSON.stringify([hardwareSerial,manufacturer,model])).digest('hex');
const directory=path.join(root,'coverage/g45-2026-11-01/replay-worker-'+randomUUID());
let db,driver,worker,address,mode,options,stage,query,observations,dispatches,reservations,releases,closed,opened,holdObserve,releaseObserve,repo,dashboard,definition;
function snapshot(){
  const snapshotId=randomUUID(),field={hint:'Search',resourceId:pkg+':id/'+(options.portableLayout?'query_v2':'query'),className:'android.widget.EditText',focused:true,clickable:true,text:query};
  const rows=stage==='popup'?[{text:options.popup==='sensitive'?'Permission request':'Information',className:'android.app.Dialog',resourceId:'android:id/dialog',bounds:[10,10,350,350]},{text:'Temporary notice'}]:stage==='home'?[{description:'Search',className:'android.widget.ImageButton',clickable:true}]:stage==='input'?[field]:[field,{className:'androidx.recyclerview.widget.RecyclerView',resourceId:pkg+':id/results',bounds:[0,80,400,800]},{text:'Offline result',clickable:true,parentIndex:1}];
  if(options.systemSensitive)rows.push({text:'Allow',className:'android.widget.FrameLayout',packageName:'com.android.permissioncontroller'});
  if(options.resultsReflow&&stage==='results'){rows[2].text='Offline result generation '+observations;rows.push({text:'Another offline result',clickable:true,parentIndex:1});}
  if(options.portableLayout&&stage==='results')rows[1].bounds=[0,80,900,390];
  const nodes=rows.map((r,i)=>({text:'',description:'',hint:'',resourceId:'',packageName:pkg,className:'android.widget.TextView',enabled:true,displayed:true,clickable:false,focused:false,password:false,bounds:[10,i*70+10,390,i*70+70],...r}));
  const rotated=options.rotate&&observations>=3||options.portableLayout&&stage!=='home';
  return {deviceSerial:'A',snapshotId,timestamp:Date.now(),foregroundPackage:pkg,observationStatus:'OBSERVED',source:'APPIUM',evidenceSource:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',viewport:{x:0,y:0,width:rotated?900:400,height:rotated?400:900},nodes,elements:nodes.map((r,i)=>({...r,elementId:snapshotId+':'+i}))};
}
const adapter={discover:async()=>[{serial:'A',status:'device',physicalId,identityVerified:true,model}],teachIdentity:async()=>({serial:'A',physicalId,hardwareSerial,manufacturer,model}),
  reserve:async()=>{reservations++;return async()=>{releases++;};},plan:async()=>assert.fail('No model planning'),open:async()=>assert.fail('No legacy engine'),
  v2:()=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial:'A',requestedName:'searchapp',packageName:pkg,component:pkg+'/.Main'}})},open:async()=>({backend:'appium',sessionId:()=>closed?undefined:'SIMULATED-NATIVE-REPLAY',
    observe:async()=>{observations++;if(holdObserve)await holdObserve;return snapshot();},execute:async()=>assert.fail('Already foreground'),close:async()=>{closed++;},
    interactV2:async(grant,signal)=>{
      if(options.expired){const now=Date.now,time=now();try{Date.now=()=>time+120000;consumeEffectGrant(grant,'A','SIMULATED-NATIVE-REPLAY');}catch(error){throw new GroundedInteractionFailure('NOT_SENT','GRANT_REJECTED',error);}finally{Date.now=now;}}
      consumeEffectGrant(grant,'A','SIMULATED-NATIVE-REPLAY');const c=grant.candidate,before=snapshot();if(c.search)beforeSearchDispatch(c,before);dispatches++;
      if(options.holdDispatch)await new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('aborted'));else signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
      if(options.unknown)throw new GroundedInteractionFailure('UNKNOWN','DISPATCH_RPC',Error('synthetic-private-transport'));
      if(c.search?.phase==='OPEN')stage='input';
      if(c.search?.phase==='ENTER'){query=c.value;noteSearchQueryEntered(c,before,snapshot());if(options.popup)stage='popup';}
      if(c.search?.phase==='SUBMIT'){noteSearchSubmitted(c);stage='results';}if(c.action==='BACK')stage='input';return snapshot();
    }})})};
async function send(endpoint,command,extra={}){
  const response=await fetch('http://127.0.0.1:'+address.port+endpoint,{method:'POST',headers:{Authorization:'Bearer '+address.token,'Content-Type':'application/json',...extra},body:JSON.stringify(command)});
  const body=await response.json();if(!response.ok)throw Object.assign(Error(body.code??'REQUEST_REJECTED'),{status:response.status,code:body.code});return body;
}
const actions=()=>[{operation:'OPEN_APPLICATION',appRef:'searchapp'},{operation:'ACTIVATE_CONTROL',purpose:'SEARCH',target:{semanticRole:'search_action',label:'Search',containerRole:'toolbar'}},{operation:'INPUT_TEXT',target:{semanticRole:'search_field',label:'Search',containerRole:'search'},value:'marine biology'},{operation:'SUBMIT_SEARCH'}];
function payload(params={query:'OpenAI'}){const p=loadSkillProgram(definition);return {type:'OPEN',requestId:randomUUID(),deviceId:'A',expectedPhysicalId:physicalId,skillId:randomUUID(),versionId:randomUUID(),version:1,contentHash:'b'.repeat(64),definitionDigest:p.definitionDigest,definition,parameters:params,authorizationId:mode.id,confirmed:true};}
async function start(input=payload()){opened=await send('/replay',input);return opened;}
async function poll(allowPaused=false){for(let i=0;i<200;i++){const result=await send('/replay',{type:'STATE',leaseId:opened.leaseId,ownerToken:opened.ownerToken});if((allowPaused&&result.checkpoint.status==='PAUSED')||['COMPLETED','BLOCKED','UNKNOWN_EFFECT','CANCELLED','INTERRUPTED'].includes(result.checkpoint.status)&&result.checkpoint.ownership!=='HELD')return result;await new Promise(r=>setTimeout(r,10));}assert.fail('Replay fixture did not reach bounded terminal state');}
before(async()=>{
  db=new PGlite();await db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql',import.meta.url),'utf8'));await db.exec('SET search_path=public');
  const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});driver={query:async(sql,args=[])=>map(await db.query(sql,args)),transaction:work=>db.transaction(tx=>work({query:async(sql,args=[])=>map(await tx.query(sql,args))})),close:()=>db.close()};
  worker=await startWorker({directory,adapter});address=JSON.parse(fs.readFileSync(path.join(directory,'address.json'),'utf8'));
});
beforeEach(async()=>{
  options={};stage='home';query='';observations=0;dispatches=0;reservations=0;releases=0;closed=0;opened=undefined;holdObserve=undefined;releaseObserve=undefined;
  definition=compileSkill({name:'Replay fixture',appAlias:'searchapp',actions:actions()}).draft;
  await db.exec('DELETE FROM teach_mode.consents');await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
  repo=new PostgresTeachRepository(driver,'teach_mode');dashboard=new OfflineTeachDashboard({mode:'OFFLINE_TEST',workspaceRoot:root,consentGranted:true,devices:[{id:randomUUID(),label:'Fixture declaration'}]},{mode:'PGLITE_TEST',repository:repo});
  await send('/tasks',{type:'SET_OWNER_TEST_MODE',deviceId:'A',physicalId,enabled:true});mode=worker.registry.ownerTestModes()[0];
});
afterEach(async()=>{releaseObserve?.();if(opened)await send('/replay',{type:'CANCEL',leaseId:opened.leaseId,ownerToken:opened.ownerToken}).catch(()=>undefined);
  if(worker.registry.ownerTestModes().some(m=>m.id===mode.id))await send('/tasks',{type:'SET_OWNER_TEST_MODE',deviceId:'A',physicalId,enabled:false,authorizationId:mode.id});
});
after(async()=>{await worker?.shutdown();await db?.close();});

for(const value of ['OpenAI','lập trình Python','C++ & AI?'])test('OFFLINE actual Worker/grounding/grant/registered verifier: '+value,async()=>{
  await start(payload({query:value}));const result=await poll();assert.equal(result.checkpoint.status,'COMPLETED');assert.equal(query,value);assert.equal(dispatches,3);assert.equal(result.checkpoint.verifiedSteps.length,4);
  assert.equal(result.checkpoint.provenance,'SIMULATED_RECEIPT');assert.equal(closed,1);assert.equal(releases,1);assert.equal(result.checkpoint.ownership,'RELEASED');
  const task=worker.registry.list().find(t=>t.executionId===result.checkpoint.binding.executionId);assert.equal(task.status,'COMPLETED');assert.ok(task.skillReplay.events.some(e=>e.kind==='DISPATCH_PENDING'));assert.ok(!JSON.stringify(task.skillReplay).includes(value));
  const persisted=JSON.parse(fs.readFileSync(path.join(directory,'tasks.json'),'utf8')).find(t=>t.executionId===task.executionId);assert.equal(persisted.skillReplay.checkpoint.status,'COMPLETED');assert.equal(persisted.skillReplay.checkpoint.ownership,'RELEASED');
});
test('G3→G4→stored v1→G5 uses existing storage with public search_path and never changes saved definition',async()=>{
  const stored=await dashboard.recordingPersistence().storage.createDraft({definition});const original=await repo.getVersion(stored.version.id);
  let calls=0;const deps={dashboard,supervisedAllowed:()=>true,storageBinding:async()=>undefined,worker:async(endpoint,command)=>{calls++;return send(endpoint,command);}};
  const request=new Request('http://localhost/api/skills',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({mode:'SUPERVISED',parameters:{query:'hải dương học'},deviceId:'A',requestId:randomUUID(),authorizationId:mode.id,confirmedExperimental:true})});
  const response=await skillReplayResponse(request,stored.skill.id,'1',deps);assert.equal(response.status,200);opened=await response.json();assert.equal((await poll()).checkpoint.status,'COMPLETED');assert.equal(calls,2);
  const fresh=new PostgresTeachRepository(driver,'teach_mode'),readback=await fresh.getVersion(stored.version.id);assert.deepEqual(readback,original);assert.equal(readback.status,'DRAFT');assert.equal(readback.evidenceLevel,'COMPILED');
});
test('G5 offline preview is NOT_DISPATCHED; supervised gate and invalid payload reject before any Worker call',async()=>{
  const stored=await dashboard.recordingPersistence().storage.createDraft({definition});let calls=0;const deps={dashboard,supervisedAllowed:()=>false,worker:async()=>{calls++;assert.fail('No Worker for preview/denied supervised');}};
  const req=body=>new Request('http://localhost/api/skills',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(body)});
  const preview=await skillReplayResponse(req({mode:'OFFLINE_PREVIEW',parameters:{query:'OpenAI'}}),stored.skill.id,'1',deps);assert.equal(preview.status,200);const plan=await preview.json();assert.equal(plan.status,'NOT_DISPATCHED');assert.ok(plan.steps.every(s=>s.status==='NOT_DISPATCHED'));assert.equal(plan.storageMode,'PGLITE_TEST_STORAGE');
  const denied=await skillReplayResponse(req({mode:'SUPERVISED',parameters:{query:'OpenAI'},deviceId:'A',requestId:randomUUID(),authorizationId:mode.id,confirmedExperimental:true}),stored.skill.id,'1',deps);assert.equal((await denied.json()).code,'SUPERVISED_REPLAY_DISABLED');assert.equal(calls,0);
  const bad=await skillReplayResponse(req({mode:'OFFLINE_PREVIEW',parameters:{query:'OpenAI'},grant:{}}),stored.skill.id,'1',deps);assert.equal(bad.status,400);
});
test('G5 unknown outcome is not retried, and wrong owner cannot read/cancel/resume the original Session',async()=>{
  options.unknown=true;await start();const result=await poll();assert.equal(result.checkpoint.status,'UNKNOWN_EFFECT');assert.equal(dispatches,1);assert.equal(result.checkpoint.pending.dispatch,'UNKNOWN');
  await assert.rejects(send('/replay',{type:'STATE',leaseId:opened.leaseId,ownerToken:'f'.repeat(64)}),/OWNER_MISMATCH/);
  await assert.rejects(send('/replay',{type:'RESUME',leaseId:opened.leaseId,ownerToken:opened.ownerToken,checkpoint:result.checkpoint}),/CHECKPOINT/);assert.equal(dispatches,1);
});
test('G5 original Worker pause/resume keeps Session, verified prefix and signed checkpoint; forged checkpoint has zero effects',async()=>{
  holdObserve=new Promise(resolve=>{releaseObserve=resolve;});await start();
  await send('/replay',{type:'PAUSE',leaseId:opened.leaseId,ownerToken:opened.ownerToken});releaseObserve();holdObserve=undefined;
  const paused=await poll(true);assert.equal(paused.checkpoint.status,'PAUSED');assert.equal(dispatches,0);assert.equal(closed,0);
  await assert.rejects(send('/replay',{type:'RESUME',leaseId:opened.leaseId,ownerToken:opened.ownerToken,checkpoint:{...paused.checkpoint,currentStep:9}}),/CHECKPOINT/);
  await send('/replay',{type:'RESUME',leaseId:opened.leaseId,ownerToken:opened.ownerToken,checkpoint:paused.checkpoint});const final=await poll();assert.equal(final.checkpoint.status,'COMPLETED');assert.equal(final.checkpoint.binding.sessionId,paused.checkpoint.binding.sessionId);assert.equal(dispatches,3);
});
test('G5 stale native geometry/expired grant fail before a driver effect',async()=>{
  options.rotate=true;await start();const result=await poll();assert.equal(result.checkpoint.status,'BLOCKED');assert.equal(dispatches,0);assert.equal(result.checkpoint.reason,'STALE_FRAME');
});
test('G5 native grant expiry is denied rather than replayed',async()=>{
  options.expired=true;await start();const result=await poll();assert.equal(result.checkpoint.status,'BLOCKED');assert.equal(dispatches,0);assert.notEqual(result.checkpoint.status,'COMPLETED');
});
test('G5 another task/tab cannot preempt the shared physical reservation; owner revocation reaches real controller',async()=>{
  options.holdDispatch=true;await start();while(!dispatches)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(start({...payload(),requestId:randomUUID()}),/BUSY/);
  await assert.rejects(worker.registry.start({type:'START',requestId:randomUUID(),jobs:[{deviceId:'A',goal:'read battery',agentVersion:2}]}),/scheduled|Physical device/);
  await send('/tasks',{type:'SET_OWNER_TEST_MODE',deviceId:'A',physicalId,enabled:false,authorizationId:mode.id});const stopped=await poll();assert.notEqual(stopped.checkpoint.status,'COMPLETED');assert.equal(dispatches,1);assert.equal(releases,1);
});
test('G5 HTTP request idempotency: concurrent OPEN uses one reservation, changed binding never starts another',async()=>{
  const input=payload();const [a,b]=await Promise.all([send('/replay',input),send('/replay',input)]);opened=a;assert.deepEqual(a,b);assert.equal(reservations,1);await poll();
  await assert.rejects(send('/replay',{...input,parameters:{query:'other'}}),/BINDING_MISMATCH/);assert.equal(reservations,1);
});
test('G5 required owner mode, literal-lossless query and unsupported operations block before Session creation',async()=>{
  await assert.rejects(send('/replay',{...payload(),authorizationId:randomUUID()}),/AUTHORIZATION_REQUIRED/);
  await assert.rejects(send('/replay',payload({query:'  padded  '})),/NOT_LOSSLESS/);
  const bad=payload();bad.definition.steps.push({...definition.steps[0],id:'ordinal',operation:'SELECT_RESULT_BY_ORDINAL',arguments:{ordinal:3}});await assert.rejects(send('/replay',bad));assert.equal(reservations,0);assert.equal(dispatches,0);
});
test('G5 control route requires original owner capability and local origin before reaching Worker',async()=>{
  let calls=0;const deps={worker:async()=>{calls++;return {};}};
  const request=new Request('http://localhost/api/skills/replay',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({type:'STATE'})});
  const denied=await skillReplayControlResponse(request,randomUUID(),deps);assert.equal(denied.status,400);assert.equal(calls,0);
});
test('G5 bound replay capability cannot be used to inject manual G3 steps through /teach',async()=>{
  holdObserve=new Promise(resolve=>{releaseObserve=resolve;});await start();
  await assert.rejects(send('/teach',{type:'FRAME',leaseId:opened.leaseId,ownerToken:opened.ownerToken}),/PURPOSE_MISMATCH/);
  releaseObserve();holdObserve=undefined;assert.equal((await poll()).checkpoint.status,'COMPLETED');assert.equal(dispatches,3);
});
test('G5 real primitive recovery after ACK uses one grounded benign Back and never repeats INPUT',async()=>{
  options.popup='benign';await start();const result=await poll();assert.equal(result.checkpoint.status,'COMPLETED',JSON.stringify(worker.registry.list().find(t=>t.executionId===result.checkpoint.binding.executionId)?.skillReplay));assert.equal(result.checkpoint.recoveryCount,1);assert.equal(dispatches,4);
  const task=worker.registry.list().find(t=>t.executionId===result.checkpoint.binding.executionId);assert.ok(task.skillReplay.events.some(e=>e.kind==='RECOVERY_RECEIPT'));assert.equal(query,'OpenAI');
});
test('G5 sensitive native dialog after ACK is never dismissed automatically',async()=>{
  options.popup='sensitive';await start();const result=await poll();assert.equal(result.checkpoint.status,'BLOCKED');assert.equal(result.checkpoint.reason,'OWNER_ASSISTANCE_REQUIRED');assert.equal(dispatches,2);assert.equal(result.checkpoint.recoveryCount,0);
});
test('G5 system permission overlay without Dialog class blocks before any effect',async()=>{
  options.systemSensitive=true;await start();const result=await poll();assert.equal(result.checkpoint.status,'BLOCKED');assert.equal(result.checkpoint.reason,'OWNER_ASSISTANCE_REQUIRED');assert.equal(dispatches,0);
});

test('OFFLINE native snapshot rotation between verified steps re-grounds changed resource ID without replaying input',async()=>{
  options.portableLayout=true;await start();const result=await poll();assert.equal(result.checkpoint.status,'COMPLETED',JSON.stringify(worker.registry.list().find(t=>t.executionId===result.checkpoint.binding.executionId)?.skillReplay));assert.equal(dispatches,3);assert.equal(result.checkpoint.verifiedSteps.length,4);assert.equal(releases,1);
});

test('OFFLINE native search results change on each fresh read without selecting any ordinal result',async()=>{
  options.resultsReflow=true;await start();const result=await poll();assert.equal(result.checkpoint.status,'COMPLETED');assert.equal(dispatches,3);assert.equal(result.checkpoint.verifiedSteps.length,4);assert.equal(query,'OpenAI');
});
test('G5 simulated Worker restart restores only a historical checkpoint; no new controller, grant or automatic resume',async()=>{
  holdObserve=new Promise(resolve=>{releaseObserve=resolve;});await start();await send('/replay',{type:'PAUSE',leaseId:opened.leaseId,ownerToken:opened.ownerToken});releaseObserve();holdObserve=undefined;
  await poll(true);const saved=worker.registry.persisted().find(t=>t.executionId===opened.checkpoint.binding.executionId);
  const {DeviceRuntimeRegistry}=load('../lib/android/agent/device-runtime.ts'),restarted=new DeviceRuntimeRegistry(adapter);restarted.restore([saved]);
  assert.equal(restarted.list()[0].status,'BLOCKED');await assert.rejects(restarted.replay({type:'STATE',leaseId:opened.leaseId,ownerToken:opened.ownerToken}),/RECONCILIATION_REQUIRED/);assert.equal(dispatches,0);
  const request=new Request('http://localhost/api/skills/replay',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','x-teach-owner':opened.ownerToken},body:JSON.stringify({type:'STATE'})});
  const nextProcessRead=await skillReplayControlResponse(request,opened.leaseId,{worker:async(endpoint,command)=>send(endpoint,command)});assert.equal(nextProcessRead.status,200);assert.equal((await nextProcessRead.json()).checkpoint.binding.sessionId,'SIMULATED-NATIVE-REPLAY');assert.equal(dispatches,0);
});
