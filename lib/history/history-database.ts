import { createTeachPostgresDatabase, type TeachDatabase } from '../skills/db/pg-database';
import { hashHistory, HistoryError } from './history-model';
import { PostgresHistoryRepository } from './postgres-history-repository';

const required:Record<string,string[]>={devices:['id','serial_hash','physical_identity_hash','model','manufacturer','android_version','status','first_seen_at','last_seen_at','metadata'],
  executions:['id','device_id','engine','status','original_command','terminal_reason','started_at','finished_at','execute_ms','model_calls','rpc_count','adb_count','runtime_digest'],
  execution_steps:['id','execution_id','step_order','capability','status','evidence_tier'],evidence_index:['id','execution_id','step_id','evidence_type','evidence_tier','storage_ref','redacted','created_at'],
  provider_usage:['id','execution_id','requested_provider','actual_provider','model','request_count','prompt_tokens','completion_tokens','latency_ms','http_status','recorded_at'],
  audit_events:['id','device_id','execution_id','actor_ref','event_type','mode','reason','created_at']};
/** All live access is preceded by this read-only check on the same pool. Never installs or repairs schema. */
export async function verifyHistoryDatabase(database:TeachDatabase,expectedBranch:string) {
  if(!/^[a-f0-9]{64}$/.test(expectedBranch))throw new HistoryError('HISTORY_BRANCH_BINDING_REQUIRED');
  const security=await database.connectionSecurity?.();
  if(!security?.encrypted||!security.authorized)throw new HistoryError('HISTORY_TLS_UNVERIFIED');
  let domain:HistoryError|undefined;
  try{return await database.transaction(async q=>{try{
    await q.query('SET TRANSACTION READ ONLY');
    const connection=(await q.query("SELECT current_database() AS database,current_user AS role,current_setting('neon.branch_id',true) AS branch,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls")).rows[0];
    if(connection.database!=='neondb')throw new HistoryError('HISTORY_DATABASE_NAME_MISMATCH');
    if(typeof connection.branch!=='string'||!connection.branch)throw new HistoryError('HISTORY_BRANCH_ID_UNAVAILABLE');
    if(hashHistory(connection.branch)!==expectedBranch)throw new HistoryError('HISTORY_BRANCH_FINGERPRINT_MISMATCH');
    const tables=(await q.query("SELECT table_name FROM information_schema.tables WHERE table_schema='phone_commander' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>String(r.table_name));
    if(tables.length!==15||Object.keys(required).some(t=>!tables.includes(t)))throw new HistoryError('HISTORY_SCHEMA_MISMATCH');
    const columns=(await q.query("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='phone_commander' ORDER BY table_name,ordinal_position")).rows;
    if(Object.entries(required).some(([table,names])=>names.some(name=>!columns.some(c=>c.table_name===table&&c.column_name===name))))throw new HistoryError('HISTORY_SCHEMA_MISMATCH');
    const constraints=(await q.query("SELECT t.relname AS table_name,c.contype,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='phone_commander' ORDER BY t.relname,c.conname")).rows;
    const checks=(table:string)=>constraints.filter(c=>c.table_name===table).map(c=>String(c.definition)).join('\n');
    if(!['COMPLETED','BLOCKED','CANCELLED','UNVERIFIED'].every(s=>checks('executions').includes(s))||!checks('devices').includes('physical_identity_hash')||!checks('devices').includes('{64}')||!checks('execution_steps').includes('UNIQUE (execution_id, step_order)')||!checks('evidence_index').includes('FOREIGN KEY (execution_id, step_id)'))throw new HistoryError('HISTORY_CONSTRAINT_MISMATCH');
    const indexes=(await q.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='phone_commander' ORDER BY tablename,indexname")).rows;
    const privileges=[];for(const table of Object.keys(required)){const p=(await q.query("SELECT has_table_privilege(current_user,$1,'SELECT') AND has_table_privilege(current_user,$1,'INSERT') AND has_table_privilege(current_user,$1,'UPDATE') AS allowed",['phone_commander.'+table])).rows[0];privileges.push({table,allowed:p.allowed===true});}
    if(privileges.some(p=>!p.allowed))throw new HistoryError('HISTORY_PRIVILEGE_MISSING');
    return {database:'neondb',role:String(connection.role),tls:true,clientTls:security,backendLegTls:connection.tls===true,branchSha256:hashHistory(connection.branch),schema:'phone_commander',tables,columns,constraints,indexes,privileges};
  }catch(error){if(error instanceof HistoryError)domain=error;throw error;}});}catch(error){throw domain??error;}
}

type Store={binding:string;database:TeachDatabase;repository:PostgresHistoryRepository;verified:Promise<unknown>};
const cache=globalThis as typeof globalThis&{phoneCommanderHistory?:Store};
export function historyStorage() {
  const url=process.env.DATABASE_URL,expected=process.env.HISTORY_EXPECTED_BRANCH_SHA256;
  if(process.env.HISTORY_STORAGE_MODE!=='POSTGRESQL'||!url||!expected)throw new HistoryError('HISTORY_NOT_CONFIGURED');
  const binding=hashHistory(JSON.stringify([process.cwd(),url,expected,'phone_commander']));
  if(cache.phoneCommanderHistory){if(cache.phoneCommanderHistory.binding!==binding)throw new HistoryError('HISTORY_CONFIG_CHANGED_RESTART_REQUIRED');return cache.phoneCommanderHistory;}
  const database=createTeachPostgresDatabase(url),store:Store={binding,database,repository:new PostgresHistoryRepository(database),verified:Promise.resolve()};
  // No background connection at import time. A rejected preflight remains rejected until restart.
  store.verified=verifyHistoryDatabase(database,expected);void store.verified.catch(()=>undefined);cache.phoneCommanderHistory=store;return store;
}
