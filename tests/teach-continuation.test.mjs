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
const sql=f=>fs.readFileSync('db/teach/'+f,'utf8');
const install=sql('10_install_teach_schema.sql'),v2=sql('proposals/20_admin_orphan_quarantine.sql'),v3=sql('proposals/21_clearance_reauthorization.sql');
const digest='a'.repeat(64);

// Memory-only PostgreSQL, software UV authenticator, fake native adapter. Never reads production owner data.
async function fixture(t,{ttl=600000}={}){
 const db=new PGlite();await db.exec(install);await db.exec(v2);await db.exec(v3);await db.exec(sql('proposals/22_g3_continuation.sql'));await db.exec('SET search_path=public');
 await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES('local-owner','TEACH_REMOTE_STORAGE',true)");
 const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
 const driver={query:async(s,a=[])=>map(await db.query(s,a)),transaction:fn=>db.transaction(tx=>fn({query:async(s,a=[])=>map(await tx.query(s,a))})),close:async()=>{}};
 const repo=new PostgresTeachRepository(driver,'teach_mode'),storage=new TeachStorageService(repo,{workspaceRoot:process.cwd(),cleanupVerified:async()=>true});
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
 const root=path.resolve('coverage/teach-mode-final-real-android-acceptance/continuation-fixtures');fs.mkdirSync(root,{recursive:true});f.directory=fs.mkdtempSync(path.join(root,'case-'));f.file=path.join(f.directory,'tasks.json');
 f.executionId=randomUUID();f.originalRequest=randomUUID();f.legacy={executionId:f.executionId,batchId:f.originalRequest,physicalId:session.physicalId,deviceId:'A',request:'Offline legacy',status:'CANCELLED',createdAt:1,finishedAt:2,events:[],latest:{type:'complete',status:'CANCELLED',counters:{steps:0,snapshots:0}}};
 fs.writeFileSync(f.file,JSON.stringify([f.legacy]));
 const adapter={verifyTeachCleanup:async()=>!f.absenceFailed,administrativeAuthority:async()=>({publicKey,credentialHash:ownerCertificateDigest(credentialId)}),
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
 const worker=async c=>{f.workerCalls.push(c.type);if(f.loseStage&&['ADMIN_REAUTHORIZE_STAGE','CONTINUATION_STAGE'].includes(c.type)){await f.send(c);throw Error('OFFLINE_WORKER_REPLY_LOST');}return f.send(c);};
 f.makeService=()=>new LiveTeachService(repo,storage,{mode:'OFFLINE_TEST'},worker,async()=>{},f.owner,f.file);f.service=f.makeService();
 const actual=repo.reauthorizeAndAdmitFresh.bind(repo);repo.reauthorizeAndAdmitFresh=async(...args)=>{f.databaseCalls++;if(f.failDatabase)throw Error('OFFLINE_DATABASE_FAILURE');const row=await actual(...args);if(f.loseCommit)throw Error('OFFLINE_COMMIT_UNKNOWN');return row;};
 f.prepare=()=>f.service.prepareAdministrativeReauthorization({id:session.id,executionId:f.executionId,open:{deviceId:'A',name:'Offline reauthorization',appAlias:'catalog',command:'Open catalog',query:'coastal research',confirmed:true}});
 f.authorize=async()=>{f.review=await f.prepare();const approvalRef=await f.approve(f.review.reference);f.input={reference:f.review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true};f.client=randomUUID();return f.service.authorizeAdministrativeReauthorization(f.input,f.client);};
 f.restart=async()=>{const saved=f.registry.persisted();await f.registry.shutdown();f.registry=f.makeRegistry();f.registry.restore(saved,hash(fs.readFileSync(f.file)).toString('hex'));f.service=f.makeService();};
 t.after(async()=>{await f.registry.shutdown();storage.stopRetention();await db.close();assert.equal(path.dirname(f.directory),root);fs.rmSync(f.directory,{recursive:true,force:true});});return f;
}


async function released(t){
 const f=await fixture(t),opened=await f.authorize();f.previous=opened;
 await f.send({type:'CANCEL',leaseId:opened.worker.leaseId,ownerToken:opened.ownerToken});
 await f.registry.setOwnerTestMode({enabled:true,deviceId:'A',physicalId:f.original.physicalId});const authorizationId=f.registry.ownerTestModes()[0].id;
 const prepared=await f.service.prepareDurableRecovery({id:opened.id,executionId:opened.worker.executionId,deviceId:'A',authorizationId});
 await f.service.releaseDurableRecovery({reference:prepared.reference,revision:prepared.revision,authorizationId,confirmed:true});
 await f.registry.setOwnerTestMode({enabled:false,deviceId:'A',physicalId:f.original.physicalId});f.closed=false;
 f.parentBefore=await f.repo.administrativeSession(f.original.id);
 f.prepareContinuation=()=>f.service.prepareContinuation({id:f.original.id,executionId:f.executionId,previousId:opened.id,previousExecutionId:opened.worker.executionId,open:{deviceId:'A',name:'Offline continuation',appAlias:'catalog',command:'Open catalog',query:'fresh research',confirmed:true}});
 f.continue=async()=>{const review=await f.prepareContinuation(),approvalRef=await f.approve(review.reference);f.continuationInput={reference:review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true};f.continuationClient=randomUUID();return f.service.authorizeContinuation(f.continuationInput,f.continuationClient);};
 return f;
}
test('OFFLINE continuation: signed UV approval, released predecessor, atomic new child, immutable parent, one native OPEN',async t=>{
 const f=await released(t),opened=await f.continue();assert.equal(f.creates,2);assert.notEqual(opened.id,f.previous.id);
 assert.deepEqual(await f.repo.administrativeSession(f.original.id),f.parentBefore);assert.equal((await f.repo.getSession(f.previous.id)).ownership,'RELEASED');
 assert.equal((await f.db.query('SELECT count(*)::int n FROM teach_mode.teach_continuations')).rows[0].n,1);
 assert.deepEqual(await f.service.authorizeContinuation(f.continuationInput,f.continuationClient),opened);assert.equal(f.creates,2);
 assert.throws(()=>f.service.authorizeContinuation(f.continuationInput,randomUUID()),/REPLAY_BINDING/);
});
test('OFFLINE continuation native absence refusal creates no successor or ledger',async t=>{
 const f=await released(t);f.absenceFailed=true;await assert.rejects(f.continue(),/NATIVE_ABSENCE/);assert.equal(f.creates,1);assert.equal((await f.db.query('SELECT count(*)::int n FROM teach_mode.teach_continuations')).rows[0].n,0);
});
test('OFFLINE continuation duplicate approvals race: one persisted stage and one child',async t=>{
 const f=await released(t),a=await f.prepareContinuation(),b=await f.prepareContinuation(),aa=await f.approve(a.reference),bb=await f.approve(b.reference);
 const results=await Promise.allSettled([f.service.authorizeContinuation({reference:a.reference,approvalRef:aa,confirmNativeOpen:true,riskAccepted:true},randomUUID()),f.service.authorizeContinuation({reference:b.reference,approvalRef:bb,confirmNativeOpen:true,riskAccepted:true},randomUUID())]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.creates,2);assert.deepEqual(await f.repo.administrativeSession(f.original.id),f.parentBefore);
});
test('OFFLINE continuation unknown DB commit never repeats mutation or native OPEN',async t=>{
 const f=await released(t),actual=f.repo.continueAndAdmitFresh.bind(f.repo);let calls=0;f.repo.continueAndAdmitFresh=async x=>{calls++;await actual(x);throw Error('OFFLINE_COMMIT_UNKNOWN');};
 await assert.rejects(f.continue(),/COMMIT_UNKNOWN/);await assert.rejects(f.service.authorizeContinuation(f.continuationInput,f.continuationClient),/COMMIT_UNKNOWN/);assert.equal(calls,1);assert.equal(f.creates,1);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM teach_mode.teach_continuations')).rows[0].n,1);await assert.rejects(f.prepareContinuation(),/JOURNAL|CLEANUP/);
});
test('OFFLINE continuation DB rollback preserves historical parent and no ledger; audit cannot update/delete',async t=>{
 const f=await released(t),review=await f.prepareContinuation(),binding=review.review.binding;
 await assert.rejects(f.repo.continueAndAdmitFresh({binding:{...binding,successorSessionId:f.original.id},authenticationSha256:digest,inspectionSha256:digest,expiresAt:Date.now()+60000}));
 assert.deepEqual(await f.repo.administrativeSession(f.original.id),f.parentBefore);assert.equal((await f.db.query('SELECT count(*)::int n FROM teach_mode.teach_continuations')).rows[0].n,0);
 await f.continue();await assert.rejects(f.db.query('DELETE FROM teach_mode.teach_continuations'));await assert.rejects(f.db.query('UPDATE teach_mode.teach_continuations SET audit=audit'));
});


test('OFFLINE continuation lost Worker stage survives restart as blocked, never retries OPEN',async t=>{
 const f=await released(t);f.loseStage=true;await assert.rejects(f.continue(),/WORKER_REPLY_LOST/);await assert.rejects(f.service.authorizeContinuation(f.continuationInput,f.continuationClient),/WORKER_REPLY_LOST/);assert.equal(f.creates,1);
 await f.restart();await assert.rejects(f.prepareContinuation(),/CLEANUP|JOURNAL/);assert.equal(f.creates,1);
});
test('OFFLINE continuation requires fresh UV, strict origin and installed v4 before native stage',async t=>{
 const f=await released(t);f.noUv=true;await assert.rejects(f.continue(),/PASSKEY/);assert.equal(f.creates,1);
 const response=await liveTeachResponse(new Request('http://localhost/api/teach-recorder',{method:'POST',headers:{host:'localhost',origin:'http://foreign.test','content-type':'application/json'},body:JSON.stringify({type:'PREPARE_CONTINUATION'})}),undefined,undefined,f.service);assert.equal(response.status,403);
 await f.db.exec('DROP FUNCTION teach_mode.teach_continue_and_admit(jsonb)');await assert.rejects(f.prepareContinuation());assert.equal(f.creates,1);
});
test('OFFLINE continuation rejects wrong predecessor and stale approval',async t=>{
 const f=await released(t);await assert.rejects(f.service.prepareContinuation({id:f.original.id,executionId:f.executionId,previousId:f.original.id,previousExecutionId:f.previous.worker.executionId,open:{deviceId:'A',name:'Wrong predecessor',appAlias:'catalog',command:'Open catalog',query:'fresh research',confirmed:true}}),/DATABASE_STATE/);
 const review=await f.prepareContinuation(),approvalRef=await f.approve(review.reference);f.ownerNow=Date.now()+61000;
 assert.throws(()=>f.service.authorizeContinuation({reference:review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true},randomUUID()),/EXPIRED|REPLAYED/);assert.equal(f.creates,1);
});

test('OFFLINE continuation supports a second proven-cleanup generation without changing original audit',async t=>{
 const f=await released(t),first=await f.continue();await f.service.control(first.id,first.ownerToken,'cancel',{revision:first.revision});f.closed=false;
 const review=await f.service.prepareContinuation({id:f.original.id,executionId:f.executionId,previousId:first.id,previousExecutionId:first.worker.executionId,open:{deviceId:'A',name:'Next generation',appAlias:'catalog',command:'Open catalog',query:'another query',confirmed:true}}),approvalRef=await f.approve(review.reference);
 const second=await f.service.authorizeContinuation({reference:review.reference,approvalRef,confirmNativeOpen:true,riskAccepted:true},randomUUID());assert.notEqual(first.id,second.id);assert.equal(f.creates,3);assert.deepEqual(await f.repo.administrativeSession(f.original.id),f.parentBefore);
});
test('OFFLINE unused v4 rollback restores v3 guard and preserves parent/previous sessions',async t=>{
 const f=await released(t),guard=(await f.db.query("SELECT pg_get_functiondef('teach_mode.teach_admin_guard()'::regprocedure) AS source")).rows[0].source;
 assert.match(guard,/teach_continuations/);await f.db.exec(sql('proposals/22_g3_continuation_rollback.sql'));
 assert.equal((await f.db.query("SELECT to_regclass('teach_mode.teach_continuations') AS name")).rows[0].name,null);assert.deepEqual(await f.repo.administrativeSession(f.original.id),f.parentBefore);assert.equal((await f.repo.getSession(f.previous.id)).ownership,'RELEASED');
});

test('OFFLINE unavailable Appium/current native state is detected before asking the owner for a Passkey review',async t=>{
 const f=await released(t);f.inspectionState='UNKNOWN';await assert.rejects(f.prepareContinuation(),/CONTINUATION_PREFLIGHT/);assert.equal(f.creates,1);assert.equal(f.workerCalls.filter(type=>type==='CONTINUATION_STAGE').length,0);assert.equal((await f.db.query('SELECT count(*)::int n FROM teach_mode.teach_continuations')).rows[0].n,0);
});

test('OFFLINE admission diagnostics disclose no capability and never retry a failed native stage',async t=>{
 const f=await released(t),review=await f.prepareContinuation();
 assert.deepEqual(await f.service.admissionStatus(randomUUID()),{state:'REFERENCE_UNAVAILABLE',nativeRetryAuthorized:false});
 assert.equal((await f.service.admissionStatus(review.reference)).state,'NOT_SUBMITTED');
 f.loseStage=true;await assert.rejects(f.continue(),/WORKER_REPLY_LOST/);
 const calls=f.workerCalls.length;
 const request=new Request('http://localhost/api/teach-recorder?review-status='+f.continuationInput.reference,{headers:{host:'localhost'}});
 const response=await liveTeachResponse(request,undefined,undefined,f.service),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.state,'FAILED');assert.equal(result.nativeRetryAuthorized,false);
 assert.equal(f.workerCalls.length,calls);assert.equal(f.creates,1);
 assert.equal(/ownerToken|certificate|approvalRef/.test(JSON.stringify(result)),false);
 await assert.rejects(f.service.admissionStatus('invalid-reference'),/INVALID_RECORDER_REQUEST/);
});
