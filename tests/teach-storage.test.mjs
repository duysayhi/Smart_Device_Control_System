import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import Module from 'node:module';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const load=createRequire(import.meta.url);
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);
const {TeachStorageService}=load('../lib/skills/teach-storage-service.ts');
const {PostgresTeachRepository,teachDatabaseSchema}=load('../lib/skills/db/postgres-teach-repository.ts');
const {TeachStorageError,teachStorageError}=load('../lib/skills/db/teach-errors.ts');
const {TeachAssetStore}=load('../lib/skills/teach-assets.ts');
const {sanitizeSnapshot}=load('../lib/skills/snapshot-sanitizer.ts');
const {readTransportIdentity}=load('../lib/android/transport-identity.ts');
const {PgTeachDatabase}=load('../lib/skills/db/pg-database.ts');
let db,repository,service;
const workspace=path.resolve('coverage/teach-gates1-4-2026-10-29/storage-fixture-'+randomUUID());
const queries=[];
const map=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
const driver={query:async(sql,values=[])=>{queries.push(sql);return map(await db.query(sql,values));},transaction:async work=>db.transaction(tx=>work({query:async(sql,values=[])=>{queries.push(sql);return map(await tx.query(sql,values));}})),close:async()=>db.close()};
const field={semanticRole:'search_field',label:'Search',containerRole:'search'},entry={semanticRole:'search_action',label:'Search',containerRole:'toolbar'};
const skill=()=>({schemaVersion:1,name:'A safe search',appScope:{alias:'youtube'},parameters:{query:{type:'string',maxLength:500,required:true,description:'Exact search phrase.'}},maxSteps:20,steps:[
  {id:'open',operation:'OPEN_APPLICATION',arguments:{appRef:'youtube'},verify:{kind:'FOREGROUND_IS',appRef:'youtube'},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'},
  {id:'search',operation:'ACTIVATE_CONTROL',arguments:{target:entry,purpose:'SEARCH'},verify:{kind:'ELEMENT_VISIBLE',target:field},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'},
  {id:'input',operation:'INPUT_TEXT',arguments:{target:field,value:{param:'query'}},verify:{kind:'WIDGET_STATE',target:field,property:'value',expected:{param:'query'}},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'},
  {id:'submit',operation:'SUBMIT_SEARCH',arguments:{scope:'search'},verify:{kind:'SEARCH_OUTCOME_MATCHES',scope:'search',value:{param:'query'}},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'}]});
const hardware=()=>({serial:'usb-'+randomUUID(),hardwareSerial:'HW-'+randomUUID(),manufacturer:'Fixture',model:'ModelA',androidVersion:'11'});
const live=extra=>[{className:'android.widget.EditText',text:'synthetic-private-search',description:'Search',hint:'Search',resourceId:'fixture:id/search',password:false,secure:false,sensitive:false,fieldType:'SEARCH',enabled:true,displayed:true,...extra}];
const fails=async(promise,code)=>assert.rejects(promise,e=>e instanceof TeachStorageError&&e.code===code);
before(async()=>{
  fs.mkdirSync(workspace,{recursive:true});db=new PGlite();await db.exec(fs.readFileSync(new URL('../db/teach/10_install_teach_schema.sql',import.meta.url),'utf8'));
  await db.exec('SET search_path TO public');
  // Fixture-only owner consent. No production service method can create consent.
  await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
  repository=new PostgresTeachRepository(driver,'teach_mode');service=new TeachStorageService(repository,{workspaceRoot:workspace});
});
after(async()=>{service?.stopRetention();await db?.close();});
async function recording(){const created=await service.createSession({device:hardware()});return service.transitionSession({sessionId:created.id,revision:created.revision,status:'RECORDING'});}
for(const [sql,domain] of Object.entries({TH001:'IMMUTABLE',TH002:'INVALID_TRANSITION',TH003:'EVIDENCE_REJECTED',TH004:'CURRENT_VERSION_MISMATCH',TH005:'APPEND_ONLY',TH006:'SNAPSHOT_REQUIRED',TH007:'EXECUTION_MISMATCH',TH008:'PHYSICAL_IDENTITY_REQUIRED',TH009:'SNAPSHOT_DEVICE_MISMATCH',TH010:'SNAPSHOT_SESSION_MISMATCH',TH011:'NO_REMOTE_CONSENT',TH012:'NOT_RECORDING','23505':'CONFLICT','23514':'CONSTRAINT_REJECTED','23503':'REFERENCE_CONFLICT','23001':'REFERENCE_CONFLICT'}))test('C1 maps '+sql+' without exposing vendor details',()=>{
  const e=teachStorageError({code:sql,message:'synthetic-private-vendor-data',detail:'synthetic-private-vendor-data'});assert.equal(e.code,domain);assert.equal(e.message.includes('synthetic-private'),false);assert.equal(JSON.stringify(e).includes('synthetic-private'),false);
});
for(const schema of ['public;DROP SCHEMA x','a.b','CAPS','a"b','../teach','x'.repeat(64),''])test('C1 rejects unsafe schema identifier before SQL: '+schema,()=>{assert.throws(()=>teachDatabaseSchema(schema),e=>e.code==='INVALID_SCHEMA');});
test('C1 physical identity matches the runtime canonical tuple; transport serial never persists raw',async()=>{
  const d=hardware(),s=await service.createSession({device:d});
  const runtime=await readTransportIdentity(async()=>({stdout:`[ro.serialno]: [${d.hardwareSerial}]\n[ro.boot.serialno]: [${d.hardwareSerial}]\n[ro.product.manufacturer]: [${d.manufacturer}]\n[ro.product.model]: [${d.model}]\n[ro.build.version.release]: [11]\n`,stderr:''}),d.serial,true);
  assert.equal(s.physicalId,runtime.physicalId);
  const row=(await db.query('SELECT * FROM teach_mode.devices WHERE id=$1',[s.deviceId])).rows[0];assert.equal(row.serial_hash,createHash('sha256').update(d.serial).digest('hex'));
  assert.equal(JSON.stringify(row).includes(d.serial),false);assert.equal(JSON.stringify(row).includes(d.hardwareSerial),false);
});
test('C1 USB and Wi-Fi registrations with the same physical tuple upsert one device',async()=>{
  const d=hardware(),a=await service.createSession({device:d}),b=await service.createSession({device:{...d,serial:'192.168.50.2:33333'}});assert.equal(a.deviceId,b.deviceId);
});
test('C1 a numeric transport identifier is accepted transiently and only its hash is persisted',async()=>{
  const d={...hardware(),serial:'1234567890123456'},s=await service.createSession({device:d});
  const row=(await db.query('SELECT * FROM teach_mode.devices WHERE id=$1',[s.deviceId])).rows[0];assert.equal(row.serial_hash,createHash('sha256').update(d.serial).digest('hex'));assert.equal(JSON.stringify(row).includes(d.serial),false);
});
test('C1 duplicate physical identity rows are blocked, never silently merged',async()=>{
  const d=hardware(),a=await service.createSession({device:d});await db.query('INSERT INTO teach_mode.devices(serial_hash,physical_identity_hash,model,manufacturer) VALUES ($1,$2,$3,$4)',['synthetic-hash',a.physicalId,d.model,d.manufacturer]);
  await fails(service.createSession({device:d}),'PHYSICAL_IDENTITY_AMBIGUOUS');
});
test('C1 session lifecycle and optimistic revision lock preserve an interrupted ownership',async()=>{
  const s=await recording();assert.equal(s.ownership,'HELD');await fails(service.transitionSession({sessionId:s.id,revision:1,status:'REVIEWING'}),'CONFLICT');
  const interrupted=await service.transitionSession({sessionId:s.id,revision:s.revision,status:'INTERRUPTED'});assert.equal(interrupted.ownership,'RETAINED_PENDING_CLEANUP');
  await fails(service.releaseAfterCleanup({sessionId:interrupted.id,revision:interrupted.revision}),'CLEANUP_UNPROVEN');assert.equal((await service.getSession(s.id)).ownership,'RETAINED_PENDING_CLEANUP');
  let transactionDepth=0;const observed={...driver,transaction:async work=>{transactionDepth++;try{return await driver.transaction(work);}finally{transactionDepth--;}}};
  const trusted=new TeachStorageService(new PostgresTeachRepository(observed),{workspaceRoot:workspace,cleanupVerified:async()=>{assert.equal(transactionDepth,0);return true;}});
  const released=await trusted.releaseAfterCleanup({sessionId:s.id,revision:interrupted.revision});assert.equal(released.ownership,'RELEASED');assert.equal(released.status,'INTERRUPTED');
});
test('C1 normal CREATED -> RECORDING -> REVIEWING -> COMPILED -> FINISHED is valid',async()=>{
  let s=await service.createSession({device:hardware()});for(const status of ['RECORDING','REVIEWING','COMPILED','FINISHED'])s=await service.transitionSession({sessionId:s.id,revision:s.revision,status});assert.equal(s.status,'FINISHED');
});
test('C1 wrong session transition remains TH002 and no stale revision is rewritten',async()=>{
  const s=await service.createSession({device:hardware()});await fails(service.transitionSession({sessionId:s.id,revision:s.revision,status:'FINISHED'}),'INVALID_TRANSITION');assert.equal((await service.getSession(s.id)).status,'CREATED');
});
test('C1 snapshots persist only sanitized semantics and an explicit redaction status',async()=>{
  const s=await recording(),r=await service.storeSnapshot({sessionId:s.id,liveNodes:live(),persistAsset:true});assert.equal(r.redactionStatus,'REDACTED');assert.ok(r.assetRef);
  const content=fs.readFileSync(path.join(workspace,'data/teach-mode/assets',r.assetRef),'utf8');assert.equal(content.includes('synthetic-private-search'),false);assert.equal(content.includes('bounds'),false);
  const raw=(await db.query('SELECT screenshot_ref,redaction_status,ui_semantics FROM teach_mode.ui_snapshots WHERE id=$1',[r.id])).rows[0];assert.equal(raw.screenshot_ref,null);assert.equal(raw.redaction_status,'REDACTED');
});
test('T9 sensitive and unknown snapshots omit raw values and never create screenshot/assets',async()=>{
  const s=await recording();for(const node of [live({password:true,text:'synthetic-secret'}),[{text:'synthetic-secret'}]]){
    const r=await service.storeSnapshot({sessionId:s.id,liveNodes:node,persistAsset:true});assert.notEqual(r.redactionStatus,'REDACTED');assert.equal(r.assetRef,null);assert.equal(JSON.stringify(r.semantics).includes('synthetic-secret'),false);
  }
});
test('C1 actions/snapshots cannot be recorded before RECORDING',async()=>{
  const s=await service.createSession({device:hardware()});await fails(service.storeSnapshot({sessionId:s.id,liveNodes:live()}),'NOT_RECORDING');
  await fails(service.recordAction({sessionId:s.id,order:1,definition:skill(),stepId:'open',receipt:'ACK',missingReason:'NOT_CAPTURED'}),'NOT_RECORDING');
});
test('C1 action uses domain step, receipt, ordering and snapshots from the same session',async()=>{
  const s=await recording(),a=await service.storeSnapshot({sessionId:s.id,liveNodes:live()}),b=await service.storeSnapshot({sessionId:s.id,liveNodes:live()});
  const r=await service.recordAction({sessionId:s.id,order:1,definition:skill(),stepId:'submit',receipt:'UNKNOWN',beforeId:a.id,afterId:b.id});assert.equal(r.receipt,'UNKNOWN');assert.equal(r.operation,'SUBMIT_SEARCH');
  await fails(service.recordAction({sessionId:s.id,order:1,definition:skill(),stepId:'open',receipt:'ACK',missingReason:'NOT_CAPTURED'}),'CONFLICT');
  await fails(service.recordAction({sessionId:s.id,order:2,definition:skill(),stepId:'open',receipt:'ACK'}),'SNAPSHOT_REQUIRED');
  const other=await recording(),foreign=await service.storeSnapshot({sessionId:other.id,liveNodes:live()});await fails(service.recordAction({sessionId:s.id,order:2,definition:skill(),stepId:'open',receipt:'ACK',beforeId:foreign.id,afterId:b.id}),'SNAPSHOT_SESSION_MISMATCH');
});
test('C1 actual DB guard rejects a snapshot device mismatch and rolls back',async()=>{
  const s=await recording(),other=await recording();await fails(repository.transaction(r=>r.insertSnapshot(s.id,other.deviceId,sanitizeSnapshot(live()))),'SNAPSHOT_DEVICE_MISMATCH');
});
test('C1 draft/version reads validate DSL; DB alone creates content_hash and evidence level',async()=>{
  const made=await service.createDraft({definition:skill()});assert.match(made.version.contentHash,/^[0-9a-f]{64}$/);assert.equal(made.version.evidenceLevel,'COMPILED');assert.equal(made.skill.currentVersionId,made.version.id);
  const input=skill();input.name='Updated safe skill';const updated=await service.replaceDefinition({versionId:made.version.id,revision:made.version.revision,definition:input});assert.notEqual(updated.contentHash,made.version.contentHash);
  await fails(service.replaceDefinition({versionId:made.version.id,revision:made.version.revision,definition:input}),'CONFLICT');
  await fails(service.updateSkill({skillId:made.skill.id,revision:1,name:'Old revision',description:null,currentVersionId:made.version.id}),'CONFLICT');
});
test('C1 a tested version is read-only; a new version preserves the old execution binding',async()=>{
  const s=await service.createSession({device:hardware()}),made=await service.createDraft({definition:skill()});
  const execution=await service.createExecution({deviceId:s.deviceId,versionId:made.version.id,runtimeDigest:'a'.repeat(64)});assert.equal(execution.status,'PLANNED');
  await service.recordOfflineTest({deviceId:s.deviceId,versionId:made.version.id,executionId:execution.id,result:'PASSED'});
  const tested=await service.getVersion(made.version.id);assert.equal(tested.evidenceLevel,'OFFLINE_TESTED');assert.equal(tested.hasTests,true);
  await fails(service.replaceDefinition({versionId:tested.id,revision:tested.revision,definition:skill()}),'VERSION_HAS_TESTS');
  const next=await service.createVersion({skillId:made.skill.id,version:2,definition:skill()});assert.equal(next.evidenceLevel,'COMPILED');
  assert.equal((await db.query('SELECT skill_version_id FROM teach_mode.executions WHERE id=$1',[execution.id])).rows[0].skill_version_id,tested.id);
  await fails(service.transitionVersion({versionId:tested.id,revision:tested.revision,status:'VERIFIED'}),'INVALID_PAYLOAD');
});
test('C1 execution identity mismatch and current_version mismatch retain domain errors',async()=>{
  const a=await service.createSession({device:hardware()}),b=await service.createSession({device:hardware()}),made=await service.createDraft({definition:skill()}),other=await service.createDraft({definition:skill()});
  const execution=await service.createExecution({deviceId:a.deviceId,versionId:made.version.id,runtimeDigest:'b'.repeat(64)});
  await fails(service.recordOfflineTest({deviceId:b.deviceId,versionId:made.version.id,executionId:execution.id,result:'PASSED'}),'EXECUTION_MISMATCH');
  await fails(service.updateSkill({skillId:other.skill.id,revision:other.skill.revision,name:other.skill.name,description:null,currentVersionId:made.version.id}),'CURRENT_VERSION_MISMATCH');
});
test('C1 consent is never minted by service; revoked consent blocks writes but cleanup still releases ownership',async()=>{
  const s=await recording();await db.exec('UPDATE teach_mode.consents SET revoked_at=now()');
  try{
    await fails(service.createDraft({definition:skill()}),'NO_REMOTE_CONSENT');await fails(service.createSession({device:hardware()}),'NO_REMOTE_CONSENT');
    await fails(service.storeSnapshot({sessionId:s.id,liveNodes:live()}),'NO_REMOTE_CONSENT');
    const cleanup=new TeachStorageService(repository,{workspaceRoot:workspace,cleanupVerified:async()=>true});const released=await cleanup.releaseAfterCleanup({sessionId:s.id,revision:s.revision});assert.equal(released.ownership,'RELEASED');assert.equal(released.status,'INTERRUPTED');
  }finally{await db.exec("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");}
});
test('C1 rollback is atomic when a later short SQL operation fails',async()=>{
  const before=(await db.query('SELECT count(*)::int AS n FROM teach_mode.devices')).rows[0].n;
  await fails(service.createSession({device:hardware(),skillId:randomUUID()}),'REFERENCE_CONFLICT');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM teach_mode.devices')).rows[0].n,before);
});
test('T7/T9 malformed/destructive/secret DSL is rejected before any repository I/O',async()=>{
  const n=queries.length;for(const mutate of [s=>s.steps[0].operation='DELETE_PHOTOS',s=>s.steps[0].arguments.proof={token:'synthetic-secret'},s=>s.name='token=synthetic-secret']){
    const input=skill();mutate(input);await fails(service.createDraft({definition:input}),'INVALID_PAYLOAD');
  }assert.equal(queries.length,n);
});
for(const ref of ['../outside.txt','/outside.txt','C:/outside.txt','C:\\outside.txt','a/../../outside.txt','a\\..\\outside.txt','a/./b','a//b','a/%2e%2e/b','assets.'])test('C1 asset containment rejects '+ref,async()=>{await fails(new TeachAssetStore(workspace).remove(ref),'ASSET_PATH_REJECTED');});
test('C1 asset writer refuses arbitrary user objects even when called outside service',async()=>{await fails(new TeachAssetStore(workspace).write({nodes:[{text:'synthetic-secret'}],redactionStatus:'REDACTED',captureAllowed:false}),'INVALID_PAYLOAD');});
test('C1 retention removes only returned private assets, preserves skills and blocks escaping references',async()=>{
  const s=await recording(),snap=await service.storeSnapshot({sessionId:s.id,liveNodes:live(),persistAsset:true});
  const outside=path.join(workspace,'outside.txt');fs.writeFileSync(outside,'synthetic-kept-file');
  await db.query('UPDATE teach_mode.ui_snapshots SET expires_at=now()-interval \'1 second\' WHERE id=$1',[snap.id]);
  await db.query("INSERT INTO teach_mode.ui_snapshots(teach_session_id,device_id,redaction_status,ui_semantics,ui_metadata_ref,expires_at) VALUES ($1,$2,'REDACTED','{}','../outside.txt',now()-interval '1 second')",[s.id,s.deviceId]);
  const skills=(await db.query('SELECT count(*)::int AS n FROM teach_mode.skills')).rows[0].n,r=await service.purgeExpired();assert.equal(r.removed,1);assert.equal(r.blocked,1);assert.equal(fs.existsSync(path.join(workspace,'data/teach-mode/assets',snap.assetRef)),false);assert.equal(fs.existsSync(outside),true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM teach_mode.skills')).rows[0].n,skills);
});
test('C1 periodic retention is explicit, bounded, and stoppable',()=>{service.startRetention(1000);assert.throws(()=>service.startRetention(1000),e=>e.code==='INVALID_PAYLOAD');service.stopRetention();});
test('C1 SQL remains schema-qualified under search_path public, with no app writes to evidence/hash fields',()=>{
  assert.ok(queries.some(q=>q.includes('"teach_mode"."teach_purge_expired"')));assert.ok(queries.some(q=>q.includes('WHERE id=$1 AND revision=$2')));
  for(const sql of queries){assert.equal(/(?:INSERT INTO|UPDATE|FROM)\s+(devices|teach_sessions|ui_snapshots|recorded_actions|skills|skill_versions|skill_tests|executions)\b/i.test(sql),false);assert.equal(/SET\s+(?:evidence_level|content_hash)\s*=|INSERT INTO[^\n]+\([^)]*\b(?:evidence_level|content_hash)\b/i.test(sql),false);assert.equal(/INSERT INTO[^\n]+consents/i.test(sql),false);}
});
test('C1 concurrent updates with the same revision allow exactly one writer',async()=>{
  const made=await service.createDraft({definition:skill()}),input={versionId:made.version.id,revision:made.version.revision,definition:skill()};
  const outcomes=await Promise.allSettled([service.replaceDefinition(input),service.replaceDefinition(input)]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected'&&o.reason.code==='CONFLICT').length,1);
});
test('C1 pg adapter commits/rolls back short transactions and always releases a fake pool client',async()=>{
  const commands=[];let releases=0;
  const pool={connect:async()=>({query:async sql=>{commands.push(sql);return {rows:[],rowCount:0};},release:()=>releases++}),end:async()=>{}};
  const adapter=new PgTeachDatabase(pool);assert.equal(await adapter.transaction(async c=>{await c.query('SELECT 1');return 7;}),7);
  await fails(adapter.transaction(async()=>{throw {code:'TH006',message:'synthetic-secret'};}),'SNAPSHOT_REQUIRED');
  assert.deepEqual(commands,['BEGIN','SELECT 1','COMMIT','BEGIN','ROLLBACK']);assert.equal(releases,2);
});
test('C1 asset containment rejects a junction/symlink to a directory outside private assets',async()=>{
  const target=path.join(workspace,'outside-assets');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'keep.txt'),'synthetic-keep');
  const link=path.join(workspace,'data/teach-mode/assets','escape');fs.symlinkSync(target,link,'junction');
  await fails(new TeachAssetStore(workspace).remove('escape/keep.txt'),'ASSET_PATH_REJECTED');assert.equal(fs.existsSync(path.join(target,'keep.txt')),true);
});
