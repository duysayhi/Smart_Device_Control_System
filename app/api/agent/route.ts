import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { workerRequest } from '@/lib/android/agent/worker-client';
import { terminalTask, type DeviceTask } from '@/lib/android/agent/runtime-schema';
import { isLocalMutation } from '@/lib/android/agent/request-origin';
import { LEGACY_ENTRY_ENABLED, legacyEntryDenied } from '@/lib/android/unified-agent/legacy-entry';
import { assertSafeSource } from '@/lib/android/safety-envelope';

// Retain NDJSON compatibility. Viewer disconnects do not cancel device ownership.
export async function POST(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ error: 'Origin không hợp lệ.' }, { status: 403 });
  const input = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), goal: z.string().trim().min(1).max(2000) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'Goal hoặc serial không hợp lệ.' }, { status: 400 });
  try { assertSafeSource(input.data.goal); }
  catch { return Response.json({ error: 'HARD_DENY: unsafe source; no execution authorized.' }, { status: 403 }); }
  if (!LEGACY_ENTRY_ENABLED) return legacyEntryDenied();
  try {
    const created = await workerRequest('POST', { type: 'START', requestId: randomUUID(), jobs: [input.data] });
    if (!created.ok) return Response.json(await created.json(), { status: created.status });
    const task = (await created.json()).tasks[0] as DeviceTask;
    let detached = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          let previous = '';
          while (!detached) {
            const response = await workerRequest('GET'), payload = await response.json();
            const current = (payload.tasks as DeviceTask[]).find(item => item.executionId === task.executionId);
            if (!current) throw new Error('Execution not found.');
            const event = current.latest && { ...current.latest, type: current.finishedAt ? 'complete' : 'progress',
              cancellationToken: task.executionId, executionId: task.executionId, deviceId: task.deviceId };
            const line = JSON.stringify(event);
            if (!detached && event && line !== previous) { controller.enqueue(encoder.encode(line + '\n')); previous = line; }
            if (current.finishedAt && terminalTask(current.status)) break;
            await new Promise(resolve => setTimeout(resolve, 750));
          }
          if (!detached) controller.close();
        })().catch(() => { if (!detached) controller.error(new Error('Runtime viewer disconnected; execution remains owned by the worker.')); });
      },
      cancel() { detached = true; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Runtime worker không sẵn sàng.' }, { status: 503 }); }
}
