import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createReplayFixture,recordedSearchEnvelope} from './helpers/teach-replay-fixture.mjs';
const load=createRequire(import.meta.url),{compileRecordedSkill}=load('../lib/skills/recorded-skill-compiler.ts');
const layouts=[
  {name:'720p-en',model:'fixture-720',width:720,height:1280},
  {name:'1080p-vn',model:'fixture-1080',width:1080,height:1920,label:'Tìm kiếm',resourceId:'icon_42',hierarchy:true,moved:true},
  {name:'landscape-vn',model:'fixture-landscape',width:1920,height:1080,label:'Tìm kiếm',resourceId:'entry_17',hierarchy:true,extra:true,changedResults:true,moved:true},
  {name:'small-540',model:'fixture-small',width:540,height:960,resourceId:'action_12',hierarchy:true,extra:true},
  {name:'popup-1440',model:'fixture-popup',width:1440,height:2560,label:'Tìm kiếm',popup:true,changedResults:true},
];
for(const variant of layouts)test('G6 SIMULATED_UI / SIMULATED_RECEIPT / OFFLINE_TEST: '+variant.name,async()=>{
  const f=await createReplayFixture(variant);try{const original=structuredClone(f.definition);await f.start();const result=await f.poll();
    assert.equal(result.checkpoint.status,'COMPLETED',JSON.stringify(result));assert.equal(result.checkpoint.provenance,'SIMULATED_RECEIPT');assert.equal(result.checkpoint.verifiedSteps.length,4);
    assert.equal(f.metrics.dispatches,variant.popup?4:3);assert.equal(f.metrics.inputs,1);assert.equal(f.metrics.submits,1);assert.equal(f.metrics.released,1);assert.equal(f.metrics.closed,1);assert.equal(f.query,'hải dương học');assert.deepEqual(f.definition,original);
    assert.equal(result.checkpoint.recoveryCount,variant.popup?1:0);assert.ok(result.history.events.some(e=>e.kind==='PORTABILITY_RESOLVED'));assert.ok(result.history.events.some(e=>e.kind==='VERIFICATION'&&e.outcome==='PASSED'));
    if(variant.label)assert.ok(result.history.events.some(e=>e.match==='SEARCH_LABEL_EQUIVALENT'));
  }finally{await f.close();}
});
for(const kind of ['missing','duplicate','duplicateIds','stale','identityChanged','unknown'])test('G6 native boundary fail closed: '+kind,async()=>{
  const f=await createReplayFixture({name:kind,[kind]:true,hold:kind==='identityChanged'});try{
    await f.start();if(kind==='identityChanged'){f.controls.identityChanged=true;f.controls.release();}const result=await f.poll();
    assert.notEqual(result.checkpoint.status,'COMPLETED');assert.equal(f.metrics.dispatches,kind==='unknown'?1:0);assert.equal(f.metrics.inputs,0);assert.equal(f.metrics.released,1);
    if(kind==='unknown'){assert.equal(result.checkpoint.status,'UNKNOWN_EFFECT');assert.equal(result.checkpoint.pending.dispatch,'UNKNOWN');}
    if(kind==='duplicate')assert.equal(result.checkpoint.reason,'SEMANTIC_TARGET_AMBIGUOUS');
  }finally{await f.close();}
});
test('G5.1 owner revocation plus cleanup journal failure is BLOCKED with no unhandled rejection or false cancellation success',async()=>{
  const f=await createReplayFixture({name:'cancel-journal-fault',hold:true});let injected=false,patch;
  try{await f.start();for(let i=0;i<200&&!f.metrics.observations;i++)await new Promise(r=>setTimeout(r,5));assert.ok(f.metrics.observations);
    const rename=fs.rename;patch=mock.method(fs,'rename',async(from,to)=>{
      if(!injected&&path.resolve(String(to))===path.resolve(f.directory,'tasks.json')){const rows=JSON.parse(await fs.readFile(from,'utf8'));
        if(rows.some(row=>row.skillReplay?.checkpoint.ownership==='RELEASED')){injected=true;throw Object.assign(Error('synthetic IO fault'),{code:'EIO'});}}
      return rename(from,to);
    });
    await f.send('/tasks',{type:'SET_OWNER_TEST_MODE',deviceId:f.serial,physicalId:f.physicalId,enabled:false,authorizationId:f.mode.id});
    const result=await f.poll();assert.equal(injected,true);assert.equal(result.checkpoint.status,'INTERRUPTED');assert.equal(result.checkpoint.reason,'CHECKPOINT_STORAGE_UNAVAILABLE');assert.equal(f.metrics.dispatches,0);assert.equal(f.metrics.released,1);assert.equal(f.worker.registry.ownerTestModes().length,0);
  }finally{patch?.mock.restore();await f.close();}
});
test('G3_RECORDED→G4_COMPILER→G5_REPLAY→G6_PORTABILITY stays one contract chain on another simulated physical profile',async()=>{
  const recorded=recordedSearchEnvelope(),compilation=compileRecordedSkill(recorded),original=structuredClone(compilation.compilation.draft);
  const f=await createReplayFixture({name:'recorded-cross-profile',model:'other-fixture',label:'Tìm kiếm',width:1080,height:1920,hierarchy:true,definition:original});
  try{await f.start({query:'lập trình Python'});const result=await f.poll();assert.equal(result.checkpoint.status,'COMPLETED');assert.equal(compilation.provenance,'OFFLINE_TEST');assert.equal(result.checkpoint.provenance,'SIMULATED_RECEIPT');
    assert.notEqual(result.checkpoint.binding.physicalId,recorded.physicalId);assert.deepEqual(f.definition,original);assert.equal(f.metrics.inputs,1);assert.equal(f.metrics.submits,1);assert.ok(result.history.events.some(e=>e.match==='SEARCH_LABEL_EQUIVALENT'));
  }finally{await f.close();}
});
