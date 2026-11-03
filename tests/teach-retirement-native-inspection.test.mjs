import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';
import {createHash} from 'node:crypto';
import {load} from './helpers/react-skill-console.mjs';
const file=path.resolve('lib/skills/retirement-native-preflight.ts'),serial='OFFLINE-INVENTORY-SERIAL',manufacturer='Fixture',model='InventoryModel';
const physicalId='android:'+createHash('sha256').update(JSON.stringify([serial,manufacturer,model])).digest('hex');

async function inspect(options={}){
 const requests=[],adb=[],properties=`[ro.serialno]: [${serial}]\n[ro.boot.serialno]: [${serial}]\n[ro.product.manufacturer]: [${manufacturer}]\n[ro.product.model]: [${options.wrongPhysical?'Other':model}]\n[ro.build.version.release]: [11]\n`;
 const effects=options.corrupt?'not-json':options.unknownEffect?JSON.stringify({physicalId,detail:{id:'OFFLINE-EFFECT',dispatch:'UNKNOWN',verified:false}}):'';
 const virtualFs={readdir:async directory=>directory.endsWith('phone-commander-local-effects')?(effects?['fixture.jsonl']:[]):directory.endsWith('phone-commander-appium-ports')?(options.portLease?['fixture-port']:[]):assert.fail('Unexpected directory'),stat:async()=>({size:Buffer.byteLength(effects)}),readFile:async p=>p.endsWith('owner.json')?JSON.stringify({serial}):effects};
 const runAdb=async args=>{adb.push(args);if(args.join(' ')==='forward --list')return {stdout:options.forward?serial+' tcp:8200 tcp:6790':'',stderr:''};
  if(args.join(' ')===`-s ${serial} shell ps -A`)return {stdout:options.instrumentation?'shell 42 io.appium.uiautomator2.server':'USER PID NAME\nshell 1 benign',stderr:''};
  if(args.join(' ')===`-s ${serial} shell getprop`)return {stdout:properties,stderr:''};
  if(args.join(' ')===`-s ${serial} shell dumpsys window policy`)return {stdout:options.locked?'mIsShowing=true screenState=SCREEN_STATE_ON':'mIsShowing=false screenState=SCREEN_STATE_ON',stderr:''};
  return assert.fail('Unexpected or mutating ADB command');};
 const original=Module._load;delete load.cache[file];Module._load=function(id,parent,...rest){if(parent?.filename===file&&id==='node:fs/promises')return virtualFs;if(parent?.filename===file&&id==='../android/adb')return {runAdb};return original.call(this,id,parent,...rest);};let subject;
 try{subject=load(file);}finally{Module._load=original;}
 const originalFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{const endpoint=new URL(url).pathname;requests.push({endpoint,method:init.method});assert.equal(init.method,'GET');assert.equal(init.body,undefined);
  if(options.networkFailure)throw Error('OFFLINE_NETWORK_FAILURE');
  if(endpoint==='/status')return Response.json({value:{ready:options.ready!==false,build:{version:options.version===null?undefined:options.version??'3.8.0'}}});
  if(options.disabled)return Response.json({value:{error:'unknown error',message:'session_discovery disabled'}},{status:500});
  if(options.notFound)return Response.json({value:{error:'unknown command',message:'No route'}},{status:404});
  return Response.json({value:Object.hasOwn(options,'inventory')?options.inventory:[]});};
 try{const result=await subject.inspectRetirementNativeState(serial,physicalId);return {result,requests,adb};}finally{globalThis.fetch=originalFetch;delete load.cache[file];}
}

test('OFFLINE Appium 3 inventory uses documented /appium/sessions and only read-only ADB/RPC',async()=>{const f=await inspect();assert.equal(f.result.state,'CLEAR');assert.deepEqual(f.requests.map(r=>r.endpoint),['/status','/appium/sessions']);assert.equal(f.result.rpcCount,2);assert.equal(f.result.adbCount,4);assert.equal(f.result.reason,'CHECKED_CURRENT_STATE_CLEAR_HISTORICAL_GAP_REMAINS');});
test('OFFLINE Appium 2 legacy inventory keeps /sessions without feature escalation',async()=>{const f=await inspect({version:'2.19.0'});assert.equal(f.result.state,'CLEAR');assert.deepEqual(f.requests.map(r=>r.endpoint),['/status','/sessions']);});
for(const options of [{disabled:true},{notFound:true},{networkFailure:true}])test('OFFLINE unavailable or denied session discovery stays UNKNOWN without endpoint fallback: '+Object.keys(options)[0],async()=>{const f=await inspect(options);assert.equal(f.result.state,'UNKNOWN');assert.equal(f.result.reason,'APPIUM_INVENTORY_UNAVAILABLE');assert.equal(f.requests.some(r=>r.endpoint==='/sessions'),false);assert.ok(f.requests.length<=2);});
for(const inventory of [null,{},'[]'])test('OFFLINE malformed Appium inventory is UNKNOWN: '+JSON.stringify(inventory),async()=>{const f=await inspect({inventory});assert.equal(f.result.state,'UNKNOWN');assert.equal(f.result.reason,'APPIUM_INVENTORY_UNSUPPORTED');});
test('OFFLINE nonempty inventory blocks admission even without selected-device capabilities',async()=>{const f=await inspect({inventory:[{id:'OFFLINE-FOREIGN-SESSION'}]});assert.equal(f.result.state,'BLOCKED');assert.equal(f.result.reason,'ACTIVE_APPIUM_SESSION_PRESENT');});
for(const version of [null,'4.0.0','unrecognized'])test('OFFLINE unverified server version cannot imply empty inventory: '+version,async()=>{const f=await inspect({version});assert.equal(f.result.state,'UNKNOWN');assert.equal(f.result.reason,'APPIUM_VERSION_UNSUPPORTED');assert.deepEqual(f.requests.map(r=>r.endpoint),['/status']);});
test('OFFLINE Appium not ready is UNKNOWN and does not request inventory',async()=>{const f=await inspect({ready:false});assert.equal(f.result.state,'UNKNOWN');assert.equal(f.result.reason,'APPIUM_NOT_READY');assert.equal(f.requests.length,1);});
for(const [options,reason]of [[{instrumentation:true},'UIAUTOMATOR_PROCESS_PRESENT'],[{portLease:true},'APPIUM_PORT_LEASE_PRESENT'],[{forward:true},'DEVICE_PORT_FORWARD_PRESENT'],[{unknownEffect:true},'REAL_UNKNOWN_NATIVE_EFFECT']])test('OFFLINE native conflict blocks before any Appium request: '+reason,async()=>{const f=await inspect(options);assert.equal(f.result.state,'BLOCKED');assert.equal(f.result.reason,reason);assert.equal(f.requests.length,0);});
test('OFFLINE malformed effect journal cannot be discarded as no pending effect',async()=>{const f=await inspect({corrupt:true});assert.equal(f.result.state,'UNKNOWN');assert.equal(f.result.reason,'EFFECT_JOURNAL_CORRUPT');assert.equal(f.requests.length,0);});
test('OFFLINE fresh physical identity mismatch blocks after server inventory',async()=>{const f=await inspect({wrongPhysical:true});assert.equal(f.result.state,'BLOCKED');assert.equal(f.result.reason,'PHYSICAL_IDENTITY_CHANGED');});
test('OFFLINE fresh keyguard read blocks a locked phone even with empty inventory',async()=>{const f=await inspect({locked:true});assert.equal(f.result.state,'BLOCKED');assert.equal(f.result.reason,'DEVICE_NOT_UNLOCKED_READY');});
