import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, readFile, writeFile, rename, unlink, rmdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DeviceRuntimeRegistry, type RuntimeAdapter } from './device-runtime';
import { RuntimeCommand, EvidenceQuery, type DeviceTask } from './runtime-schema';
import { runtimeDirectory, androidRuntimeDigest } from './runtime-storage';
import { sharedReasoningScheduler } from './reasoning-scheduler';
import type { WorkerAddress } from './runtime-storage';
import { z } from 'zod';
import { CatalogWarmup } from './catalog-warmup';

async function jsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length; if (size > 65536) throw new Error('Worker input is too large.'); chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startWorker(options: { directory?: string; adapter?: RuntimeAdapter } = {}) {
  const root = options.directory ?? runtimeDirectory(), lock = join(root, 'owner'); await mkdir(root, { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = JSON.parse(await readFile(join(lock, 'pid.json'), 'utf8')) as { pid: number };
    try { process.kill(owner.pid, 0); throw new Error('A runtime worker is already running.'); }
    catch (check) {
      if ((check as NodeJS.ErrnoException).code !== 'ESRCH') throw check;
      await unlink(join(lock, 'pid.json')); await rmdir(lock); await mkdir(lock);
    }
  }
  await writeFile(join(lock, 'pid.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  const stateFile = join(root, 'tasks.json'), token = randomBytes(32).toString('hex');
  let writes = Promise.resolve(), stopping = false, saveTimer: ReturnType<typeof setTimeout> | undefined;
  let warmup: CatalogWarmup | undefined, admitting = 0;
  const registry = new DeviceRuntimeRegistry(options.adapter, () => {
    warmup?.schedule();
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = undefined; const content = JSON.stringify(registry.persisted());
      writes = writes.then(async () => { await writeFile(stateFile + '.tmp', content, { mode: 0o600 }); await rename(stateFile + '.tmp', stateFile); }).catch(() => { console.error('Runtime journal write failed.'); });
    }, 100);
  });
  if (!options.adapter) warmup = new CatalogWarmup(() => !stopping && admitting === 0 && registry.ownerTestModes().length === 0 && !registry.list().some(t => !t.finishedAt));
  try {
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as DeviceTask[];
    if (Array.isArray(saved)) registry.restore(saved);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Runtime journal could not be restored; nothing will be resumed.'); }
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    const received = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + token);
    if (request.headers.origin || received.length !== expected.length || !timingSafeEqual(received, expected)) { response.writeHead(403).end('{}'); return; }
    try {
      if (request.url === '/health') { response.end(JSON.stringify({ protocol: 1, features: ['agent-v2', 'owner-test-mode', 'source-policy-v2'], pid: process.pid, queue: sharedReasoningScheduler.summary() })); return; }
      if (request.url?.startsWith('/evidence?') && request.method === 'GET') {
        const query = EvidenceQuery.parse(Object.fromEntries(new URL(request.url, 'http://127.0.0.1').searchParams));
        const task = registry.list().find(task => task.executionId === query.executionId && task.deviceId === query.deviceId);
        const visual = task?.latest?.visual;
        if (task?.status !== 'WAITING_HUMAN' || visual?.id !== query.evidenceId || !visual?.image.dataUrl.startsWith('data:image/png;base64,') ||
          !task.latest?.assistance?.resumable || task.latest.assistance.expiresAt <= Date.now()) { response.writeHead(410).end('{}'); return; }
        response.setHeader('Content-Type', 'image/png'); response.end(Buffer.from(visual.image.dataUrl.slice('data:image/png;base64,'.length), 'base64')); return;
      }
      if (request.url === '/shutdown' && request.method === 'POST') {
        const input = await jsonBody(request).catch(() => ({}));
        const cancelActive = z.object({ cancelActive: z.literal(true) }).strict().safeParse(input).success;
        if (registry.list().some(task => !task.finishedAt) && !cancelActive) throw new Error('Cannot stop a worker with active executions.');
        response.end(JSON.stringify({ accepted: true })); void shutdown(); return;
      }
      if (request.url === '/reasoning' && request.method === 'POST' && !stopping) {
        const body = z.object({ model: z.literal(process.env.OLLAMA_MODEL ?? 'phone-commander'), stream: z.literal(false), format: z.record(z.string(), z.unknown()),
          options: z.object({ temperature: z.literal(0) }).strict(),
          messages: z.array(z.object({ role: z.enum(['system', 'user']), content: z.string().max(24000) }).strict()).min(1).max(2) }).strict().parse(await jsonBody(request));
        const cancel = new AbortController(); response.once('close', () => { if (!response.writableEnded) cancel.abort(); });
        const base = new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
        if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid Ollama URL.');
        const result = await sharedReasoningScheduler.run('action-plan-interpreter', async signal => {
          const reply = await fetch(new URL('/api/chat', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
          return { status: reply.status, body: await reply.text() };
        }, cancel.signal, Math.min(180000, Math.max(1000, Number(process.env.OLLAMA_TIMEOUT_MS ?? 180000))));
        response.writeHead(result.status).end(result.body); return;
      }
      if (request.url === '/tasks' && request.method === 'GET') {
        const devices = await registry.refreshConnections();
        warmup?.connected(devices);
        const tasks = registry.list();
        for (const task of tasks) if (task.latest?.visual?.image) {
          task.latest.visual.image.dataUrl = '/api/agent/runtime?' + new URLSearchParams({ executionId: task.executionId, deviceId: task.deviceId, evidenceId: task.latest.visual.id }).toString();
        }
        response.end(JSON.stringify({ tasks, devices, reasoning: sharedReasoningScheduler.summary(), ownerTestModes: registry.ownerTestModes(), ownerPolicyAudit: registry.ownerPolicyAudit() })); return;
      }
      if (request.url !== '/tasks' || request.method !== 'POST' || stopping) { response.writeHead(404).end('{}'); return; }
      const command = RuntimeCommand.parse(await jsonBody(request));
      if (command.type === 'SET_OWNER_TEST_MODE') {
        const audit = (authorizationId: string, accepted: boolean) => appendFileSync(join(root, 'owner-test-policy-audit.jsonl'), JSON.stringify({ at: Date.now(), event: command.enabled ? 'ENABLED' : 'DISABLED', accepted, deviceId: command.deviceId, physicalId: command.physicalId, authorizationId, fullControl: command.fullControl === true, rollbackOnFailure: command.rollbackOnFailure === true }) + '\n', { mode: 0o600 });
        // Commit the rare authorization change only after its audit write; never expose an unaudited enable window.
        if (command.enabled) admitting++;
        try {
          if (command.enabled) await warmup?.pause();
          const accepted = await registry.setOwnerTestMode(command, mode => audit(mode.id, true));
          if (!command.enabled) audit(command.authorizationId!, accepted);
          response.end(JSON.stringify({ accepted }));
        } finally { if (command.enabled) admitting--; warmup?.schedule(); }
        return;
      }
      if (command.type === 'START') {
        admitting++;
        try { await warmup?.pause(); response.end(JSON.stringify({ tasks: await registry.start(command) })); }
        finally { admitting--; warmup?.schedule(); }
        return;
      }
      const result =
        { accepted: command.type === 'CANCEL' ? registry.cancel(command.executionId, command.deviceId) : command.type === 'CANCEL_BATCH' ? registry.cancelBatch(command.batchId) > 0 : command.type === 'ASSIST_V2' ? registry.confirmV2(command) : registry.confirm(command) };
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(409).end(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 240) : 'Runtime command rejected.' }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No worker address.');
  const metadata: WorkerAddress = { port: address.port, token, pid: process.pid, protocol: 1, features: ['agent-v2', 'owner-test-mode', 'full-control-test-mode', 'source-policy-v2'],
    runtimeSha256: androidRuntimeDigest(), observerIdleTimeoutMs: Number(process.env.AGENT_V2_OBSERVER_IDLE_TIMEOUT_MS ?? process.env.ANDROID_OBSERVER_IDLE_TIMEOUT_MS ?? 1000) };
  await writeFile(join(root, 'address.json'), JSON.stringify(metadata), { mode: 0o600 });
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    await warmup?.close();
    await registry.shutdown();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
    await writes; await writeFile(stateFile, JSON.stringify(registry.persisted()), { mode: 0o600 });
    await new Promise<void>(resolve => server.close(() => resolve()));
    await unlink(join(root, 'address.json')); await unlink(join(lock, 'pid.json')); await rmdir(lock);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  };
  const onSignal = () => { void shutdown(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  console.log('Phone Commander runtime worker ready on loopback port ' + address.port + '.');
  return { registry, shutdown, server };
}
