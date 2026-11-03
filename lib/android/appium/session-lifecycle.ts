import { AndroidExecutionError } from '../errors';
import type { AppiumClient } from './client';
export type NativeLifecycleEvent={kind:'CREATE_INTENT'|'NATIVE_BOUND'|'BINDING_VERIFIED'|'NATIVE_READY'|'DELETE_INTENT'|'DELETE_ACK'|'ABSENCE_VERIFIED'|'NATIVE_CLOSED';nativeSessionId?:string;nativeServerSha256?:string};
export type NativeLifecycleHook=(event:NativeLifecycleEvent)=>Promise<void>;
/** Only an exact native invalid-session response is evidence. Network failure/HTTP 404 is not. */
export async function verifyNativeSessionAbsent(client:AppiumClient,sessionId:string):Promise<boolean>{
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId))return false;
 try{await client.request('GET',`/session/${encodeURIComponent(sessionId)}/appium/capabilities`,undefined,10000);return false;}
 catch(error){if(error instanceof AndroidExecutionError&&error.requestOutcomeKnown&&error.sessionInvalid)return true;throw error;}
}
