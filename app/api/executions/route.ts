import { z } from 'zod';
import { executeAndroidAction, isValidAndroidSerial, listAndroidDevices, preflightAndroidPlan } from '@/lib/android/adb';
import { ActionPlanSchema } from '@/lib/validators/action-plan.schema';
import { ExecutionStepResult, ExecutionStreamEvent } from '@/types/execution';

const ExecutionRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  actionPlan: ActionPlanSchema,
});

const busyDevices = new Set<string>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ExecutionRequestSchema.safeParse(body);

  if (!parsed.success || !isValidAndroidSerial(parsed.data?.deviceId ?? '')) {
    return Response.json(
      { success: false, error: 'Yêu cầu thực thi hoặc serial thiết bị không hợp lệ.' },
      { status: 400 }
    );
  }

  let devices;
  try {
    devices = await listAndroidDevices();
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Không thể chạy ADB.' },
      { status: 503 }
    );
  }

  const targetDevice = devices.find((device) => device.serial === parsed.data.deviceId);
  if (!targetDevice) {
    return Response.json(
      { success: false, error: 'Không tìm thấy thiết bị Android được chọn.' },
      { status: 404 }
    );
  }
  if (targetDevice.connectionType !== 'USB') {
    return Response.json(
      { success: false, error: 'Executor hiện chỉ hỗ trợ thiết bị Android kết nối USB.' },
      { status: 400 }
    );
  }
  if (targetDevice.status !== 'device') {
    return Response.json(
      { success: false, error: `Thiết bị ${targetDevice.serial} đang ở trạng thái ${targetDevice.status}.` },
      { status: 409 }
    );
  }

  const { deviceId, actionPlan } = parsed.data;
  if (busyDevices.has(deviceId)) {
    return Response.json({ success: false, error: 'Thiết bị đang thực thi một kế hoạch khác.' }, { status: 409 });
  }
  busyDevices.add(deviceId);
  try {
    await preflightAndroidPlan(deviceId, actionPlan.actions);
  } catch (error) {
    busyDevices.delete(deviceId);
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Kế hoạch không thể thực thi.' }, { status: 422 });
  }
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const steps: ExecutionStepResult[] = actionPlan.actions.map((action, index) => ({
        index,
        action,
        status: 'PENDING',
      }));

      const send = (event: ExecutionStreamEvent) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        let executionError: string | undefined;
        send({ type: 'progress', steps: [...steps] });

        for (const step of steps) {
          if (cancelled) return;
          step.status = 'EXECUTING';
          send({ type: 'progress', steps: [...steps] });

          try {
            await executeAndroidAction(deviceId, actionPlan.actions[step.index]);
            step.status = 'SUCCESS';
          } catch (error) {
            step.status = 'FAILED';
            step.error = error instanceof Error ? error.message : 'Thực thi action thất bại.';
            executionError = step.error;
          }

          send({ type: 'progress', steps: [...steps] });
          if (step.status === 'FAILED') break;
        }

        if (!cancelled) {
          send({
            type: 'complete',
            success: steps.every((step) => step.status === 'SUCCESS'),
            steps: [...steps],
            ...(executionError ? { error: executionError } : {}),
          });
        }
      })()
        .catch(() => {
          if (!cancelled) controller.error(new Error('Luồng thực thi ADB bị gián đoạn.'));
        })
        .finally(() => {
          busyDevices.delete(deviceId);
          if (!cancelled) controller.close();
        });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
