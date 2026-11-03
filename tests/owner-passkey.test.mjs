import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,generateKeyPairSync,sign} from 'node:crypto';
import path from 'node:path';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {load} from './helpers/react-skill-console.mjs';
const {OwnerPasskeyService}=load(path.resolve('lib/owner-auth/passkey.ts'));
const {ownerAuthResponse}=load(path.resolve('lib/owner-auth/api.ts'));
const {OwnerAuthenticationError}=load(path.resolve('lib/owner-auth/store.ts'));
const digest=v=>createHash('sha256').update(v).digest(),origin='http://localhost:49861',secret='d'.repeat(64);
function fixture(){let now=1793600000000;const f={now:()=>now,advance:ms=>{now+=ms;},writes:0,state:{version:1,origin,osOwnerSha256:'a'.repeat(64),revision:1,bootstrap:{hash:digest(secret).toString('hex'),expiresAt:now+300000,consumed:false},audit:[]}};
 f.store={read:async()=>structuredClone(f.state),update:async(revision,change)=>{if(f.failWrite)throw new OwnerAuthenticationError('OWNER_STORE_WRITE_FAILED');if(revision!==f.state.revision)throw new OwnerAuthenticationError('OWNER_STORE_REVISION_CONFLICT');f.writes++;f.state=change(structuredClone(f.state));return structuredClone(f.state);}};
 f.service=new OwnerPasskeyService(f.store,f.now);return f;}
function authenticator(){const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=key.publicKey.export({format:'jwk'}),id=randomBytes(32);let count=0;
 const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 return {id:id.toString('base64url'),register(options,patch={}){const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin,crossOrigin:false,...patch.client}));
  const length=Buffer.alloc(2);length.writeUInt16BE(id.length);const counter=Buffer.alloc(4),authData=Buffer.concat([digest('localhost'),Buffer.from([patch.uv===false?65:69]),counter,Buffer.alloc(16),length,id,cose]);
  return {id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{},authenticatorAttachment:'platform',response:{clientDataJSON:client.toString('base64url'),attestationObject:Buffer.from(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(authData)]]))).toString('base64url'),transports:['internal']}};
 },assert(options,patch={}){const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin,crossOrigin:false,...patch.client}));const counter=Buffer.alloc(4);counter.writeUInt32BE(++count);
  const authData=Buffer.concat([digest('localhost'),Buffer.from([patch.uv===false?1:5]),counter]);let signature=sign('sha256',Buffer.concat([authData,digest(client)]),key.privateKey);if(patch.badSignature)signature=Buffer.alloc(signature.length);
  return {id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{},authenticatorAttachment:'platform',response:{clientDataJSON:client.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:signature.toString('base64url')}};
 }};
}
const binding=()=>({purpose:'ADMIN_ORPHAN_DISPOSITION',sessionId:randomUUID(),executionId:randomUUID(),requestId:randomUUID(),physicalId:'android:'+'a'.repeat(64),revision:3,journalSha256:'b'.repeat(64),runtimeSha256:'c'.repeat(64),migrationSha256:'d'.repeat(64),freshRequestId:randomUUID(),residualRisk:'HISTORICAL_ATTESTATION_GAP_NOT_ACTIVE_UNKNOWN',summary:'OFFLINE exact record: administrative retirement remains UNVERIFIED; one fresh admission only.'});
async function enrolled(){const f=fixture(),a=authenticator(),s=await f.service.beginRegistration(secret);await f.service.finishRegistration(s.reference,a.register(s.options));return Object.assign(f,{a});}
async function signed(f,b=binding()){const review=f.service.prepareReview(b),start=await f.service.beginApproval(review.reference),result=await f.service.finishApproval(start.reference,f.a.assert(start.options));return {review,start,result,b};}
test('OFFLINE real WebAuthn verifier accepts a valid software-authenticator registration; bootstrap is consumed once',async()=>{
 const f=fixture(),a=authenticator(),s=await f.service.beginRegistration(secret);assert.equal(s.options.authenticatorSelection.userVerification,'required');assert.equal(s.options.authenticatorSelection.authenticatorAttachment,'platform');
 assert.equal((await f.service.finishRegistration(s.reference,a.register(s.options))).userVerified,true);assert.equal(f.state.credential.id,a.id);assert.equal(f.state.bootstrap.consumed,true);assert.equal(f.state.audit[0].event,'ENROLLED');
 await assert.rejects(f.service.beginRegistration(secret));await assert.rejects(f.service.finishRegistration(s.reference,a.register(s.options)));assert.equal(f.writes,1);
});
test('OFFLINE protected first enrollment refuses missing/wrong/expired bootstrap and requires UV',async()=>{
 const f=fixture();for(const value of [undefined,'x','a'.repeat(64)])await assert.rejects(f.service.beginRegistration(value));
 const s=await f.service.beginRegistration(secret);await assert.rejects(f.service.finishRegistration(s.reference,authenticator().register(s.options,{uv:false})));assert.equal(f.writes,0);f.advance(300001);await assert.rejects(f.service.beginRegistration(secret));
});
test('OFFLINE registration verifies RP challenge/origin and does not echo assertion data',async()=>{
 for(const client of [{origin:'http://foreign.invalid'},{challenge:'untrusted'}]){const f=fixture(),s=await f.service.beginRegistration(secret);await assert.rejects(f.service.finishRegistration(s.reference,authenticator().register(s.options,{client})),e=>e.code==='OWNER_PASSKEY_VERIFICATION_FAILED'&&!e.message.includes('foreign'));assert.equal(f.writes,0);}
});
test('OFFLINE signed owner approval binds purpose/session/revision/physical/source and is single-use',async()=>{
 const f=await enrolled(),x=await signed(f);assert.equal(x.result.userVerified,true);assert.equal(f.state.credential.counter,1);
 for(const patch of [{purpose:'FRESH_ADMISSION'},{sessionId:randomUUID()},{physicalId:'android:'+'b'.repeat(64)},{revision:4},{migrationSha256:'e'.repeat(64)}])assert.throws(()=>f.service.consumeApproval(x.result.approvalRef,{...x.b,...patch}));
 const grant=f.service.consumeApproval(x.result.approvalRef,x.b);assert.equal(grant.purpose,x.b.purpose);assert.throws(()=>f.service.consumeApproval(x.result.approvalRef,x.b));
 await assert.rejects(f.service.finishApproval(x.start.reference,f.a.assert(x.start.options)));assert.equal(f.state.audit.filter(e=>e.event==='AUTHENTICATED').length,1);
});
test('OFFLINE owner authentication refuses foreign credential, invalid signature, missing UV and wrong origin',async()=>{
 for(const patch of [{badSignature:true},{uv:false},{client:{origin:'http://foreign.invalid'}}]){const f=await enrolled(),review=f.service.prepareReview(binding()),start=await f.service.beginApproval(review.reference);await assert.rejects(f.service.finishApproval(start.reference,f.a.assert(start.options,patch)));assert.equal(f.state.audit.length,1);}
 const f=await enrolled(),review=f.service.prepareReview(binding()),s=await f.service.beginApproval(review.reference);await assert.rejects(f.service.finishApproval(s.reference,authenticator().assert(s.options)),e=>e.code==='OWNER_FOREIGN_CREDENTIAL');
});
test('OFFLINE expired approval, process restart and failed durable counter/audit write cannot authorize mutations',async()=>{
 const f=await enrolled(),x=await signed(f);f.advance(60001);assert.throws(()=>f.service.consumeApproval(x.result.approvalRef,x.b));const fresh=new OwnerPasskeyService(f.store,f.now);assert.throws(()=>fresh.consumeApproval(x.result.approvalRef,x.b));
 const second=await enrolled(),review=second.service.prepareReview(binding()),start=await second.service.beginApproval(review.reference);second.failWrite=true;await assert.rejects(second.service.finishApproval(start.reference,second.a.assert(start.options)));assert.equal(second.state.audit.length,1);
});
test('OFFLINE origin/host guards reject cross-origin and same-origin assertions cannot claim owner without a passkey',async()=>{
 const f=fixture();const request=(originHeader,host,body)=>new Request('http://localhost:49861/api/owner-auth',{method:'POST',headers:{host,origin:originHeader,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await ownerAuthResponse(request('http://foreign.invalid','localhost:49861',{type:'BEGIN_REGISTRATION',token:secret}),f.service)).status,403);
 assert.equal((await ownerAuthResponse(request('http://localhost:49862','localhost:49862',{type:'BEGIN_REGISTRATION',token:secret}),f.service)).status,409);
 assert.equal((await ownerAuthResponse(request(origin,'localhost:49861',{type:'FINISH_APPROVAL',reference:randomUUID(),response:{verified:true,owner:'local-owner'}}),f.service)).status,409);assert.equal(f.writes,0);
});

function continuation(){return {...binding(),purpose:'G3_CONTINUATION',ownerAuthSha256:'a'.repeat(64),priorClearanceSha256:'a'.repeat(64),priorMarkerSha256:'b'.repeat(64),newClearanceId:randomUUID(),successorSessionId:randomUUID(),freshSpecSha256:'c'.repeat(64),previousSessionId:randomUUID(),previousExecutionId:randomUUID(),previousRevision:4,previousLifecycleSha256:'d'.repeat(64)};}
test('OFFLINE continuation review lasts ten minutes while ceremony and approval stay bounded to sixty seconds',async()=>{
 const f=await enrolled(),b=continuation(),review=f.service.prepareReview(b);assert.equal(review.expiresAt-f.now(),600000);f.advance(540000);const start=await f.service.beginApproval(review.reference);assert.equal(start.options.timeout,60000);const approved=await f.service.finishApproval(start.reference,f.a.assert(start.options));assert.ok(approved.expiresAt-f.now()<=60000);f.advance(60001);assert.throws(()=>f.service.consumeApproval(approved.approvalRef,b));assert.throws(()=>f.service.review(review.reference));
 const second=await enrolled(),long=second.service.prepareReview(continuation()),ceremony=await second.service.beginApproval(long.reference);second.advance(60001);await assert.rejects(second.service.finishApproval(ceremony.reference,second.a.assert(ceremony.options)));assert.ok(second.service.review(long.reference));
 const ordinary=second.service.prepareReview(binding());assert.equal(ordinary.expiresAt-second.now(),120000);
});
