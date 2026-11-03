import {createHash,createPrivateKey,createPublicKey,sign,verify,randomUUID} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {OwnerOperationSchema,type OwnerOperation} from './operation';
import {OwnerAuthenticationError,FileOwnerCredentialStore} from './store';

export const OwnerCertificateSchema=z.object({version:z.literal(1),id:z.uuid(),credentialHash:z.string().regex(/^[a-f0-9]{64}$/),authenticationEventId:z.uuid(),binding:OwnerOperationSchema,issuedAt:z.number().int().positive(),expiresAt:z.number().int().positive(),signature:z.string().regex(/^[A-Za-z0-9_-]+$/).max(512)}).strict();
export type OwnerCertificate=z.infer<typeof OwnerCertificateSchema>;
export const OwnerDatabaseReadbackSchema=z.object({version:z.literal(1),ownerCertificateId:z.uuid(),originalSessionId:z.uuid(),originalRevision:z.number().int().positive(),originalOwnership:z.literal('ADMIN_DISPOSED_UNVERIFIED'),physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),clearanceId:z.uuid(),freshRequestId:z.uuid(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),successorRef:z.uuid().optional(),successorOwnership:z.literal('HELD').optional(),observedAt:z.number().int().positive(),signature:z.string().regex(/^[A-Za-z0-9_-]+$/).max(512)}).strict();
export type OwnerDatabaseReadback=z.infer<typeof OwnerDatabaseReadbackSchema>;
export async function issueOwnerDatabaseReadback(issuer:OwnerApprovalIssuer,input:Omit<OwnerDatabaseReadback,'signature'>):Promise<OwnerDatabaseReadback>{const payload=OwnerDatabaseReadbackSchema.omit({signature:true}).parse(input);return {...payload,signature:await issuer.sign(JSON.stringify(payload))};}
export function verifyOwnerDatabaseReadback(input:unknown,publicKey:string,certificate:OwnerCertificate,now=Date.now()):OwnerDatabaseReadback{const value=OwnerDatabaseReadbackSchema.parse(input),{signature,...payload}=value;
 if(value.ownerCertificateId!==certificate.id||value.originalSessionId!==certificate.binding.sessionId||value.physicalId!==certificate.binding.physicalId||value.freshRequestId!==certificate.binding.freshRequestId||value.sourceSha256!==certificate.binding.runtimeSha256||value.observedAt>now||now-value.observedAt>5000||!verify(null,Buffer.from(JSON.stringify(payload)),createPublicKey({key:Buffer.from(publicKey,'base64url'),type:'spki',format:'der'}),Buffer.from(signature,'base64url')))throw new OwnerAuthenticationError('OWNER_DB_READBACK_INVALID_OR_STALE');return value;}
export function ownerAuthenticationRuntimeSha256(){const root=join(process.cwd(),'lib','owner-auth');return createHash('sha256').update(readdirSync(root).filter(f=>f.endsWith('.ts')).sort().map(f=>f+'\n'+readFileSync(join(root,f),'utf8')).join('\n')).digest('hex');}
export async function readOwnerPublicAuthority(){const state=await new FileOwnerCredentialStore(join(process.cwd(),'data','teach-mode','owner-auth')).read();if(!state.credential||!state.issuerPublicKey)throw new OwnerAuthenticationError('OWNER_NOT_ENROLLED');return {publicKey:state.issuerPublicKey,credentialHash:ownerCertificateDigest(state.credential.id)};}
export interface OwnerApprovalIssuer {ready():Promise<boolean>;sign(payload:string):Promise<string>}
export const ownerCertificateDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function issueOwnerCertificate(issuer:OwnerApprovalIssuer,binding:OwnerOperation,credentialHash:string,authenticationEventId:string,issuedAt:number,expiresAt:number):Promise<OwnerCertificate>{
 const payload={version:1 as const,id:randomUUID(),credentialHash,authenticationEventId,binding:OwnerOperationSchema.parse(binding),issuedAt,expiresAt};return OwnerCertificateSchema.parse({...payload,signature:await issuer.sign(JSON.stringify(payload))});
}
export function verifyOwnerCertificate(input:unknown,publicKey:string,credentialHash:string,now=Date.now()):OwnerCertificate{
 const certificate=OwnerCertificateSchema.parse(input),{signature,...payload}=certificate;
 if(certificate.credentialHash!==credentialHash||certificate.issuedAt>now||certificate.expiresAt<=now||certificate.expiresAt-certificate.issuedAt>60000||!verify(null,Buffer.from(JSON.stringify(payload)),createPublicKey({key:Buffer.from(publicKey,'base64url'),type:'spki',format:'der'}),Buffer.from(signature,'base64url')))throw new OwnerAuthenticationError('OWNER_CERTIFICATE_INVALID_OR_EXPIRED');
 return certificate;
}
/** Delegation issuer key, not the user's Passkey private key. Protected by bootstrap ACL. */
export class FileOwnerApprovalIssuer implements OwnerApprovalIssuer {
 constructor(private readonly directory:string){}
 private async key(){const file=join(this.directory,'issuer-private.der'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw Error();return createPrivateKey({key:await readFile(file),type:'pkcs8',format:'der'});}
 async ready(){try{await this.key();return true;}catch{return false;}}
 async sign(payload:string){try{return sign(null,Buffer.from(payload),await this.key()).toString('base64url');}catch{throw new OwnerAuthenticationError('OWNER_ISSUER_UNAVAILABLE');}}
}
