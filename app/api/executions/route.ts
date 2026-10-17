import { z } from 'zod';
import { isValidAndroidSerial, listAndroidDevices, runAdb } from '@/lib/android/adb';
import { assertNonSensitivePlan, createExecutionContext } from '@/lib/android/condition-executor';
import { asAndroidError, checkCancellation } from '@/lib/android/errors';
import { ActionPlanSchema } from '@/lib/validators/action-plan.schema';
import { ExecutionStepResult, ExecutionStreamEvent } from '@/types/execution';
import { assessPlanPolicy } from '@/lib/android/security-policy';
import { isWifiOffPlan, isWifiOnPlan, wifiNetworkForPlan } from '@/lib/android/wifi-plan';
import { issueWifiConfirmation, consumeWifiConfirmation } from '@/lib/android/wifi-confirmation';
import { isLocalSameOrigin } from '@/lib/android/agent/request-origin';
import { developmentPolicyEnabled } from '@/lib/android/policy-mode';

const ExecutionRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  actionPlan: ActionPlanSchema,
  confirmationToken: z.string().uuid().optional(),
});

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
  const policy = assessPlanPolicy(actionPlan);
  const wifiOff = isWifiOffPlan(actionPlan);
  const wifiOn = isWifiOnPlan(actionPlan);
  const wifiNetwork = wifiNetworkForPlan(actionPlan);
  const wifiChange = wifiOff || wifiOn || wifiNetwork !== undefined;
  if (wifiChange) {
    if (!request.headers.get('origin') || !isLocalSameOrigin(request)) return Response.json({ success: false, error: 'Same-origin confirmation required.' }, { status: 403 });
    if ((process.env.ANDROID_EXECUTOR_BACKEND ?? 'appium') !== 'appium') return Response.json({ success: false, error: 'Wi-Fi control requires Appium.' }, { status: 422 });
    if (!developmentPolicyEnabled() && !parsed.data.confirmationToken) return Response.json({ success: false, confirmationRequired: true,
      wifiEnabled: wifiOn, wifiNetwork, confirmationToken: issueWifiConfirmation(deviceId, actionPlan),
      error: wifiNetwork !== undefined ? 'Connecting to this Wi-Fi network may change phone connectivity. Enter credentials only on the phone.' :
        wifiOn ? 'Turning on Wi-Fi may reconnect this phone to saved networks.' : 'Turning off Wi-Fi disconnects wireless networking on this phone.' }, { status: 409 });
    if (!developmentPolicyEnabled() && !consumeWifiConfirmation(parsed.data.confirmationToken!, deviceId, actionPlan)) return Response.json({ success: false, error: 'Confirmation expired, mismatched or already used.' }, { status: 409 });
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(300000)]);
  let execution: Awaited<ReturnType<typeof createExecutionContext>>;
  try {
    if (developmentPolicyEnabled() || !wifiChange) assertNonSensitivePlan(actionPlan);
    execution = await createExecutionContext(deviceId, actionPlan.actions, runAdb, signal,
      wifiNetwork !== undefined ? { wifiNetworkConfirmed: wifiNetwork } : wifiOff ? { wifiOffConfirmed: true } : wifiOn ? { wifiOnConfirmed: true } : undefined);
  } catch (error) {
    const failure = asAndroidError(error);
    return Response.json({ success: false, error: failure.message, errorCode: failure.code, policy }, { status: failure.code === 'SESSION_ERROR' ? 409 : 422 });
  }
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const steps: ExecutionStepResult[] = actionPlan.actions.map((action, index) => ({
        index,
        action,
        status: 'PENDING',
        deviceId,
      }));

      const send = (event: ExecutionStreamEvent) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        let executionError: string | undefined;
        let errorCode: ExecutionStepResult['errorCode'];
        try {
        send({ type: 'progress', steps: [...steps] });
        for (const step of steps) {
          checkCancellation(signal);
          step.status = 'EXECUTING';
          step.phase = 'EXECUTING';
          send({ type: 'progress', steps: [...steps] });
          const stepStarted = performance.now();
          try {
            const outcome = await execution.execute(actionPlan.actions[step.index], signal, (progress) => {
              step.phase = 'WAITING'; step.waitingFor = progress.waitingFor;
              step.elapsedMs = progress.elapsedMs; step.evidence = progress.evidence;
              if (progress.exploration) step.exploration = progress.exploration;
              send({ type: 'progress', steps: [...steps] });
            });
            Object.assign(step, outcome);
            step.phase = undefined;
            step.status = outcome.verification === 'VERIFIED' ? 'SUCCESS' : 'SENT';
          } catch (error) {
            const failure = asAndroidError(error);
            step.status = 'FAILED';
            step.phase = undefined;
            step.error = failure.message; step.errorCode = failure.code;
            if (failure.exploration) step.exploration = failure.exploration;
            if (failure.visual) step.visual = failure.visual;
            if (failure.visualFailure) step.visualFailure = failure.visualFailure;
            step.elapsedMs = Math.round(performance.now() - stepStarted);
            errorCode = failure.code;
            executionError = step.error;
          }

          send({ type: 'progress', steps: [...steps] });
          if (step.status === 'FAILED') break;
        }
        } catch (error) {
          const failure = asAndroidError(error);
          executionError = failure.message; errorCode = failure.code;
        } finally {
          try { await execution.close(); }
          catch (error) {
            const failure = asAndroidError(error);
            executionError = `Session cleanup failed: ${failure.message}`; errorCode = 'SESSION_ERROR';
          }
        }
        if (!cancelled) {
          const success = !executionError && steps.every((step) => step.status === 'SUCCESS');
          send({
            type: 'complete',
            success,
            status: executionError ? 'FAILED' : success ? 'SUCCESS' : 'SENT',
            steps: [...steps],
            ...(executionError ? { error: executionError } : {}),
            ...(errorCode ? { errorCode } : {}),
          });
        }
      })()
        .catch(() => {
          if (!cancelled) {
            cancelled = true;
            controller.error(new Error('Luồng thực thi Android bị gián đoạn.'));
          }
        })
        .finally(() => {
          if (!cancelled) controller.close();
        });
    },
    cancel() {
      cancelled = true;
      cancellation.abort();
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
