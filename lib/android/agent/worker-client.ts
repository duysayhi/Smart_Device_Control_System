import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runtimeDirectory, androidRuntimeDigest, type WorkerAddress } from './runtime-storage';
let starting: Promise<WorkerAddress> | undefined;
async function address(): Promise<WorkerAddress | undefined> {
  try {
    const value = JSON.parse(await readFile(join(runtimeDirectory(), 'address.json'), 'utf8')) as WorkerAddress;
    if (value.protocol !== 1 || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token)) return;
    const response = await fetch(`http://127.0.0.1:${value.port}/health`, { headers: { Authorization: 'Bearer ' + value.token }, signal: AbortSignal.timeout(1000), cache: 'no-store' });
    if (response.ok && (await response.json()).pid === value.pid) return value;
  } catch { /* A new worker may still be publishing its address. */ }
}
async function ensureWorker(): Promise<WorkerAddress> {
  const current = await address(); if (current) return current;
  if (!starting) starting = (async () => {
    const child = spawn(process.execPath, [join(process.cwd(), 'scripts', 'agent-worker.cjs')], {
      cwd: process.cwd(), env: process.env, detached: true, windowsHide: true, stdio: 'ignore',
    });
    let spawnError: Error | undefined; child.once('error', error => { spawnError = error; }); child.unref();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      const ready = await address(); if (ready) return ready;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Runtime worker unavailable. Run npm run agent:worker and inspect the retained worker/device locks.');
  })().finally(() => { starting = undefined; });
  return starting;
}
export async function workerRequest(method: 'GET' | 'POST', body?: unknown, path: '/tasks' | '/reasoning' | '/evidence' = '/tasks', signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const connection = await ensureWorker();
  const command = body as { type?: string; enabled?: boolean; fullControl?: boolean; jobs?: { agentVersion?: number; ownerAuthorizedTest?: boolean }[] } | undefined;
  if (method === 'POST' && path === '/tasks' && (command?.type === 'START' || command?.type === 'SET_OWNER_TEST_MODE' && command.enabled !== false) &&
    (!connection.features?.includes('source-policy-v2') || connection.runtimeSha256 && androidRuntimeDigest() && connection.runtimeSha256 !== androidRuntimeDigest())) {
    return Response.json({ error: 'Runtime source/policy version changed. Finish existing tasks and restart the idle worker before granting or starting another execution.' }, { status: 409 });
  }
  if (method === 'POST' && command?.type === 'SET_OWNER_TEST_MODE' && command.fullControl && !connection.features?.includes('full-control-test-mode')) {
    return Response.json({ error: 'Full-control mode requires the updated idle worker; no authorization was sent.' }, { status: 409 });
  }
  if (method === 'POST' && path === '/tasks' && (command?.type === 'SET_OWNER_TEST_MODE' || command?.jobs?.some(job => job.ownerAuthorizedTest)) && !connection.features?.includes('owner-test-mode')) {
    return Response.json({ error: 'Owner test mode requires the updated worker. Restart the idle worker first; no authorization or action was sent.' }, { status: 409 });
  }
  if (method === 'POST' && path === '/tasks' && command?.type === 'START' && command.jobs?.some(job => job.agentVersion === 2) && !connection.features?.includes('agent-v2')) {
    return Response.json({ error: 'Agent V2 requires an updated worker. Finish active tasks, then restart the idle runtime; existing Sessions were not interrupted.' }, { status: 409 });
  }
  const query = method === 'GET' && body ? '?' + new URLSearchParams(body as Record<string, string>).toString() : '';
  return fetch(`http://127.0.0.1:${connection.port}${path}${query}`, { method, headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(path === '/reasoning' ? 181000 : 20000), ...(signal ? [signal] : [])]), cache: 'no-store' });
}
export async function queuedOllamaFetch(_url: string, options: RequestInit) {
  return workerRequest('POST', JSON.parse(String(options.body)), '/reasoning', options.signal ?? undefined);
}
export async function runningWorkerTasks(): Promise<Response | undefined> {
  const connection = await address(); if (!connection) return;
  return fetch(`http://127.0.0.1:${connection.port}/tasks`, { headers: { Authorization: 'Bearer ' + connection.token }, signal: AbortSignal.timeout(5000), cache: 'no-store' });
}
