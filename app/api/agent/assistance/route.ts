import { z } from 'zod';
import { submitHumanChoice, cancelAgent } from '@/lib/android/agent/human-assistance';
import { runningWorkerTasks, workerRequest } from '@/lib/android/agent/worker-client';
import type { DeviceTask } from '@/lib/android/agent/runtime-schema';
import { isLocalMutation } from '@/lib/android/agent/request-origin';

const Input = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CONFIRM'), token: z.string().uuid(), evidenceId: z.string().uuid(), x: z.number().finite(), y: z.number().finite(), confirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal('CANCEL'), token: z.string().uuid() }).strict(),
  z.object({ type: z.literal('STOP'), token: z.string().uuid() }).strict(),
]);
export async function POST(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ error: 'Origin không hợp lệ.' }, { status: 403 });
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Xác nhận không hợp lệ.' }, { status: 400 });
  const input = parsed.data;
  const localAccepted = input.type === 'STOP' ? cancelAgent(input.token) : submitHumanChoice(input.token, input.type === 'CANCEL' ? 'CANCEL' :
    { evidenceId: input.evidenceId, x: input.x, y: input.y, confirmed: true });
  if (localAccepted) return Response.json({ accepted: true });
  try {
    const response = await runningWorkerTasks();
    if (response?.ok) {
      const task = ((await response.json()).tasks as DeviceTask[]).find(task => input.type === 'STOP' ? task.executionId === input.token : task.latest?.assistance?.token === input.token);
      if (task) {
        const command = input.type === 'CONFIRM' ? { ...input, type: 'ASSIST', executionId: task.executionId, deviceId: task.deviceId } :
          { type: 'CANCEL', executionId: task.executionId, deviceId: task.deviceId };
        const forwarded = await workerRequest('POST', command); return Response.json(await forwarded.json(), { status: forwarded.status });
      }
    }
  } catch { /* Invalid or unavailable execution must not be acknowledged. */ }
  if (input.type === 'STOP') {
    const accepted = cancelAgent(input.token);
    return Response.json(accepted ? { accepted: true } : { error: 'Tác vụ đã kết thúc hoặc token không hợp lệ.' }, { status: accepted ? 200 : 409 });
  }
  const accepted = submitHumanChoice(input.token, input.type === 'CANCEL' ? 'CANCEL' :
    { evidenceId: input.evidenceId, x: input.x, y: input.y, confirmed: true });
  return Response.json(accepted ? { accepted: true } : { error: 'Xác nhận đã hết hạn hoặc đã được sử dụng.' }, { status: accepted ? 200 : 409 });
}
