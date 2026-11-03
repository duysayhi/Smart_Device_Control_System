import type { DeviceTask } from '../android/agent/runtime-schema';
import type { AndroidAdbDevice } from '../../types/device';
import { historyStorage } from './history-database';
import { hashHistory, HistoryError, mapHistoryTask } from './history-model';
import type { PostgresHistoryRepository } from './postgres-history-repository';

export interface HistorySink {offer(tasks:DeviceTask[],devices?:AndroidAdbDevice[],at?:number):void;drain():Promise<void>;status():string}
/** Display-only projection queue. It neither dispatches actions nor replaces the operational journal. */
export function createHistorySink(repository:PostgresHistoryRepository,ready:Promise<unknown>=Promise.resolve(),digest?:string):HistorySink {
  let pending:DeviceTask[]|undefined,at=0,running:Promise<void>|undefined,state='IDLE',deviceKey='',commitUnknown=false,connectionGap=false;
  const observations:{devices:AndroidAdbDevice[];at:number}[]=[];
  const projected=new Map<string,string>();
  const run=async()=>{
    await ready;
    while(pending||observations.length){const tasks=pending??[],stamp=at;pending=undefined;
      while(observations.length){const observation=observations[0];await repository.snapshotDevices(observation.devices,observation.at);observations.shift();}
      for(const task of tasks)try{const snapshot=mapHistoryTask(task,'LIVE_WORKER',stamp,digest),key=hashHistory(JSON.stringify({...snapshot,sourceAt:0}));
        if(projected.get(snapshot.id)===key)continue;
        const result=await repository.putTask(snapshot);
        if(['PERSISTED','UNCHANGED','STALE_IGNORED'].includes(result)){projected.set(snapshot.id,key);if(projected.size>512)projected.delete(projected.keys().next().value!);}}
      catch(error){if(error instanceof HistoryError&&error.code==='INVALID_HISTORY_TASK')await repository.quarantine(hashHistory(String(task.executionId)),'INVALID_HISTORY_TASK',stamp);else throw error;}
    }state=connectionGap?'HISTORY_CONNECTION_GAP':'SYNCED';
  };
  return {offer(tasks,devices,stamp=Date.now()){
    if(commitUnknown)return;
    // Coalescing applies to cumulative task snapshots. A complete fresh discovery snapshot is kept separately.
    pending=structuredClone(tasks);at=stamp;
    if(devices){const key=hashHistory(JSON.stringify(devices.map(d=>[d.serial,d.physicalId,d.identityVerified,d.status,d.connectionType,d.model]).sort()));
      if(key!==deviceKey){if(observations.length>=256){connectionGap=true;state='HISTORY_BACKLOG_FULL';return;}observations.push({devices:structuredClone(devices),at:stamp});deviceKey=key;}}
    if(!running){state='SYNCING';running=run().catch(error=>{commitUnknown=error instanceof HistoryError&&error.code==='HISTORY_COMMIT_OUTCOME_UNKNOWN';state=commitUnknown?'HISTORY_COMMIT_OUTCOME_UNKNOWN':'HISTORY_SYNC_FAILED';}).finally(()=>{running=undefined;});}
  },async drain(){await running;},status:()=>state};
}
export function configuredHistorySink(digest?:string):HistorySink|undefined {
  if(process.env.HISTORY_STORAGE_MODE!=='POSTGRESQL')return;
  const store=historyStorage();return createHistorySink(store.repository,store.verified,digest);
}
