import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {load} from './helpers/react-skill-console.mjs';
const get=file=>load(path.resolve(file));
const {startWorker}=get('lib/android/agent/worker-server.ts');
const {DeviceRuntimeRegistry}=get('lib/android/agent/device-runtime.ts');
const {teachLifecycleState}=get('lib/android/agent/teach-lifecycle.ts');
const {LiveTeachService,LiveTeachError}=get('lib/skills/live-teach-service.ts');
const {OfflineTeachDashboard}=get('lib/skills/teach-dashboard.ts');
const {PostgresTeachRepository}=get('lib/skills/db/postgres-teach-repository.ts');
const {liveTeachResponse}=get('lib/skills/live-teach-api.ts');
const {GroundedInteractionFailure}=get('lib/android/grounded-interactions.ts');
const {TeachStorageError}=get('lib/skills/db/teach-errors.ts');
const base=path.resolve('coverage/g3-durable-recovery-2026-11-02');
const hardwareSerial='OFFLINE-RECOVERY-HARDWARE',manufacturer='Fixture',model='Recovery fixture';
const physicalId='android:'+createHash('sha256').update(JSON.stringify([hardwareSerial,manufacturer,model])).digest('hex');
const pkg='org.fixture.recovery';

async function fixture(t,options={}){
 fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'worker-'));
 const f={directory,creates:0,closes:0,reservations:0,releases:0,verificationReads:0,unknown:false,closed:false,devices:[{serial:'A',status:'device',identityVerified:true,physicalId,model}]};
 f.adapter={discover:async()=>f.devices,teachIdentity:async()=>({serial:'A',physicalId,hardwareSerial,manufacturer,model}),
  reserve:async()=>{f.reservations++;return async()=>{f.releases++;};},plan:async()=>assert.fail('No model'),open:async()=>assert.fail('No legacy engine'),
  verifyTeachCleanup:async(id,p,d,s)=>{f.verificationReads++;if(options.verificationWait)await options.verificationWait;return !f.failVerification&&f.closed&&id==='OFFLINE-SESSION'&&p===physicalId&&d==='A'&&s==='0'.repeat(64);},
  v2:(serial,budget)=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial,packageName:pkg,component:pkg+'/.Main'}})},open:async()=>{
   await budget.nativeLifecycle({kind:'CREATE_INTENT',nativeServerSha256:'0'.repeat(64)});if(options.createWait)await options.createWait;
   f.creates++;await budget.nativeLifecycle({kind:'NATIVE_BOUND',nativeSessionId:'OFFLINE-SESSION'});await budget.nativeLifecycle({kind:'BINDING_VERIFIED'});await budget.nativeLifecycle({kind:'NATIVE_READY'});
   if(options.admissionResponseWait)await options.admissionResponseWait;
   return {backend:'appium',sessionId:()=>f.closed?undefined:'OFFLINE-SESSION',observe:async()=>{const snapshotId=randomUUID();return {deviceSerial:'A',snapshotId,timestamp:Date.now(),foregroundPackage:'org.fixture.other',observationStatus:'OBSERVED',source:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',viewport:{x:0,y:0,width:400,height:900},nodes:[],elements:[]};},
    execute:async()=>{if(f.unknown)throw new GroundedInteractionFailure('UNKNOWN','OFFLINE_DISPATCH',Error('fixture outcome unknown'));assert.fail('No action expected');},
    close:async()=>{if(f.closed)return;await budget.nativeLifecycle({kind:'DELETE_INTENT'});if(options.cleanupFailure)throw Error('OFFLINE_CLEANUP_FAILED');f.closes++;f.closed=true;
      for(const kind of ['DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED'])await budget.nativeLifecycle({kind});}};
  }})};
 f.worker=await startWorker({directory,adapter:f.adapter});
 f.transport=async(command,signal)=>{const a=JSON.parse(fs.readFileSync(path.join(directory,'address.json'),'utf8'));const response=await fetch('http://127.0.0.1:'+a.port+'/teach',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify(command),signal});const body=await response.json();if(!response.ok)throw new LiveTeachError(body.code);return body;};
 f.openCommand={type:'OPEN',recordingRef:randomUUID(),requestId:randomUUID(),deviceId:'A',expectedPhysicalId:physicalId,appRef:'catalog',query:''};
 f.closeWorker=async()=>{if(f.worker){f.worker.server.closeAllConnections();await f.worker.shutdown();f.worker=undefined;}};
 f.restart=async()=>{await f.closeWorker();f.worker=await startWorker({directory,adapter:f.adapter});};
 f.authorize=async()=>{await f.worker.registry.setOwnerTestMode({enabled:true,deviceId:'A',physicalId});return f.worker.registry.ownerTestModes()[0].id;};
 f.prepare=async opened=>{const authorizationId=await f.authorize();const result=await f.transport({type:'RECOVERY_PREPARE',recordingRef:f.openCommand.recordingRef,executionId:opened.executionId,deviceId:'A',physicalId,authorizationId});return {...result,authorizationId};};
 t.after(async()=>{await f.closeWorker();await f.db?.close();const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith('worker-'));fs.rmSync(resolved,{recursive:true,force:true});});
 return f;
}

test('OFFLINE journal persists native binding before OPEN response; duplicate OPEN shares admission and never journals capability',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.transport(f.openCommand),f.transport(f.openCommand)]);assert.equal(a.leaseId,b.leaseId);assert.equal(f.creates,1);
 const json=fs.readFileSync(path.join(f.directory,'tasks.json'),'utf8'),row=JSON.parse(json)[0];assert.equal(row.teachLifecycle.binding.recordingRef,f.openCommand.recordingRef);assert.equal(teachLifecycleState(row.teachLifecycle).nativeSessionId,'OFFLINE-SESSION');assert.equal(json.includes(a.ownerToken),false);assert.equal(json.includes('ownerToken'),false);
 const address=JSON.parse(fs.readFileSync(path.join(f.directory,'address.json'),'utf8'));const publicState=await(await fetch('http://127.0.0.1:'+address.port+'/tasks',{headers:{Authorization:'Bearer '+address.token}})).json();
 assert.equal(publicState.tasks[0].teachLifecycle,undefined);assert.equal(JSON.stringify(publicState).includes('OFFLINE-SESSION'),false);
 await f.transport({type:'STOP',leaseId:a.leaseId,ownerToken:a.ownerToken});assert.equal(teachLifecycleState(f.worker.registry.list()[0].teachLifecycle).cleanup,'PROVEN');assert.equal(f.closes,1);assert.equal(f.releases,1);
});

test('OFFLINE lost HTTP admission response + Worker restart recovers by new owner proof without old capability or native OPEN replay',async t=>{
 const f=await fixture(t),opened=await f.transport(f.openCommand);await f.restart();const prepared=await f.prepare(opened);
 const command={type:'RECOVERY_CONFIRM',reference:prepared.reference,revision:prepared.revision,authorizationId:prepared.authorizationId,confirmed:true};
 const [a,b]=await Promise.all([f.transport(command),f.transport(command)]);assert.deepEqual(a,b);assert.equal(a.cleanup,'PROVEN');assert.equal(a.binding.recordingRef,f.openCommand.recordingRef);assert.equal(a.pending,'NONE');assert.ok(f.verificationReads>=2);
 await assert.rejects(f.transport(f.openCommand),/NO_REOPEN/);assert.equal(f.creates,1);assert.equal(f.closes,1);assert.equal(f.releases,1);
});

test('OFFLINE restart snapshot during CREATE intent never guesses native Session or resumes admission',async t=>{
 let release;const createWait=new Promise(r=>release=r),f=await fixture(t,{createWait});const pending=f.transport(f.openCommand);
 while(!f.worker.registry.list()[0]?.teachLifecycle?.events.some(e=>e.kind==='CREATE_INTENT'))await new Promise(setImmediate);
 const crashed=f.worker.registry.persisted(),next=new DeviceRuntimeRegistry(f.adapter);next.restore(crashed);
 assert.equal(teachLifecycleState(next.list()[0].teachLifecycle).nativeSessionId,undefined);
 await assert.rejects(next.teach(f.openCommand),/NO_REOPEN/);assert.equal(f.creates,0);release();await pending;
});

test('OFFLINE HTTP timeout/disconnect after Session creation preserves binding; recovery never retransmits OPEN',async t=>{
 let release;const admissionResponseWait=new Promise(r=>release=r),f=await fixture(t,{admissionResponseWait});const controller=new AbortController();
 const request=f.transport(f.openCommand,controller.signal);const rejected=assert.rejects(request,{name:'AbortError'});
 while(!f.worker.registry.list()[0]?.teachLifecycle?.events.some(e=>e.kind==='NATIVE_READY'))await new Promise(setImmediate);
 controller.abort();await rejected;const checkpoint=JSON.parse(fs.readFileSync(path.join(f.directory,'tasks.json'),'utf8'))[0];assert.equal(teachLifecycleState(checkpoint.teachLifecycle).nativeSessionId,'OFFLINE-SESSION');
 release();while(!f.worker.registry.hasTeachSessions())await new Promise(setImmediate);const original=f.worker.registry.list()[0];await f.restart();
 const authorizationId=await f.authorize(),prepared=await f.transport({type:'RECOVERY_PREPARE',recordingRef:f.openCommand.recordingRef,executionId:original.executionId,deviceId:'A',physicalId,authorizationId});
 assert.equal(prepared.cleanup,'PROVEN');assert.equal(f.creates,1);assert.equal(f.closes,1);
});

test('OFFLINE disk error before native CREATE prevents effects and cannot become cleanup proof',async()=>{
 let creates=0;const adapter={discover:async()=>[{serial:'A',status:'device',identityVerified:true,physicalId}],reserve:async()=>async()=>{},v2:()=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial:'A',packageName:pkg}})},open:async()=>{creates++;assert.fail('Must not reach native');}})};
 const registry=new DeviceRuntimeRegistry(adapter,()=>{},async()=>{throw Error('OFFLINE_DISK_FAILURE');});
 await assert.rejects(registry.teach({type:'OPEN',recordingRef:randomUUID(),requestId:randomUUID(),deviceId:'A',expectedPhysicalId:physicalId,appRef:'catalog',query:''}));assert.equal(creates,0);
});

test('OFFLINE cleanup failure and UNKNOWN pending effect both block recovery without retry',async t=>{
 const broken=await fixture(t,{cleanupFailure:true});const b=await broken.transport(broken.openCommand);await broken.transport({type:'STOP',leaseId:b.leaseId,ownerToken:b.ownerToken});
 const auth=await broken.authorize().catch(()=>null);if(auth)await assert.rejects(broken.transport({type:'RECOVERY_PREPARE',recordingRef:broken.openCommand.recordingRef,executionId:b.executionId,deviceId:'A',physicalId,authorizationId:auth}));
 assert.notEqual(teachLifecycleState(broken.worker.registry.list()[0].teachLifecycle).cleanup,'PROVEN');
 const f=await fixture(t),opened=await f.transport(f.openCommand);f.unknown=true;const frame=await f.transport({type:'FRAME',leaseId:opened.leaseId,ownerToken:opened.ownerToken});
 const receipt=await f.transport({type:'STEP',leaseId:opened.leaseId,ownerToken:opened.ownerToken,requestId:randomUUID(),frameId:frame.id,operation:'OPEN_APPLICATION'});assert.equal(receipt.dispatch,'UNKNOWN');
 await f.transport({type:'STOP',leaseId:opened.leaseId,ownerToken:opened.ownerToken});assert.equal(teachLifecycleState(f.worker.registry.list()[0].teachLifecycle).pending,'UNKNOWN');await assert.rejects(f.prepare(opened),/CLEANUP_UNPROVEN/);assert.equal(f.creates,1);
});

test('OFFLINE recovery rejects foreign/expired owner, wrong physical device, revision conflict and missing independent proof',async t=>{
 const f=await fixture(t),opened=await f.transport(f.openCommand);await f.restart();const authorizationId=await f.authorize();
 const command={type:'RECOVERY_PREPARE',recordingRef:f.openCommand.recordingRef,executionId:opened.executionId,deviceId:'A',physicalId,authorizationId};
 await assert.rejects(f.transport({...command,authorizationId:randomUUID()}),/OWNER/);await assert.rejects(f.transport({...command,physicalId:'android:'+'e'.repeat(64)}),/MISMATCH/);
 f.failVerification=true;await assert.rejects(f.transport(command),/VERIFICATION_FAILED/);f.failVerification=false;
 const prepared=await f.transport(command);await assert.rejects(f.transport({type:'RECOVERY_CONFIRM',reference:prepared.reference,revision:prepared.revision+1,authorizationId,confirmed:true}),/REFERENCE_INVALID/);
 f.devices=[{serial:'A',status:'device',identityVerified:true,physicalId:'android:'+'f'.repeat(64)}];await assert.rejects(f.transport(command),/PHYSICAL_IDENTITY/);f.devices=[{serial:'A',status:'device',identityVerified:true,physicalId}];
 await f.worker.registry.setOwnerTestMode({enabled:false,deviceId:'A',physicalId,authorizationId});await assert.rejects(f.transport(command),/OWNER/);
 const expired=await f.authorize(),now=Date.now,time=now();try{Date.now=()=>time+31*60*1000;await assert.rejects(f.transport({...command,authorizationId:expired}),/OWNER/);}finally{Date.now=now;}
});

test('OFFLINE corrupt checkpoint preserves bytes and refuses startup, legacy missing attestation never becomes proof',async t=>{
 const f=await fixture(t),opened=await f.transport(f.openCommand);await f.closeWorker();const file=path.join(f.directory,'tasks.json'),rows=JSON.parse(fs.readFileSync(file,'utf8'));rows[0].teachLifecycle.events[1].revision=999;fs.writeFileSync(file,JSON.stringify(rows));const bytes=fs.readFileSync(file);
 await assert.rejects(startWorker({directory:f.directory,adapter:f.adapter}),/JOURNAL_INVALID/);assert.deepEqual(fs.readFileSync(file),bytes);
 const legacy=structuredClone(rows[0]);delete legacy.teachLifecycle;fs.writeFileSync(file,JSON.stringify([legacy]));f.worker=await startWorker({directory:f.directory,adapter:f.adapter});
 const authorizationId=await f.authorize();await assert.rejects(f.transport({type:'RECOVERY_PREPARE',recordingRef:f.openCommand.recordingRef,executionId:opened.executionId,deviceId:'A',physicalId,authorizationId}),/ATTESTATION_MISSING/);
});

test('OFFLINE restore retains lifecycle evidence beyond legacy history window and rejects exact-task binding corruption',async t=>{
 const f=await fixture(t),opened=await f.transport(f.openCommand);await f.transport({type:'STOP',leaseId:opened.leaseId,ownerToken:opened.ownerToken});const attested=f.worker.registry.persisted()[0];
 const legacy=Array.from({length:45},()=>({executionId:randomUUID(),batchId:randomUUID(),deviceId:'A',request:'Legacy fixture',status:'CANCELLED',createdAt:1,finishedAt:2,events:[]}));
 const next=new DeviceRuntimeRegistry(f.adapter);next.restore([attested,...legacy]);assert.ok(next.list().some(t=>t.executionId===opened.executionId));assert.equal(next.list().length,41);
 const corrupt={...attested,physicalId:'android:'+'e'.repeat(64)};assert.throws(()=>new DeviceRuntimeRegistry(f.adapter).restore([corrupt]),/BINDING_CORRUPT/);
});

async function databaseFixture(t){
 const f=await fixture(t);f.db=new PGlite();await f.db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql',import.meta.url),'utf8'));await f.db.exec('SET search_path=public');await f.db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES('local-owner','TEACH_REMOTE_STORAGE',true)");
 let loseCommit=false;const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
 const db={query:async(sql,values)=>map(await f.db.query(sql,values)),transaction:async work=>{const value=await f.db.transaction(tx=>work({query:async(sql,values)=>map(await tx.query(sql,values))}));if(loseCommit){loseCommit=false;throw new TeachStorageError('SAVE_OUTCOME_UNKNOWN');}return value;},close:async()=>{}};
 const repo=new PostgresTeachRepository(db,'teach_mode');f.repository=repo;
 f.compose=(bridge=f.transport)=>{let service;const dashboard=new OfflineTeachDashboard({mode:'OFFLINE_TEST',workspaceRoot:process.cwd(),consentGranted:true,devices:[{id:randomUUID(),label:'Offline declaration only'}]},{mode:'PGLITE_TEST',repository:repo,cleanupVerified:async s=>service.cleanupProven(s.id)});service=new LiveTeachService(repo,dashboard.recordingPersistence().storage,dashboard,bridge,async()=>{});return service;};
 f.loseCommit=()=>{loseCommit=true;};return f;
}
test('OFFLINE lost OPEN response persists retained DB ownership; authenticated exact recovery releases once and records audit after readback',async t=>{
 const f=await databaseFixture(t),service=f.compose(async command=>{const value=await f.transport(command);if(command.type==='OPEN')throw new LiveTeachError('WORKER_UNAVAILABLE_OR_OUTCOME_UNKNOWN');return value;});
 await assert.rejects(service.open({requestId:randomUUID(),deviceId:'A',name:'Offline durable search',appAlias:'catalog',command:'Open catalog',query:'',confirmed:true},randomUUID()),/OUTCOME_UNKNOWN/);
 const row=(await f.db.query('SELECT id FROM teach_mode.teach_sessions')).rows[0];assert.equal((await f.repository.getSession(row.id)).ownership,'RETAINED_PENDING_CLEANUP');const task=f.worker.registry.list()[0];await f.restart();
 const next=f.compose(),authorizationId=await f.authorize(),plan=await next.prepareDurableRecovery({id:row.id,executionId:task.executionId,deviceId:'A',authorizationId});assert.equal(plan.requiresOwnerConfirmation,true);
 const before=await f.repository.getSession(row.id);assert.equal(before.revision,3);const input={reference:plan.reference,revision:plan.revision,authorizationId,confirmed:true};
 const [a,b]=await Promise.all([next.releaseDurableRecovery(input),next.releaseDurableRecovery(input)]);assert.deepEqual(a,b);assert.equal(a.database.ownership,'RELEASED');assert.equal(a.database.status,'INTERRUPTED');assert.equal(a.database.revision,4);assert.equal(a.audit,'RECORDED');assert.equal(f.creates,1);
 assert.ok(f.worker.registry.list()[0].teachLifecycle.events.some(e=>e.kind==='DB_RELEASE_CONFIRMED'));
 const serialized=JSON.stringify(f.worker.registry.persisted());assert.equal(serialized.includes(authorizationId),false);assert.equal(serialized.includes(plan.reference),false);
 const response=await liveTeachResponse(new Request('http://localhost:3000/api/teach-recorder',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.invalid'},body:JSON.stringify({type:'PREPARE_DURABLE_RECOVERY'})}),undefined,undefined,next);assert.equal(response.status,403);
});
test('OFFLINE lost DB COMMIT response never repeats release; fresh service reads already released state',async t=>{
 const f=await databaseFixture(t),service=f.compose();const current=await service.open({requestId:randomUUID(),deviceId:'A',name:'Offline lost commit',appAlias:'catalog',command:'Open catalog',query:'',confirmed:true},randomUUID());await f.restart();
 const next=f.compose(),authorizationId=await f.authorize(),plan=await next.prepareDurableRecovery({id:current.id,executionId:current.worker.executionId,deviceId:'A',authorizationId});f.loseCommit();
 const command={reference:plan.reference,revision:plan.revision,authorizationId,confirmed:true};await assert.rejects(next.releaseDurableRecovery(command),{code:'SAVE_OUTCOME_UNKNOWN'});await assert.rejects(next.releaseDurableRecovery(command),{code:'SAVE_OUTCOME_UNKNOWN'});
 const stored=await f.repository.getSession(current.id);assert.equal(stored.ownership,'RELEASED');assert.equal(stored.revision,4);
 const fresh=f.compose(),read=await fresh.prepareDurableRecovery({id:current.id,executionId:current.worker.executionId,deviceId:'A',authorizationId});assert.equal(read.status,'ALREADY_RELEASED');assert.equal((await f.repository.getSession(current.id)).revision,4);
});

test('OFFLINE DB revision change blocks release and simulated evidence cannot authorize PostgreSQL mode',async t=>{
 const f=await databaseFixture(t),service=f.compose();const current=await service.open({requestId:randomUUID(),deviceId:'A',name:'Offline revision protection',appAlias:'catalog',command:'Open catalog',query:'',confirmed:true},randomUUID());await f.restart();
 const next=f.compose(),authorizationId=await f.authorize(),input={id:current.id,executionId:current.worker.executionId,deviceId:'A',authorizationId};const plan=await next.prepareDurableRecovery(input);
 const row=await f.repository.getSession(current.id);await f.repository.updateSession(row.id,row.revision,'INTERRUPTED','RETAINED_PENDING_CLEANUP','OFFLINE_CONFLICT');
 await assert.rejects(next.releaseDurableRecovery({reference:plan.reference,revision:plan.revision,authorizationId,confirmed:true}),/REVISION_CONFLICT/);assert.equal((await f.repository.getSession(current.id)).ownership,'RETAINED_PENDING_CLEANUP');
 const postgresBoundary=new LiveTeachService(f.repository,{getSession:id=>f.repository.getSession(id)},{mode:'POSTGRESQL_STORAGE'},f.transport,async()=>{});
 await assert.rejects(postgresBoundary.prepareDurableRecovery(input),/EXACT_SESSION_MISMATCH/);
});

test('OFFLINE cleanup proof reconciles Stop DB transition committed before release, without rewriting REVIEWING as success',async t=>{
 const f=await databaseFixture(t),service=f.compose(),current=await service.open({requestId:randomUUID(),deviceId:'A',name:'Offline stop storage window',appAlias:'catalog',command:'Open catalog',query:'',confirmed:true},randomUUID());await f.restart();
 const before=await f.repository.getSession(current.id);await f.repository.updateSession(before.id,before.revision,'REVIEWING','HELD');
 const next=f.compose(),authorizationId=await f.authorize(),plan=await next.prepareDurableRecovery({id:current.id,executionId:current.worker.executionId,deviceId:'A',authorizationId});
 const released=await next.releaseDurableRecovery({reference:plan.reference,revision:plan.revision,authorizationId,confirmed:true});assert.equal(released.database.ownership,'RELEASED');assert.equal(released.database.status,'REVIEWING');assert.equal(released.automaticResume,false);
});
