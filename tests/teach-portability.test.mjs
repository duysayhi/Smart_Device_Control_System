import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
const load=createRequire(import.meta.url),root=path.resolve('.');
Module._extensions['.ts']=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);};
const {portableTargetMatch,resolvePortableTarget}=load('../lib/skills/skill-portability.ts');
const {compileSkill}=load('../lib/skills/skill-compiler.ts'),{compileRecordedSkill}=load('../lib/skills/recorded-skill-compiler.ts');
const {loadSkillProgram}=load('../lib/skills/skill-program.ts');
const {acceptReplaySnapshot,replayStepStatus,readReplayHandle,replaySafeToStartNew}=load('../lib/skills/replay-console-state.ts');
const {ReplayCheckpointSchema}=load('../lib/skills/replay-schemas.ts');
const {skillReplayOptionsResponse}=load('../lib/skills/skill-replay-api.ts');
const target={semanticRole:'search_action',label:'Search',containerRole:'toolbar'};
const step={id:'s1',operation:'ACTIVATE_CONTROL',arguments:{target,purpose:'SEARCH'},verify:{kind:'STATE_CHANGED'},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'};
for(const label of ['Search','search','Tìm kiếm','TÌM KIẾM','tim kiem','Tìm kiếm'])test('G6 OFFLINE semantic search label: '+label,()=>{
  const actual={...target,label,resourceIdHint:'different.app:id/new_control'},before=structuredClone(actual),observation={candidates:[{id:'live-1',operation:'ACTIVATE_CONTROL',target:actual}]};
  assert.equal(resolvePortableTarget(step,observation).status,'RESOLVED');assert.deepEqual(actual,before);assert.deepEqual(resolvePortableTarget(step,observation),resolvePortableTarget(step,observation));
});
for(const mutation of ['wrong-role','wrong-container','arbitrary-label','id-only','duplicate','recovery-only','wrong-operation'])test('G6 OFFLINE fail closed: '+mutation,()=>{
  const c={id:'live-1',operation:'ACTIVATE_CONTROL',target:{...target}};
  if(mutation==='wrong-role')c.target.semanticRole='navigation';if(mutation==='wrong-container')c.target.containerRole='dialog';
  if(mutation==='arbitrary-label')c.target.label='Search and pay';if(mutation==='id-only')c.target.label='Other';if(mutation==='recovery-only')c.recovery='DISMISS_BENIGN';if(mutation==='wrong-operation')c.operation='INPUT_TEXT';
  const candidates=mutation==='duplicate'?[c,{...c,id:'other',target:{...target,label:'Tìm kiếm'}}]:[c];
  const result=resolvePortableTarget(step,{candidates});assert.equal(result.status,'BLOCKED');assert.equal(result.reason,mutation==='duplicate'?'SEMANTIC_TARGET_AMBIGUOUS':'SEMANTIC_TARGET_MISSING');
});
test('G6 missing targets, unresolved label parameters and translated arbitrary navigation never receive a coordinate fallback',()=>{
  assert.equal(resolvePortableTarget(step,{candidates:[]}).status,'BLOCKED');
  assert.equal(portableTargetMatch({...target,semanticRole:'navigation'},{...target,semanticRole:'navigation',label:'Tìm kiếm'}),undefined);
  assert.equal(portableTargetMatch({...target,label:undefined,labelParam:'query'},target),undefined);
  assert.equal(resolvePortableTarget({...step,operation:'SUBMIT_SEARCH',arguments:{scope:'s1'}},{candidates:[{id:'submit',operation:'SUBMIT_SEARCH'}]}).candidateId,'submit');
});
function definition(){return compileSkill({name:'Search',appAlias:'youtube',actions:[{operation:'OPEN_APPLICATION',appRef:'youtube'},{operation:'ACTIVATE_CONTROL',purpose:'SEARCH',target},{operation:'INPUT_TEXT',target:{semanticRole:'search_field',label:'Search',containerRole:'search'},value:'marine biology'},{operation:'SUBMIT_SEARCH'}]}).draft;}
function checkpoint(){return {contractVersion:1,binding:{skillId:randomUUID(),versionId:randomUUID(),version:1,contentHash:'a'.repeat(64),definitionDigest:'b'.repeat(64),executionId:randomUUID(),deviceId:'OFFLINE-A',physicalId:'android:'+'c'.repeat(64),sessionId:'OFFLINE-SESSION'},status:'PAUSED',revision:2,currentStep:0,observationGeneration:1,verifiedSteps:[],recoveryCount:0,ownership:'HELD',provenance:'SIMULATED_RECEIPT',signature:'d'.repeat(64)};}
test('G3→G4→G5→G6 contract compatibility preserves v1 DSL and separates synthetic receipt provenance',()=>{
  const d=definition(),before=structuredClone(d),program=loadSkillProgram(d);assert.equal(program.contractVersion,1);assert.deepEqual(program.definition,before);
  const action={operation:'OPEN_APPLICATION',appRef:'youtube'},context={recordingRef:randomUUID(),deviceId:'OFFLINE-A',physicalId:'android:'+'a'.repeat(64),executionId:randomUUID(),sessionId:'OFFLINE'};
  const safe={nodes:[],redactionStatus:'CAPTURE_SAFETY_UNKNOWN',reasons:['PRIVACY_FLAGS_UNPROVEN'],captureAllowed:false};
  const compiled=compileRecordedSkill({contractVersion:1,name:'Observed app',appAlias:'youtube',origin:'SIMULATED_RECEIPT',ownerParameterizationConfirmed:true,...context,actions:[{order:1,persistence:'PERSISTED',receipt:{...context,id:randomUUID(),requestId:randomUUID(),leaseId:randomUUID(),operation:'OPEN_APPLICATION',dispatch:'NOT_SENT',verification:'PASSED',evidenceId:randomUUID(),at:Date.now(),action,before:safe,after:safe,beforeSnapshotId:randomUUID(),afterSnapshotId:randomUUID(),provenance:'SIMULATED_RECEIPT'}}]});
  assert.equal(compiled.provenance,'OFFLINE_TEST');assert.equal(compiled.program.definition.schemaVersion,1);assert.equal(resolvePortableTarget(program.definition.steps[1],{candidates:[{id:'fresh-vn',operation:'ACTIVATE_CONTROL',target:{...target,label:'Tìm kiếm'}}]}).status,'RESOLVED');
  const cp=checkpoint();assert.equal(ReplayCheckpointSchema.safeParse(cp).success,true);assert.equal(cp.provenance,'SIMULATED_RECEIPT');
});
test('G5.1 presentation accepts only bound non-regressing checkpoints and exact verified prefix; ACK is not VERIFIED',()=>{
  const cp=checkpoint(),lease={kind:'LEASE',leaseId:randomUUID(),ownerToken:'a'.repeat(64),binding:cp.binding},d=definition(),view={checkpoint:cp};
  assert.equal(acceptReplaySnapshot(view,lease,d).checkpoint.status,'PAUSED');
  assert.throws(()=>acceptReplaySnapshot({...view,checkpoint:{...cp,binding:{...cp.binding,deviceId:'FOREIGN'}}},lease,d),/MISMATCH/);
  assert.throws(()=>acceptReplaySnapshot({...view,checkpoint:{...cp,revision:1}},lease,d,view),/MISMATCH/);
  assert.throws(()=>acceptReplaySnapshot({...view,checkpoint:{...cp,currentStep:1,verifiedSteps:[{stepId:'s3',evidenceId:randomUUID(),snapshotId:randomUUID()}]}},lease,d),/MISMATCH/);
  assert.equal(replayStepStatus('s1',0,{...cp,pending:{stepId:'s1',requestId:randomUUID(),dispatch:'ACK'}}),'ACK_UNVERIFIED');
  assert.equal(replaySafeToStartNew({...cp,status:'UNKNOWN_EFFECT',ownership:'RELEASED'}),false);
});
test('G5.1 storage excludes parameters and corrupt reconnect handles have sanitized diagnostics',()=>{
  const cp=checkpoint(),handle={kind:'LEASE',leaseId:randomUUID(),ownerToken:'a'.repeat(64),binding:cp.binding};
  assert.deepEqual(readReplayHandle({getItem:()=>JSON.stringify(handle)}),handle);
  for(const raw of ['synthetic-private-value',JSON.stringify({...handle,password:'synthetic-private-value'})])assert.throws(()=>readReplayHandle({getItem:()=>raw}),e=>e.message==='REPLAY_RECONNECT_REFERENCE_INVALID');
});
test('G5.1 native OFF capability read never calls Worker/DB and owner scope must match physical identity and expiry',async()=>{
  const req=()=>new Request('http://localhost/api/skills/replay'),never=async()=>assert.fail('OFF has no runtime IO');
  const off=await skillReplayOptionsResponse(req(),{supervisedAllowed:()=>false,runtime:never});assert.equal(off.status,200);assert.equal((await off.json()).supervisedEnabled,false);
  const state={devices:[{serial:'A',status:'device',identityVerified:true,physicalId:'android:'+'a'.repeat(64)}],ownerTestModes:[{id:randomUUID(),deviceId:'A',physicalId:'android:'+'b'.repeat(64),expiresAt:Date.now()+5000}]};
  const wrong=await skillReplayOptionsResponse(req(),{supervisedAllowed:()=>true,runtime:async()=>state});assert.equal((await wrong.json()).devices[0].authorizationId,undefined);
  state.ownerTestModes[0].physicalId=state.devices[0].physicalId;const valid=await skillReplayOptionsResponse(req(),{supervisedAllowed:()=>true,runtime:async()=>state});assert.equal((await valid.json()).devices[0].authorizationId,state.ownerTestModes[0].id);
  state.ownerTestModes[0].expiresAt=Date.now()-1;const expired=await skillReplayOptionsResponse(req(),{supervisedAllowed:()=>true,runtime:async()=>state});assert.equal((await expired.json()).devices[0].authorizationId,undefined);
  const foreign=await skillReplayOptionsResponse(new Request('http://localhost/api/skills/replay',{headers:{Origin:'https://untrusted.example'}}),{supervisedAllowed:()=>true,runtime:never});assert.equal(foreign.status,403);
});
