import test, {before, after, beforeEach, afterEach} from 'node:test';
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
const {LiveTeachService,LiveTeachError}=load('../lib/skills/live-teach-service.ts');
const {liveTeachResponse}=load('../lib/skills/live-teach-api.ts');
const {teachResponse}=load('../lib/skills/teach-api.ts');
const {TeachStorageError}=load('../lib/skills/db/teach-errors.ts');
const pkg='org.unseen.catalog',hardwareSerial='OFFLINE-HARDWARE-A',manufacturer='Fixture',model='Unseen';
const physicalId='android:'+createHash('sha256').update(JSON.stringify([hardwareSerial,manufacturer,model])).digest('hex');
const directory=path.join(root,'coverage/g3-2026-10-31/fixture-worker-'+randomUUID());
let db,driver,worker,address,stage,text,nativeClosed,dispatches,reservations,releases,ready,devices,unknown,waitStep,failAction;
let service,dashboard,repo,current;
const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
function observation(){
  const snapshotId=randomUUID(),field={hint:'Search',resourceId:pkg+':id/query',className:'android.widget.EditText',focused:true,clickable:true,text};
  const rows=stage==='start'?[{description:'Search',className:'android.widget.ImageButton',clickable:true}]:stage==='input'?[field]:[field,{className:'androidx.recyclerview.widget.RecyclerView',resourceId:pkg+':id/results',bounds:[0,80,400,800]},{text:'Fixture result',clickable:true,parentIndex:1}];
  const nodes=rows.map((row,i)=>({text:'',description:'',hint:'',resourceId:'',packageName:pkg,className:'android.widget.TextView',enabled:true,displayed:true,clickable:false,focused:false,password:false,bounds:[10,i*70+10,390,i*70+70],...row}));
  return {deviceSerial:'A',snapshotId,timestamp:Date.now(),foregroundPackage:pkg,observationStatus:'OBSERVED',source:'APPIUM',evidenceSource:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',viewport:{x:0,y:0,width:400,height:900},nodes,elements:nodes.map((n,i)=>({...n,elementId:snapshotId+':'+i}))};
}
const adapter={
  discover:async()=>devices,teachIdentity:async()=>({serial:'A',physicalId,hardwareSerial,manufacturer,model}),
  reserve:async()=>{reservations++;return async()=>{releases++;};},
  plan:async()=>assert.fail('G3 must not invoke a planner'),open:async()=>assert.fail('No legacy execution'),
  v2:()=>({readiness:async()=>ready,catalog:{resolve:async()=>({app:{serial:'A',requestedName:'catalog',packageName:pkg,component:pkg+'/.Main'}})},open:async()=>({
    backend:'appium',sessionId:()=>nativeClosed?undefined:'offline-native-session',observe:async()=>observation(),
    execute:async()=>assert.fail('Foreground no-op must not dispatch OPEN_APP'),close:async()=>{nativeClosed++;},
    interactV2:async grant=>{consumeEffectGrant(grant,'A','offline-native-session');const c=grant.candidate,before=observation();beforeSearchDispatch(c,before);dispatches++;
      if(waitStep)await waitStep;
      if(unknown)throw new GroundedInteractionFailure('UNKNOWN','DISPATCH_RPC',Error('synthetic-private-detail'));
      if(c.search?.phase==='OPEN')stage='input';
      if(c.search?.phase==='ENTER'){text=c.value;noteSearchQueryEntered(c,before,observation());}
      if(c.search?.phase==='SUBMIT'){noteSearchSubmitted(c);stage='results';}return observation();}
  })})
};
async function transport(command){
  const response=await fetch('http://127.0.0.1:'+address.port+'/teach',{method:'POST',headers:{Authorization:'Bearer '+address.token,'Content-Type':'application/json'},body:JSON.stringify(command)});
  const result=await response.json();if(!response.ok)throw new LiveTeachError(result.code);return result;
}
function compose(bridge=transport,database=driver){
  const repository=new PostgresTeachRepository(database,'teach_mode');let live;
  const app=new OfflineTeachDashboard({mode:'OFFLINE_TEST',workspaceRoot:root,consentGranted:true,devices:[{id:randomUUID(),label:'Offline declaration fixture'}]},
    {mode:'PGLITE_TEST',repository,cleanupVerified:async s=>live?.cleanupProven(s.id)===true});
  live=new LiveTeachService(repository,app.recordingPersistence().storage,app,bridge,async()=>undefined);
  return {live,app,repository};
}
const openPayload=()=>({requestId:randomUUID(),deviceId:'A',name:'G3 offline '+randomUUID().replace(/[0-9]/g,d=>'ghijklmnop'[Number(d)]),appAlias:'catalog',command:'Open catalog and search marine biology',query:'marine biology',confirmed:true});
async function open(){current=await service.open(openPayload(),randomUUID());return current;}
async function state(){const token=current.ownerToken;current={...await service.state(current.id,token),ownerToken:token};return current;}
async function step(operation,extra={}){
  const frame=await service.frame(current.id,current.ownerToken),candidate=frame.controls.find(c=>c.operation===operation);
  const input={revision:current.revision,requestId:randomUUID(),frameId:frame.id,operation,...(candidate?{candidateId:candidate.id}:{}),...(operation==='INPUT_TEXT'?{value:'marine biology'}:{}),...extra};
  const result=await service.step(current.id,current.ownerToken,input);current={...result,ownerToken:current.ownerToken};return result;
}
async function stop(){const result=await service.control(current.id,current.ownerToken,'stop',{revision:current.revision});current={...result,ownerToken:current.ownerToken};return result;}
const n=async table=>Number((await db.query('SELECT count(*) AS n FROM teach_mode.'+table)).rows[0].n);
before(async()=>{
  db=new PGlite();await db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql',import.meta.url),'utf8'));await db.exec('SET search_path=public');
  const query=async(target,sql,args=[])=>{if(failAction&&/INSERT INTO .*"recorded_actions"/.test(sql))throw new TeachStorageError('DATABASE_ERROR');return map(await target.query(sql,args));};
  driver={query:(sql,args)=>query(db,sql,args),transaction:work=>db.transaction(tx=>work({query:(sql,args)=>query(tx,sql,args)})),close:()=>db.close()};
  worker=await startWorker({directory,adapter});address=JSON.parse(fs.readFileSync(path.join(directory,'address.json'),'utf8'));
});
beforeEach(async()=>{
  stage='start';text='';nativeClosed=0;dispatches=0;reservations=0;releases=0;ready='READY';unknown=false;waitStep=undefined;failAction=false;current=undefined;
  devices=[{serial:'A',status:'device',physicalId,identityVerified:true,model}];
  await db.exec('DELETE FROM teach_mode.consents');await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
  ({live:service,app:dashboard,repository:repo}=compose());
});
afterEach(async()=>{
  failAction=false;waitStep=undefined;
  if(current)await service.control(current.id,current.ownerToken,'cancel',{revision:(await service.state(current.id,current.ownerToken)).revision}).catch(()=>undefined);
});
after(async()=>{await worker?.shutdown();await db?.close();});

test('G3 actual authenticated Worker + PGlite: record search, Compile no INSERT, confirmed existing Save API and fresh repository readback',async()=>{
  await open();const before=await n('skills');
  for(const op of ['OPEN_APPLICATION','ACTIVATE_CONTROL','INPUT_TEXT','SUBMIT_SEARCH'])await step(op);
  assert.equal(current.receipts.length,4);assert.ok(current.receipts.every(r=>r.verification==='PASSED'&&r.persistence==='PERSISTED'));
  const actions=(await db.query('SELECT * FROM teach_mode.recorded_actions WHERE session_id=$1 ORDER BY step_order',[current.id])).rows;
  assert.equal(actions.length,4);assert.deepEqual(actions.map(r=>r.receipt_status),['NOT_SENT','ACK','ACK','ACK']);
  assert.ok(actions.every(r=>r.before_snapshot_id&&r.after_snapshot_id&&r.diagnostic.runtime.sessionIdentity==='offline-native-session'));
  assert.deepEqual(actions[2].safe_args.value,{param:'query'});assert.ok(!JSON.stringify(actions).includes('marine biology'));
  await stop();assert.equal(current.database.ownership,'RELEASED');assert.equal(nativeClosed,1);assert.equal(releases,1);
  current={...await service.compile(current.id,current.ownerToken,{revision:current.revision,parameterizeQuery:true}),ownerToken:current.ownerToken};
  assert.equal(await n('skills'),before);assert.equal(current.review.origin,'RECORDED');
  assert.equal(JSON.stringify(current.review).includes('marine biology'),false);
  const input={reference:current.review.reference,confirmed:true,name:current.name,parameterNames:{query:'topic'}};
  const request=()=>new Request('http://localhost/api/teach-sessions',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(input)});
  const responses=await Promise.all([teachResponse(request(),'save-draft',{id:current.review.saveSessionId},dashboard),teachResponse(request(),'save-draft',{id:current.review.saveSessionId},dashboard)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);const [saved,duplicate]=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(saved,duplicate);assert.equal(await n('skills'),before+1);
  const fresh=new PostgresTeachRepository(driver,'teach_mode'),version=await fresh.getVersionByNumber(saved.skillId,1);
  assert.equal(version.status,'DRAFT');assert.deepEqual(version.definition,saved.definition);assert.match(version.contentHash,/^[a-f0-9]{64}$/);
  const independent=(await db.query('SELECT v.*,s.current_version_id FROM teach_mode.skill_versions v JOIN teach_mode.skills s ON s.id=v.skill_id WHERE v.id=$1',[version.id])).rows[0];
  assert.equal(independent.source_session_id,current.id);assert.equal(independent.current_version_id,version.id);assert.equal(independent.evidence_level,'COMPILED');
  assert.equal((await fresh.getSession(current.id)).status,'FINISHED');assert.equal(current.worker.modelCalls,0);
  assert.equal(worker.registry.list().filter(t=>!t.finishedAt).length,0);
});
test('G3 no device, unauthorized and locked admission have no dispatch or invented receipt',async()=>{
  for(const variant of [[],[{...devices[0],status:'unauthorized'}]]){devices=variant;await assert.rejects(service.open(openPayload(),randomUUID()),/DEVICE_IDENTITY_UNAVAILABLE/);}
  devices=[{serial:'A',status:'device',physicalId,identityVerified:true}];ready='UNLOCK_REQUIRED';await assert.rejects(service.open(openPayload(),randomUUID()),/DEVICE_NOT_READY/);assert.equal(dispatches,0);
});
test('G3 same physical device cannot be taken by a second tab or legacy cancellation',async()=>{
  await open();await assert.rejects(service.open(openPayload(),randomUUID()),/BUSY/);
  assert.equal(worker.registry.cancel(current.worker.executionId,'A'),false);
  assert.equal((await service.devices()).devices[0].state,'BUSY');assert.equal(nativeClosed,0);assert.equal(reservations,1);
});
test('G3 recorder request ownership, cross-origin and client-forged receipts are rejected before Worker effects',async()=>{
  await open();await assert.rejects(service.state(current.id,'b'.repeat(64)),/OWNER_MISMATCH/);
  const req=(body,origin='http://localhost')=>new Request('http://localhost/api/teach-recorder',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','x-teach-owner':current.ownerToken},body:JSON.stringify(body)});
  assert.equal((await liveTeachResponse(req({},'https://foreign.invalid'),current.id,'step',service)).status,403);
  assert.equal((await liveTeachResponse(req({revision:current.revision,receipt:{dispatch:'ACK'}}),current.id,'step',service)).status,400);assert.equal(dispatches,0);
});
test('G3 same OPEN key is idempotent and a different owner cannot replay it',async()=>{
  const payload=openPayload(),client=randomUUID();const [a,b]=await Promise.all([service.open(payload,client),service.open(payload,client)]);current=a;assert.deepEqual(a,b);assert.equal(reservations,1);
  assert.throws(()=>service.open(payload,randomUUID()),/OWNER_MISMATCH/);
});
test('G3 duplicate STEP before/after persistence yields one grant and one action row',async()=>{
  await open();const frame=await service.frame(current.id,current.ownerToken),control=frame.controls.find(c=>c.operation==='ACTIVATE_CONTROL');
  const input={revision:current.revision,requestId:randomUUID(),frameId:frame.id,operation:'ACTIVATE_CONTROL',candidateId:control.id};
  const [a,b]=await Promise.all([service.step(current.id,current.ownerToken,input),service.step(current.id,current.ownerToken,input)]);assert.deepEqual(a,b);current={...a,ownerToken:current.ownerToken};
  assert.deepEqual(await service.step(current.id,current.ownerToken,input),a);assert.equal(dispatches,1);
  assert.equal((await db.query('SELECT count(*) AS n FROM teach_mode.recorded_actions WHERE session_id=$1',[current.id])).rows[0].n,1);
});
test('G3 consent revocation before STEP blocks dispatch; cleanup still releases proven ownership',async()=>{
  await open();await db.query("UPDATE teach_mode.consents SET revoked_at=now()");await assert.rejects(step('ACTIVATE_CONTROL'),e=>e.code==='NO_REMOTE_CONSENT');assert.equal(dispatches,0);
  current={...await state(),ownerToken:current.ownerToken};await service.control(current.id,current.ownerToken,'cancel',{revision:current.revision});
  assert.equal((await repo.getSession(current.id)).ownership,'RELEASED');
});
test('G3 missing consent and missing branch binding reject before device ownership or DB session creation',async()=>{
  const count=await n('teach_sessions');await db.exec('DELETE FROM teach_mode.consents');await assert.rejects(service.open(openPayload(),randomUUID()),e=>e.code==='NO_REMOTE_CONSENT');assert.equal(await n('teach_sessions'),count);
  const closed=new LiveTeachService(repo,dashboard.recordingPersistence().storage,dashboard,transport);await assert.rejects(closed.open(openPayload(),randomUUID()),/TEST_BRANCH_BINDING_REQUIRED/);assert.equal(reservations,0);
});
test('G3 DB failure after native ACK retains truthful receipt, pauses, prevents dispatch replay and Compile',async()=>{
  await open();failAction=true;await assert.rejects(step('ACTIVATE_CONTROL'),e=>e.code==='DATABASE_ERROR');failAction=false;
  current={...await state(),ownerToken:current.ownerToken};assert.equal(current.receipts[0].dispatch,'ACK');assert.equal(current.receipts[0].persistence,'NOT_PERSISTED');assert.equal(current.worker.status,'PAUSED');assert.equal(dispatches,1);
  assert.throws(()=>service.step(current.id,current.ownerToken,{revision:current.revision,requestId:randomUUID(),frameId:randomUUID(),operation:'OBSERVE_UI'}),/INVALID_STATE|UNRESOLVED/);
  await assert.rejects(service.compile(current.id,current.ownerToken,{revision:current.revision,parameterizeQuery:true}),/NOT_READY/);
});
test('G3 UNKNOWN native effect cannot resume, exclude, replay or Compile',async()=>{
  await open();unknown=true;await step('ACTIVATE_CONTROL');assert.equal(current.receipts[0].dispatch,'UNKNOWN');assert.equal(current.worker.status,'INTERRUPTED');assert.equal(dispatches,1);
  assert.throws(()=>service.reviewIntent(current.id,current.ownerToken,{revision:current.revision,receiptId:current.receipts[0].id,confirmed:true}),/CANNOT_EXCLUDE/);
  assert.throws(()=>service.control(current.id,current.ownerToken,'resume',{revision:current.revision}),/UNRESOLVED/);
});
test('G3 mismatched Worker receipt interrupts orchestration without writing forged snapshots/actions',async()=>{
  const altered=compose(async command=>{const result=await transport(command);return command.type==='STEP'?{...result,sessionId:'wrong-session'}:result;});service=altered.live;dashboard=altered.app;repo=altered.repository;
  await open();const before=await n('recorded_actions');await assert.rejects(step('ACTIVATE_CONTROL'),/RECEIPT_MISMATCH/);assert.equal(await n('recorded_actions'),before);assert.equal(dispatches,1);
});
test('G3 Next memory loss does not replay actions; explicit owner cleanup reconciles the original Worker Session',async()=>{
  await open();await step('OPEN_APPLICATION');const restarted=compose();
  await assert.rejects(restarted.live.state(current.id,current.ownerToken),/MEMORY_LOST/);
  const result=await restarted.live.recoverCleanup({id:current.id,leaseId:current.worker.leaseId},current.ownerToken);
  assert.equal(result.automaticResume,false);assert.equal(result.database.status,'INTERRUPTED');assert.equal(result.database.ownership,'RELEASED');assert.equal(nativeClosed,1);assert.equal(dispatches,0);
});
test('G3 cancel during in-flight action waits for receipt persistence before ownership release',async()=>{
  await open();let finish;waitStep=new Promise(resolve=>{finish=resolve;});const running=step('ACTIVATE_CONTROL');
  while(!dispatches)await new Promise(resolve=>setTimeout(resolve,5));
  const cancel=service.control(current.id,current.ownerToken,'cancel',{revision:current.revision});assert.equal(releases,0);finish();await running;await cancel;
  assert.equal(nativeClosed,1);assert.equal(releases,1);assert.equal((await repo.getSession(current.id)).ownership,'RELEASED');assert.equal(worker.registry.list().filter(t=>!t.finishedAt).length,0);
});
test('G3 pause blocks native dispatch; parameterization needs owner review before compilation',async()=>{
  await open();current={...await service.control(current.id,current.ownerToken,'pause',{revision:current.revision}),ownerToken:current.ownerToken};
  assert.throws(()=>service.step(current.id,current.ownerToken,{revision:current.revision,requestId:randomUUID(),frameId:randomUUID(),operation:'OPEN_APPLICATION'}),/INVALID_STATE/);
  current={...await service.control(current.id,current.ownerToken,'resume',{revision:current.revision}),ownerToken:current.ownerToken};
  for(const op of ['OPEN_APPLICATION','ACTIVATE_CONTROL','INPUT_TEXT','SUBMIT_SEARCH'])await step(op);await stop();
  await assert.rejects(service.compile(current.id,current.ownerToken,{revision:current.revision,parameterizeQuery:false}),/PARAMETER_REVIEW_REQUIRED/);
});
test('G3 Worker /teach requires existing bearer auth, rejects foreign Origin and unknown operations',async()=>{
  const url='http://127.0.0.1:'+address.port+'/teach';
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+address.token,Origin:'http://localhost'},body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+address.token},body:JSON.stringify({type:'HOME'})})).status,400);
});
test('G3 lost OPEN response retains physical DB ownership, never repeats admission, explicit original Worker cleanup is required',async()=>{
  let admitted,calls=0;
  const uncertain=compose(async command=>{const response=await transport(command);if(command.type==='OPEN'){admitted=response;calls++;throw new LiveTeachError('WORKER_UNAVAILABLE_OR_OUTCOME_UNKNOWN');}return response;});
  const payload=openPayload(),client=randomUUID();
  try{
    await assert.rejects(uncertain.live.open(payload,client),/OUTCOME_UNKNOWN/);
    await assert.rejects(uncertain.live.open(payload,client),/OUTCOME_UNKNOWN/);assert.equal(calls,1);assert.equal(dispatches,0);
    const owned=await uncertain.repository.getOwnedSession(physicalId);assert.equal(owned.status,'INTERRUPTED');assert.equal(owned.ownership,'RETAINED_PENDING_CLEANUP');
    await assert.rejects(service.open(openPayload(),randomUUID()),/BUSY/);assert.equal(reservations,1);
    // Fixture-only handoff of the genuine original capability simulates explicit
    // owner recovery; no receipt or cleanup assertion is manufactured.
    const recovered=await uncertain.live.recoverCleanup({id:owned.id,leaseId:admitted.leaseId},admitted.ownerToken);
    assert.equal(recovered.database.ownership,'RELEASED');assert.equal(nativeClosed,1);
  }finally{if(admitted&&nativeClosed===0)await transport({type:'CANCEL',leaseId:admitted.leaseId,ownerToken:admitted.ownerToken});}
});

test('G3 physical annotation persists honest provenance and never dispatches or becomes a verified receipt',async()=>{
 await open();const sessionId=current.id,annotationId=randomUUID(),recordDirectory=path.resolve('data/teach-mode/observations',sessionId);
 try{const result=await service.annotate(sessionId,current.ownerToken,{requestId:annotationId,choice:'SEARCH_BUTTON',physicalActionConfirmed:true});assert.equal(dispatches,0);assert.equal(result.receipts.length,0);assert.equal(result.annotations[0].verification,'UNVERIFIED');
 const persisted=JSON.parse(fs.readFileSync(path.join(recordDirectory,annotationId+'.json'),'utf8'));assert.equal(persisted.annotation.provenance,'HUMAN_ANNOTATED');assert.equal(persisted.nativeDispatchReceipt,null);assert.equal(persisted.missingObservationReason,'NO_NATIVE_EVENT');
 await service.annotate(sessionId,current.ownerToken,{requestId:annotationId,choice:'SEARCH_BUTTON',physicalActionConfirmed:true});assert.equal(fs.readdirSync(recordDirectory).length,1);
 await stop();await assert.rejects(service.compile(sessionId,current.ownerToken,{revision:current.revision,parameterizeQuery:true}),/PHYSICAL_ACTION_VERIFICATION_REQUIRED/);
 }finally{assert.equal(path.dirname(recordDirectory),path.resolve('data/teach-mode/observations'));assert.match(path.basename(recordDirectory),/^[a-f0-9-]{36}$/);fs.rmSync(recordDirectory,{recursive:true,force:true});}
});
