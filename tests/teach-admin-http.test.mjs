import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {load} from './helpers/react-skill-console.mjs';
const get=f=>load(path.resolve(f)),{startWorker}=get('lib/android/agent/worker-server.ts');
const {issueOwnerCertificate,ownerAuthenticationRuntimeSha256}=get('lib/owner-auth/certificates.ts');
const {teachRuntimeDigest}=get('lib/android/agent/runtime-storage.ts');

test('OFFLINE real Worker HTTP authenticates admin schema, source, public-response redaction and old-client denial without native OPEN',async t=>{
 const root=path.resolve('coverage/g3-final-unblock-2026-11-03/http-fixtures');fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'case-')),physicalId='android:'+'a'.repeat(64),executionId=randomUUID(),requestId=randomUUID(),key=generateKeyPairSync('ed25519'),credentialHash='b'.repeat(64),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const legacy={executionId,batchId:requestId,deviceId:'A',physicalId,request:'Offline legacy',status:'CANCELLED',createdAt:1,finishedAt:2,events:[],latest:{type:'complete',status:'CANCELLED',counters:{steps:0,snapshots:0}}},bytes=JSON.stringify([legacy]);fs.writeFileSync(path.join(directory,'tasks.json'),bytes);let reservations=0,releases=0;
 const adapter={discover:async()=>[{serial:'A',status:'device',identityVerified:true,physicalId}],administrativeAuthority:async()=>({publicKey,credentialHash}),inspectAdministrativeState:async()=>({state:'CLEAR',reason:'FIXTURE',physicalId,at:Date.now(),digest:'e'.repeat(64),adbCount:0,rpcCount:0}),reserve:async()=>{reservations++;return async()=>{releases++;};},plan:async()=>assert.fail('No model'),open:async()=>assert.fail('No native execution')};
 const worker=await startWorker({directory,adapter});t.after(async()=>{worker.server.closeAllConnections();await worker.shutdown();assert.equal(path.dirname(directory),root);fs.rmSync(directory,{recursive:true,force:true});});
 const metadata=JSON.parse(fs.readFileSync(path.join(directory,'address.json'),'utf8')),url='http://127.0.0.1:'+metadata.port;
 assert.ok(metadata.features.includes('teach-admin-admission-v1'));assert.equal(metadata.ownerAuthSha256,ownerAuthenticationRuntimeSha256());
 const post=body=>fetch(url+'/teach',{method:'POST',headers:{Authorization:'Bearer '+metadata.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({type:'ADMIN_STAGE',deviceId:'A',certificate:{verified:true,owner:'local-owner'},expiresAt:Date.now()+600000})).status,400);
 const binding={purpose:'ADMIN_ORPHAN_DISPOSITION',sessionId:randomUUID(),executionId,requestId,physicalId,revision:3,journalSha256:createHash('sha256').update(bytes).digest('hex'),runtimeSha256:teachRuntimeDigest(),ownerAuthSha256:ownerAuthenticationRuntimeSha256(),migrationSha256:'c'.repeat(64),freshRequestId:randomUUID(),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',summary:'OFFLINE exact administrative scope'},issuer={ready:async()=>true,sign:async payload=>sign(null,Buffer.from(payload),key.privateKey).toString('base64url')},now=Date.now(),certificate=await issueOwnerCertificate(issuer,binding,credentialHash,randomUUID(),now,now+60000);
 const staged=await post({type:'ADMIN_STAGE',deviceId:'A',certificate,expiresAt:Date.now()+600000});assert.equal(staged.status,200);assert.equal((await staged.json()).cleanup,'UNVERIFIED');assert.equal(reservations,1);
 const publicState=await(await fetch(url+'/tasks',{headers:{Authorization:'Bearer '+metadata.token}})).text();assert.equal(publicState.includes('administrativeAdmission'),false);assert.equal(publicState.includes(certificate.signature),false);assert.equal(publicState.includes(metadata.token),false);
 const old=await post({type:'OPEN',requestId:randomUUID(),recordingRef:randomUUID(),deviceId:'A',expectedPhysicalId:physicalId,appRef:'catalog',query:''});assert.equal(old.status,409);assert.match((await old.json()).code,/ADMIN_FRESH/);
 worker.server.closeAllConnections();await worker.shutdown();assert.equal(releases,1);
});
