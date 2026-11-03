/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit operator CLI. Never loads env files itself, changes schema or starts Android/Worker/model services.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText,file);
const {createTeachPostgresDatabase}=require('../lib/skills/db/pg-database.ts');
const {verifyHistoryDatabase}=require('../lib/history/history-database.ts');
const {PostgresHistoryRepository}=require('../lib/history/postgres-history-repository.ts');
const {inspectHistorySource,importHistory}=require('../lib/history/history-import.ts');
const {runtimeDirectory}=require('../lib/android/agent/runtime-storage.ts');
const {hashHistory,mapHistoryTask,HistoryQuerySchema}=require('../lib/history/history-model.ts');
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
async function main(){
  const action=args[0],root=path.resolve(value('--source-root')??process.cwd()),evidence=path.resolve(value('--evidence-dir')??'coverage/history-neon-2026-11-02');
  const relative=path.relative(path.resolve('coverage'),evidence);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('INVALID_EVIDENCE_DIRECTORY');
  fs.mkdirSync(evidence,{recursive:true});
  if(action==='dry-run'){
    const file=path.join(runtimeDirectory(root),'tasks.json'),bytes=fs.readFileSync(file),plan=inspectHistorySource(bytes);
    const result={mode:'DRY_RUN_NO_DATABASE',sourceRootHash:hashHistory(root),checksum:plan.checksum,sourceCount:plan.count,validCount:plan.valid.length,rejected:plan.rejected,missingPhysicalIdentity:plan.valid.filter(t=>!t.physicalId).length};
    fs.writeFileSync(path.join(evidence,'import-dry-run.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));return;
  }
  if(!['preflight','import','reconcile'].includes(action))throw Error('INVALID_HISTORY_ACTION');
  const expected=value('--expected-branch-sha256')??process.env.HISTORY_EXPECTED_BRANCH_SHA256;
  console.log(JSON.stringify({databaseUrlPresent:Boolean(process.env.DATABASE_URL),expectedBranchPresent:Boolean(expected)}));
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL_MISSING');
  const database=createTeachPostgresDatabase(process.env.DATABASE_URL);
  try{
    const preflight=await verifyHistoryDatabase(database,expected??'');fs.writeFileSync(path.join(evidence,'live-preflight.json'),JSON.stringify(preflight,null,2),{mode:0o600});
    console.log(JSON.stringify({preflight:'PASS',database:preflight.database,role:preflight.role,tls:preflight.tls,tables:preflight.tables.length,branchSha256:preflight.branchSha256}));
    if(action==='preflight')return;
    if(action==='reconcile'){
      const bytes=fs.readFileSync(path.join(runtimeDirectory(root),'tasks.json')),plan=inspectHistorySource(bytes),ids=plan.valid.map(t=>t.executionId);
      const rows=(await database.query(`SELECT e.id,e.status,e.engine,e.started_at,e.finished_at,e.original_command,d.id AS matched_device,
        (SELECT a.reason FROM phone_commander.audit_events a WHERE a.execution_id=e.id AND a.event_type='HISTORY_SNAPSHOT' AND a.actor_ref='history-projector' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS provenance
        FROM phone_commander.executions e JOIN phone_commander.devices d ON d.id=e.device_id WHERE e.id=ANY($1::uuid[])`,[ids])).rows;
      const mismatches=[],missing=[];for(const task of plan.valid){const row=rows.find(r=>r.id===task.executionId);if(!row){missing.push(task.executionId);continue;}
        const expected=mapHistoryTask(task,'LEGACY_IMPORT',Date.now()),meta=JSON.parse(row.provenance??'{}');
        if(row.status!==expected.status||row.engine!==expected.engine||!row.matched_device||meta.sourceStatus!==expected.sourceStatus||meta.requestHash!==expected.requestHash||row.original_command!=='Lệnh Android [nội dung đã ẩn]'||new Date(row.started_at).getTime()!==expected.createdAt||(expected.finishedAt!==undefined&&new Date(row.finished_at).getTime()!==expected.finishedAt))mismatches.push(task.executionId);
      }
      const repository=new PostgresHistoryRepository(database),page=await repository.read(HistoryQuerySchema.parse({pageSize:100}));
      const counts=(await database.query(`SELECT (SELECT count(*) FROM phone_commander.executions WHERE id=ANY($1::uuid[])) AS executions,
        (SELECT count(*) FROM phone_commander.execution_steps WHERE execution_id=ANY($1::uuid[])) AS steps,
        (SELECT count(*) FROM phone_commander.evidence_index WHERE execution_id=ANY($1::uuid[])) AS evidence,
        (SELECT count(*) FROM phone_commander.provider_usage WHERE execution_id=ANY($1::uuid[])) AS providerRows,
        (SELECT count(*) FROM phone_commander.audit_events WHERE event_type='HISTORY_QUARANTINED' AND actor_ref='history-projector') AS quarantined`,[ids])).rows[0];
      const result={mode:'INDEPENDENT_READ_ONLY_NEW_POOL',sourceChecksum:plan.checksum,sourceCount:plan.count,databaseRows:rows.length,missing,mismatches,repositoryTotal:page.total,counts,statusCounts:rows.reduce((out,r)=>{out[r.status]=(out[r.status]??0)+1;return out;},{})};
      fs.writeFileSync(path.join(evidence,'live-reconciliation.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));return;
    }
    if(!args.includes('--apply'))throw Error('EXPLICIT_APPLY_REQUIRED');
    const source=runtimeDirectory(root),taskFile=path.join(source,'tasks.json'),wirelessFile=path.join(source,'wireless-devices.json'),bytes=fs.readFileSync(taskFile);
    inspectHistorySource(bytes);const wirelessBytes=fs.existsSync(wirelessFile)?fs.readFileSync(wirelessFile):Buffer.from('[]');
    const {WirelessRecord}=require('../lib/android/wireless-store.ts'),{z}=require('zod');
    const wireless=z.array(WirelessRecord).max(100).parse(JSON.parse(wirelessBytes.toString('utf8')));
    // Backups contain existing private local journal data. Never include them in Git or public assets.
    const backup=path.join(evidence,'source-backup-'+hashHistory(Buffer.concat([bytes,wirelessBytes])).slice(0,16));fs.mkdirSync(backup,{recursive:true,mode:0o700});
    for(const [name,content] of [['tasks.json',bytes],['wireless-devices.json',wirelessBytes]]){const file=path.join(backup,name);if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(content))throw Error('SOURCE_BACKUP_CONFLICT');}else fs.writeFileSync(file,content,{flag:'wx',mode:0o600});}
    const result=await importHistory(new PostgresHistoryRepository(database),bytes,wireless,fs.statSync(taskFile).mtimeMs,fs.existsSync(wirelessFile)?fs.statSync(wirelessFile).mtimeMs:fs.statSync(taskFile).mtimeMs);
    result.sourceUnchanged=fs.readFileSync(taskFile).equals(bytes);fs.writeFileSync(path.join(evidence,'live-import.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
  }finally{await database.close();}
}
main().catch(error=>{const code=error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:error&&typeof error.message==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'HISTORY_OPERATION_BLOCKED';console.error(JSON.stringify({verdict:'BLOCKED',code}));process.exitCode=1;});
