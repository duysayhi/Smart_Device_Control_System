import {join} from 'node:path';
import {z} from 'zod';
import {isLocalMutation,isLocalSameOrigin} from '../android/agent/request-origin';
import {FileOwnerCredentialStore,OwnerAuthenticationError} from './store';
import {OwnerPasskeyService} from './passkey';
import {FileOwnerApprovalIssuer,ownerAuthenticationRuntimeSha256} from './certificates';
import type {AuthenticationResponseJSON,RegistrationResponseJSON} from '@simplewebauthn/server';

const globalStore=globalThis as typeof globalThis&{phoneCommanderOwnerPasskey?:OwnerPasskeyService;phoneCommanderOwnerPasskeyDigest?:string};
export function ownerPasskeyService(){const directory=join(process.cwd(),'data','teach-mode','owner-auth'),digest=ownerAuthenticationRuntimeSha256();
 if(!globalStore.phoneCommanderOwnerPasskey||globalStore.phoneCommanderOwnerPasskeyDigest!==digest){globalStore.phoneCommanderOwnerPasskey=new OwnerPasskeyService(new FileOwnerCredentialStore(directory),Date.now,new FileOwnerApprovalIssuer(directory));globalStore.phoneCommanderOwnerPasskeyDigest=digest;}
 return globalStore.phoneCommanderOwnerPasskey;
}
const commands=z.discriminatedUnion('type',[
 z.object({type:z.literal('BEGIN_REGISTRATION'),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({type:z.literal('FINISH_REGISTRATION'),reference:z.uuid(),response:z.unknown()}).strict(),
 z.object({type:z.literal('BEGIN_APPROVAL'),reviewRef:z.uuid()}).strict(),
 z.object({type:z.literal('FINISH_APPROVAL'),reference:z.uuid(),response:z.unknown()}).strict(),
]);
export async function ownerAuthResponse(request:Request,provided?:OwnerPasskeyService){
 if(!['GET','POST'].includes(request.method))return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
 if(!(request.method==='GET'?isLocalSameOrigin(request):isLocalMutation(request)))return Response.json({code:'OWNER_ORIGIN_REQUIRED'},{status:403});
 try{const service=provided??ownerPasskeyService(),status=await service.status();
   const authority=request.headers.get('host')??new URL(request.url).host;
   if('http://'+authority!==status.origin||(request.headers.get('origin')&&request.headers.get('origin')!==status.origin))throw new OwnerAuthenticationError('OWNER_ORIGIN_MISMATCH');
   let result:unknown;
   if(request.method==='GET'){const ref=new URL(request.url).searchParams.get('review');result=ref?{...status,review:service.review(z.uuid().parse(ref))}:status;}
   else {const text=await request.text();if(text.length>65536)throw new OwnerAuthenticationError('OWNER_REQUEST_TOO_LARGE');const data=commands.parse(JSON.parse(text));
     if(data.type==='BEGIN_REGISTRATION')result=await service.beginRegistration(data.token);
     else if(data.type==='FINISH_REGISTRATION')result=await service.finishRegistration(data.reference,data.response as RegistrationResponseJSON);
     else if(data.type==='BEGIN_APPROVAL')result=await service.beginApproval(data.reviewRef);
     else result=await service.finishApproval(data.reference,data.response as AuthenticationResponseJSON);
   }
   return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }catch(error){const code=error instanceof OwnerAuthenticationError?error.code:'OWNER_REQUEST_REJECTED';return Response.json({code},{status:409,headers:{'Cache-Control':'no-store'}});}
}
