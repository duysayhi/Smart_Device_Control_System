import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse,
  type AuthenticationResponseJSON,type RegistrationResponseJSON} from '@simplewebauthn/server';
import {OwnerAuthenticationError,type OwnerCredentialStore} from './store';
import {OwnerOperationSchema,type OwnerOperation} from './operation';
import {issueOwnerCertificate,issueOwnerDatabaseReadback,type OwnerApprovalIssuer,type OwnerCertificate,type OwnerDatabaseReadback} from './certificates';
export {OwnerOperationSchema,type OwnerOperation} from './operation';

export const ownerDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Ceremony {kind:'REGISTER'|'APPROVE';challenge:string;expiresAt:number;bootstrapHash?:string;review?:string}
interface Review {binding:OwnerOperation;digest:string;expiresAt:number}
export interface OwnerVerifiedApproval {readonly purpose:OwnerOperation['purpose'];readonly bindingHash:string;readonly authenticationEventId:string;readonly expiresAt:number;readonly certificate?:OwnerCertificate}
/** One owner credential, genuine WebAuthn UV verification. No Android/DB authority. */
export class OwnerPasskeyService {
  private ceremonies=new Map<string,Ceremony>();private reviews=new Map<string,Review>();
  private approvals=new Map<string,OwnerVerifiedApproval>();private trusted=new WeakSet<object>();private consumed=new WeakSet<object>();
  private readbackIssued=new WeakSet<object>();
  constructor(private readonly store:OwnerCredentialStore,private readonly clock=Date.now,private readonly issuer?:OwnerApprovalIssuer){}
  private fail(code:string):never{throw new OwnerAuthenticationError(code);}
  private sweep(){const now=this.clock();for(const[k,v]of this.ceremonies)if(v.expiresAt<=now)this.ceremonies.delete(k);for(const[k,v]of this.reviews)if(v.expiresAt<=now)this.reviews.delete(k);for(const[k,v]of this.approvals)if(v.expiresAt<=now)this.approvals.delete(k);if(this.ceremonies.size+this.reviews.size+this.approvals.size>=100)this.fail('OWNER_AUTH_CAPACITY');}
  async status(){const state=await this.store.read();return {enrolled:!!state.credential,origin:state.origin,userVerification:'required',issuerReady:!!state.issuerPublicKey&&await this.issuer?.ready()===true,bootstrapExpiresAt:state.credential?undefined:state.bootstrap.expiresAt};}
  async beginRegistration(token:unknown){this.sweep();if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))this.fail('OWNER_BOOTSTRAP_INVALID');const state=await this.store.read();
    const actual=createHash('sha256').update(token).digest(),expected=Buffer.from(state.bootstrap.hash,'hex');
    if(state.credential||state.bootstrap.consumed||state.bootstrap.expiresAt<=this.clock()||!timingSafeEqual(actual,expected))this.fail('OWNER_BOOTSTRAP_INVALID');
    const options=await generateRegistrationOptions({rpName:'Phone Commander Owner',rpID:'localhost',userName:'Device owner',userID:Buffer.from(state.osOwnerSha256,'hex'),
      attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'},timeout:120000});
    const reference=randomUUID();this.ceremonies.set(reference,{kind:'REGISTER',challenge:options.challenge,bootstrapHash:state.bootstrap.hash,expiresAt:Math.min(state.bootstrap.expiresAt,this.clock()+120000)});return {reference,options};
  }
  private take(reference:string,kind:Ceremony['kind']){const entry=this.ceremonies.get(reference);this.ceremonies.delete(reference);if(!entry||entry.kind!==kind||entry.expiresAt<=this.clock())return this.fail('OWNER_CEREMONY_EXPIRED_OR_REPLAYED');return entry;}
  async finishRegistration(reference:string,response:RegistrationResponseJSON){const ceremony=this.take(reference,'REGISTER'),state=await this.store.read();
    if(state.credential||state.bootstrap.consumed||state.bootstrap.hash!==ceremony.bootstrapHash||state.bootstrap.expiresAt<=this.clock())this.fail('OWNER_BOOTSTRAP_INVALID');
    let verified;try{verified=await verifyRegistrationResponse({response,expectedChallenge:ceremony.challenge,expectedOrigin:state.origin,expectedRPID:'localhost',requireUserVerification:true,requireUserPresence:true,supportedAlgorithmIDs:[-7,-257]});}catch{this.fail('OWNER_PASSKEY_VERIFICATION_FAILED');}
    if(!verified!.verified||!verified!.registrationInfo.userVerified)this.fail('OWNER_PASSKEY_UV_REQUIRED');
    if(state.audit.length>=100)this.fail('OWNER_DURABLE_AUDIT_CAPACITY');const credential=verified!.registrationInfo.credential,at=this.clock();
    await this.store.update(state.revision,current=>({...current,revision:current.revision+1,bootstrap:{...current.bootstrap,consumed:true},credential:{id:credential.id,publicKey:Buffer.from(credential.publicKey).toString('base64url'),counter:credential.counter,transports:credential.transports,enrolledAt:at},audit:[...current.audit,{id:randomUUID(),at,event:'ENROLLED' as const,credentialHash:ownerDigest(credential.id)}]}));
    return {enrolled:true,userVerified:true};
  }
  /** Backend-only: review content is never supplied by the approval request. */
  prepareReview(input:OwnerOperation){this.sweep();const binding=OwnerOperationSchema.parse(input),reference=randomUUID(),review={binding,digest:ownerDigest(binding),expiresAt:this.clock()+(binding.purpose==='G3_CONTINUATION'?600000:120000)};this.reviews.set(reference,review);return {reference,...review,requiresUserVerification:true};}
  review(reference:string){const review=this.reviews.get(reference);if(!review||review.expiresAt<=this.clock())return this.fail('OWNER_REVIEW_EXPIRED');return structuredClone(review);}
  async beginApproval(reference:string){this.sweep();const state=await this.store.read();if(!state.credential)this.fail('OWNER_NOT_ENROLLED');const review=this.review(reference);
    const options=await generateAuthenticationOptions({rpID:'localhost',allowCredentials:[{id:state.credential.id,transports:state.credential.transports}],userVerification:'required',timeout:60000});
    const ceremony=randomUUID();this.ceremonies.set(ceremony,{kind:'APPROVE',challenge:options.challenge,review:reference,expiresAt:Math.min(review.expiresAt,this.clock()+60000)});return {reference:ceremony,options,review};
  }
  async finishApproval(reference:string,response:AuthenticationResponseJSON){const ceremony=this.take(reference,'APPROVE'),review=this.review(ceremony.review!),state=await this.store.read(),credential=state.credential;
    if(!credential||response.id!==credential.id)this.fail('OWNER_FOREIGN_CREDENTIAL');let verified;
    try{verified=await verifyAuthenticationResponse({response,expectedChallenge:ceremony.challenge,expectedOrigin:state.origin,expectedRPID:'localhost',requireUserVerification:true,
      credential:{id:credential.id,publicKey:Buffer.from(credential.publicKey,'base64url'),counter:credential.counter,transports:credential.transports}});}catch{this.fail('OWNER_PASSKEY_VERIFICATION_FAILED');}
    if(!verified!.verified||!verified!.authenticationInfo.userVerified)this.fail('OWNER_PASSKEY_UV_REQUIRED');if(state.audit.length>=100)this.fail('OWNER_DURABLE_AUDIT_CAPACITY');const at=this.clock(),authenticationEventId=randomUUID();
    await this.store.update(state.revision,current=>({...current,revision:current.revision+1,credential:{...credential,counter:verified!.authenticationInfo.newCounter},audit:[...current.audit,{id:authenticationEventId,at,event:'AUTHENTICATED' as const,credentialHash:ownerDigest(credential.id),bindingHash:review.digest}]}));
    this.reviews.delete(ceremony.review!);const expiresAt=Math.min(review.expiresAt,at+60000),certificate=this.issuer?await issueOwnerCertificate(this.issuer,review.binding,ownerDigest(credential.id),authenticationEventId,at,expiresAt):undefined;
    const approval=Object.freeze({purpose:review.binding.purpose,bindingHash:review.digest,authenticationEventId,expiresAt,certificate}),approvalRef=randomUUID();this.trusted.add(approval);this.approvals.set(approvalRef,approval);
    return {approvalRef,purpose:approval.purpose,bindingHash:approval.bindingHash,expiresAt:approval.expiresAt,userVerified:true};
  }
  /** Reference alone is insufficient: exact backend binding + trusted object + single use. */
  consumeApproval(reference:string,binding:OwnerOperation):OwnerVerifiedApproval{const approval=this.approvals.get(reference);if(!approval||!this.trusted.has(approval)||this.consumed.has(approval)||approval.expiresAt<=this.clock()||approval.purpose!==binding.purpose||approval.bindingHash!==ownerDigest(OwnerOperationSchema.parse(binding)))this.fail('OWNER_APPROVAL_INVALID_OR_REPLAYED');this.consumed.add(approval);this.approvals.delete(reference);return approval;}
  async certifyDatabaseReadback(approval:OwnerVerifiedApproval,input:Omit<OwnerDatabaseReadback,'version'|'signature'|'ownerCertificateId'>){if(!this.issuer||!approval.certificate||!this.trusted.has(approval)||!this.consumed.has(approval)||this.readbackIssued.has(approval)||approval.expiresAt<=this.clock())this.fail('OWNER_READBACK_ATTESTATION_NOT_AUTHORIZED');this.readbackIssued.add(approval);return issueOwnerDatabaseReadback(this.issuer,{...input,version:1,ownerCertificateId:approval.certificate.id});}
}
