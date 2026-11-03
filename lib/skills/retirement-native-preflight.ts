import {readFile,readdir,stat} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {runAdb} from '../android/adb';import {readTransportIdentity} from '../android/transport-identity';import {deviceReadiness} from '../android/agent/device-readiness';import {AppiumClient} from '../android/appium/client';
export interface RetirementNativeInspection {state:'CLEAR'|'BLOCKED'|'UNKNOWN';reason:string;physicalId:string;at:number;digest:string;adbCount:number;rpcCount:number}
/** Read-only, called while holding the existing physical reservation. No Session creation. */
export async function inspectRetirementNativeState(serial:string,physicalId:string):Promise<RetirementNativeInspection>{
 let adbCount=0,rpcCount=0;const deadline=Date.now()+30000,digests:string[]=[],hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
 const finish=(state:RetirementNativeInspection['state'],reason:string):RetirementNativeInspection=>({state,reason,physicalId,at:Date.now(),digest:hash(JSON.stringify({state,reason,physicalId,digests})),adbCount,rpcCount});
 const read=async(args:string[],timeout=5000)=>{if(Date.now()>=deadline)throw Error('INSPECTION_BUDGET');adbCount++;const r=await runAdb(args,Math.max(1,Math.min(timeout,deadline-Date.now())));digests.push(hash(r.stdout));return r;};
 try{
  const effects=join(tmpdir(),'phone-commander-local-effects');let files:string[]=[];try{files=await readdir(effects);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return finish('UNKNOWN','EFFECT_JOURNAL_UNREADABLE');}
  for(const file of files.filter(f=>f.endsWith('.jsonl')&&f!=='interpretations.jsonl')){if(Date.now()>=deadline)return finish('UNKNOWN','INSPECTION_BUDGET');const p=join(effects,file);if((await stat(p)).size>5000000)return finish('UNKNOWN','EFFECT_JOURNAL_TOO_LARGE');const text=await readFile(p,'utf8');let rows:Record<string,unknown>[];try{rows=text.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));}catch{return finish('UNKNOWN','EFFECT_JOURNAL_CORRUPT');}
   const relevant=rows.filter(r=>r.physicalId===physicalId);if(!relevant.length)continue;digests.push(hash(text));const records=new Map<string,{dispatch:string;verified:boolean}>();
   const scan=(v:unknown)=>{if(!v||typeof v!=='object')return;const r=v as Record<string,unknown>;if(typeof r.id==='string'&&['UNKNOWN','ACKNOWLEDGED','NOT_SENT'].includes(String(r.dispatch)))records.set(r.id,{dispatch:String(r.dispatch),verified:r.verified===true});for(const x of Object.values(r))if(x&&typeof x==='object')scan(x);};for(const r of relevant)scan(r.detail);
   if([...records.values()].some(r=>r.dispatch==='UNKNOWN'&&!r.verified))return finish('BLOCKED','REAL_UNKNOWN_NATIVE_EFFECT');
  }
  const ports=join(tmpdir(),'phone-commander-appium-ports');let directories:string[]=[];try{directories=await readdir(ports);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return finish('UNKNOWN','PORT_LOCK_INVENTORY_UNREADABLE');}
  for(const directory of directories){try{const owner=JSON.parse(await readFile(join(ports,directory,'owner.json'),'utf8'));if(owner.serial===serial)return finish('BLOCKED','APPIUM_PORT_LEASE_PRESENT');}catch{return finish('UNKNOWN','PORT_LOCK_OWNER_UNREADABLE');}}
  const forwards=(await read(['forward','--list'])).stdout;if(forwards.split(/\r?\n/).some(line=>line.startsWith(serial+' ')||line.startsWith(serial+'\t')))return finish('BLOCKED','DEVICE_PORT_FORWARD_PRESENT');
  const processes=(await read(['-s',serial,'shell','ps','-A'])).stdout;if(/io\.appium\.uiautomator2\.server/.test(processes))return finish('BLOCKED','UIAUTOMATOR_PROCESS_PRESENT');
  const client=new AppiumClient(undefined,fetch,()=>{rpcCount++;});let inventory:unknown;try{const status=await client.request<{ready?:boolean;build?:{version?:string}}>('GET','/status',undefined,5000);if(status.ready!==true)return finish('UNKNOWN','APPIUM_NOT_READY');const major=/^([23])\.\d+\.\d+(?:[-+].*)?$/.exec(status.build?.version??'')?.[1];if(!major)return finish('UNKNOWN','APPIUM_VERSION_UNSUPPORTED');inventory=await client.request('GET',major==='3'?'/appium/sessions':'/sessions',undefined,5000);}catch{return finish('UNKNOWN','APPIUM_INVENTORY_UNAVAILABLE');}
  if(!Array.isArray(inventory))return finish('UNKNOWN','APPIUM_INVENTORY_UNSUPPORTED');if(inventory.length)return finish('BLOCKED','ACTIVE_APPIUM_SESSION_PRESENT');digests.push(hash(JSON.stringify(inventory)));
  const identity=await readTransportIdentity(read,serial,true);if(identity?.physicalId!==physicalId)return finish('BLOCKED','PHYSICAL_IDENTITY_CHANGED');const state=deviceReadiness((await read(['-s',serial,'shell','dumpsys','window','policy'])).stdout);if(state!=='READY')return finish('BLOCKED','DEVICE_NOT_UNLOCKED_READY');
  return finish('CLEAR','CHECKED_CURRENT_STATE_CLEAR_HISTORICAL_GAP_REMAINS');
 }catch{return finish('UNKNOWN','READ_ONLY_SAFETY_INSPECTION_FAILED');}
}
