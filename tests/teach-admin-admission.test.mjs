import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {load} from './helpers/react-skill-console.mjs';
const get=file=>load(path.resolve(file));
const {DeviceRuntimeRegistry}=get('lib/android/agent/device-runtime.ts');
const {TeachCommand}=get('lib/android/agent/teach-contracts.ts');
const {teachRuntimeDigest}=get('lib/android/agent/runtime-storage.ts');
const {ownerAuthenticationRuntimeSha256,ownerCertificateDigest,issueOwnerCertificate,issueOwnerDatabaseReadback,verifyOwnerCertificate,verifyOwnerDatabaseReadback}=get('lib/owner-auth/certificates.ts');
const {teachLifecycleState}=get('lib/android/agent/teach-lifecycle.ts');
const physicalId='android:'+'a'.repeat(64),journal='b'.repeat(64),credentialHash='c'.repeat(64);
async function fixture(t){
 const key=generateKeyPairSync('ed25519'),issuer={ready:async()=>true,sign:async payload=>sign(null,Buffer.from(payload),key.privateKey).toString('base64url')};
 const f={key,issuer,creates:0,releases:0,reserves:0,writes:0,closed:false,inspectionState:'CLEAR',devicePhysical:physicalId};
 f.binding={purpose:'ADMIN_ORPHAN_DISPOSITION',sessionId:randomUUID(),executionId:randomUUID(),requestId:randomUUID(),physicalId,revision:3,journalSha256:journal,runtimeSha256:teachRuntimeDigest(),ownerAuthSha256:ownerAuthenticationRuntimeSha256(),migrationSha256:'d'.repeat(64),freshRequestId:randomUUID(),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',summary:'OFFLINE administrative disposal; cleanup stays UNVERIFIED.'};
 f.legacy={executionId:f.binding.executionId,batchId:f.binding.requestId,physicalId,deviceId:'A',request:'Legacy recording',status:'CANCELLED',createdAt:1,finishedAt:2,events:[],latest:{type:'complete',status:'CANCELLED',counters:{steps:0,snapshots:0}}};
 f.authority={publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),credentialHash};
 f.adapter={administrativeAuthority:async()=>f.authority,inspectAdministrativeState:async()=>({state:f.inspectionState,reason:f.inspectionReason??'FIXTURE',physicalId,at:Date.now(),digest:'e'.repeat(64),adbCount:0,rpcCount:0}),
  discover:async()=>[{serial:'A',status:'device',identityVerified:true,physicalId:f.devicePhysical}],plan:async()=>assert.fail('No model'),open:async()=>assert.fail('No second engine'),
  reserve:async()=>{if(f.reserved)throw Error('RESERVATION_BUSY');f.reserved=true;f.reserves++;return async()=>{assert.equal(f.reserved,true);f.reserved=false;f.releases++;};},
  v2:(serial,budget)=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial,packageName:'org.fixture.catalog',component:'org.fixture.catalog/.Main'}})},open:async()=>{
   f.creates++;await budget.nativeLifecycle({kind:'CREATE_INTENT',nativeServerSha256:'0'.repeat(64)});await budget.nativeLifecycle({kind:'NATIVE_BOUND',nativeSessionId:'OFFLINE-ADMIN-NATIVE'});await budget.nativeLifecycle({kind:'BINDING_VERIFIED'});await budget.nativeLifecycle({kind:'NATIVE_READY'});
   return {backend:'appium',sessionId:()=>f.closed?undefined:'OFFLINE-ADMIN-NATIVE',observe:async()=>({deviceSerial:'A',snapshotId:randomUUID(),timestamp:Date.now(),foregroundPackage:'org.fixture.other',observationStatus:'OBSERVED',source:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',nodes:[],elements:[]}),execute:async()=>assert.fail('No UI effect'),close:async()=>{if(f.closed)return;f.closed=true;for(const kind of ['DELETE_INTENT','DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED'])await budget.nativeLifecycle({kind});}};
  }})};
 f.newRegistry=()=>new DeviceRuntimeRegistry(f.adapter,()=>{},async()=>{f.writes++;if(f.failWrite)throw Error('OFFLINE_DISK_FAILURE');f.persisted=f.registry.persisted();});
 f.registry=f.newRegistry();f.registry.restore([f.legacy],journal);f.send=command=>f.registry.teach(TeachCommand.parse(command));
 f.cert=async(patch={},issuedAt=Date.now())=>issueOwnerCertificate(issuer,{...f.binding,...patch},credentialHash,randomUUID(),issuedAt,issuedAt+60000);
 f.stage=async()=>{f.certificate=await f.cert();f.staged=await f.send({type:'ADMIN_STAGE',deviceId:'A',certificate:f.certificate,expiresAt:Date.now()+600000});return f.staged;};
 f.readback=async(certificate,patch={})=>issueOwnerDatabaseReadback(issuer,{version:1,ownerCertificateId:certificate.id,originalSessionId:f.binding.sessionId,originalRevision:4,originalOwnership:'ADMIN_DISPOSED_UNVERIFIED',physicalId,clearanceId:f.clearanceId??=randomUUID(),freshRequestId:f.binding.freshRequestId,sourceSha256:f.binding.runtimeSha256,observedAt:Date.now(),...patch});
 f.commit=async()=>{await f.stage();f.commitCommand={type:'ADMIN_COMMIT',executionId:f.binding.executionId,stageId:f.staged.stageId,certificate:f.certificate,readback:await f.readback(f.certificate)};return f.send(f.commitCommand);};
 f.authorize=async()=>{await f.commit();f.successor=randomUUID();f.freshCertificate=await f.cert({purpose:'FRESH_ADMISSION',revision:4,successorSessionId:f.successor,freshSpecSha256:ownerCertificateDigest({appRef:'catalog',query:''})});f.authorizeCommand={type:'ADMIN_AUTHORIZE_FRESH',executionId:f.binding.executionId,stageId:f.staged.stageId,certificate:f.freshCertificate,readback:await f.readback(f.freshCertificate,{originalRevision:5,successorRef:f.successor,successorOwnership:'HELD'})};return f.send(f.authorizeCommand);};
 f.open=()=>({type:'OPEN',recordingRef:f.successor??randomUUID(),requestId:f.binding.freshRequestId,deviceId:'A',expectedPhysicalId:physicalId,appRef:'catalog',query:'',administrativeClearance:f.clearanceId});
 t.after(async()=>{await f.registry.shutdown();});return f;
}

test('OFFLINE signed certificate and database receipt reject tamper, foreign issuer, expired approval and stale readback',async t=>{
 const f=await fixture(t),certificate=await f.cert();assert.equal(verifyOwnerCertificate(certificate,f.authority.publicKey,credentialHash).id,certificate.id);
 assert.throws(()=>verifyOwnerCertificate({...certificate,binding:{...certificate.binding,physicalId:'android:'+'f'.repeat(64)}},f.authority.publicKey,credentialHash));
 assert.throws(()=>verifyOwnerCertificate(certificate,f.authority.publicKey,'f'.repeat(64)));
 assert.throws(()=>verifyOwnerCertificate(certificate,f.authority.publicKey,credentialHash,certificate.expiresAt));
 const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');assert.throws(()=>verifyOwnerCertificate(certificate,other,credentialHash));
 const proof=await f.readback(certificate);assert.equal(verifyOwnerDatabaseReadback(proof,f.authority.publicKey,certificate).originalRevision,4);
 assert.throws(()=>verifyOwnerDatabaseReadback({...proof,originalRevision:99},f.authority.publicKey,certificate));assert.throws(()=>verifyOwnerDatabaseReadback(proof,f.authority.publicKey,certificate,proof.observedAt+5001));
});

test('OFFLINE ADMIN_STAGE persists UNVERIFIED marker and original journal provenance while holding the existing reservation',async t=>{
 const f=await fixture(t),before=structuredClone(f.legacy),staged=await f.stage();assert.equal(staged.cleanup,'UNVERIFIED');assert.equal(f.reserves,1);assert.equal(f.releases,0);assert.equal(f.creates,0);
 const row=f.persisted[0],{administrativeAdmission,...original}=row;assert.equal(administrativeAdmission.status,'STAGED');assert.equal(administrativeAdmission.originalJournalSha256,journal);assert.equal(row.status,before.status);assert.equal(row.finishedAt,before.finishedAt);assert.equal(original.teachLifecycle,undefined);assert.equal(JSON.stringify(row).includes(f.certificate.signature),false);
 await assert.rejects(f.send({type:'OPEN',recordingRef:randomUUID(),requestId:randomUUID(),deviceId:'A',expectedPhysicalId:physicalId,appRef:'catalog',query:''}),/ADMIN_FRESH/);assert.equal(f.creates,0);
 await assert.rejects(f.registry.start({type:'START',requestId:randomUUID(),jobs:[{deviceId:'A',goal:'open org.fixture.catalog'}]}),/QUARANTINE/);
});

test('OFFLINE exact signed stage/commit/fresh admission hands off one reservation and duplicate OPEN creates only one native Session',async t=>{
 const f=await fixture(t);await f.authorize();const command=f.open(),[a,b]=await Promise.all([f.send(command),f.send(command)]);assert.equal(a.leaseId,b.leaseId);assert.equal(f.creates,1);assert.equal(f.reserves,1);assert.equal(f.registry.list()[0].administrativeAdmission.status,'DISPATCHED');
 await assert.rejects(f.send({...command,requestId:randomUUID()}),/BUSY|ADMIN_FRESH/);assert.equal(f.creates,1);
 const closed=await f.send({type:'STOP',leaseId:a.leaseId,ownerToken:a.ownerToken});assert.equal(closed.cleanup,'PROVEN');assert.equal(f.releases,1);
 const original=f.registry.list().find(x=>x.executionId===f.binding.executionId);assert.equal(original.status,'CANCELLED');assert.equal(original.teachLifecycle,undefined);
 assert.equal(teachLifecycleState(f.registry.list().find(x=>x.executionId===a.executionId).teachLifecycle).pending,'NONE');
});

test('OFFLINE legacy stage denies wrong physical identity, wrong source, wrong original journal and expired/foreign authentication',async t=>{
 for(const patch of [{physicalId:'android:'+'f'.repeat(64)},{runtimeSha256:'f'.repeat(64)},{ownerAuthSha256:'f'.repeat(64)},{journalSha256:'f'.repeat(64)},{purpose:'MIGRATION_APPLY'}]){const f=await fixture(t);await assert.rejects(f.send({type:'ADMIN_STAGE',deviceId:'A',certificate:await f.cert(patch),expiresAt:Date.now()+600000}));assert.equal(f.creates,0);assert.equal(f.registry.list()[0].administrativeAdmission,undefined);}
 const f=await fixture(t);await assert.rejects(f.send({type:'ADMIN_STAGE',deviceId:'A',certificate:await f.cert({},Date.now()-70000),expiresAt:Date.now()+600000}));f.devicePhysical='android:'+'f'.repeat(64);await assert.rejects(f.stage(),/IDENTITY/);assert.equal(f.reserves,0);
});

test('OFFLINE UNKNOWN native effect and unavailable Appium inventory deny staging, never release original ownership or claim proof',async t=>{
 for(const state of ['UNKNOWN','BLOCKED']){const f=await fixture(t);f.inspectionState=state;f.inspectionReason=state==='BLOCKED'?'REAL_UNKNOWN_NATIVE_EFFECT':'APPIUM_INVENTORY_UNAVAILABLE';await assert.rejects(f.stage(),/ADMIN_SAFETY/);assert.equal(f.creates,0);assert.equal(f.releases,1);assert.equal(f.registry.list()[0].administrativeAdmission,undefined);}
});

test('OFFLINE simultaneous stage and replayed commit cannot create a second fence or authorize fresh without separate purpose',async t=>{
 const f=await fixture(t),certificate=await f.cert(),command={type:'ADMIN_STAGE',deviceId:'A',certificate,expiresAt:Date.now()+600000};const results=await Promise.allSettled([f.send(command),f.send(command)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.reserves,1);
 const g=await fixture(t);await g.commit();await assert.rejects(g.send(g.commitCommand),/COMMIT_BINDING/);
 await assert.rejects(g.send({...g.commitCommand,type:'ADMIN_AUTHORIZE_FRESH'}),/FRESH_DB_BINDING/);assert.equal(g.creates,0);
});

test('OFFLINE lost Worker response/restart preserves marker but cannot recreate its private reservation or replay OPEN',async t=>{
 const f=await fixture(t);await f.authorize();const saved=f.registry.persisted();await f.registry.shutdown();f.registry=f.newRegistry();f.registry.restore(saved,journal);await assert.rejects(f.send(f.open()),/ADMIN_FRESH/);await assert.rejects(f.send(f.authorizeCommand),/FENCE/);assert.equal(f.creates,0);assert.equal(f.registry.list()[0].administrativeAdmission.status,'AUTHORIZED');
});

test('OFFLINE disk failure, audit corruption and stale database readback fail closed before native creation',async t=>{
 const f=await fixture(t);f.failWrite=true;await assert.rejects(f.stage(),/DISK_FAILURE/);assert.equal(f.creates,0);assert.equal(f.releases,1);
 const saved=f.registry.persisted();saved[0].administrativeAdmission.physicalId='android:'+'f'.repeat(64);assert.throws(()=>new DeviceRuntimeRegistry(f.adapter).restore(saved,journal),/INVALID/);
 const g=await fixture(t);await g.stage();await assert.rejects(g.send({type:'ADMIN_COMMIT',executionId:g.binding.executionId,stageId:g.staged.stageId,certificate:g.certificate,readback:await g.readback(g.certificate,{observedAt:Date.now()-6000})}),/STALE/);assert.equal(g.creates,0);
});

test('OFFLINE pre-existing effects, invented client auth fields, duplicate fresh authorization and clearance scope are rejected',async t=>{
 const legacy=await fixture(t);await assert.rejects(legacy.send({type:'OPEN',requestId:legacy.binding.requestId,recordingRef:legacy.binding.sessionId,deviceId:'A',expectedPhysicalId:physicalId,appRef:'catalog',query:''}),/ALREADY_JOURNALED_NO_REOPEN/);assert.equal(legacy.creates,0);
 const f=await fixture(t);f.legacy.latest.counters.steps=1;f.registry.restore([f.legacy],journal);await assert.rejects(f.stage(),/UNSUPPORTED/);assert.equal(f.reserves,0);
 assert.equal(TeachCommand.safeParse({type:'ADMIN_STAGE',deviceId:'A',certificate:{owner:'local-owner',verified:true},expiresAt:Date.now()+600000}).success,false);
 const g=await fixture(t);await g.authorize();await assert.rejects(g.send(g.authorizeCommand),/FRESH_DB_BINDING/);await assert.rejects(g.send({...g.open(),administrativeClearance:randomUUID()}),/ADMIN_FRESH/);assert.equal(g.creates,0);
});
