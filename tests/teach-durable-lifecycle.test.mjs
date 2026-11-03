import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {load} from './helpers/react-skill-console.mjs';
import path from 'node:path';
const {createTeachLifecycle,appendTeachLifecycle,parseTeachLifecycle,teachLifecycleState}=load(path.resolve('lib/android/agent/teach-lifecycle.ts'));
const {ManagedAppiumSession}=load(path.resolve('lib/android/appium/session-manager.ts'));
const {AppiumClient}=load(path.resolve('lib/android/appium/client.ts'));
const {verifyNativeSessionAbsent}=load(path.resolve('lib/android/appium/session-lifecycle.ts'));
const binding=()=>({recordingRef:randomUUID(),executionId:randomUUID(),requestId:randomUUID(),physicalId:'android:'+'a'.repeat(64),runtimeSha256:'b'.repeat(64),teachRuntimeSha256:'c'.repeat(64),provenance:'SIMULATED_RECEIPT'});
function ready(){let row=createTeachLifecycle(binding());for(const event of [{kind:'CREATE_INTENT',nativeServerSha256:'0'.repeat(64)},{kind:'NATIVE_BOUND',nativeSessionId:'OFFLINE-NATIVE'},{kind:'BINDING_VERIFIED'},{kind:'NATIVE_READY'}])row=appendTeachLifecycle(row,event);return row;}
function closed(row=ready()){for(const kind of ['CLOSE_INTENT','DELETE_INTENT','DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED','CLEANUP_PROVEN'])row=appendTeachLifecycle(row,{kind});return row;}

test('OFFLINE durable binding/revision/hash survives JSON without authority or query fields',()=>{
 const row=closed(),copy=JSON.parse(JSON.stringify(row));assert.deepEqual(parseTeachLifecycle(copy),row);const state=teachLifecycleState(copy);
 assert.equal(state.cleanup,'PROVEN');assert.equal(state.nativeSessionId,'OFFLINE-NATIVE');assert.equal(state.pending,'NONE');assert.equal(state.revision,row.events.length);
 assert.doesNotMatch(JSON.stringify(row),/ownerToken|authorizationId|password|query|grant|credentials/);
});
test('OFFLINE lifecycle rejects corruption, unknown versions, wrong binding, forbidden extras and false cleanup',()=>{
 const row=closed();for(const change of [r=>r.contractVersion=2,r=>r.binding.physicalId='android:'+'d'.repeat(64),r=>r.events[1].nativeServerSha256='e'.repeat(64),r=>r.events[2].nativeSessionId='FOREIGN',r=>r.events[4].revision=99,r=>r.binding.ownerToken='secret',r=>r.events[0].proof=true]){
 const copy=structuredClone(row);change(copy);assert.throws(()=>parseTeachLifecycle(copy));}
 assert.throws(()=>appendTeachLifecycle(ready(),{kind:'CLEANUP_PROVEN'}));
 assert.throws(()=>appendTeachLifecycle(closed(),{kind:'DB_RELEASE_CONFIRMED',databaseRevision:4}));
});
test('OFFLINE crash after intent or binding is not cleanup proof; UNKNOWN stays sticky after close',()=>{
 let row=ready(),requestId=randomUUID();row=appendTeachLifecycle(row,{kind:'EFFECT_PENDING',effectRequestId:requestId});
 assert.equal(teachLifecycleState(JSON.parse(JSON.stringify(row))).pending,'PENDING');
 row=appendTeachLifecycle(row,{kind:'EFFECT_RESOLVED',effectRequestId:requestId,dispatch:'UNKNOWN'});row=closed(row);
 assert.equal(teachLifecycleState(row).pending,'UNKNOWN');assert.throws(()=>appendTeachLifecycle(row,{kind:'RECOVERY_CONFIRMED'}));
 assert.throws(()=>appendTeachLifecycle(row,{kind:'EFFECT_PENDING',effectRequestId:randomUUID()}));
});

function nativeFixture(options={}){
 const serial='OFFLINE-'+randomUUID(),hardware='HW-'+randomUUID(),physical='android:'+createHash('sha256').update(JSON.stringify([hardware,'Fixture','Phone'])).digest('hex');
 let created=0,deleted=0,portsReleased=0,gone=false,row=createTeachLifecycle({...binding(),physicalId:physical}),events=[];
 const run=async args=>({stdout:args.includes('get-state')?'device':args.includes('getprop')?`[ro.serialno]: [${hardware}]\n[ro.boot.serialno]: [${hardware}]\n[ro.product.manufacturer]: [Fixture]\n[ro.product.model]: [Phone]\n`:'',stderr:''});
 const fetcher=async(url,init)=>{
  if(init.method==='POST'&&url.endsWith('/session')){created++;if(options.lostCreateResponse)throw Error('OFFLINE_NETWORK_DROP');return Response.json({value:{sessionId:'OFFLINE-BOUND'}});}
  if(init.method==='DELETE'){deleted++;if(options.cleanupFailure)throw Error('OFFLINE_DELETE_DROP');gone=true;return Response.json({value:null});}
  if(url.endsWith('/appium/capabilities'))return gone?Response.json({value:{error:'invalid session id',message:'Offline closed'}},{status:404}):Response.json({value:{'appium:udid':serial}});
  return Response.json({value:null});
 };
 const hook=async event=>{if(options.failAt===event.kind)throw Error('OFFLINE_DISK_ERROR');row=appendTeachLifecycle(row,event);events.push(event.kind);};
 const session=new ManagedAppiumSession(new AppiumClient('http://localhost:4723',fetcher),serial,run,async()=>undefined,async()=>({systemPort:8200,chromedriverPort:9500,release:async()=>{portsReleased++;}}),physical,undefined,hook);
 return {session,events,get row(){return row;},get counts(){return {created,deleted,portsReleased};}};
}
test('OFFLINE native Session ID is checkpointed before initialization, DELETE ACK plus independent absence before resources release',async()=>{
 const f=nativeFixture();await f.session.open();assert.deepEqual(f.events,['CREATE_INTENT','NATIVE_BOUND','BINDING_VERIFIED','NATIVE_READY']);
 assert.equal(teachLifecycleState(f.row).nativeSessionId,'OFFLINE-BOUND');await f.session.close();
 assert.deepEqual(f.events.slice(-4),['DELETE_INTENT','DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED']);assert.deepEqual(f.counts,{created:1,deleted:1,portsReleased:1});
});
test('OFFLINE disk error before CREATE prevents native RPC; failure after binding never fabricates cleanup',async()=>{
 const a=nativeFixture({failAt:'CREATE_INTENT'});await assert.rejects(a.session.open(),/DISK/);assert.equal(a.counts.created,0);await a.session.close();
 const b=nativeFixture({failAt:'NATIVE_BOUND'});await assert.rejects(b.session.open(),/DISK/);assert.equal(b.counts.created,1);assert.equal(teachLifecycleState(b.row).nativeSessionId,undefined);
 await assert.rejects(b.session.close());assert.equal(teachLifecycleState(b.row).cleanup,'UNPROVEN');
});
test('OFFLINE lost native CREATE response retains uncertainty with no invented ID and no retry',async()=>{
 const f=nativeFixture({lostCreateResponse:true});await assert.rejects(f.session.open());await assert.rejects(f.session.close(),/uncertain/);
 assert.equal(f.counts.created,1);assert.equal(f.counts.deleted,0);assert.equal(f.counts.portsReleased,0);assert.equal(teachLifecycleState(f.row).nativeSessionId,undefined);
});
test('OFFLINE DELETE failure keeps cleanup unproven and never releases resources',async()=>{
 const f=nativeFixture({cleanupFailure:true});await f.session.open();await assert.rejects(f.session.close());
 assert.equal(f.counts.deleted,1);assert.equal(f.counts.portsReleased,0);assert.equal(teachLifecycleState(f.row).deleteAck,false);assert.equal(teachLifecycleState(f.row).cleanup,'UNPROVEN');
});
test('OFFLINE absence verifier refuses network errors, generic 404 and a still-live exact Session',async()=>{
 assert.notEqual(new AppiumClient('http://localhost:4723').endpointFingerprint(),new AppiumClient('http://localhost:4724').endpointFingerprint());
 for(const fetcher of [async()=>{throw Error('offline connection refused');},async()=>Response.json({value:{error:'unknown command'}},{status:404})]){
 await assert.rejects(verifyNativeSessionAbsent(new AppiumClient('http://localhost',fetcher),'OFFLINE-ID'));}
 assert.equal(await verifyNativeSessionAbsent(new AppiumClient('http://localhost',async()=>Response.json({value:{}})),'OFFLINE-ID'),false);
 assert.equal(await verifyNativeSessionAbsent(new AppiumClient('http://localhost',async()=>Response.json({value:{error:'invalid session id'}},{status:404})),'OFFLINE-ID'),true);
});
