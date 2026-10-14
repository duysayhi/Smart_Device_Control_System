import { z } from 'zod';
import { isValidAndroidSerial, listAndroidDevices, runAdb } from '@/lib/android/adb';
import { AgentBudget } from '@/lib/android/agent/budget';
import { planGoal } from '@/lib/android/agent/goal-planner';
import { createAgentExecution, runAgent } from '@/lib/android/agent/agent-loop';
import { asAndroidError } from '@/lib/android/errors';

const Input = z.object({ deviceId: z.string().min(1).max(128), goal: z.string().trim().min(1).max(2000) }).strict();
export async function POST(request: Request) {
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success || !isValidAndroidSerial(input.data?.deviceId ?? '')) return Response.json({ error: 'Goal hoặc serial không hợp lệ.' }, { status: 400 });
  const budget = new AgentBudget();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(budget.limits.timeMs)]);
  let execution: Awaited<ReturnType<typeof createAgentExecution>>, planned: Awaited<ReturnType<typeof planGoal>>;
  try {
    const devices = await listAndroidDevices();
    const device = devices.find(d => d.serial === input.data.deviceId);
    if (!device || device.status !== 'device' || device.connectionType !== 'USB') return Response.json({ error: 'Cần một thiết bị Android USB đã cấp quyền.' }, { status: 409 });
    planned = await planGoal(input.data.goal, budget, undefined, signal);
    execution = await createAgentExecution(planned.goal, budget, input.data.deviceId, runAdb, signal);
  } catch (error) {
    const failure = asAndroidError(error);
    return Response.json({ error: failure.code === 'BACKEND_ERROR' ? 'Không thể lập goal an toàn hoặc kết nối backend Agent. Kiểm tra phạm vi yêu cầu/Ollama/Appium.' : failure.message,
      status: signal.aborted && signal.reason?.name !== 'TimeoutError' ? 'CANCELLED' : 'BLOCKED', errorCode: failure.code }, { status: failure.code === 'SESSION_ERROR' ? 409 : 422 });
  }
  const encoder = new TextEncoder();
  let detached = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void runAgent(planned.goal, budget, execution, undefined, signal, event => {
        if (!detached) controller.enqueue(encoder.encode(JSON.stringify({ ...event, plannerSource: planned.source }) + '\n'));
      }).catch(() => {
        if (!detached) { detached = true; controller.error(new Error('Agent execution stream failed.')); }
      }).finally(() => { if (!detached) controller.close(); });
    },
    cancel() { detached = true; cancellation.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
