import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
const load=createRequire(import.meta.url),root=path.resolve('.');
Module._extensions['.ts']=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);};
const {compileSkill}=load('../lib/skills/skill-compiler.ts');
const {compileRecordedSkill}=load('../lib/skills/recorded-skill-compiler.ts');
const {loadSkillProgram,bindSkillParameters,semanticTargetMatches}=load('../lib/skills/skill-program.ts');
const {FORBIDDEN_KEYS}=load('../lib/skills/skill-safety.ts');
const search={semanticRole:'search_action',label:'Search',containerRole:'toolbar'},field={semanticRole:'search_field',label:'Search',containerRole:'search'};
const actions=[{operation:'OPEN_APPLICATION',appRef:'youtube'},{operation:'ACTIVATE_CONTROL',purpose:'SEARCH',target:search},{operation:'INPUT_TEXT',target:field,value:'marine biology'},{operation:'SUBMIT_SEARCH'}];
const definition=()=>compileSkill({name:'Search skill',appAlias:'youtube',actions}).draft;
function envelope(){
  const context={recordingRef:randomUUID(),deviceId:'OFFLINE-A',physicalId:'android:'+'a'.repeat(64),executionId:randomUUID(),sessionId:'OFFLINE-SESSION'};
  const snapshot={nodes:[],redactionStatus:'CAPTURE_SAFETY_UNKNOWN',reasons:['PRIVACY_FLAGS_UNPROVEN'],captureAllowed:false};
  return {contractVersion:1,name:'Search skill',appAlias:'youtube',origin:'SIMULATED_RECEIPT',ownerParameterizationConfirmed:true,...context,
    actions:actions.map((action,index)=>({order:index+1,persistence:'PERSISTED',receipt:{...context,id:randomUUID(),requestId:randomUUID(),leaseId:context.recordingRef,operation:action.operation,dispatch:index?'ACK':'NOT_SENT',verification:'PASSED',evidenceId:randomUUID(),at:Date.now(),action:structuredClone(action),before:snapshot,after:snapshot,beforeSnapshotId:randomUUID(),afterSnapshotId:randomUUID(),provenance:'SIMULATED_RECEIPT'}}))};
}
test('G3_TO_G4_TO_G5_CONTRACT_COMPATIBILITY: recorded receipt envelope compiles losslessly to unchanged v1 DSL',()=>{
  const input=envelope(),before=structuredClone(input),result=compileRecordedSkill(input);
  assert.equal(result.provenance,'OFFLINE_TEST');assert.equal(result.maxStatus,'PENDING_VALIDATION');assert.equal(result.compilation.status,'DRAFT');
  assert.deepEqual(result.compilation.draft,definition());assert.deepEqual(input,before);assert.deepEqual(compileRecordedSkill(input),result);
  assert.equal(result.evidenceReferences.length,4);assert.equal(result.program.contractVersion,1);assert.equal(result.program.compatibility.realDevice,'UNVERIFIED');
  assert.ok(!JSON.stringify(result.compilation.draft).includes('marine biology'));
  assert.deepEqual(result.program.steps[2].preconditions,['DEVICE_IDENTITY','OWNED_SESSION','FRESH_OBSERVATION','APP_FOREGROUND','UNIQUE_SEMANTIC_TARGET','SEARCH_SCOPE']);
});
for(const mutation of ['unknown','unverified','not-persisted','wrong-session','wrong-device','wrong-order','duplicate','missing-after','same-observation','wrong-operation','unattested','spoof-native'])test('G4 provenance rejects '+mutation,()=>{
  const e=envelope(),r=e.actions[1].receipt;
  if(mutation==='unknown')r.dispatch='UNKNOWN';if(mutation==='unverified')r.verification='FAILED';if(mutation==='not-persisted')e.actions[1].persistence='NOT_PERSISTED';
  if(mutation==='wrong-session')r.sessionId='OTHER';if(mutation==='wrong-device')r.physicalId='android:'+'b'.repeat(64);if(mutation==='wrong-order')e.actions[1].order=8;
  if(mutation==='duplicate')r.requestId=e.actions[0].receipt.requestId;if(mutation==='missing-after')delete r.afterSnapshotId;if(mutation==='same-observation')r.afterSnapshotId=r.beforeSnapshotId;
  if(mutation==='wrong-operation')r.operation='BACK';if(mutation==='unattested')delete r.provenance;if(mutation==='spoof-native')e.origin='ANDROID_RUNTIME';
  assert.throws(()=>compileRecordedSkill(e));
});
test('G4 parameter extraction requires owner review; query literals never become portable coordinates or authority',()=>{
  const e=envelope();e.ownerParameterizationConfirmed=false;assert.throws(()=>compileRecordedSkill(e),/PARAMETER_REVIEW_REQUIRED/);
  for(const key of FORBIDDEN_KEYS){const bad=envelope();bad.actions[1].receipt.action.target.extra=[{[key]:'synthetic-private-value'}];assert.throws(()=>compileRecordedSkill(bad));}
});
for(const query of ['OpenAI','lập trình Python','C++ & AI? #42','hải dương học 🌊'])test('G4 exact parameter binding: '+query,()=>{
  const p=loadSkillProgram(definition()),before=structuredClone(p),bound=bindSkillParameters(p,{query});
  assert.equal(bound.steps[2].arguments.value,query);assert.equal(bound.steps[2].verify.expected,query);assert.equal(bound.steps[3].verify.value,query);assert.deepEqual(p,before);
});
for(const value of [undefined,'','   ','x'.repeat(501),123,'password=synthetic-secret','gsk_syntheticSecretNeverStore01234567'])test('G4 invalid/sensitive parameters fail with sanitized diagnostics: '+typeof value,()=>{
  assert.throws(()=>bindSkillParameters(loadSkillProgram(definition()),value===undefined?{}:{query:value}),error=>/^PARAMETER_/.test(error.code)&&!error.message.includes('synthetic-secret'));
});
test('G4 rejects extra parameters and unsupported schema/ordinal rather than truncating or silently upgrading',()=>{
  assert.throws(()=>bindSkillParameters(loadSkillProgram(definition()),{query:'OpenAI',extra:'value'}),/PARAMETER_UNKNOWN/);
  assert.throws(()=>loadSkillProgram({...definition(),schemaVersion:2}),/INCOMPATIBLE/);
  const bad=definition();bad.steps.push({...bad.steps[0],id:'ordinal',operation:'SELECT_RESULT_BY_ORDINAL',arguments:{ordinal:3}});assert.throws(()=>loadSkillProgram(bad));
});
test('G2 semantic fixtures: search stays runnable; video legacy operations preserve meaning and report terminal verifier limitation',()=>{
  // Reconstructed semantic fixtures, not exports or re-saves of either live Neon row.
  const oldSearch=definition(),copy=structuredClone(oldSearch);assert.equal(loadSkillProgram(oldSearch).compatibility.supported,true);assert.deepEqual(oldSearch,copy);
  const video=compileSkill({name:'video',appAlias:'youtube',actions:[actions[0],actions[0],{operation:'SCROLL_CONTAINER',target:{semanticRole:'scroll_container',label:'Observed container',containerRole:'results'},direction:'DOWN',maxAttempts:1},{operation:'BACK',reason:'DISMISS_BENIGN'}]}).draft;
  assert.ok(video);const program=loadSkillProgram(video);assert.equal(program.compatibility.supported,false);assert.equal(program.compatibility.issues[0].code,'TERMINAL_VERIFIER_REQUIRED');
  assert.deepEqual(program.definition.steps.map(s=>s.operation),['OPEN_APPLICATION','OPEN_APPLICATION','SCROLL_CONTAINER','BACK']);
});
test('G4 semantic matching tolerates resource-id variation without accepting different roles or ambiguous labels',()=>{
  assert.equal(semanticTargetMatches({...search,resourceIdHint:'old:id/search'},{...search,resourceIdHint:'new:id/query'}),true);
  assert.equal(semanticTargetMatches(search,field),false);assert.equal(semanticTargetMatches(search,{...search,label:'Delete'}),false);
});
