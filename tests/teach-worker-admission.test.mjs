import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Offline transport characterization: no Worker, Appium, ADB, network or database.
function fixture({ rejected = false, mismatch = false, adminFeature=false, continuationFeature=false, ownerMismatch=false } = {}) {
  const calls = [], timeouts = [], source = fs.readFileSync(path.resolve('lib/android/agent/worker-client.ts'), 'utf8');
  const metadata = { protocol: 1, pid: 42, port: 59999, token: 'a'.repeat(64),
    features: ['teach-step-v1', 'skill-replay-v1', 'source-policy-v2', 'unified-prepared-plan'],
    ownerAuthSha256:ownerMismatch?'STALE_OWNER':'OWNER_DIGEST',runtimeSha256: 'ANDROID_DIGEST', teachRuntimeSha256: mismatch ? 'STALE_DIGEST' : 'TEACH_DIGEST' };
  if(adminFeature)metadata.features.push('teach-admin-admission-v1');if(continuationFeature)metadata.features.push('teach-continuation-v1');
  const context = { exports: {}, process: { cwd: () => '/offline', execPath: 'unused', env: {} },
    AbortSignal: { timeout(ms) { timeouts.push(ms); return new AbortController().signal; }, any: signals => AbortSignal.any(signals) },
    Response, URLSearchParams, Buffer, setTimeout,
    require(id) {
      if (id === 'node:fs/promises') return { readFile: async () => JSON.stringify(metadata) };
      if (id === 'node:path') return path;
      if (id === 'node:child_process') return { spawn: () => assert.fail('Existing Worker must not spawn again') };
      if (id === './runtime-storage') return { runtimeDirectory: () => '/offline', androidRuntimeDigest: () => 'ANDROID_DIGEST', teachRuntimeDigest: () => 'TEACH_DIGEST' };
      if(id==='../../owner-auth/certificates')return {ownerAuthenticationRuntimeSha256:()=> 'OWNER_DIGEST'};
      assert.fail('Unexpected dependency: ' + id);
    },
    async fetch(url, options) {
      calls.push({ url, options });
      if (url.endsWith('/health')) return Response.json({ pid: 42 });
      if (rejected) throw new DOMException('Offline admission transport timeout', 'TimeoutError');
      return Response.json({ accepted: true });
    },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { request: context.exports.workerRequest, calls, timeouts };
}

for (const route of ['/teach', '/replay']) test('OFFLINE native admission has bounded setup deadline, preserves payload/auth, and sends once: ' + route, async () => {
  const f = fixture(), command = { type: 'OPEN', requestId: 'offline-request', deviceId: 'OFFLINE_DEVICE' };
  await f.request('POST', command, route);
  assert.deepEqual(f.timeouts, [1000, 181000]);
  const sent = f.calls.filter(c => !c.url.endsWith('/health'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(sent[0].options.body), command);
  assert.equal(sent[0].options.headers.Authorization, 'Bearer ' + 'a'.repeat(64));
  assert.equal(sent[0].options.cache, 'no-store');
});

for (const [method, route, body, timeout] of [
  ['POST', '/teach', { type: 'STEP' }, 20000],
  ['POST', '/teach', { type: 'FRAME' }, 20000],
  ['POST', '/replay', { type: 'CANCEL' }, 20000],
  ['POST', '/tasks', { type: 'START', jobs: [] }, 20000],
  ['GET', '/tasks', undefined, 20000],
  ['POST', '/planning', { type: 'PREPARE' }, 181000],
  ['POST', '/reasoning', {}, 181000],
]) test('OFFLINE existing transport deadline remains unchanged: ' + method + ' ' + route + ' ' + (body?.type ?? ''), async () => {
  const f = fixture(); await f.request(method, body, route);
  assert.deepEqual(f.timeouts, [1000, timeout]);
  assert.equal(f.calls.length, 2);
});

test('OFFLINE admission timeout remains unknown and never retries the mutation', async () => {
  const f = fixture({ rejected: true });
  await assert.rejects(f.request('POST', { type: 'OPEN' }, '/teach'), { name: 'TimeoutError' });
  assert.equal(f.calls.filter(c => c.url.endsWith('/teach')).length, 1);
  assert.deepEqual(f.timeouts, [1000, 181000]);
});

test('OFFLINE aborted caller still prevents admission before any request', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.request('POST', { type: 'OPEN' }, '/replay', controller.signal), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
});

test('OFFLINE admission still enforces runtime source binding before dispatch', async () => {
  const f = fixture({ mismatch: true });
  const response = await f.request('POST', { type: 'OPEN' }, '/teach');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'TEACH_WORKER_SOURCE_MISMATCH');
  assert.equal(f.calls.filter(c => c.url.endsWith('/teach')).length, 0);
});

for(const options of [{},{adminFeature:true},{adminFeature:true,continuationFeature:true,ownerMismatch:true}])test('OFFLINE continuation feature/owner source gate refuses before dispatch: '+JSON.stringify(options),async()=>{const f=fixture(options),response=await f.request('POST',{type:'CONTINUATION_STAGE'},'/teach');assert.equal(response.status,409);assert.equal(f.calls.filter(c=>!c.url.endsWith('/health')).length,0);});
test('OFFLINE updated continuation transport forwards one command after all authority/source feature checks',async()=>{const f=fixture({adminFeature:true,continuationFeature:true}),response=await f.request('POST',{type:'CONTINUATION_STAGE'},'/teach');assert.equal(response.status,200);assert.equal(f.calls.filter(c=>!c.url.endsWith('/health')).length,1);});
