import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,createHash,generateKeyPairSync,sign} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {PGlite} from '@electric-sql/pglite';
import {load} from './helpers/react-skill-console.mjs';
const get=f=>load(path.resolve(f)),hash=x=>createHash('sha256').update(x).digest();
const {OwnerPasskeyService}=get('lib/owner-auth/passkey.ts');
const {PostgresTeachRepository}=get('lib/skills/db/postgres-teach-repository.ts');
const {TeachStorageService}=get('lib/skills/teach-storage-service.ts');
const {LiveTeachService}=get('lib/skills/live-teach-service.ts');
const {DeviceRuntimeRegistry}=get('lib/android/agent/device-runtime.ts');
const {TeachCommand}=get('lib/android/agent/teach-contracts.ts');
const {liveTeachResponse}=get('lib/skills/live-teach-api.ts');

async function fixture(t){
 const db=new PGlite();await db.exec(fs.readFileSync('db/teach/10_install_teach_schema.sql','utf8'));await db.exec(fs.readFileSync('db/teach/proposals/20_admin_orphan_quarantine.sql','utf8'));await db.exec('SET search_path=public');await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES('local-owner','TEACH_REMOTE_STORAGE',true)");
 const f={db,creates:0,retireCalls:0,nativeUnknown:false,workerCalls:[],closed:false};const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
 const driver={query:async(s,a=[])=>map(await db.query(s,a)),transaction:work=>db.transaction(tx=>work({query:async(s,a=[])=>map(await tx.query(s,a))})),close:async()=>{}};
 const repo=new PostgresTeachRepository(driver,'teach_mode');f.repo=repo;let service;
 const storage=new TeachStorageService(repo,{workspaceRoot:process.cwd(),cleanupVerified:async s=>service.cleanupProven(s.id)});f.storage=storage;
 f.device={serial:'A',hardwareSerial:'OFFLINE-'+randomUUID(),manufacturer:'Fixture',model:'Admin model'};let row=await storage.createSession({device:f.device});row=await storage.transitionSession({sessionId:row.id,revision:row.revision,status:'RECORDING'});row=await storage.transitionSession({sessionId:row.id,revision:row.revision,status:'INTERRUPTED'});f.original=row;
 const delegation=generateKeyPairSync('ed25519'),issuer={ready:async()=>true,sign:async value=>sign(null,Buffer.from(value),delegation.privateKey).toString('base64url')},publicKey=delegation.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const authenticator=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=authenticator.publicKey.export({format:'jwk'}),credentialId=randomBytes(32).toString('base64url'),origin='http://localhost:49861';let count=0;
 const cose=Buffer.from(isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]))).toString('base64url');
 let state={version:1,origin,osOwnerSha256:'a'.repeat(64),issuerPublicKey:publicKey,revision:1,bootstrap:{hash:'b'.repeat(64),expiresAt:Date.now()-1,consumed:true},credential:{id:credentialId,publicKey:cose,counter:0,enrolledAt:Date.now(),transports:['internal']},audit:[]};
 const store={read:async()=>structuredClone(state),update:async(revision,change)=>{assert.equal(state.revision,revision);state=change(structuredClone(state));return state;}};
 const owner=new OwnerPasskeyService(store,Date.now,issuer);f.owner=owner;
 f.approve=async reference=>{const start=await owner.beginApproval(reference),client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:start.options.challenge,origin,crossOrigin:false})),counter=Buffer.alloc(4);counter.writeUInt32BE(++count);const data=Buffer.concat([hash('localhost'),Buffer.from([5]),counter]),signature=sign('sha256',Buffer.concat([data,hash(client)]),authenticator.privateKey);
  const approved=await owner.finishApproval(start.reference,{id:credentialId,rawId:credentialId,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:client.toString('base64url'),authenticatorData:data.toString('base64url'),signature:signature.toString('base64url')}});assert.equal('certificate'in approved,false);return approved.approvalRef;};
 const root=path.resolve('coverage/g3-final-unblock-2026-11-03/service-fixtures');fs.mkdirSync(root,{recursive:true});f.directory=fs.mkdtempSync(path.join(root,'case-'));const file=path.join(f.directory,'tasks.json');
 f.executionId=randomUUID();f.originalRequest=randomUUID();const legacy={executionId:f.executionId,batchId:f.originalRequest,physicalId:row.physicalId,deviceId:'A',request:'Offline legacy',status:'CANCELLED',createdAt:1,finishedAt:2,events:[],latest:{type:'complete',status:'CANCELLED',counters:{steps:0,snapshots:0}}};fs.writeFileSync(file,JSON.stringify([legacy]));
 const adapter={administrativeAuthority:async()=>({publicKey,credentialHash:get('lib/owner-auth/certificates.ts').ownerCertificateDigest(credentialId)}),inspectAdministrativeState:async()=>({state:f.nativeUnknown?'UNKNOWN':'CLEAR',reason:f.nativeUnknown?'REAL_UNKNOWN_NATIVE_EFFECT':'FIXTURE',physicalId:row.physicalId,at:Date.now(),digest:'e'.repeat(64),adbCount:0,rpcCount:0}),discover:async()=>[{serial:'A',status:'device',identityVerified:true,physicalId:row.physicalId}],teachIdentity:async()=>({...f.device,physicalId:row.physicalId}),
  plan:async()=>assert.fail('No model'),open:async()=>assert.fail('No legacy engine'),reserve:async()=>async()=>{},
  v2:(serial,budget)=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial,packageName:'org.fixture.catalog',component:'org.fixture.catalog/.Main'}})},open:async()=>{f.creates++;for(const event of [{kind:'CREATE_INTENT',nativeServerSha256:'0'.repeat(64)},{kind:'NATIVE_BOUND',nativeSessionId:'OFFLINE-SERVICE'},{kind:'BINDING_VERIFIED'},{kind:'NATIVE_READY'}])await budget.nativeLifecycle(event);return {backend:'appium',sessionId:()=>f.closed?undefined:'OFFLINE-SERVICE',observe:async()=>({deviceSerial:'A',snapshotId:randomUUID(),timestamp:Date.now(),foregroundPackage:'org.fixture.other',observationStatus:'OBSERVED',source:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',nodes:[],elements:[]}),execute:async()=>assert.fail('No native action'),close:async()=>{if(f.closed)return;f.closed=true;for(const kind of ['DELETE_INTENT','DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED'])await budget.nativeLifecycle({kind});}};}})};
 const registry=new DeviceRuntimeRegistry(adapter,()=>{},async()=>fs.writeFileSync(file,JSON.stringify(registry.persisted())));registry.restore([legacy],hash(fs.readFileSync(file)).toString('hex'));f.registry=registry;
 const worker=async command=>{f.workerCalls.push(command.type);return registry.teach(TeachCommand.parse(command));};
 service=new LiveTeachService(repo,storage,{mode:'OFFLINE_TEST'},worker,async()=>{},owner,file);f.service=service;
 const realRetire=repo.retireLegacy.bind(repo);repo.retireLegacy=async(...args)=>{f.retireCalls++;const result=await realRetire(...args);if(f.loseCommit)throw Error('OFFLINE_COMMIT_OUTCOME_UNKNOWN');return result;};
 f.prepare=()=>service.prepareAdministrativeRecovery({id:row.id,executionId:f.executionId,deviceId:'A'});
 f.retire=async()=>{f.review=await f.prepare();f.approvalRef=await f.approve(f.review.reference);f.retireInput={reference:f.review.reference,approvalRef:f.approvalRef,riskAccepted:true};return service.retireAdministrativeRecovery(f.retireInput);};
 t.after(async()=>{await registry.shutdown();storage.stopRetention();await db.close();assert.equal(path.dirname(f.directory),root);fs.rmSync(f.directory,{recursive:true,force:true});});return f;
}

test('OFFLINE real WebAuthn approval -> existing service -> PGlite retirement -> signed Worker readback, original stays UNVERIFIED',async t=>{
 const f=await fixture(t),[a,b]=await(async()=>{f.review=await f.prepare();const approvalRef=await f.approve(f.review.reference),input={reference:f.review.reference,approvalRef,riskAccepted:true};return Promise.all([f.service.retireAdministrativeRecovery(input),f.service.retireAdministrativeRecovery(input)]);})();assert.deepEqual(a,b);assert.equal(f.retireCalls,1);assert.equal(a.cleanup,'UNVERIFIED');assert.equal(f.creates,0);assert.deepEqual(f.workerCalls,['ADMIN_STAGE','ADMIN_COMMIT']);
 const stored=await f.repo.administrativeSession(f.original.id);assert.equal(stored.session.ownership,'ADMIN_DISPOSED_UNVERIFIED');assert.equal(stored.session.status,'INTERRUPTED');assert.equal(stored.audit[0].cleanupClaim,'UNVERIFIED');assert.equal(f.registry.list()[0].administrativeAdmission.status,'RETIRED');
 const input={requestId:a.freshRequestId,deviceId:'A',name:'Offline admin search',appAlias:'catalog',command:'Open catalog',query:'coastal research',confirmed:true},fresh=await f.service.prepareAdministrativeFresh({reference:f.review.reference,open:input});const approvalRef=await f.approve(fresh.reference),command={reference:fresh.reference,approvalRef,confirmNativeOpen:true},client=randomUUID();const [opened,duplicate]=await Promise.all([f.service.authorizeAdministrativeFresh(command,client),f.service.authorizeAdministrativeFresh(command,client)]);assert.deepEqual(opened,duplicate);assert.equal(f.creates,1);assert.equal(f.workerCalls.filter(c=>c==='OPEN').length,1);assert.equal((await f.repo.administrativeSession(f.original.id)).session.ownership,'ADMIN_DISPOSED_UNVERIFIED');
 assert.throws(()=>f.service.authorizeAdministrativeFresh(command,randomUUID()),/REPLAY_BINDING_MISMATCH/);assert.throws(()=>f.service.authorizeAdministrativeFresh({...command,approvalRef:randomUUID()},client),/REPLAY_BINDING_MISMATCH/);assert.equal(f.creates,1);
 const closed=await f.service.control(opened.id,opened.ownerToken,'stop',{revision:opened.revision});assert.equal(closed.worker.cleanup,'PROVEN');assert.equal((await f.repo.getSession(opened.id)).ownership,'RELEASED');
});

test('OFFLINE approval reference/checkbox/foreign client cannot substitute for genuine Owner authentication',async t=>{
 const f=await fixture(t),review=await f.prepare();assert.throws(()=>f.service.retireAdministrativeRecovery({reference:review.reference,approvalRef:randomUUID(),riskAccepted:true}),/OWNER_APPROVAL/);assert.equal(f.retireCalls,0);assert.deepEqual(f.workerCalls,[]);
 const response=await liveTeachResponse(new Request('http://localhost:49861/api/teach-recorder',{method:'POST',headers:{Origin:'https://foreign.invalid','Content-Type':'application/json'},body:JSON.stringify({type:'RETIRE_ADMIN_RECOVERY',reference:review.reference,approvalRef:randomUUID(),riskAccepted:true})}),undefined,undefined,f.service);assert.equal(response.status,403);
 const approved=await f.approve(review.reference);assert.throws(()=>f.service.retireAdministrativeRecovery({reference:review.reference,approvalRef:approved,riskAccepted:false}));assert.equal(f.retireCalls,0);
});

test('OFFLINE UNKNOWN native safety inspection prevents DB retirement and fresh OPEN even with valid Passkey approval',async t=>{
 const f=await fixture(t);f.nativeUnknown=true;await assert.rejects(f.retire(),/ADMIN_SAFETY/);assert.equal(f.retireCalls,0);assert.equal(f.creates,0);assert.equal((await f.repo.getSession(f.original.id)).ownership,'RETAINED_PENDING_CLEANUP');
});

test('OFFLINE lost DB commit response is never replayed; readback exposes ADMIN state without inventing Worker commit proof',async t=>{
 const f=await fixture(t);f.loseCommit=true;await assert.rejects(f.retire(),/COMMIT_OUTCOME_UNKNOWN/);await assert.rejects(f.service.retireAdministrativeRecovery(f.retireInput),/COMMIT_OUTCOME_UNKNOWN/);assert.equal(f.retireCalls,1);assert.equal((await f.repo.getSession(f.original.id)).ownership,'ADMIN_DISPOSED_UNVERIFIED');assert.equal(f.registry.list()[0].administrativeAdmission.status,'STAGED');assert.equal(f.creates,0);await assert.rejects(f.service.prepareAdministrativeFresh({reference:f.review.reference,open:{requestId:randomUUID(),deviceId:'A',name:'Offline attempt',appAlias:'catalog',command:'Open catalog',query:'',confirmed:true}}),/REFERENCE_INVALID/);
});

test('OFFLINE DB readback mismatch cannot be signed as clearance or authorize native dispatch',async t=>{
 const f=await fixture(t),read=f.repo.administrativeSession.bind(f.repo);f.repo.administrativeSession=async id=>{const result=await read(id);return result.session.ownership==='ADMIN_DISPOSED_UNVERIFIED'?{...result,session:{...result.session,physicalId:'android:'+'f'.repeat(64)}}:result;};
 await assert.rejects(f.retire(),/READBACK_MISMATCH/);assert.equal(f.retireCalls,1);assert.deepEqual(f.workerCalls,['ADMIN_STAGE']);assert.equal(f.creates,0);
});
