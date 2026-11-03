import {lstat,mkdir,readFile,rename,rmdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';

const encoded=z.string().regex(/^[A-Za-z0-9_-]+$/).max(4096);
export const OwnerStateSchema=z.object({version:z.literal(1),origin:z.string().regex(/^http:\/\/localhost:[0-9]{2,5}$/),
  osOwnerSha256:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().positive(),
  issuerPublicKey:encoded.optional(),
  bootstrap:z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number().int(),consumed:z.boolean()}).strict(),
  credential:z.object({id:encoded,publicKey:encoded,counter:z.number().int().nonnegative(),enrolledAt:z.number().int(),
    transports:z.array(z.enum(['ble','cable','hybrid','internal','nfc','smart-card','usb'])).optional()}).strict().optional(),
  audit:z.array(z.object({id:z.uuid(),at:z.number().int(),event:z.enum(['ENROLLED','AUTHENTICATED']),credentialHash:z.string().regex(/^[a-f0-9]{64}$/),bindingHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()).max(100)}).strict();
export type OwnerState=z.infer<typeof OwnerStateSchema>;
export interface OwnerCredentialStore {read():Promise<OwnerState>;update(expectedRevision:number,change:(value:OwnerState)=>OwnerState):Promise<OwnerState>}
export class OwnerAuthenticationError extends Error {constructor(readonly code:string){super(code);}}
/** Bootstrap creates this directory under an owner-only Windows ACL. No automatic enrollment. */
export class FileOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly directory:string){}
  async read():Promise<OwnerState>{
    try{const directory=await lstat(this.directory),file=join(this.directory,'owner.json'),info=await lstat(file);
      if(!directory.isDirectory()||directory.isSymbolicLink()||!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error();
      return OwnerStateSchema.parse(JSON.parse(await readFile(file,'utf8')));
    }catch{throw new OwnerAuthenticationError('OWNER_BOOTSTRAP_REQUIRED_OR_STORE_INVALID');}
  }
  async update(expectedRevision:number,change:(value:OwnerState)=>OwnerState):Promise<OwnerState>{
    const lock=join(this.directory,'write-lock'),nonce=randomUUID();
    try{await mkdir(lock);}catch{throw new OwnerAuthenticationError('OWNER_STORE_BUSY');}
    try{const current=await this.read();if(current.revision!==expectedRevision)throw new OwnerAuthenticationError('OWNER_STORE_REVISION_CONFLICT');
      const next=OwnerStateSchema.parse(change(structuredClone(current)));if(next.revision!==current.revision+1||next.origin!==current.origin||next.osOwnerSha256!==current.osOwnerSha256)throw new OwnerAuthenticationError('OWNER_STORE_BINDING_CHANGED');
      const temporary=join(this.directory,nonce+'.tmp');await writeFile(temporary,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(temporary,join(this.directory,'owner.json'));return next;
    }catch(error){if(error instanceof OwnerAuthenticationError)throw error;throw new OwnerAuthenticationError('OWNER_STORE_WRITE_FAILED');}
    finally{await rmdir(lock).catch(()=>undefined);}
  }
}
