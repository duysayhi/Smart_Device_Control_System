import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
const load=createRequire(import.meta.url),root=path.resolve('.');
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>{const original=m.require.bind(m);m.require=id=>original(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:f}).outputText,f);};
export const uiNodes=n=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(uiNodes):[n,...uiNodes(n.props?.children)];
export const uiText=n=>n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(uiText).join(''):typeof n==='object'?uiText(n.props?.children):String(n);
export function consoleHarness(props,relative='components/skills/SkillReplayConsole.tsx',exportName='SkillReplayConsole'){
  const slots=[],effects=new Map();let cursor=0,tree;
  const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const hooks={...React,useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},
    useRef(initial){const i=cursor++;slots[i]??={value:{current:initial}};return slots[i].value;},
    useEffect(effect,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))effects.set(i,{effect,deps});},
    useCallback(fn,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))slots[i]={value:fn,deps};return slots[i].value;}};
  const file=path.join(root,relative),original=Module._load;delete load.cache[file];
  Module._load=function(id,parent,main){return id==='react'&&parent?.filename===file?hooks:original.call(this,id,parent,main);};let C;
  try{C=load(file)[exportName];}finally{Module._load=original;}
  const render=()=>{cursor=0;tree=C(props);for(const [i,e] of effects){slots[i]?.cleanup?.();slots[i]={deps:e.deps,cleanup:e.effect()};}effects.clear();return tree;};
  const find=predicate=>{const n=uiNodes(tree).find(predicate);assert.ok(n,'Expected console control');return n;};
  return {render,find,get tree(){return tree;},button:label=>find(n=>n.type==='button'&&uiText(n)===label),async settle(){for(let i=0;i<8;i++){await new Promise(setImmediate);render();}},close(){for(const slot of slots)slot?.cleanup?.();}};
}
export {load};
