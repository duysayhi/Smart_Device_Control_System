import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {load} from './helpers/react-skill-console.mjs';
const get=file=>load(path.resolve(file));
const {reviewOrphanDisposition}=get('lib/skills/orphan-disposition.ts');
const {TeachStorageService}=get('lib/skills/teach-storage-service.ts');
const {PostgresTeachRepository}=get('lib/skills/db/postgres-teach-repository.ts');
const {DeviceRuntimeRegistry}=get('lib/android/agent/device-runtime.ts');
const hash='a'.repeat(64),physicalId='android:'+hash,now=1793600000000;
const sources=['DEVICE_IDENTITY','WORKER_TASKS','DEVICE_RESERVATIONS','PHYSICAL_LOCKS','APPIUM_SESSIONS','PENDING_EFFECT_RECONCILIATION'];
function input(binding={sessionId:randomUUID(),executionId:randomUUID(),requestId:randomUUID(),physicalId,revision:3,originalJournalSha256:hash}){
 return {inspection:{binding:{...binding},status:'INTERRUPTED',ownership:'RETAINED_PENDING_CLEANUP',legacyAttestation:'MISSING',evidenceDigests:[hash],pending:'NONE',
  observations:sources.map(source=>({source,at:now,digest:hash,physicalId:binding.physicalId,verdict:'CLEAR'}))},
  owner:{subject:'local-owner',purpose:'ADMIN_ORPHAN_DISPOSITION',binding:{...binding},authenticationEventSha256:hash,authenticatedAt:now-1000,expiresAt:now+1000,revoked:false},
  approval:{approvalId:randomUUID(),binding:{...binding},authenticationEventSha256:hash,riskAccepted:true,risk:'MISSING_ORIGINAL_NATIVE_CLEANUP_ATTESTATION',acceptedAt:now}};
}
const blocked=value=>assert.equal(reviewOrphanDisposition(value,now).verdict,'BLOCKED');
test('OFFLINE legacy unattested pending effects remain blocked even with explicit risk acceptance',()=>{
 const x=input();x.inspection.pending='UNATTESTED';assert.equal(reviewOrphanDisposition(x,now).reason,'PENDING_EFFECT_UNRECONCILED');
});
for(const pending of ['PENDING','UNKNOWN'])test('OFFLINE no administrative override of '+pending,()=>{const x=input();x.inspection.pending=pending;blocked(x);});
test('OFFLINE exact original recording/execution/request/revision/physical binding required',()=>{
 for(const field of ['sessionId','executionId','requestId','physicalId','revision','originalJournalSha256']){
  const x=structuredClone(input());x.owner.binding[field]=field==='revision'?4:field==='physicalId'?'android:'+'b'.repeat(64):field==='originalJournalSha256'?'b'.repeat(64):randomUUID();blocked(x);
 }
});
test('OFFLINE foreign, expired, revoked, wrong-purpose and unauthenticated owners cannot produce review readiness',()=>{
 for(const patch of [{subject:'foreign'},{expiresAt:now},{revoked:true},{purpose:'OPEN_APPLICATION'},{authenticatedAt:now+1}]){const x=input();Object.assign(x.owner,patch);blocked(x);}
});
test('OFFLINE explicit risk acceptance is bound to the authentication event and expires',()=>{
 for(const patch of [{riskAccepted:false},{authenticationEventSha256:'b'.repeat(64)},{acceptedAt:now-120000}]){const x=input();Object.assign(x.approval,patch);blocked(x);}
});
test('OFFLINE preflight must cover every source once, fresh, clear and on the same physical identity',()=>{
 for(const change of [x=>x.inspection.observations[0].verdict='UNKNOWN',x=>x.inspection.observations[1].verdict='CONFLICT',
  x=>x.inspection.observations[2].at=now-5001,x=>x.inspection.observations[3].physicalId='android:'+'c'.repeat(64),
  x=>x.inspection.observations[4].source='PHYSICAL_LOCKS']){const x=input();change(x);blocked(x);}
});
test('OFFLINE deterministic review is immutable, unverified and quarantined, never an execution grant',()=>{
 const x=input(),before=JSON.stringify(x),a=reviewOrphanDisposition(x,now);assert.deepEqual(a,reviewOrphanDisposition(x,now));assert.equal(JSON.stringify(x),before);
 assert.equal(a.verdict,'READY_FOR_OWNER_REVIEW');assert.equal(a.cleanup,'UNVERIFIED');assert.equal(a.admission,'QUARANTINED');assert.equal(a.audit.beforeRevision,3);
 assert.equal('revision' in a.audit,false);assert.equal('grant' in a,false);assert.equal('verified' in a,false);
});
test('OFFLINE invalid/secret-bearing client extras are rejected without echoing values in errors',()=>{
 const x=input();x.inspection.token='fixture-private-do-not-echo';const result=reviewOrphanDisposition(x,now);assert.equal(result.verdict,'BLOCKED');assert.equal(JSON.stringify(result).includes('fixture-private'),false);
});

let db,driver,repository,storage,originalGuard;
const proposal=new URL('../db/teach/proposals/20_admin_orphan_quarantine.sql',import.meta.url);
const rows=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
before(async()=>{
 db=new PGlite();await db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql',import.meta.url),'utf8'));
 originalGuard=(await db.query("SELECT pg_get_functiondef('teach_mode.teach_sessions_guard()'::regprocedure) AS body")).rows[0].body;
 await db.exec(fs.readFileSync(proposal,'utf8'));await db.exec('SET search_path TO public');
 await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
 driver={query:async(sql,args=[])=>rows(await db.query(sql,args)),transaction:work=>db.transaction(tx=>work({query:async(sql,args=[])=>rows(await tx.query(sql,args))})),close:async()=>db.close()};
 repository=new PostgresTeachRepository(driver,'teach_mode');storage=new TeachStorageService(repository,{workspaceRoot:path.resolve('coverage/orphan-offline-assets')});
});
after(async()=>{storage?.stopRetention();await db?.close();});
async function retained(){
 const device={serial:'fixture-'+randomUUID(),hardwareSerial:'FIXTURE-'+randomUUID(),model:'Offline fixture',manufacturer:'Fixture'};
 const s=await storage.createSession({device}),r=await storage.transitionSession({sessionId:s.id,revision:s.revision,status:'RECORDING'});
 return {session:await storage.transitionSession({sessionId:r.id,revision:r.revision,status:'INTERRUPTED'}),device};
}
function audit(s){return reviewOrphanDisposition(input({sessionId:s.id,executionId:randomUUID(),requestId:randomUUID(),physicalId:s.physicalId,revision:s.revision,originalJournalSha256:hash}),now).audit;}
// Fixture-only implementation of the proposed extension interface. No production wiring.
const fixtureRepository=()=>({
 recordAdministrativeDisposition:async(binding,a)=>(await db.query('SELECT * FROM teach_mode.teach_record_admin_disposition($1,$2,$3::jsonb)',[binding.sessionId,binding.revision,JSON.stringify(a)])).rows[0],
 readAdministrativeDisposition:async(id)=>(await db.query('SELECT * FROM teach_mode.teach_sessions WHERE id=$1',[id])).rows[0],
});
const commit=(s,a)=>fixtureRepository().recordAdministrativeDisposition({sessionId:s.id,revision:s.revision},a);
test('OFFLINE proposed SQL keeps original guard body, existing tables and normal G3 repository lifecycle',async()=>{
 assert.equal((await db.query("SELECT pg_get_functiondef('teach_mode.teach_sessions_guard()'::regprocedure) AS body")).rows[0].body,originalGuard);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='teach_mode' AND table_type='BASE TABLE'")).rows[0].n,10);
 const {session:s}=await retained();assert.equal(s.ownership,'RETAINED_PENDING_CLEANUP');assert.equal(s.status,'INTERRUPTED');
 const publicGrant=(await db.query("SELECT acl::text AS acl FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid='teach_mode.teach_record_admin_disposition(uuid,integer,jsonb)'::regprocedure AND acl.grantee=0")).rows;
 assert.equal(publicGrant.length,0);
});
test('OFFLINE administrative state persists audit atomically, never RELEASED or PROVEN',async()=>{
 const {session:s}=await retained(),a=audit(s),result=await commit(s,a);
 assert.equal(result.ownership_state,'ADMIN_DISPOSED_UNVERIFIED');assert.equal(result.status,'INTERRUPTED');assert.equal(result.revision,s.revision+1);
 assert.deepEqual(result.administrative_audit,[a]);assert.equal(result.interrupted_reason,s.interruptedReason);
 const next=await fixtureRepository().readAdministrativeDisposition(s.id);assert.deepEqual(next.administrative_audit,[a]);
});
test('OFFLINE duplicate approval returns same record; same key different binding is rejected',async()=>{
 const {session:s}=await retained(),a=audit(s),first=await commit(s,a),second=await commit(s,a);assert.deepEqual(second,first);
 await assert.rejects(commit(s,{...a,executionId:randomUUID()}));assert.equal((await fixtureRepository().readAdministrativeDisposition(s.id)).revision,first.revision);
});
test('OFFLINE competing revisions serialize to one administrative transition; not evidence of real PostgreSQL MVCC timing',async()=>{
 const {session:s}=await retained(),a=audit(s),b=audit(s),results=await Promise.allSettled([commit(s,a),commit(s,b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal((await fixtureRepository().readAdministrativeDisposition(s.id)).administrative_audit.length,1);
});
test('OFFLINE wrong physical identity, UNKNOWN effect and audit-write failure leave ownership/revision unchanged',async()=>{
 for(const patch of [{physicalId:'android:'+'b'.repeat(64)},{pendingAssessment:'UNKNOWN'},{cleanupClaim:'PROVEN'},{privateValue:'do-not-persist'}]){
  const {session:s}=await retained();await assert.rejects(commit(s,{...audit(s),...patch}));const r=await repository.getSession(s.id);assert.equal(r.revision,s.revision);assert.equal(r.ownership,s.ownership);
 }
});
test('OFFLINE interrupted transaction rolls back both disposition and audit; no automatic retry',async()=>{
 const {session:s}=await retained(),a=audit(s);let attempts=0;
 await assert.rejects(db.transaction(async tx=>{attempts++;await tx.query('SELECT * FROM teach_mode.teach_record_admin_disposition($1,$2,$3::jsonb)',[s.id,s.revision,JSON.stringify(a)]);throw Error('OFFLINE_TRANSACTION_ABORT');}));
 assert.equal(attempts,1);assert.equal((await repository.getSession(s.id)).revision,s.revision);assert.deepEqual((await fixtureRepository().readAdministrativeDisposition(s.id)).administrative_audit,[]);
});
test('OFFLINE lost commit response/new repository reads durable decision without reapplying a mutation',async()=>{
 const {session:s}=await retained(),a=audit(s);await commit(s,a);const restored=await fixtureRepository().readAdministrativeDisposition(s.id);
 assert.equal(restored.revision,s.revision+1);assert.deepEqual(restored.administrative_audit,[a]);
});
test('OFFLINE administrative quarantine blocks new DB sessions before old clients could dispatch native OPEN',async()=>{
 const {session:s,device}=await retained();await commit(s,audit(s));await assert.rejects(storage.createSession({device}));
 await assert.rejects(db.query("UPDATE teach_mode.teach_sessions SET ownership_state='RELEASED' WHERE id=$1",[s.id]));
 await assert.rejects(db.query('DELETE FROM teach_mode.teach_sessions WHERE id=$1',[s.id]));
});
test('OFFLINE rollback is append-only requarantine; cannot erase audit or downgrade to verified cleanup',async()=>{
 const {session:s}=await retained(),a=audit(s),disposed=await commit(s,a),back={...a,approvalId:randomUUID(),beforeRevision:disposed.revision,action:'REQUARANTINE'};
 const restored=await commit({...s,revision:disposed.revision},back);assert.equal(restored.ownership_state,'RETAINED_PENDING_CLEANUP');assert.equal(restored.administrative_audit.length,2);
 await assert.rejects(db.query("UPDATE teach_mode.teach_sessions SET administrative_audit='[]'::jsonb WHERE id=$1",[s.id]));
 const regular=new PostgresTeachRepository(driver,'teach_mode');assert.equal((await regular.getOwnedSession(s.physicalId)).id,s.id);
});
test('OFFLINE Worker restart with legacy journal never fabricates attestation or sends native OPEN',async()=>{
 const executionId=randomUUID(),requestId=randomUUID(),recordingRef=randomUUID();let nativeCalls=0;
 const adapter={discover:async()=>[{serial:'A',physicalId,identityVerified:true,status:'device'}],plan:async()=>{nativeCalls++;assert.fail('No planner');},open:async()=>{nativeCalls++;assert.fail('No native open');}};
 const registry=new DeviceRuntimeRegistry(adapter);registry.restore([{executionId,batchId:requestId,deviceId:'A',physicalId,request:'Fixture legacy admission',agentVersion:2,status:'CANCELLED',createdAt:now,finishedAt:now+1,events:[]}]);
 await registry.setOwnerTestMode({enabled:true,deviceId:'A',physicalId});const authorizationId=registry.ownerTestModes()[0].id;
 await assert.rejects(registry.teach({type:'RECOVERY_PREPARE',recordingRef,executionId,deviceId:'A',physicalId,authorizationId}),e=>e.code==='RECOVERY_ATTESTATION_MISSING');
 assert.equal(nativeCalls,0);assert.equal(registry.list()[0].teachLifecycle,undefined);await registry.setOwnerTestMode({enabled:false,deviceId:'A',physicalId});
});
test('OFFLINE readiness module/proposed SQL have no production API/Worker import or automatic migration',()=>{
 const directories=['app','lib/android'];let consumers=0;
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(/\.[cm]?[jt]sx?$/.test(file)&&/orphan-disposition|20_admin_orphan_quarantine/.test(fs.readFileSync(file,'utf8')))consumers++;}}
 for(const directory of directories)walk(directory);assert.equal(consumers,0);
 assert.equal(createHash('sha256').update(originalGuard).digest('hex').length,64);
});
