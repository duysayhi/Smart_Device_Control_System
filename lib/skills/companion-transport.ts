import {runAdb} from '../android/adb';
import {z} from 'zod';
const integer=z.number().int().nonnegative();
export const CompanionEventSchema=z.object({sequence:integer,origin:z.literal('ANDROID_ACCESSIBILITY'),inputOrigin:z.literal('UNDETERMINED'),verification:z.literal('UNVERIFIED'),eventType:integer,deviceUptime:integer,at:integer,windowId:z.number().int(),packageName:z.literal('com.google.android.youtube'),target:z.object({resourceId:z.string().max(512).nullable().optional(),className:z.string().max(256),bounds:z.array(z.number().int()).length(4)}).strict(),beforeTargetFingerprint:z.string().max(128).nullable(),beforeObservedAt:integer,afterTargetFingerprint:z.string().max(128)}).strict();
export type CompanionEvent=z.infer<typeof CompanionEventSchema>;
export interface CompanionFrame {image:string;width:number;height:number;at:number;transport:'MEDIAPROJECTION_MJPEG'}
/** USB forwarding is created only by explicit pairing on an already owned Recorder session. */
export class CompanionTransport {
 private reader?:ReadableStreamDefaultReader<Uint8Array>;private pending=Buffer.alloc(0);private controller?:AbortController;private ended=false;
 private constructor(private readonly serial:string,private readonly port:number,private readonly token:string){}
 static async pair(serial:string,token:string){
  if(!/^[A-Za-z0-9._:-]{1,256}$/.test(serial)||!/^[a-f0-9]{64}$/.test(token))throw Error('COMPANION_PAIRING_INVALID');
  const result=await runAdb(['-s',serial,'forward','tcp:0','tcp:38947'],5000),port=Number(result.stdout.trim());if(!Number.isInteger(port)||port<1024||port>65535)throw Error('COMPANION_FORWARD_INVALID');
  const transport=new CompanionTransport(serial,port,token);try{await transport.events();return transport;}catch{await transport.close();throw Error('COMPANION_PAIRING_FAILED');}
 }
 private async request(path:'frames'|'events',signal:AbortSignal){return fetch(`http://127.0.0.1:${this.port}/${path}`,{headers:{Authorization:'Bearer '+this.token},signal,redirect:'error',cache:'no-store'});}
 async events(){if(this.ended)throw Error('COMPANION_CLOSED');const response=await this.request('events',AbortSignal.timeout(5000));if(!response.ok||!response.body)throw Error('COMPANION_EVENTS_UNAVAILABLE');const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262144)throw Error('COMPANION_EVENTS_LIMIT');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}return z.array(CompanionEventSchema).max(128).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
 async frame():Promise<CompanionFrame>{
  if(this.ended)throw Error('COMPANION_CLOSED');
  if(!this.reader){this.controller=new AbortController();const response=await this.request('frames',AbortSignal.any([this.controller.signal,AbortSignal.timeout(600000)]));if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('multipart/x-mixed-replace'))throw Error('COMPANION_STREAM_UNAVAILABLE');this.reader=response.body.getReader();}
  for(;;){const boundary=this.pending.indexOf('\r\n\r\n');if(boundary>=0){if(boundary>1024)throw Error('COMPANION_HEADER_LIMIT');const header=this.pending.subarray(0,boundary).toString('ascii'),number=(name:string)=>Number(new RegExp('(?:^|\\r\\n)'+name+': ([0-9]+)').exec(header)?.[1]),length=number('Content-Length');if(!Number.isInteger(length)||length<4||length>1048576)throw Error('COMPANION_FRAME_LIMIT');
    if(this.pending.length>=boundary+4+length){const bytes=this.pending.subarray(boundary+4,boundary+4+length);this.pending=this.pending.subarray(boundary+4+length);const width=number('X-Source-Width'),height=number('X-Source-Height'),at=number('X-Captured-At');if(width<1||height<1||width>10000||height>10000||!Number.isFinite(at)||Math.abs(Date.now()-at)>5000)throw Error('COMPANION_FRAME_BINDING_INVALID');return {image:bytes.toString('base64'),width,height,at,transport:'MEDIAPROJECTION_MJPEG'};}}
   const part=await Promise.race([this.reader.read(),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('COMPANION_FRAME_TIMEOUT')),5000);timer.unref();})]);if(part.done)throw Error('COMPANION_STREAM_CLOSED');this.pending=Buffer.concat([this.pending,part.value]);if(this.pending.length>1200000)throw Error('COMPANION_BUFFER_LIMIT');
  }
 }
 stopFrames(){this.controller?.abort();void this.reader?.cancel().catch(()=>{});this.reader=undefined;this.controller=undefined;this.pending=Buffer.alloc(0);}
 async close(){if(this.ended)return;this.ended=true;this.stopFrames();await runAdb(['-s',this.serial,'forward','--remove','tcp:'+this.port],5000);}
}
