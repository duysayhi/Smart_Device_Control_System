import type { TeachDatabase, TeachQuery } from '../skills/db/pg-database';
import type { AndroidAdbDevice } from '../../types/device';
import { HistoryError, hashHistory, historyDevice, historyId, type HistoryDevice, type HistoryQuery, type HistorySnapshot } from './history-model';

const prefix='phone_commander.';
const connectionJson="(CASE WHEN actor_ref='history-projector' AND event_type LIKE 'DEVICE_%' THEN reason::jsonb ELSE '{}'::jsonb END)";
type Row=Record<string,unknown>;
const time=(at:number)=>new Date(at).toISOString();
const metadata=(row?:Row):Record<string,unknown>=>{try{return JSON.parse(String(row?.reason??'{}'));}catch{return {};}};
const failure=(e:unknown):never=>{if(e instanceof HistoryError)throw e;
  if(e&&typeof e==='object'&&'code'in e&&e.code==='SAVE_OUTCOME_UNKNOWN')throw new HistoryError('HISTORY_COMMIT_OUTCOME_UNKNOWN');
  throw new HistoryError('HISTORY_DATABASE_UNAVAILABLE');};
export interface HistoryRepository {
  putTask(snapshot:HistorySnapshot):Promise<string>;
  snapshotDevices(devices:AndroidAdbDevice[],at:number):Promise<void>;
  read(query:HistoryQuery):Promise<unknown>;
}
/** Existing 15-table schema only. This adapter has no DDL or access to teach_mode. */
export class PostgresHistoryRepository implements HistoryRepository {
  constructor(private readonly database:TeachDatabase){}
  private async transaction<T>(work:(q:TeachQuery)=>Promise<T>) {
    let domain:HistoryError|undefined;
    try{return await this.database.transaction(async q=>{try{return await work(q);}catch(e){if(e instanceof HistoryError)domain=e;throw e;}});}catch(e){return failure(domain??e);}
  }
  async registerDevice(input:HistoryDevice):Promise<string> {
    if(!/^[a-f0-9]{64}$/.test(input.physicalHash)||!/^[a-f0-9]{64}$/.test(input.serialHash)||!input.model||!['CONNECTED','DISCONNECTED','OFFLINE','UNAUTHORIZED','ERROR'].includes(input.status))throw new HistoryError('INVALID_HISTORY_DEVICE');
    return this.transaction(async q=>{
      const matches=(await q.query(`SELECT id FROM ${prefix}devices WHERE lower(physical_identity_hash)=$1 FOR UPDATE`,[input.physicalHash])).rows;
      if(matches.length>1)throw new HistoryError('PHYSICAL_IDENTITY_AMBIGUOUS');
      if(matches.length){await q.query(`UPDATE ${prefix}devices SET last_seen_at=GREATEST(last_seen_at,$2),first_seen_at=LEAST(first_seen_at,$2) WHERE id=$1`,[matches[0].id,time(input.at)]);return String(matches[0].id);}
      const row=(await q.query(`INSERT INTO ${prefix}devices(serial_hash,physical_identity_hash,model,manufacturer,android_version,status,first_seen_at,last_seen_at,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8) ON CONFLICT(physical_identity_hash) DO UPDATE SET last_seen_at=GREATEST(devices.last_seen_at,EXCLUDED.last_seen_at),
        first_seen_at=LEAST(devices.first_seen_at,EXCLUDED.first_seen_at) RETURNING id`,[input.serialHash,input.physicalHash,input.model,input.manufacturer??null,input.androidVersion??null,input.status,time(input.at),JSON.stringify({historyProjectionVersion:1})])).rows[0];
      return String(row.id);
    });
  }
  async quarantine(sourceHash:string,reason:string,at:number):Promise<void> {
    if(!/^[a-f0-9]{64}$/.test(sourceHash)||!/^[A-Z0-9_]{1,80}$/.test(reason))throw new HistoryError('INVALID_HISTORY_QUARANTINE');
    await this.transaction(q=>q.query(`INSERT INTO ${prefix}audit_events(id,event_type,actor_ref,reason,created_at) VALUES($1,'HISTORY_QUARANTINED','history-projector',$2,$3) ON CONFLICT(id) DO NOTHING`,
      [historyId('quarantine:'+sourceHash+':'+reason),JSON.stringify({sourceHash,reason}),time(at)]));
  }
  async putTask(s:HistorySnapshot):Promise<string> {
    if(!s.physicalHash){await this.quarantine(hashHistory(s.id),'PHYSICAL_IDENTITY_MISSING',s.sourceAt);return 'QUARANTINED';}
    return this.transaction(async q=>{
      const devices=(await q.query(`SELECT id FROM ${prefix}devices WHERE lower(physical_identity_hash)=$1`,[s.physicalHash])).rows;
      if(devices.length!==1){await q.query(`INSERT INTO ${prefix}audit_events(id,event_type,actor_ref,reason,created_at) VALUES($1,'HISTORY_QUARANTINED','history-projector',$2,$3) ON CONFLICT(id) DO NOTHING`,
        [historyId('quarantine:'+s.id+':device'),JSON.stringify({sourceHash:hashHistory(s.id),reason:'DEVICE_FK_UNRESOLVED'}),time(s.sourceAt)]);return 'QUARANTINED';}
      const deviceId=String(devices[0].id);
      const inserted=await q.query(`INSERT INTO ${prefix}executions(id,device_id,engine,status,started_at) VALUES($1,$2,$3,'PLANNED',$4) ON CONFLICT(id) DO NOTHING RETURNING id`,[s.id,deviceId,s.engine,time(s.createdAt)]);
      const existing=(await q.query(`SELECT * FROM ${prefix}executions WHERE id=$1 FOR UPDATE`,[s.id])).rows[0];
      if(String(existing.device_id)!==deviceId)throw new HistoryError('HISTORY_EXECUTION_DEVICE_CONFLICT');
      const previous=(await q.query(`SELECT id,reason FROM ${prefix}audit_events WHERE execution_id=$1 AND event_type='HISTORY_SNAPSHOT' AND actor_ref='history-projector' ORDER BY created_at DESC,id DESC LIMIT 1`,[s.id])).rows[0],meta=metadata(previous);
      if(!inserted.rows.length&&!previous)throw new HistoryError('HISTORY_EXISTING_RECORD_CONFLICT');
      if(previous&&(Number(meta.sourceAt)>s.sourceAt||meta.source==='LIVE_WORKER'&&s.source==='LEGACY_IMPORT'||existing.finished_at&&!s.finishedAt))return 'STALE_IGNORED';
      if(existing.finished_at&&s.finishedAt&&new Date(String(existing.finished_at)).getTime()>s.finishedAt)return 'STALE_IGNORED';
      const snapshotHash=hashHistory(JSON.stringify({...s,sourceAt:0}));
      if(meta.snapshotHash===snapshotHash){
        if(s.sourceAt>Number(meta.sourceAt))await q.query(`UPDATE ${prefix}audit_events SET reason=$2 WHERE id=$1 AND actor_ref='history-projector' AND event_type='HISTORY_SNAPSHOT'`,[previous.id,JSON.stringify({...meta,sourceAt:s.sourceAt})]);
        return 'UNCHANGED';
      }
      await q.query(`UPDATE ${prefix}executions SET original_command=$3,engine=$4,status=$5,terminal_reason=$6,started_at=$7,finished_at=$8,execute_ms=$9,model_calls=$10,rpc_count=$11,adb_count=$12,runtime_digest=$13 WHERE id=$1 AND device_id=$2`,
        [s.id,deviceId,'Lệnh Android [nội dung đã ẩn]',s.engine,s.status,s.reason,time(s.createdAt),s.finishedAt?time(s.finishedAt):null,s.duration,s.modelCalls,s.rpc,s.adb,s.digest]);
      for(const step of s.steps){
        await q.query(`INSERT INTO ${prefix}execution_steps(id,execution_id,step_order,capability,status,evidence_tier) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(execution_id,step_order) DO UPDATE SET status=EXCLUDED.status,evidence_tier=EXCLUDED.evidence_tier WHERE execution_steps.id=EXCLUDED.id`,
          [step.id,s.id,step.order,step.capability,step.status,step.evidence.length?'HISTORICAL_REFERENCE':null]);
        for(const evidence of step.evidence)await q.query(`INSERT INTO ${prefix}evidence_index(id,execution_id,step_id,evidence_type,evidence_tier,storage_ref,redacted,created_at)
          VALUES($1,$2,$3,'WORKER_VERIFICATION_REFERENCE',$4,$5,true,$6) ON CONFLICT(id) DO NOTHING`,[evidence.id,s.id,step.id,evidence.tier,'worker-evidence:'+evidence.ref,time(s.sourceAt)]);
      }
      for(const p of s.providers)await q.query(`INSERT INTO ${prefix}provider_usage(id,execution_id,requested_provider,actual_provider,model,request_count,prompt_tokens,completion_tokens,latency_ms,http_status,recorded_at)
        VALUES($1,$2,'UNRECORDED',$3,$4,1,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,[p.id,s.id,p.provider,p.model,p.prompt,p.completion,p.elapsed,p.http,time(s.sourceAt)]);
      const audit={version:1,source:s.source,sourceAt:s.sourceAt,sourceStatus:s.sourceStatus,engine:s.engine,requestHash:s.requestHash,redaction:'FULL_COMMAND_TEXT_OMITTED',legacyAggregate:s.aggregate,snapshotHash};
      await q.query(`INSERT INTO ${prefix}audit_events(id,device_id,execution_id,actor_ref,event_type,reason,created_at) VALUES($1,$2,$3,'history-projector','HISTORY_SNAPSHOT',$4,$5) ON CONFLICT(id) DO NOTHING`,
        [historyId(s.id+':snapshot:'+snapshotHash),deviceId,s.id,JSON.stringify(audit),time(Date.now())]);
      return 'PERSISTED';
    });
  }
  async connection(deviceId:string,serialHash:string,transport:string,status:string,at:number,source='LIVE_WORKER') {
    if(!/^[a-f0-9]{64}$/.test(serialHash)||!['USB','Wi-Fi'].includes(transport)||!['CONNECTED','DISCONNECTED','OFFLINE','UNAUTHORIZED','ERROR'].includes(status))throw new HistoryError('INVALID_CONNECTION_EVENT');
    await this.transaction(async q=>{
      if(!(await q.query(`SELECT id FROM ${prefix}devices WHERE id=$1 FOR UPDATE`,[deviceId])).rows.length)throw new HistoryError('DEVICE_FK_UNRESOLVED');
      const previous=(await q.query(`SELECT id,reason FROM ${prefix}audit_events WHERE device_id=$1 AND actor_ref='history-projector' AND event_type LIKE 'DEVICE_%' AND ${connectionJson}->>'transportHash'=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[deviceId,serialHash])).rows[0],meta=metadata(previous);
      if(Number(meta.observedAt)>at||(meta.latestObservationSource??meta.source)==='LIVE_WORKER'&&source!=='LIVE_WORKER')return;
      if(meta.sourceStatus===status){
        if(at>Number(meta.observedAt))await q.query(`UPDATE ${prefix}audit_events SET reason=$2,created_at=CASE WHEN $3 THEN $4 ELSE created_at END WHERE id=$1 AND actor_ref='history-projector'`,
          [previous.id,JSON.stringify({...meta,observedAt:at,latestObservationSource:source}),source==='LEGACY_SNAPSHOT_NOT_EXACT_TRANSITION_TIME'&&meta.source===source,time(at)]);
        return;
      }
      await q.query(`INSERT INTO ${prefix}audit_events(id,device_id,actor_ref,event_type,mode,reason,created_at) VALUES($1,$2,'history-projector',$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
        [historyId(deviceId+':'+serialHash+':'+status+':'+at),deviceId,'DEVICE_'+status,transport,JSON.stringify({version:1,source,sourceStatus:status,transportHash:serialHash,observedAt:at}),time(at)]);
      const states=(await q.query(`SELECT DISTINCT ON(${connectionJson}->>'transportHash') event_type FROM ${prefix}audit_events WHERE device_id=$1 AND event_type LIKE 'DEVICE_%' AND actor_ref='history-projector' ORDER BY ${connectionJson}->>'transportHash',created_at DESC,id DESC`,[deviceId])).rows;
      const state=states.some(row=>row.event_type==='DEVICE_CONNECTED')?'CONNECTED':status;
      await q.query(`UPDATE ${prefix}devices SET status=$2,last_seen_at=GREATEST(last_seen_at,$3) WHERE id=$1`,[deviceId,state,time(at)]);
    });
  }
  async snapshotDevices(devices:AndroidAdbDevice[],at:number) {
    try{
    const seen=new Set<string>();
    for(const raw of devices){const mapped=historyDevice(raw,at);if(mapped){const id=await this.registerDevice(mapped);
      const old=(await this.database.query(`SELECT device_id FROM ${prefix}audit_events WHERE event_type LIKE 'DEVICE_%' AND actor_ref='history-projector' AND ${connectionJson}->>'transportHash'=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[mapped.serialHash])).rows[0];
      if(old&&String(old.device_id)!==id)await this.connection(String(old.device_id),mapped.serialHash,mapped.transport,'DISCONNECTED',at);
      await this.connection(id,mapped.serialHash,mapped.transport,mapped.status,at);seen.add(mapped.serialHash);}
      else { // Offline/unauthorized can only refer to an already observed transport; never invent an identity.
        const serialHash=hashHistory(raw.serial);seen.add(serialHash);
        const rows=await this.database.query(`SELECT device_id,mode FROM ${prefix}audit_events WHERE event_type LIKE 'DEVICE_%' AND actor_ref='history-projector' AND ${connectionJson}->>'transportHash'=$1 ORDER BY created_at DESC,CASE WHEN event_type='DEVICE_DISCONNECTED' THEN 1 ELSE 0 END,id DESC LIMIT 1`,[serialHash]);
        if(rows.rows[0]&&['offline','unauthorized'].includes(raw.status))await this.connection(String(rows.rows[0].device_id),serialHash,String(rows.rows[0].mode),raw.status==='offline'?'OFFLINE':'UNAUTHORIZED',at);
      }
    }
    const tracked=await this.database.query(`SELECT DISTINCT ON(device_id,${connectionJson}->>'transportHash') device_id,mode,reason FROM ${prefix}audit_events WHERE event_type LIKE 'DEVICE_%' AND actor_ref='history-projector' ORDER BY device_id,${connectionJson}->>'transportHash',created_at DESC,id DESC`);
    for(const row of tracked.rows){const meta=metadata(row);if(typeof meta.transportHash==='string'&&!seen.has(meta.transportHash)&&meta.sourceStatus!=='DISCONNECTED')await this.connection(String(row.device_id),meta.transportHash,String(row.mode),'DISCONNECTED',at);}
    }catch(e){return failure(e);}
  }
  async read(input:HistoryQuery):Promise<unknown> {
    try {
      if(input.kind==='detail'){
        const execution=(await this.database.query(`SELECT * FROM ${prefix}executions WHERE id=$1 AND EXISTS(SELECT 1 FROM ${prefix}audit_events a WHERE a.execution_id=executions.id AND a.event_type='HISTORY_SNAPSHOT' AND a.actor_ref='history-projector')`,[input.id])).rows[0];if(!execution)throw new HistoryError('HISTORY_NOT_FOUND');
        const [steps,evidence,providers,audit]=await Promise.all(['execution_steps','evidence_index','provider_usage','audit_events'].map(table=>this.database.query(`SELECT * FROM ${prefix}${table} WHERE execution_id=$1 ORDER BY ${table==='execution_steps'?'step_order':table==='provider_usage'?'recorded_at':'created_at'},id LIMIT 500`,[input.id])));
        return {execution,steps:steps.rows,evidence:evidence.rows,providers:providers.rows,audit:audit.rows};
      }
      const values:unknown[]=[],conditions:string[]=[];const add=(clause:string,value:unknown)=>{values.push(value);conditions.push(clause.replace('?',`$${values.length}`));};
      const device=input.kind==='devices',connection=input.kind==='connections',table=device?'devices':connection?'audit_events':'executions',date=device?'last_seen_at':connection?'created_at':'started_at';
      if(connection)conditions.push("event_type LIKE 'DEVICE_%' AND actor_ref='history-projector'");
      if(!device&&!connection)conditions.push(`EXISTS(SELECT 1 FROM ${prefix}audit_events a WHERE a.execution_id=executions.id AND a.event_type='HISTORY_SNAPSHOT' AND a.actor_ref='history-projector')`);
      if(input.deviceId)add(device?'id=?':'device_id=?',input.deviceId);
      if(input.status)add(connection?'event_type=?':'status=?',connection?'DEVICE_'+input.status:input.status);
      if(input.engine&&!device&&!connection)add('engine=?',input.engine);
      if(input.transport&&connection)add('mode=?',input.transport);
      if(input.from)add(date+'>=?',input.from);if(input.to)add(date+'<=?',input.to);
      if(input.q){
        if(device||connection)add(device?'model ILIKE ?':'event_type ILIKE ?','%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');
        else{values.push(hashHistory(input.q));conditions.push(`(EXISTS(SELECT 1 FROM ${prefix}audit_events a WHERE a.execution_id=executions.id AND a.actor_ref='history-projector' AND a.event_type='HISTORY_SNAPSHOT' AND a.reason::jsonb->>'requestHash'=$${values.length})${'lệnh android [nội dung đã ẩn]'.includes(input.q.toLocaleLowerCase('vi-VN'))?' OR original_command IS NOT NULL':''})`);}
      }
      const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
      // Count+page share a read-only repeatable snapshot; no empty-array fallback on DB failure.
      return await this.transaction(async q=>{await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const total=Number((await q.query(`SELECT count(*) AS n FROM ${prefix}${table}${where}`,values)).rows[0].n);
        const select=device?'id,serial_hash,physical_identity_hash,model,manufacturer,android_version,status,first_seen_at,last_seen_at':connection?'id,device_id,event_type,mode,reason,created_at':`executions.*,(SELECT d.model FROM ${prefix}devices d WHERE d.id=executions.device_id) AS model,(SELECT a.reason::jsonb->>'sourceStatus' FROM ${prefix}audit_events a WHERE a.execution_id=executions.id AND a.event_type='HISTORY_SNAPSHOT' AND a.actor_ref='history-projector' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS source_status`;
        const items=(await q.query(`SELECT ${select} FROM ${prefix}${table}${where} ORDER BY ${date} DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,input.pageSize,(input.page-1)*input.pageSize])).rows;
        return {storageMode:'POSTGRESQL_HISTORY',items,total,page:input.page,pageSize:input.pageSize};});
    }catch(e){return failure(e);}
  }
}
