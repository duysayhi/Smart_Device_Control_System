import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {load} from './helpers/react-skill-console.mjs';
const get=f=>load(path.resolve(f)),hash=v=>createHash('sha256').update(v).digest();
const {PostgresTeachRepository}=get('lib/skills/db/postgres-teach-repository.ts');
const {TeachStorageService}=get('lib/skills/teach-storage-service.ts');
const {LiveTeachService}=get('lib/skills/live-teach-service.ts');
const {OwnerPasskeyService}=get('lib/owner-auth/passkey.ts');
const {DeviceRuntimeRegistry}=get('lib/android/agent/device-runtime.ts');
const {TeachCommand}=get('lib/android/agent/teach-contracts.ts');
const {liveTeachResponse}=get('lib/skills/live-teach-api.ts');
const {ownerCertificateDigest,ownerAuthenticationRuntimeSha256,issueOwnerCertificate,issueOwnerDatabaseReadback}=get('lib/owner-auth/certificates.ts');
const {teachRuntimeDigest}=get('lib/android/agent/runtime-storage.ts');
const {parseAdministrativeAdmission}=get('lib/skills/legacy-retirement-contracts.ts');
const {createTeachLifecycle,appendTeachLifecycle}=get('lib/android/agent/teach-lifecycle.ts');
const sql=f=>fs.readFileSync('db/teach/'+f,'utf8');
const install=sql('10_install_teach_schema.sql'),v2=sql('proposals/20_admin_orphan_quarantine.sql'),v3=sql('proposals/21_clearance_reauthorization.sql');
const digest='a'.repeat(64);

// Memory-only PostgreSQL, software UV authenticator, fake native adapter. Never reads production owner data.
async function fixture(t,{ttl=600000}={}){
 const db=new PGlite();await db.exec(install);await db.exec(v2);await db.exec(v3);await db.exec('SET search_path=public');
 await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES('local-owner','TEACH_REMOTE_STORAGE',true)");
 const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
 const driver={query:async(s,a=[])=>map(await db.query(s,a)),transaction:fn=>db.transaction(tx=>fn({query:async(s,a=[])=>map(await tx.query(s,a))})),close:async()=>{}};
 const repo=new PostgresTeachRepository(driver,'teach_mode'),storage=new TeachStorageService(repo,{workspaceRoot:process.cwd(),cleanupVerified:async()=>false});
 const f={db,repo,storage,creates:0,reserves:0,releases:0,workerCalls:[],databaseCalls:0,closed:false,inspectionState:'CLEAR',deviceStatus:'device'};
 const dev={serial:'A',hardwareSerial:'OFFLINE-'+randomUUID(),model:'Offline',manufacturer:'Fixture'};
 let session=await storage.createSession({device:dev});session=await storage.transitionSession({sessionId:session.id,revision:session.revision,status:'RECORDING'});
 session=await storage.transitionSession({sessionId:session.id,revision:session.revision,status:'INTERRUPTED'});f.original=session;
 const delegation=generateKeyPairSync('ed25519'),issuer={ready:async()=>true,sign:async v=>sign(null,Buffer.from(v),delegation.privateKey).toString('base64url')};
 const publicKey=delegation.publicKey.export({type:'spki',format:'der'}).toString('base64url'),authenticator=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=authenticator.publicKey.export({format:'jwk'}),credentialId=randomBytes(32).toString('base64url'),origin='http://localhost:49861';let counter=0;
 const cose=Buffer.from(isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]))).toString('base64url');
 let state={version:1,origin,osOwnerSha256:digest,issuerPublicKey:publicKey,revision:1,bootstrap:{hash:digest,expiresAt:1,consumed:true},credential:{id:credentialId,publicKey:cose,counter:0,enrolledAt:1,transports:['internal']},audit:[]};
 const store={read:async()=>structuredClone(state),update:async(rev,fn)=>{if(f.failAudit)throw Error('OFFLINE_AUDIT_FAILURE');assert.equal(state.revision,rev);state=fn(structuredClone(state));return state;}};
 f.owner=new OwnerPasskeyService(store,()=>f.ownerNow??Date.now(),issuer);
 f.approve=async reference=>{const begin=await f.owner.beginApproval(reference),client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:begin.options.challenge,origin,crossOrigin:false})),count=Buffer.alloc(4);count.writeUInt32BE(++counter);
  const data=Buffer.concat([hash('localhost'),Buffer.from([f.noUv?1:5]),count]);
  return (await f.owner.finishApproval(begin.reference,{id:credentialId,rawId:credentialId,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:client.toString('base64url'),authenticatorData:data.toString('base64url'),signature:sign('sha256',Buffer.concat([data,hash(client)]),authenticator.privateKey).toString('base64url')}})).approvalRef;};
 const root=path.resolve('coverage/g3-final-unblock-2026-11-03/clearance-reauthorization/fixtures');fs.mkdirSync(root,{recursive:true});f.directory=fs.mkdtempSync(path.join(root,'case-'));f.file=path.join(f.directory,'tasks.json');
 f.executionId=randomUUID();f.originalRequest=randomUUID();f.legacy={executionId:f.executionId,batchId:f.originalRequest,physicalId:session.physicalId,deviceId:'A',request:'Offline legacy',status:'CANCELLED',createdAt:1,finishedAt:2,events:[],latest:{type:'complete',status:'CANCELLED',counters:{steps:0,snapshots:0}}};
 fs.writeFileSync(f.file,JSON.stringify([f.legacy]));
 const adapter={administrativeAuthority:async()=>({publicKey,credentialHash:ownerCertificateDigest(credentialId)}),
  discover:async()=>[{serial:'A',status:f.deviceStatus,identityVerified:true,physicalId:f.wrongPhysical?'android:'+'f'.repeat(64):session.physicalId}],
  inspectAdministrativeState:async()=>{if(f.inspectionGate){f.inspectionEntered?.();await f.inspectionGate;}return {state:f.inspectionState,reason:f.inspectionState==='CLEAR'?'OFFLINE':'REAL_UNKNOWN_NATIVE_EFFECT',physicalId:session.physicalId,at:Date.now(),digest:'e'.repeat(64),rpcCount:0,adbCount:0};},
  teachIdentity:async()=>({...dev,physicalId:session.physicalId}),plan:async()=>assert.fail('No model'),open:async()=>assert.fail('No alternate engine'),
  reserve:async()=>{if(f.reserved||f.externalLock)throw Error('OFFLINE_RESERVATION_BUSY');f.reserved=true;f.reserves++;return async()=>{assert.equal(f.reserved,true);f.reserved=false;f.releases++;};},
  v2:(serial,budget)=>({readiness:async()=>'READY',catalog:{resolve:async()=>({app:{serial,packageName:'org.fixture.catalog',component:'org.fixture.catalog/.Main'}})},open:async()=>{
   f.creates++;for(const e of [{kind:'CREATE_INTENT',nativeServerSha256:'0'.repeat(64)},{kind:'NATIVE_BOUND',nativeSessionId:'OFFLINE-REAUTH'},{kind:'BINDING_VERIFIED'},{kind:'NATIVE_READY'}])await budget.nativeLifecycle(e);
   return {backend:'appium',sessionId:()=>f.closed?undefined:'OFFLINE-REAUTH',observe:async()=>({deviceSerial:'A',snapshotId:randomUUID(),timestamp:Date.now(),foregroundPackage:'org.fixture.other',observationStatus:'OBSERVED',source:'APPIUM',observedAt:new Date().toISOString(),screen:'OBSERVED',nodes:[],elements:[]}),execute:async()=>assert.fail('No UI effects'),close:async()=>{if(f.closed)return;f.closed=true;for(const kind of ['DELETE_INTENT','DELETE_ACK','ABSENCE_VERIFIED','NATIVE_CLOSED'])await budget.nativeLifecycle({kind});}};
  }})};
 f.makeRegistry=()=>new DeviceRuntimeRegistry(adapter,()=>{},async()=>{if(f.failDisk)throw Error('OFFLINE_DISK_FAILURE');fs.writeFileSync(f.file,JSON.stringify(f.registry.persisted()));});
 f.registry=f.makeRegistry();f.registry.restore([f.legacy],hash(fs.readFileSync(f.file)).toString('hex'));
 f.send=c=>f.registry.teach(TeachCommand.parse(c));
 const binding={purpose:'ADMIN_ORPHAN_DISPOSITION',sessionId:session.id,executionId:f.executionId,requestId:f.originalRequest,physicalId:session.physicalId,revision:session.revision,journalSha256:hash(fs.readFileSync(f.file)).toString('hex'),runtimeSha256:teachRuntimeDigest(),ownerAuthSha256:ownerAuthenticationRuntimeSha256(),migrationSha256:digest,freshRequestId:randomUUID(),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',summary:'OFFLINE legacy retirement fixture'};
 f.cert=patch=>{const now=Date.now();return issueOwnerCertificate(issuer,{...binding,...patch},ownerCertificateDigest(credentialId),randomUUID(),now,now+60000);};
 const certificate=await f.cert(),expiresAt=Date.now()+ttl,stage=await f.send({type:'ADMIN_STAGE',deviceId:'A',certificate,expiresAt});
 f.oldClearance={id:randomUUID(),requestId:binding.freshRequestId,sourceSha256:binding.runtimeSha256,expiresAt};
 f.oldAudit={approvalId:randomUUID(),action:'DISPOSE',sessionId:session.id,executionId:f.executionId,requestId:f.originalRequest,physicalId:session.physicalId,beforeRevision:session.revision,actorRef:'local-owner',authenticationEventSha256:ownerCertificateDigest(certificate),acceptedAt:Date.now(),riskAccepted:true,reason:'MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION',cleanupClaim:'UNVERIFIED',pendingAssessment:'HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE',originalJournalSha256:binding.journalSha256,evidenceDigests:[digest],preflightDigest:digest};
 const retired=await repo.retireLegacy(session.id,session.revision,f.oldAudit,f.oldClearance);
 await f.send({type:'ADMIN_COMMIT',executionId:f.executionId,stageId:stage.stageId,certificate,readback:await issueOwnerDatabaseReadback(issuer,{version:1,ownerCertificateId:certificate.id,originalSessionId:session.id,originalRevision:retired.revision,originalOwnership:'ADMIN_DISPOSED_UNVERIFIED',physicalId:session.physicalId,clearanceId:f.oldClearance.id,freshRequestId:binding.freshRequestId,sourceSha256:binding.runtimeSha256,observedAt:Date.now()})});
 f.oldMarker=structuredClone(f.registry.list()[0].administrativeAdmission);
 const worker=async c=>{f.workerCalls.push(c.type);if(f.loseStage&&c.type==='ADMIN_REAUTHORIZE_STAGE'){await f.send(c);throw Error('OFFLINE_WORKER_REPLY_LOST');}return f.send(c);};
 f.makeService=()=>new LiveTeachService(repo,storage,{mode:'OFFLINE_TEST'},worker,async()=>{},f.owner,f.file);f.service=f.makeService();
 const actual=repo.reauthorizeAndAdmitFresh.bind(repo);repo.reauthorizeAndAdmitFresh=async(...args)=>{f.databaseCalls++;if(f.failDatabase)throw Error('OFFLINE_DATABASE_FAILURE');const row=await actual(...args);if(f.loseCommit)throw Error('OFFLINE_COMMIT_UNKNOWN');return row;};
 f.prepare=()=>f.service.prepareAdministrativeReauthorization({id:session.id,executionId:f.executionId,open:{deviceId:'A',name:'Offline reauthorization',appAlias:'catalog',command:'Open catalog',query:'coastal research',confirmed:true}});
 f.authorize=async()=>{f.review=await f.prepare();const approvalRef=await f.approve(f.review.reference);f.input={reference:f.review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true};f.client=randomUUID();return f.service.authorizeAdministrativeReauthorization(f.input,f.client);};
 f.restart=async()=>{const saved=f.registry.persisted();await f.registry.shutdown();f.registry=f.makeRegistry();f.registry.restore(saved,hash(fs.readFileSync(f.file)).toString('hex'));f.service=f.makeService();};
 t.after(async()=>{await f.registry.shutdown();storage.stopRetention();await db.close();assert.equal(path.dirname(f.directory),root);fs.rmSync(f.directory,{recursive:true,force:true});});return f;
}

test('OFFLINE expired unused clearance: real UV signature -> atomic reauthorization -> one fake native OPEN; old history preserved',async t=>{
 const f=await fixture(t,{ttl:1600});await new Promise(r=>setTimeout(r,1700));assert.ok(f.oldClearance.expiresAt<Date.now());
 const opened=await f.authorize(),read=await f.repo.administrativeSession(f.original.id);
 assert.equal(f.creates,1);assert.equal(f.databaseCalls,1);assert.equal(read.session.revision,f.original.revision+3);
 assert.equal(read.session.ownership,'ADMIN_DISPOSED_UNVERIFIED');assert.equal(read.session.status,'INTERRUPTED');
 assert.deepEqual(read.audit[0],f.oldAudit);assert.deepEqual(read.audit[1].previousClearance,f.oldClearance);assert.equal(read.audit[1].cleanupClaim,'UNVERIFIED');
 assert.notEqual(read.clearance.id,f.oldClearance.id);assert.equal(read.clearance.successorSessionId,opened.id);
 const marker=f.registry.list().find(x=>x.executionId===f.executionId).administrativeAdmission;
 assert.equal(marker.status,'DISPATCHED');assert.equal(marker.reauthorizations[0].digest,f.oldMarker.digest);assert.equal(marker.reauthorizations[0].expiresAt,f.oldClearance.expiresAt);
 assert.deepEqual(f.workerCalls,['ADMIN_REAUTHORIZE_STAGE','ADMIN_REAUTHORIZE_COMMIT','IDENTITY','OPEN']);
 await assert.rejects(f.repo.admitAuthorizedFresh(f.original.id,read.session.revision,f.oldClearance,randomUUID(),digest));
 assert.equal((await f.repo.getSession(opened.id)).ownership,'HELD');
});

test('OFFLINE unused unexpired clearance can be explicitly superseded; duplicate/concurrent request shares one operation',async t=>{
 const f=await fixture(t);f.review=await f.prepare();const approvalRef=await f.approve(f.review.reference),input={reference:f.review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true},client=randomUUID();
 const [a,b]=await Promise.all([f.service.authorizeAdministrativeReauthorization(input,client),f.service.authorizeAdministrativeReauthorization(input,client)]);
 assert.deepEqual(a,b);assert.deepEqual(await f.service.authorizeAdministrativeReauthorization(input,client),a);assert.equal(f.creates,1);assert.equal(f.databaseCalls,1);
 assert.throws(()=>f.service.authorizeAdministrativeReauthorization(input,randomUUID()),/REPLAY_BINDING/);
 await assert.rejects(f.prepare(),/DATABASE_STATE/);assert.equal(f.creates,1);
});

test('OFFLINE two distinct approvals racing for the same original revision yield only one successor',async t=>{
 const f=await fixture(t),a=await f.prepare(),b=await f.prepare(),approvalA=await f.approve(a.reference),approvalB=await f.approve(b.reference);
 const result=await Promise.allSettled([[a,approvalA],[b,approvalB]].map(([review,approvalRef])=>f.service.authorizeAdministrativeReauthorization({reference:review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true},randomUUID())));
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.creates,1);assert.equal(f.databaseCalls,1);
});

test('OFFLINE no fresh UV, wrong purpose, expired approval and audit failure never stage or mutate',async t=>{
 const f=await fixture(t),review=await f.prepare(),input={reference:review.reference,approvalRef:randomUUID(),confirmNativeOpen:true,riskAccepted:true};
 assert.throws(()=>f.service.authorizeAdministrativeReauthorization(input,randomUUID()),/OWNER_APPROVAL/);
 f.noUv=true;await assert.rejects(f.approve(review.reference),/OWNER_PASSKEY|UV/);f.noUv=false;
 f.failAudit=true;await assert.rejects(f.approve(review.reference),/AUDIT_FAILURE/);f.failAudit=false;
 const ref=await f.approve(review.reference);f.ownerNow=Date.now()+60001;assert.throws(()=>f.service.authorizeAdministrativeReauthorization({...input,approvalRef:ref},randomUUID()),/OWNER_APPROVAL/);
 const old=await f.cert();await assert.rejects(f.send({type:'ADMIN_REAUTHORIZE_STAGE',deviceId:'A',certificate:old,previousClearance:f.oldClearance,expiresAt:Date.now()+600000}),/BINDING/);
 assert.equal(f.databaseCalls,0);assert.equal(f.creates,0);assert.deepEqual(f.workerCalls,[]);
});

for(const state of ['UNKNOWN','BLOCKED'])test('OFFLINE safety '+state+' refuses reauthorization without DB write',async t=>{
 const f=await fixture(t);f.inspectionState=state;await assert.rejects(f.authorize(),/SAFETY/);assert.equal(f.databaseCalls,0);assert.equal(f.creates,0);
 assert.deepEqual((await f.repo.administrativeSession(f.original.id)).clearance,f.oldClearance);
});

test('OFFLINE physical mismatch/disconnect and pending runtime effect cannot be called clear',async t=>{
 const f=await fixture(t);f.wrongPhysical=true;await assert.rejects(f.authorize(),/IDENTITY/);f.wrongPhysical=false;f.deviceStatus='offline';await assert.rejects(f.authorize(),/IDENTITY/);assert.equal(f.databaseCalls,0);
 f.deviceStatus='device';const other={...f.legacy,executionId:randomUUID(),batchId:randomUUID()};
 let lifecycle=createTeachLifecycle({recordingRef:randomUUID(),executionId:other.executionId,requestId:other.batchId,physicalId:f.original.physicalId,runtimeSha256:digest,teachRuntimeSha256:digest,provenance:'SIMULATED_RECEIPT'});
 for(const e of [{kind:'CREATE_INTENT',nativeServerSha256:digest},{kind:'NATIVE_BOUND',nativeSessionId:'OFFLINE-PENDING'},{kind:'BINDING_VERIFIED'},{kind:'NATIVE_READY'},{kind:'EFFECT_PENDING',effectRequestId:randomUUID()}])lifecycle=appendTeachLifecycle(lifecycle,e);
 other.teachLifecycle=lifecycle;f.registry.restore([...f.registry.persisted(),other],digest);
 await assert.rejects(f.authorize(),/EFFECT_UNRESOLVED/);assert.equal(f.creates,0);assert.equal(f.databaseCalls,0);
 other.teachLifecycle=appendTeachLifecycle(lifecycle,{kind:'EFFECT_RESOLVED',effectRequestId:lifecycle.events.at(-1).effectRequestId,dispatch:'UNKNOWN'});
 f.registry.restore([...f.registry.persisted().filter(x=>x.executionId!==other.executionId),other],digest);
 await assert.rejects(f.authorize(),/EFFECT_UNRESOLVED/);assert.equal(f.creates,0);assert.equal(f.databaseCalls,0);
});

test('OFFLINE shutdown cannot release an inspection fence while reauthorization is in flight',async t=>{
 const f=await fixture(t);let resume;f.inspectionGate=new Promise(resolve=>{resume=resolve;});const entered=new Promise(resolve=>{f.inspectionEntered=resolve;});
 const work=f.authorize();
 try{
  await Promise.race([entered,work.then(()=>{throw Error('Inspection milestone was not observed');})]);
  assert.equal(f.registry.administrativeReauthorizationPending(),true);
  await assert.rejects(f.registry.shutdown(),/REAUTH_IN_PROGRESS/);assert.equal(f.releases,0);
 }finally{resume();await work;}
 assert.equal(f.creates,1);
});

test('OFFLINE restart at RETIRED needs a newly acquired real reservation; a stale external lock stays blocked',async t=>{
 const f=await fixture(t);await f.restart();f.externalLock=true;await assert.rejects(f.authorize(),/RESERVATION_BUSY/);assert.equal(f.creates,0);assert.equal(f.databaseCalls,0);
 f.externalLock=false;await f.authorize();assert.equal(f.creates,1);assert.equal(f.reserves,2);
});

for(const mode of ['failDatabase','loseCommit','loseStage','failDisk'])test('OFFLINE '+mode+' is retained and not automatically replayed',async t=>{
 const f=await fixture(t);f[mode]=true;await assert.rejects(f.authorize());const calls=f.databaseCalls,stages=f.workerCalls.filter(x=>x==='ADMIN_REAUTHORIZE_STAGE').length;
 await assert.rejects(f.service.authorizeAdministrativeReauthorization(f.input,f.client));assert.equal(f.databaseCalls,calls);assert.equal(f.workerCalls.filter(x=>x==='ADMIN_REAUTHORIZE_STAGE').length,stages);assert.equal(f.creates,0);
 if(mode!=='failDisk'){await f.restart();await assert.rejects(f.prepare(),/MARKER|DATABASE_STATE/);}
 else {
  // Failed disk write leaves the old journal readable: a review is not authority. The live RAM fence must reject another stage.
  await assert.rejects(f.authorize(),/PRIOR_INVALID/);
 }
 assert.equal(f.creates,0);
});

test('OFFLINE SQL successor conflict rolls back audit/clearance/revision and preserves original quarantine',async t=>{
 const f=await fixture(t),before=await f.repo.administrativeSession(f.original.id),next={id:randomUUID(),requestId:randomUUID(),sourceSha256:digest,expiresAt:Date.now()+600000};
 const audit={approvalId:randomUUID(),action:'REAUTHORIZE',sessionId:f.original.id,executionId:f.executionId,requestId:f.originalRequest,physicalId:f.original.physicalId,beforeRevision:before.session.revision,actorRef:'local-owner',authenticationEventSha256:digest,acceptedAt:Date.now(),riskAccepted:true,cleanupClaim:'UNVERIFIED',pendingAssessment:'HISTORICAL_GAP_NO_ACTIVE_EFFECT_EVIDENCE',originalJournalSha256:f.oldAudit.originalJournalSha256,priorMarkerSha256:f.oldMarker.digest,preflightDigest:digest,previousClearance:f.oldClearance,newClearance:next};
 await assert.rejects(f.repo.reauthorizeAndAdmitFresh(f.original.id,before.session.revision,audit,f.original.id));assert.deepEqual(await f.repo.administrativeSession(f.original.id),before);
 for(const patch of [{physicalId:'android:'+'f'.repeat(64)},{cleanupClaim:'PROVEN'},{previousClearance:{...f.oldClearance,id:randomUUID()}},{authenticationEventSha256:f.oldAudit.authenticationEventSha256}]){
  await assert.rejects(f.db.query('SELECT * FROM teach_mode.teach_reauthorize_and_admit($1,$2,$3::jsonb,$4)',[f.original.id,before.session.revision,JSON.stringify({...audit,...patch}),randomUUID()]));
 }
 assert.deepEqual(await f.repo.administrativeSession(f.original.id),before);
 const renewed=await f.repo.reauthorizeAndAdmitFresh(f.original.id,before.session.revision,audit,randomUUID());assert.equal(renewed.ownership,'HELD');
 await assert.rejects(f.repo.reauthorizeAndAdmitFresh(f.original.id,before.session.revision,audit,randomUUID()));
 assert.deepEqual((await f.repo.administrativeSession(f.original.id)).audit[1].previousClearance,f.oldClearance);
});

test('OFFLINE HTTP strict binding/origin/confirmation and missing v3 migration fail before native stage',async t=>{
 const f=await fixture(t),url='http://localhost:49861/api/teach-recorder',request=body=>new Request(url,{method:'POST',headers:{Origin:'http://localhost:49861','Content-Type':'application/json','x-teach-client':randomUUID()},body:JSON.stringify(body)});
 const review=await f.prepare();const bad=await liveTeachResponse(request({type:'AUTHORIZE_ADMIN_REAUTHORIZATION',reference:review.reference,approvalRef:randomUUID(),confirmNativeOpen:false,riskAccepted:true}),undefined,undefined,f.service);assert.equal(bad.status,400);
 const foreign=await liveTeachResponse(new Request(url,{method:'POST',headers:{Origin:'https://foreign.invalid'},body:'{}'}),undefined,undefined,f.service);assert.equal(foreign.status,403);
 await assert.rejects(f.service.prepareAdministrativeReauthorization({id:f.original.id,executionId:f.executionId,open:{deviceId:'A',requestId:randomUUID(),name:'Offline',appAlias:'catalog',command:'Open catalog',query:'',confirmed:true}}),/INVALID/);
 f.repo.assertReauthorizationReady=async()=>{throw Error('OFFLINE_V3_NOT_INSTALLED');};await assert.rejects(f.prepare(),/V3_NOT_INSTALLED/);assert.equal(f.creates,0);assert.deepEqual(f.workerCalls,[]);
});

test('OFFLINE corrupt/consumed/source-rebound prior markers cannot be used to acquire a fresh lease',async t=>{
 const f=await fixture(t),saved=f.registry.persisted();saved[0].administrativeAdmission.expiresAt++;assert.throws(()=>parseAdministrativeAdmission(saved[0].administrativeAdmission),/INVALID/);
 assert.throws(()=>f.makeRegistry().restore(saved,digest),/INVALID/);assert.equal(f.creates,0);
 const review=await f.prepare();const binding=f.owner.review(review.reference).binding;
 for(const patch of [{priorMarkerSha256:'f'.repeat(64)},{physicalId:'android:'+'f'.repeat(64)},{runtimeSha256:'f'.repeat(64)},{priorClearanceSha256:'f'.repeat(64)}]){
  await assert.rejects(f.send({type:'ADMIN_REAUTHORIZE_STAGE',deviceId:'A',certificate:await f.cert({...binding,...patch}),previousClearance:f.oldClearance,expiresAt:Date.now()+600000}));
 }
 assert.equal(f.creates,0);assert.equal(f.reserves,1);
});

test('OFFLINE v3 installation keeps ten tables, v2 bytes and original lifecycle guard; SQL install failure rolls back',async()=>{
 assert.equal(hash(sql('proposals/20_admin_orphan_quarantine.sql')).toString('hex'),'5d1d00d0e4eba4b8e17678686f13f0709ac2c80a433671091522f5eeb2b5c134');
 const db=new PGlite();try{await db.exec(install);await db.exec(v2);const guard=(await db.query("SELECT pg_get_functiondef('teach_mode.teach_sessions_guard()'::regprocedure) body")).rows[0].body;
  await assert.rejects(db.exec(v3.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')));await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM teach_mode.teach_schema_migrations')).rows[0].n,2);
  await db.exec(v3);assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='teach_mode' AND table_type='BASE TABLE'")).rows[0].n,10);
  assert.equal((await db.query("SELECT pg_get_functiondef('teach_mode.teach_sessions_guard()'::regprocedure) body")).rows[0].body,guard);
  const acl=(await db.query("SELECT prosecdef,aclexplode(proacl) AS acl FROM pg_proc WHERE oid='teach_mode.teach_reauthorize_and_admit(uuid,integer,jsonb,uuid)'::regprocedure")).rows;
  assert.ok(acl.every(x=>x.prosecdef===false));
  const publicExec=await db.query("SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='teach_mode.teach_reauthorize_and_admit(uuid,integer,jsonb,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'");
  assert.equal(publicExec.rows[0].n,0);
  const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length}),repo=new PostgresTeachRepository({query:async(s,a=[])=>map(await db.query(s,a))},'teach_mode');
  await repo.assertReauthorizationReady();
  await db.exec('DROP FUNCTION teach_mode.teach_reauthorize_and_admit(uuid,integer,jsonb,uuid)');
  await assert.rejects(repo.assertReauthorizationReady(),{code:'DATABASE_ERROR'});
 }finally{await db.close();}
});
