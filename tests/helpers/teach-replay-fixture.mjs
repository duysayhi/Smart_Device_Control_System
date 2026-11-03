import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
const load=createRequire(import.meta.url),root=path.resolve('.');
Module._extensions['.ts']=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);};
const {startWorker}=load('../../lib/android/agent/worker-server.ts');
const {consumeEffectGrant}=load('../../lib/android/agent/effect-grants.ts');
const {beforeSearchDispatch,noteSearchQueryEntered,noteSearchSubmitted,freshSearchTarget}=load('../../lib/android/agent/generic-search.ts');
const {GroundedInteractionFailure}=load('../../lib/android/grounded-interactions.ts');
const {geometryFingerprint}=load('../../lib/android/visual-grounding.ts');
const {compileSkill}=load('../../lib/skills/skill-compiler.ts');
const {loadSkillProgram}=load('../../lib/skills/skill-program.ts');
export const searchActions=[{operation:'OPEN_APPLICATION',appRef:'searchapp'},{operation:'ACTIVATE_CONTROL',purpose:'SEARCH',target:{semanticRole:'search_action',label:'Search',containerRole:'toolbar'}},{operation:'INPUT_TEXT',target:{semanticRole:'search_field',label:'Search',containerRole:'search'},value:'marine biology'},{operation:'SUBMIT_SEARCH'}];
export function recordedSearchEnvelope(){
  const context={recordingRef:randomUUID(),deviceId:'SIMULATED-RECORDED',physicalId:'android:'+'e'.repeat(64),executionId:randomUUID(),sessionId:'SIMULATED-RECORDED-SESSION'},safe={nodes:[],redactionStatus:'CAPTURE_SAFETY_UNKNOWN',reasons:['PRIVACY_FLAGS_UNPROVEN'],captureAllowed:false};
  return {contractVersion:1,name:'Recorded portable search',appAlias:'searchapp',origin:'SIMULATED_RECEIPT',ownerParameterizationConfirmed:true,...context,actions:searchActions.map((action,index)=>({order:index+1,persistence:'PERSISTED',receipt:{...context,id:randomUUID(),requestId:randomUUID(),leaseId:context.recordingRef,operation:action.operation,dispatch:index?'ACK':'NOT_SENT',verification:'PASSED',evidenceId:randomUUID(),at:Date.now(),action:structuredClone(action),before:safe,after:safe,beforeSnapshotId:randomUUID(),afterSnapshotId:randomUUID(),provenance:'SIMULATED_RECEIPT'}}))};
}
/** SIMULATED_UI/RECEIPT only. Existing Worker/grants/verification registry; no driver or model connection. */
export async function createReplayFixture(variant={},directory=path.join(root,'coverage/g516-2026-11-01/worker-'+randomUUID())){
  const label=variant.label??'Search',pkg='org.fixture.portable',serial='OFFLINE-'+(variant.name??randomUUID()),manufacturer='SIMULATED',model=variant.model??'fixture-model';
  const physicalId='android:'+createHash('sha256').update(JSON.stringify([serial,manufacturer,model])).digest('hex');
  const controls={hold:!!variant.hold,release(){controls.hold=false;releaseHold?.();},identityChanged:false};
  const metrics={observations:0,dispatches:0,inputs:0,submits:0,backs:0,closed:0,reserved:0,released:0,modelCalls:0};
  let stage='home',query='',worker,address,opened,releaseHold,firstObserve=true;
  const width=variant.width??720,height=variant.height??1280;
  function snapshot(){
    const rows=[],add=(row,parentIndex)=>{const i=rows.length;rows.push({text:'',description:'',hint:'',resourceId:'',packageName:pkg,className:'android.widget.TextView',enabled:true,displayed:true,clickable:false,focused:false,password:false,bounds:[20,20+i*45,width-20,55+i*45],...(parentIndex===undefined?{}:{parentIndex}),...row});return i;};
    const parent=variant.hierarchy?add({className:'android.widget.FrameLayout',bounds:[0,0,width,height]}):undefined;
    if(variant.extra) {add({text:'Sponsored',bounds:[0,height-70,width,height-20]},parent);add({text:'Decoration'},parent);}
    const field=()=>add({hint:label,text:query,className:'android.widget.EditText',resourceId:pkg+':id/'+(variant.resourceId??'search_query'),focused:true,clickable:true,bounds:[20,20,width-20,75]},parent);
    if(stage==='popup'){add({text:'Information',className:'android.app.Dialog',resourceId:'android:id/dialog',bounds:[20,20,width-20,200]},parent);add({text:'Temporary notice'},parent);}
    else if(stage==='home'){
      if(!variant.missing){const row={description:label,className:'android.widget.ImageButton',clickable:true,resourceId:pkg+':id/'+(variant.resourceId??'search_button'),bounds:variant.moved?[width-120,100,width-20,160]:[20,20,120,80]};add(row,parent);if(variant.duplicate||variant.duplicateIds)add({...row,description:variant.duplicateIds?label:label==='Search'?'Tìm kiếm':'Search',resourceId:variant.duplicateIds?row.resourceId:pkg+':id/other_search_button',bounds:[150,20,250,80]},parent);}
    }else {field();if(stage==='results'){const resultParent=add({className:variant.hierarchy?'android.widget.ListView':'androidx.recyclerview.widget.RecyclerView',resourceId:pkg+':id/search_results',bounds:[0,100,width,height-10]},parent);
      add({text:variant.changedResults?'Result generation '+metrics.observations:'Offline result',clickable:true,bounds:[20,120,width-20,180]},resultParent);
      if(variant.extra)add({text:'Sponsored result',clickable:true,bounds:[20,200,width-20,250]},resultParent);
    }}
    const snapshotId=randomUUID();return {deviceSerial:serial,snapshotId,timestamp:Date.now()-(variant.stale?6000:0),foregroundPackage:pkg,observationStatus:'OBSERVED',source:'APPIUM',evidenceSource:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',viewport:{x:0,y:0,width,height},nodes:rows,elements:rows.map((n,i)=>({...n,elementId:snapshotId+':'+i}))};
  }
  const adapter={discover:async()=>[{serial,status:'device',physicalId:controls.identityChanged?'android:'+'f'.repeat(64):physicalId,identityVerified:true,model}],teachIdentity:async()=>({serial,physicalId,hardwareSerial:serial,manufacturer,model}),
    reserve:async()=>{metrics.reserved++;return async()=>{metrics.released++;};},plan:async()=>assert.fail('No model'),open:async()=>assert.fail('No parallel executor'),
    v2:()=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial,requestedName:'searchapp',packageName:pkg,component:pkg+'/.Main'}})},open:async()=>({backend:'appium',sessionId:()=>metrics.closed?undefined:'SIMULATED-'+serial,
      observe:async(signal)=>{metrics.observations++;if(controls.hold&&firstObserve){firstObserve=false;await new Promise((resolve,reject)=>{releaseHold=resolve;signal?.addEventListener('abort',()=>reject(Error('fixture interrupted')),{once:true});});}return snapshot();},
      execute:async()=>assert.fail('Fixture already foreground'),close:async()=>{metrics.closed++;},
      interactV2:async(grant)=>{
        consumeEffectGrant(grant,serial,'SIMULATED-'+serial);const c=grant.candidate,before=snapshot();
        if(c.fingerprint!==geometryFingerprint(before)||c.search&&!freshSearchTarget(c,before))throw new GroundedInteractionFailure('NOT_SENT','TARGET_CHANGED',Error('fixture stale target'));
        if(c.search)beforeSearchDispatch(c,before);metrics.dispatches++;
        if(variant.unknown)throw new GroundedInteractionFailure('UNKNOWN','FIXTURE_TIMEOUT',Error('fixture effect unknown'));
        if(c.search?.phase==='OPEN')stage='input';
        if(c.search?.phase==='ENTER'){query=c.value;metrics.inputs++;noteSearchQueryEntered(c,before,snapshot());if(variant.popup)stage='popup';}
        if(c.search?.phase==='SUBMIT'){metrics.submits++;noteSearchSubmitted(c);stage='results';}
        if(c.action==='BACK'){metrics.backs++;stage='input';}return snapshot();
      },
    })})};
  worker=await startWorker({directory,adapter});address=JSON.parse(fs.readFileSync(path.join(directory,'address.json'),'utf8'));
  async function send(endpoint,command){const response=await fetch('http://127.0.0.1:'+address.port+endpoint,{method:'POST',headers:{Authorization:'Bearer '+address.token,'Content-Type':'application/json'},body:JSON.stringify(command)});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.code??'FIXTURE_REJECTED'),{code:body.code,status:response.status});return body;}
  await send('/tasks',{type:'SET_OWNER_TEST_MODE',deviceId:serial,physicalId,enabled:true});
  const mode=worker.registry.ownerTestModes()[0];
  const definition=structuredClone(variant.definition??compileSkill({name:'Portable search — OFFLINE_TEST',appAlias:'searchapp',actions:searchActions}).draft);
  if(variant.hold)for(const [index,step] of definition.steps.entries())step.timeoutMs=index===0?90000:10000;
  async function start(params={query:'hải dương học'},stored){const program=loadSkillProgram(definition);opened=await send('/replay',{type:'OPEN',requestId:randomUUID(),deviceId:serial,expectedPhysicalId:physicalId,skillId:stored?.skill.id??randomUUID(),versionId:stored?.version.id??randomUUID(),version:stored?.version.version??1,contentHash:stored?.version.contentHash??'a'.repeat(64),definitionDigest:program.definitionDigest,definition,parameters:params,authorizationId:mode.id,confirmed:true});return opened;}
  async function state(){return send('/replay',{type:'STATE',leaseId:opened.leaseId,ownerToken:opened.ownerToken});}
  async function poll(){for(let i=0;i<300;i++){const value=await state();if(['COMPLETED','BLOCKED','UNKNOWN_EFFECT','INTERRUPTED','CANCELLED'].includes(value.checkpoint.status)&&value.checkpoint.ownership!=='HELD')return value;await new Promise(r=>setTimeout(r,10));}throw Error('FIXTURE_DID_NOT_SETTLE');}
  async function close(){controls.release();if(opened)await send('/replay',{type:'CANCEL',leaseId:opened.leaseId,ownerToken:opened.ownerToken}).catch(()=>undefined);for(const owner of worker.registry.ownerTestModes())await send('/tasks',{type:'SET_OWNER_TEST_MODE',deviceId:serial,physicalId,enabled:false,authorizationId:owner.id});await worker.shutdown();}
  return {serial,physicalId,mode,definition,metrics,controls,worker,directory,start,state,poll,send,close,get opened(){return opened;},set opened(value){opened=value;},get query(){return query;}};
}
