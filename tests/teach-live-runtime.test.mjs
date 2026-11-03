import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';
const load=createRequire(import.meta.url),root=path.resolve('.');
Module._extensions['.ts']=(m,f)=>{const old=m.require.bind(m);m.require=id=>old(id.startsWith('@/')?path.join(root,id.slice(2)):id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);};
const {mapFramePointer,uniqueControlAt}=load('../lib/skills/frame-geometry.ts');
const {focusedWindowPrivacy}=load('../lib/android/agent/teach-frame-privacy.ts');
const {TeachCommand}=load('../lib/android/agent/teach-contracts.ts');
const {TeachSession}=load('../lib/android/agent/teach-session.ts');
const {AgentBudget}=load('../lib/android/agent/budget.ts');
const {consumeEffectGrant}=load('../lib/android/agent/effect-grants.ts');
const {beforeSearchDispatch,noteSearchQueryEntered,noteSearchSubmitted}=load('../lib/android/agent/generic-search.ts');
const {GroundedInteractionFailure}=load('../lib/android/grounded-interactions.ts');

function fixture(options={}) {
  const pkg='org.unseen.catalog';let stage='start',text='',closed=0,cleanups=0,interactions=0,rotated=false,foreground=options.outside?'org.other':pkg;
  const controller=new AbortController();
  function view(){const snapshotId=randomUUID();const field={hint:'Search',resourceId:pkg+':id/query',className:'android.widget.EditText',focused:true,clickable:true,text};
    const rows=stage==='start'?[{description:'Search',className:'android.widget.ImageButton',clickable:true}]:stage==='input'?[field]:[field,{resourceId:pkg+':id/results',className:'androidx.recyclerview.widget.RecyclerView',bounds:[0,80,400,800]},{text:'Public result',clickable:true,parentIndex:1}];
    if(options.secret)rows.push({text:options.secret,className:'android.widget.EditText',hint:'Password',password:true,focused:false});
    const nodes=rows.map((r,i)=>({text:'',description:'',hint:'',resourceId:'',packageName:pkg,className:'android.widget.TextView',enabled:true,displayed:true,clickable:false,focused:false,password:false,bounds:[10,i*70+10,390,i*70+70],...r}));
    return {deviceSerial:'A',snapshotId,timestamp:Date.now(),foregroundPackage:foreground,observationStatus:'OBSERVED',source:'APPIUM',evidenceSource:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',viewport:{x:0,y:0,width:rotated?900:400,height:rotated?400:900},nodes,elements:nodes.map((n,i)=>({...n,elementId:snapshotId+':'+i}))};}
  const execution={backend:'appium',sessionId:()=>closed?undefined:'native-owned-session',observe:async()=>{if(options.observationFail)throw Error('synthetic driver timeout');return view();},execute:async action=>{assert.equal(options.outside,true);assert.deepEqual(action,{type:'OPEN_APP',app:pkg});foreground=pkg;interactions++;},close:async()=>{closed++;if(options.cleanupFail)throw Error('synthetic cleanup failure');},interactV2:async grant=>{
    consumeEffectGrant(grant,'A','native-owned-session');const c=grant.candidate,before=view();beforeSearchDispatch(c,before);interactions++;
    if(options.unknown)throw new GroundedInteractionFailure('UNKNOWN','DISPATCH_RPC',Error('synthetic-private-driver-detail'));
    if(c.search?.phase==='OPEN')stage='input';
    if(c.search?.phase==='ENTER'){text=c.value;noteSearchQueryEntered(c,before,view());}
    if(c.search?.phase==='SUBMIT'){noteSearchSubmitted(c);stage='results';}
    return view();}};
  const budget=new AgentBudget({reasoning:0});
  const session=new TeachSession(randomUUID(),'A','android:'+'a'.repeat(64),randomUUID(),'catalog',options.query??'marine biology',{serial:'A',packageName:pkg},execution,budget,controller.signal,
    {ready:async()=>options.locked?'UNLOCK_REQUIRED':'READY',privacy:async()=>options.privacy?options.privacy():options.safeWindow?'SAFE_WINDOW':'UNKNOWN',capture:async()=>{if(options.screenshot)return options.screenshot;throw Error('No screenshot expected in unknown privacy fixture');},cleanup:async()=>{cleanups++;}});
  const step=async(operation,value)=>{const frame=await session.frame();const control=frame.controls.find(c=>c.operation===operation);return session.step({type:'STEP',requestId:randomUUID(),leaseId:session.leaseId,ownerToken:session.ownerToken,frameId:frame.id,operation,...(control?{candidateId:control.id}:{}),...(value!==undefined?{value}:{})});};
  return {session,step,budget,rotate(){rotated=true;},get closed(){return closed;},get cleanups(){return cleanups;},get interactions(){return interactions;}};
}

test('G3 coordinate mapping respects letterboxing, offsets, scaling and rotated dimensions',()=>{
  const display={left:50,top:100,width:400,height:400};
  assert.equal(mapFramePointer(display,{width:400,height:900},{x:55,y:200}),undefined);
  assert.deepEqual(mapFramePointer(display,{width:400,height:900},{x:250,y:300}),{x:.5,y:.5});
  assert.deepEqual(mapFramePointer(display,{width:900,height:400},{x:250,y:300}),{x:.5,y:.5});
  assert.equal(mapFramePointer({...display,width:0},{width:400,height:900},{x:250,y:300}),undefined);
  assert.equal(mapFramePointer(display,{width:400,height:900},{x:NaN,y:300}),undefined);
});
test('G3 overlapping controls and letterbox gestures never choose an arbitrary target',()=>{
  const a={rectangle:[0,0,100,100]},b={rectangle:[0,0,200,200]};
  assert.equal(uniqueControlAt([a,b],{width:400,height:900},{x:.1,y:.1}),undefined);
  assert.equal(uniqueControlAt([a],{width:400,height:900},{x:1,y:0}),undefined);
  assert.equal(uniqueControlAt([a],{width:400,height:900},{x:.1,y:.1}),a);
});
test('G3 window privacy requires a bound focused window and complete explicit flags',()=>{
  const window=flags=>`Window #0 Window{abc u0 org.example/.Main}:\n mAttrs={ ty=BASE_APPLICATION fl=${flags} }\nmCurrentFocus=Window{abc u0 org.example/.Main}`;
  assert.equal(focusedWindowPrivacy(window('HARDWARE_ACCELERATED'),'org.example'),'SAFE_WINDOW');
  assert.equal(focusedWindowPrivacy(window('SECURE HARDWARE_ACCELERATED'),'org.example'),'SECURE_WINDOW');
  assert.equal(focusedWindowPrivacy(window('0x2000'),'org.example'),'SECURE_WINDOW');
  assert.equal(focusedWindowPrivacy(window('8192'),'org.example'),'UNKNOWN');
  assert.equal(focusedWindowPrivacy(window('HARDWARE_ACCELERATED'),'foreign.app'),'UNKNOWN');
  assert.equal(focusedWindowPrivacy('mCurrentFocus=null','org.example'),'UNKNOWN');
});
test('G3 closed command schema rejects grants, arbitrary keys, coordinates and foreign authority',()=>{
  const base={type:'STEP',requestId:randomUUID(),leaseId:randomUUID(),ownerToken:'a'.repeat(64),frameId:randomUUID(),operation:'BACK'};
  for(const extra of [{operation:'HOME'},{operation:'TAP_POINT'},{grant:{}},{receipt:{dispatch:'ACK'}},{verified:true},{rawPoint:{x:0,y:0}}])assert.equal(TeachCommand.safeParse({...base,...extra}).success,false);
  assert.equal(TeachCommand.safeParse({...base,touch:{x:2,y:0}}).success,false);
});
test('G3 observed foreground is NOT_SENT with independent verification, never a fabricated ACK',async()=>{
  const f=fixture();try{const receipt=await f.step('OPEN_APPLICATION');assert.equal(receipt.dispatch,'NOT_SENT');assert.equal(receipt.verification,'PASSED');assert.equal(f.interactions,0);assert.equal(f.session.view().modelCalls,0);}finally{await f.session.close();}
  assert.equal(f.closed,1);assert.equal(f.cleanups,1);assert.equal(f.session.view().sessionId,'native-owned-session');
});
test('G3 one click repeated concurrently returns the same receipt and consumes the grant once',async()=>{
  const f=fixture();try{const frame=await f.session.frame(),control=frame.controls.find(c=>c.operation==='ACTIVATE_CONTROL');assert.ok(control);
    const command={type:'STEP',requestId:randomUUID(),leaseId:f.session.leaseId,ownerToken:f.session.ownerToken,frameId:frame.id,operation:'ACTIVATE_CONTROL',candidateId:control.id};
    const [a,b]=await Promise.all([f.session.step(command),f.session.step(command)]);assert.deepEqual(a,b);assert.equal(a.dispatch,'ACK');assert.equal(a.verification,'PASSED');assert.equal(f.interactions,1);
    await assert.rejects(f.session.step({...command,operation:'BACK'}),/REPLAY_BINDING_MISMATCH/);
  }finally{await f.session.close();}
});
test('G3 search step preserves the actual user value and denies value replacement before dispatch',async()=>{
  const f=fixture();try{await f.step('ACTIVATE_CONTROL');const receipt=await f.step('INPUT_TEXT','invented');assert.equal(receipt.dispatch,'NOT_SENT');assert.equal(receipt.reason,'VALUE_NOT_AUTHORIZED');assert.equal(f.interactions,1);}finally{await f.session.close();}
});
test('G3 four semantic search actions are verified through issued grants without any model call',async()=>{
  const f=fixture();try{
    const receipts=[];
    for(const op of ['OPEN_APPLICATION','ACTIVATE_CONTROL','INPUT_TEXT','SUBMIT_SEARCH'])receipts.push(await f.step(op,op==='INPUT_TEXT'?'marine biology':undefined));
    assert.deepEqual(receipts.map(r=>r.verification),['PASSED','PASSED','PASSED','PASSED']);
    assert.deepEqual(receipts.map(r=>r.dispatch),['NOT_SENT','ACK','ACK','ACK']);
    assert.equal(f.interactions,3);assert.equal(f.session.view().modelCalls,0);
    assert.ok(receipts.every(r=>r.beforeSnapshotId&&r.afterSnapshotId&&r.evidenceId));
  }finally{await f.session.close();}
});
test('G3 sensitive native fields are absent from frame labels, receipt snapshots and errors',async()=>{
  const secret='gsk_syntheticSecretNeverPersist123';const f=fixture({secret}); // gitleaks:allow -- synthetic privacy test input
  try{const frame=await f.session.frame();assert.equal(frame.image,undefined);assert.ok(!JSON.stringify(frame).includes(secret));const receipt=await f.step('OBSERVE_UI');assert.ok(!JSON.stringify(receipt).includes(secret));assert.ok(!JSON.stringify(f.session.view()).includes(f.session.ownerToken));}finally{await f.session.close();}
});
test('G3 rotation between frame and action is NOT_SENT; no raw coordinate fallback',async()=>{
  const f=fixture();try{const frame=await f.session.frame();f.rotate();const receipt=await f.session.step({type:'STEP',requestId:randomUUID(),leaseId:f.session.leaseId,ownerToken:f.session.ownerToken,frameId:frame.id,operation:'ACTIVATE_CONTROL',touch:{x:.5,y:.05}});assert.equal(receipt.dispatch,'NOT_SENT');assert.equal(receipt.reason,'STALE_FRAME');assert.equal(f.interactions,0);}finally{await f.session.close();}
});
test('G3 wrong owner, unknown frame, paused state and key reuse cannot dispatch',async()=>{
  const f=fixture();try{const frame=await f.session.frame();assert.throws(()=>f.session.step({type:'STEP',requestId:randomUUID(),leaseId:f.session.leaseId,ownerToken:'b'.repeat(64),frameId:frame.id,operation:'OPEN_APPLICATION'}),/OWNER_MISMATCH/);
    f.session.pause();await assert.rejects(f.session.step({type:'STEP',requestId:randomUUID(),leaseId:f.session.leaseId,ownerToken:f.session.ownerToken,frameId:frame.id,operation:'OPEN_APPLICATION'}),/INVALID_STATE/);assert.equal(f.interactions,0);f.session.resume();}finally{await f.session.close();}
});
test('G3 unknown dispatch remains UNKNOWN/INTERRUPTED and never automatically repeats',async()=>{
  const f=fixture({unknown:true});try{const r=await f.step('ACTIVATE_CONTROL');assert.equal(r.dispatch,'UNKNOWN');assert.equal(r.verification,'UNVERIFIED');assert.equal(f.session.view().status,'INTERRUPTED');assert.equal(f.interactions,1);assert.throws(()=>f.session.resume(),/INVALID_STATE/);assert.ok(!JSON.stringify(r).includes('private-driver-detail'));}finally{await f.session.close('INTERRUPTED');}
});
test('G3 uncertain Session cleanup retains reservation; repeated Stop does not release it',async()=>{
  const f=fixture({cleanupFail:true});const a=await f.session.close(),b=await f.session.close();assert.deepEqual(a,b);assert.equal(a.cleanup,'UNCERTAIN');assert.equal(a.status,'INTERRUPTED');assert.equal(f.cleanups,0);assert.equal(f.closed,1);
});
test('G3 locked device cannot supply a clickable frame or invoke an input primitive',async()=>{
  const f=fixture({locked:true});try{await assert.rejects(f.session.frame(),/DEVICE_NOT_READY/);assert.equal(f.interactions,0);}finally{await f.session.close();}
});
test('G3 safe frame pipeline emits a transient JPEG bound to unchanged native geometry',async()=>{
  const screenshot=await sharp({create:{width:400,height:900,channels:3,background:'#112233'}}).png().toBuffer();
  const f=fixture({safeWindow:true,screenshot});try{const frame=await f.session.frame();assert.match(frame.image,/^data:image\/jpeg;base64,/);assert.equal(frame.width,400);assert.equal(frame.height,900);assert.equal(frame.transport,'SCREENSHOT_POLLING');
    const receipt=await f.step('OPEN_APPLICATION');assert.ok(!JSON.stringify(receipt).includes('data:image'));assert.equal(receipt.before.captureAllowed,false);
  }finally{await f.session.close();}
});
test('G3 privacy change during capture suppresses the frame instead of exposing the captured bitmap',async()=>{
  const screenshot=await sharp({create:{width:400,height:900,channels:3,background:'#112233'}}).png().toBuffer();let reads=0;
  const f=fixture({screenshot,privacy:()=>++reads===1?'SAFE_WINDOW':'SECURE_WINDOW'});
  try{const frame=await f.session.frame();assert.equal(reads,2);assert.equal(frame.image,undefined);assert.equal(frame.imageOmittedReason,'CAPTURE_SAFETY_UNKNOWN');assert.equal(f.interactions,0);}finally{await f.session.close();}
});
test('G3 wrong screenshot dimensions and unavailable image transport never issue a clickable frame',async()=>{
  const screenshot=await sharp({create:{width:900,height:400,channels:3,background:'#112233'}}).png().toBuffer();
  for(const options of [{safeWindow:true,screenshot},{safeWindow:true},{observationFail:true}]){const f=fixture(options);try{await assert.rejects(f.session.frame());assert.equal(f.interactions,0);}finally{await f.session.close();}}
});
test('G3 stale frame and unresolved candidate have zero effect, with no coordinate fallback',async()=>{
  const f=fixture(),now=Date.now;try{const frame=await f.session.frame(),time=now();Date.now=()=>time+6000;
    await assert.rejects(f.session.step({type:'STEP',requestId:randomUUID(),leaseId:f.session.leaseId,ownerToken:f.session.ownerToken,frameId:frame.id,operation:'OPEN_APPLICATION'}),/STALE_FRAME/);
    Date.now=now;const fresh=await f.session.frame();const receipt=await f.session.step({type:'STEP',requestId:randomUUID(),leaseId:f.session.leaseId,ownerToken:f.session.ownerToken,frameId:fresh.id,operation:'ACTIVATE_CONTROL',candidateId:'not-issued'});
    assert.equal(receipt.dispatch,'NOT_SENT');assert.equal(receipt.reason,'UNRESOLVED_TARGET');assert.equal(receipt.action,undefined);assert.equal(f.interactions,0);
  }finally{Date.now=now;await f.session.close();}
});
test('G3 OPEN from another app delegates to the existing action executor and verifies foreground independently',async()=>{
  const f=fixture({outside:true});try{const frame=await f.session.frame();assert.equal(frame.image,undefined);assert.equal(frame.imageOmittedReason,'OUTSIDE_APP_SCOPE');assert.equal(frame.controls.length,0);
    const receipt=await f.step('OPEN_APPLICATION');assert.equal(receipt.dispatch,'ACK');assert.equal(receipt.verification,'PASSED');assert.equal(f.interactions,1);
  }finally{await f.session.close();}
});

test('G3 heartbeat expiry records its exact reason without raising or disabling the lease timeout',async()=>{
 const f=fixture();let clock=Date.now();f.session.dependencies.clock=()=>clock;clock+=31000;
 try{await new Promise(resolve=>setTimeout(resolve,2300));assert.equal(f.session.view().closeReason,'HEARTBEAT_EXPIRED');assert.equal(f.session.view().status,'INTERRUPTED');assert.equal(f.closed,1);}finally{await f.session.close();}
});
test('G3 repeated close retains the first operator reason and closes the native session once',async()=>{
 const f=fixture(),first=await f.session.close('CANCELLED');assert.equal(first.closeReason,'OWNER_CANCEL');assert.deepEqual(await f.session.close('INTERRUPTED','ABORT_SIGNAL'),first);assert.equal(f.closed,1);
});
