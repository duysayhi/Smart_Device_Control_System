import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import ts from 'typescript';
const load = createRequire(import.meta.url);
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);
const {compileSkill}=load('../lib/skills/skill-compiler.ts');
const {validateSkill}=load('../lib/skills/skill-validator.ts');
const field={semanticRole:'search_field',label:'Search',containerRole:'search'};
const entry={semanticRole:'search_action',label:'Search',containerRole:'toolbar'};
const sample=()=>({name:'YouTube search',appAlias:'youtube',actions:[{operation:'OPEN_APPLICATION',appRef:'youtube'},{operation:'ACTIVATE_CONTROL',target:entry,purpose:'SEARCH'},{operation:'INPUT_TEXT',target:field,value:'OpenAI'},{operation:'SUBMIT_SEARCH'}]});
test('C4 Dashboard semantic demonstration compiles to four validated steps and only a query parameter',()=>{
  const r=compileSkill(sample());assert.equal(r.status,'DRAFT');assert.equal(r.validation.ok,true);assert.equal(r.validation.maxStatus,'PENDING_VALIDATION');
  assert.deepEqual(r.draft.steps.map(s=>s.operation),['OPEN_APPLICATION','ACTIVATE_CONTROL','INPUT_TEXT','SUBMIT_SEARCH']);
  assert.deepEqual(Object.keys(r.draft.parameters),['query']);assert.deepEqual(r.draft.steps[2].arguments.value,{param:'query'});
  assert.deepEqual(r.draft.steps[3].verify,{kind:'SEARCH_OUTCOME_MATCHES',scope:'s2',value:{param:'query'}});assert.equal(JSON.stringify(r).includes('OpenAI'),false);
  assert.equal(validateSkill(r.draft).ok,true);assert.equal(r.reviewRequired,true);assert.match(r.limitations[0],/Video thứ N/);
});
test('C4 exact Vietnamese/English sample queries produce the same parameterized DSL without a model',()=>{
  const a=sample(),b=sample();b.actions[2].value='nhạc piano';assert.deepEqual(compileSkill(a),compileSkill(b));
});
for(const operation of ['TAP_POINT','SWIPE','HOME','PRESS_KEY','SELECT_SEARCH_RESULT','PLAY_VIDEO','UNKNOWN_OPERATION','DELETE_PHOTOS'])test('C4 rejects entire demonstration, never drops an unsupported/destructive step: '+operation,()=>{
  const input=sample();input.actions.push({operation});const r=compileSkill(input);assert.equal(r.status,'REJECTED');assert.equal(r.draft,undefined);
});
for(const key of ['bounds','rawPoint','raw_point','tapPoint','point','coordinates','elementId','candidateId','grant','proof','verified'])test('C4 rejects deep live runtime key '+key,()=>{
  const input=sample();input.extra={a:[{b:{[key]:'synthetic'}}]};const r=compileSkill(input);assert.equal(r.status,'REJECTED');assert.equal(r.errors.some(e=>e.code==='FORBIDDEN_KEY'),true);
});
for(const mode of ['purpose','missing-field','repeated-input'])test('C4 ambiguity produces review and no incomplete DSL: '+mode,()=>{
  const input=sample();if(mode==='purpose')delete input.actions[1].purpose;
  if(mode==='missing-field')input.actions=input.actions.slice(0,2);
  if(mode==='repeated-input')input.actions.splice(3,0,{...input.actions[2],value:'Other query'});
  const r=compileSkill(input);assert.equal(r.status,'AMBIGUOUS');assert.equal(r.draft,undefined);assert.equal(r.reviewRequired,true);assert.ok(r.review.length);
});
test('C4 deterministic, immutable input and no console/I/O/model entry points',()=>{
  const input=sample();Object.freeze(input.actions);Object.freeze(input);const a=compileSkill(input),b=compileSkill(input);assert.deepEqual(a,b);assert.equal(input.actions[2].value,'OpenAI');
  const source=fs.readFileSync(new URL('../lib/skills/skill-compiler.ts',import.meta.url),'utf8');assert.equal(/node:fs|child_process|process\.env|\bfetch\s*\(|\bconsole\.|Date\.now|Math\.random/.test(source),false);
});
test('T9 compiler refuses a secret before parameterization and never echoes input in diagnostics',()=>{
  const input=sample(),secret='token=synthetic-private-parameter';input.actions[2].value=secret;const r=compileSkill(input);assert.equal(r.status,'REJECTED');assert.equal(JSON.stringify(r).includes(secret),false);
});
test('T7 navigation cannot disguise data deletion',()=>{
  const input=sample();input.actions[1]={operation:'ACTIVATE_CONTROL',purpose:'NAVIGATION',target:{semanticRole:'navigation',label:'Xóa hết ảnh',containerRole:'navigation'}};
  const r=compileSkill(input);assert.equal(r.status,'REJECTED');assert.ok(r.errors.some(e=>e.code==='HARD_DENY'));
});
test('C4 unknown verifier and excessive timeout remain rejected by C2 validator',()=>{
  const input=sample();input.actions.push({operation:'ASSERT_UI',predicate:{kind:'MAGIC_SUCCESS'}});assert.equal(compileSkill(input).status,'REJECTED');
  const time=sample();time.actions.forEach(a=>a.timeoutMs=40000);const r=compileSkill(time);assert.equal(r.status,'REJECTED');assert.ok(r.errors.some(e=>e.code==='TIMEOUT_LIMIT'));
});
