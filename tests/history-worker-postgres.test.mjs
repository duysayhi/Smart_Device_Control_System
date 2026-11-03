import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { load } from './helpers/react-skill-console.mjs';

const { startWorker }=load(path.resolve('lib/android/agent/worker-server.ts'));
const { createHistorySink }=load(path.resolve('lib/history/history-service.ts'));
const { PostgresHistoryRepository }=load(path.resolve('lib/history/postgres-history-repository.ts'));
const { historyResponse }=load(path.resolve('lib/history/history-api.ts'));
const { historyDevice,hashHistory }=load(path.resolve('lib/history/history-model.ts'));

test('OFFLINE Worker new task → projector → PostgreSQL fixture → Dashboard API persists once across retry and restart with zero native effect',async t=>{
  const memory=new PGlite();
  const ddl=await fs.readFile(new URL('./helpers/phone-history-schema.sql',import.meta.url));
  assert.equal(hashHistory(ddl),'d33c407007202c279f01394a4ccd2db02d2d01a7d1166b9f7ad39f3aa4fa3365');
  await memory.exec(ddl.toString('utf8'));await memory.exec('SET search_path TO public');
  const result=r=>({rows:r.rows,rowCount:r.affectedRows??r.rows.length});
  const database={query:async(sql,args=[])=>result(await memory.query(sql,args)),
    transaction:work=>memory.transaction(q=>work({query:async(sql,args=[])=>result(await q.query(sql,args))})),close:()=>memory.close()};
  const repository=new PostgresHistoryRepository(database),device={serial:'OFFLINE-PIPELINE-FIXTURE',model:'Synthetic pipeline phone',
    physicalId:'android:'+'d'.repeat(64),identityVerified:true,status:'device',connectionType:'USB'};
  await repository.registerDevice(historyDevice(device,Date.now()));
  const evidenceRoot=path.resolve('coverage/history-neon-finalize-2026-11-02');await fs.mkdir(evidenceRoot,{recursive:true});
  const directory=await fs.mkdtemp(path.join(evidenceRoot,'pipeline-fixture-'));
  let worker;const effects=[];
  const forbidden=name=>async()=>{effects.push(name);assert.fail('No native/model operation in fixture: '+name);};
  const adapter={discover:async()=>[device],reserve:forbidden('reservation'),plan:forbidden('model'),open:forbidden('session'),v2:()=>assert.fail('No V2 native execution for hard-denied fixture')};
  async function stop(){if(worker){worker.server.closeAllConnections();await worker.shutdown();worker=undefined;}}
  t.after(async()=>{await stop();await database.close();const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),evidenceRoot);assert.ok(path.basename(resolved).startsWith('pipeline-fixture-'));await fs.rm(resolved,{recursive:true,force:true});});
  async function request(method,body){const address=JSON.parse(await fs.readFile(path.join(directory,'address.json'),'utf8'));
    return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:address.port,path:'/tasks',method,agent:false,
      headers:{Authorization:'Bearer '+address.token,'Content-Type':'application/json',Connection:'close'}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(text));}catch(error){reject(error);}});});req.setTimeout(5000,()=>req.destroy(Error('Fixture HTTP timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
  }
  const sink=createHistorySink(repository,Promise.resolve(),'e'.repeat(64));worker=await startWorker({directory,adapter,history:sink});
  // This input exercises the real hard-deny task branch, only in a synthetic in-process worker.
  const command={type:'START',requestId:randomUUID(),jobs:[{deviceId:device.serial,goal:'Xóa hết ảnh trong thư viện',agentVersion:2}]};
  const started=await request('POST',command);assert.equal(started.tasks.length,1);const executionId=started.tasks[0].executionId;
  await worker.registry.settled(executionId);await request('GET');await sink.drain();
  assert.equal(sink.status(),'SYNCED');assert.deepEqual(effects,[]);assert.equal(worker.registry.list()[0].status,'BLOCKED');
  const page=await historyResponse(new Request('http://localhost:3000/api/history?kind=executions'),{repository,verified:Promise.resolve()});
  assert.equal(page.status,200);const body=await page.json();assert.equal(body.storageMode,'POSTGRESQL_HISTORY');assert.equal(body.total,1);
  assert.equal(body.items[0].id,executionId);assert.equal(body.items[0].status,'BLOCKED');assert.equal(body.items[0].engine,'GOAL_V2');
  assert.equal(JSON.stringify(body).includes(command.jobs[0].goal),false);
  const detail=await historyResponse(new Request('http://localhost:3000/api/history?kind=detail&id='+executionId),{repository:new PostgresHistoryRepository(database),verified:Promise.resolve()});
  const readback=await detail.json();assert.equal(readback.execution.id,executionId);assert.equal(readback.steps.length,0);assert.equal(readback.evidence.length,0);
  assert.ok(readback.audit.some(row=>row.event_type==='HISTORY_SNAPSHOT'&&JSON.parse(row.reason).requestHash===hashHistory(command.jobs[0].goal)));
  const repeated=await request('POST',command);assert.equal(repeated.tasks[0].executionId,executionId);await request('GET');await sink.drain();
  assert.equal(Number((await memory.query('SELECT count(*) AS n FROM phone_commander.executions')).rows[0].n),1);
  await stop();const checkpoint=JSON.parse(await fs.readFile(path.join(directory,'tasks.json'),'utf8'));assert.equal(checkpoint.length,1);assert.equal(checkpoint[0].executionId,executionId);
  const nextSink=createHistorySink(new PostgresHistoryRepository(database),Promise.resolve(),'e'.repeat(64));worker=await startWorker({directory,adapter,history:nextSink});
  const restored=await request('GET');await nextSink.drain();assert.equal(restored.tasks[0].executionId,executionId);assert.equal(restored.tasks[0].status,'BLOCKED');
  assert.deepEqual(worker.registry.ownerTestModes(),[]);assert.equal(worker.registry.list().filter(row=>!row.finishedAt).length,0);assert.deepEqual(effects,[]);
  assert.equal(Number((await memory.query('SELECT count(*) AS n FROM phone_commander.executions')).rows[0].n),1);
});
