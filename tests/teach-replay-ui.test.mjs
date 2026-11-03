import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const load=createRequire(import.meta.url),file=path.resolve('components/skills/SkillReplayPreview.tsx');
const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file}).outputText;
const props={skillId:'11111111-1111-4111-8111-111111111111',version:1,definition:{parameters:{query:{type:'string',required:true,maxLength:80}}}};
function component(hooks=React){const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m.require=id=>id==='react'?hooks:load(id);m._compile(source,file);return m.exports.SkillReplayPreview;}
const nodes=n=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props?.children):String(n);
test('G5 preview SSR has no Worker fetch, real execution button or VERIFIED claim',()=>{
  const old=global.fetch;global.fetch=()=>assert.fail('No fetch during preview SSR');
  try{const html=renderToStaticMarkup(React.createElement(component(),props));assert.match(html,/Offline Replay Preview/);assert.match(html,/EXPERIMENTAL/);assert.match(html,/không chạy Android/);assert.doesNotMatch(html,/SUPERVISED|Chạy Android/);assert.equal((html.match(/<button/g)||[]).length,1);}finally{global.fetch=old;}
});
test('G5 preview form double submit issues one app fetch, displays NOT_DISPATCHED and never auto-retries an error',async()=>{
  let cursor=0,tree,calls=0,release;const slots=[];
  const hooks={...React,useState(initial){const i=cursor++;if(!slots[i])slots[i]={v:initial};return [slots[i].v,v=>{slots[i].v=typeof v==='function'?v(slots[i].v):v;}];},useRef(initial){const i=cursor++;slots[i]??={v:{current:initial}};return slots[i].v;}};
  const C=component(hooks),render=()=>{cursor=0;tree=C(props);},find=predicate=>{const n=nodes(tree).find(predicate);assert.ok(n);return n;},old=global.fetch;
  global.fetch=async(url,init)=>{calls++;assert.equal(url,'/api/skills/'+props.skillId+'/versions/1/replay');assert.deepEqual(JSON.parse(init.body),{mode:'OFFLINE_PREVIEW',parameters:{query:'lập trình Python'}});await new Promise(r=>{release=r;});return Response.json({explanation:'Static plan',compatibility:{supported:true,issues:[]},steps:[{id:'s1',operation:'SUBMIT_SEARCH',status:'NOT_DISPATCHED',preconditions:['FRESH_OBSERVATION'],postcondition:'SEARCH_OUTCOME_MATCHES'}]});};
  try{render();find(n=>n.type==='input').props.onChange({target:{value:'lập trình Python'}});render();const submit=find(n=>n.type==='form').props.onSubmit;
    submit({preventDefault(){}});submit({preventDefault(){}});render();assert.equal(calls,1);assert.equal(find(n=>n.type==='button').props.disabled,true);release();for(let i=0;i<4;i++)await new Promise(setImmediate);render();assert.match(text(tree),/NOT_DISPATCHED/);assert.match(text(tree),/FRESH_OBSERVATION/);
    global.fetch=async()=>{calls++;throw Error('synthetic-private-error');};find(n=>n.type==='form').props.onSubmit({preventDefault(){}});for(let i=0;i<4;i++)await new Promise(setImmediate);render();assert.equal(calls,2);assert.match(text(tree),/chưa gửi thao tác Android/);assert.doesNotMatch(text(tree),/synthetic-private-error/);
  }finally{global.fetch=old;}
});
