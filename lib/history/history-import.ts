import type { DeviceTask } from '../android/agent/runtime-schema';
import type { WirelessDeviceRecord } from '../android/wireless-store';
import { HistoryTaskSchema, HistoryError, hashHistory, historyDevice, mapHistoryTask } from './history-model';
import type { PostgresHistoryRepository } from './postgres-history-repository';

export function inspectHistorySource(bytes:Buffer) {
  let rows:unknown;try{rows=JSON.parse(bytes.toString('utf8'));}catch{throw new HistoryError('HISTORY_CORRUPTED_JSON');}
  if(!Array.isArray(rows)||rows.length>10000)throw new HistoryError('INVALID_HISTORY_SOURCE');
  const seen=new Set<string>(),valid:DeviceTask[]=[],rejected:{sourceHash:string;reason:string}[]=[];
  for(const raw of rows){const parsed=HistoryTaskSchema.safeParse(raw);
    if(!parsed.success){rejected.push({sourceHash:hashHistory(JSON.stringify(raw)),reason:'INVALID_HISTORY_TASK'});continue;}
    const task=raw as DeviceTask;if(seen.has(task.executionId)){rejected.push({sourceHash:hashHistory(task.executionId),reason:'DUPLICATE_SOURCE_TASK'});continue;}
    seen.add(task.executionId);valid.push(task);
  }
  return {checksum:hashHistory(bytes),count:rows.length,valid,rejected};
}
/** Explicit import only. Caller backs up original bytes before invoking this; no source mutation or automatic retry. */
export async function importHistory(repository:PostgresHistoryRepository,bytes:Buffer,wireless:WirelessDeviceRecord[],sourceAt:number,wirelessAt=sourceAt) {
  const plan=inspectHistorySource(bytes),counts:Record<string,number>={PERSISTED:0,UNCHANGED:0,STALE_IGNORED:0,QUARANTINED:0};
  const wirelessCounts={source:wireless.length,imported:0,unresolved:0};
  for(const record of wireless){
    if(!record.lastConnectedAt||!record.physicalId||!record.model||!['CONNECTED','DISCONNECTED','ERROR'].includes(record.state)){
      await repository.quarantine(hashHistory(record.serial),'LEGACY_CONNECTION_UNRESOLVED',sourceAt);wirelessCounts.unresolved++;continue;
    }
    const mapped=historyDevice({serial:record.serial,physicalId:record.physicalId,identityVerified:true,model:record.model,status:'device',connectionType:'Wi-Fi',osVersion:record.osVersion},record.lastConnectedAt);
    if(mapped){const id=await repository.registerDevice(mapped);await repository.connection(id,mapped.serialHash,'Wi-Fi',record.state==='CONNECTED'?'CONNECTED':record.state==='ERROR'?'ERROR':'DISCONNECTED',wirelessAt,'LEGACY_SNAPSHOT_NOT_EXACT_TRANSITION_TIME');wirelessCounts.imported++;}
    else{await repository.quarantine(hashHistory(record.serial),'LEGACY_CONNECTION_UNRESOLVED',sourceAt);wirelessCounts.unresolved++;}
  }
  for(const rejected of plan.rejected){await repository.quarantine(rejected.sourceHash,rejected.reason,sourceAt);counts.QUARANTINED++;}
  for(const task of plan.valid){let snapshot;
    try{snapshot=mapHistoryTask(task,'LEGACY_IMPORT',sourceAt);}catch{await repository.quarantine(hashHistory(task.executionId),'INVALID_HISTORY_TASK',sourceAt);counts.QUARANTINED++;continue;}
    const outcome=await repository.putTask(snapshot);counts[outcome]=(counts[outcome]??0)+1;
  }
  return {checksum:plan.checksum,sourceCount:plan.count,validCount:plan.valid.length,rejectedCount:plan.rejected.length,counts,wirelessCounts};
}
