import { UnifiedAgentService, UnifiedNotSentError, UnifiedPlanError, UnifiedExecuteRequestError } from '@/lib/android/unified-agent/service';
import { UnifiedCommand, EngineSelectionRemovedError, hasEngineSelection, type PreparedView } from '@/lib/android/unified-agent/contracts';
import { assertUnifiedSource, UnifiedAdmissionError } from '@/lib/android/unified-agent/capability-router';
import { isLocalMutation, isLocalSameOrigin } from '@/lib/android/agent/request-origin';
import { workerRequest } from '@/lib/android/agent/worker-client';
import { androidRuntimeDigest } from '@/lib/android/agent/runtime-storage';
import { developmentPolicyEnabled } from '@/lib/android/policy-mode';
import type { DeviceTask } from '@/lib/android/agent/runtime-schema';
import type { AndroidAdbDevice } from '@/types/device';
import type { OwnerTestMode } from '@/lib/android/agent/owner-test-policy';

async function payload<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? 'Backend request rejected.');
  return value as T;
}
type RuntimeState = { devices: AndroidAdbDevice[]; tasks: DeviceTask[]; ownerTestModes: OwnerTestMode[] };
const state = async () => payload<RuntimeState>(await workerRequest('GET'));
const globalService = globalThis as typeof globalThis & { phoneCommanderUnifiedCatalog?: UnifiedAgentService };
function service() {
  return globalService.phoneCommanderUnifiedCatalog ??= new UnifiedAgentService({
    async context(deviceId) {
      const data = await state(), d = data.devices.find(d => d.serial === deviceId && d.status === 'device' && d.identityVerified && d.physicalId);
      if (!d?.physicalId) throw Error('BLOCKED: selected physical device identity is unavailable.');
      const hash = androidRuntimeDigest(); if (!hash) throw Error('Runtime digest unavailable; cannot bind a plan.');
      return { deviceId, physicalId: d.physicalId, backend: process.env.ANDROID_EXECUTOR_BACKEND ?? 'appium', runtimeHash: hash,
        policyMode: developmentPolicyEnabled() ? 'development' : 'normal', ownerId: data.ownerTestModes.find(m => m.deviceId === deviceId && m.physicalId === d.physicalId && m.expiresAt > Date.now())?.id,
        busy: data.tasks.some(t => !t.finishedAt && (t.deviceId === deviceId || t.physicalId === d.physicalId)) };
    },
    async prepare(source, deviceId, engine) { return payload<PreparedView>(await workerRequest('POST', { type: 'PREPARE', source, deviceId, engine }, '/planning')); },
    async start(reference) {
      const response = await workerRequest('POST', { type: 'START_PREPARED', reference }, '/planning');
      if (!response.ok) throw new UnifiedNotSentError((await response.json()).error ?? 'Worker rejected admission before scheduling.');
      const result = await payload<{ tasks: DeviceTask[] }>(response);
      if (result.tasks.length !== 1) throw Error('Worker admission result is ambiguous.'); return result.tasks[0];
    },
    async tasks() { return (await state()).tasks; },
    async cancel(task) { await payload(await workerRequest('POST', { type: 'CANCEL', executionId: task.executionId, deviceId: task.deviceId })); },
    async assist(task, reply) {
      const { kind, ...fields } = reply;
      const result = await payload<{ accepted: boolean }>(await workerRequest('POST', { type: kind === 'V2' ? 'ASSIST_V2' : 'ASSIST', executionId: task.executionId, deviceId: task.deviceId, ...fields }));
      if (!result.accepted) throw Error('Original engine rejected stale or foreign assistance.');
    },
  });
}
export async function GET(request: Request) {
  if (!isLocalSameOrigin(request)) return Response.json({ error: 'Local same-origin request required.' }, { status: 403 });
  try { return Response.json({ executions: await service().list() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Runtime unavailable.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ error: 'Local same-origin JSON request required.' }, { status: 403 });
  const raw = await request.json().catch(() => null);
  try {
    const analysis = raw?.type === 'ANALYZE' ? raw.input : undefined;
    if (typeof analysis?.source === 'string') assertUnifiedSource(analysis.source);
    if (hasEngineSelection(raw) || hasEngineSelection(analysis)) throw new EngineSelectionRemovedError();
    const input = UnifiedCommand.safeParse(raw);
    if (!input.success) return Response.json({ error: 'Invalid unified command. Client plans, engine overrides and grants are not accepted by execute.' }, { status: 400 });
    const command = input.data;
    if (command.type === 'ANALYZE') return Response.json(await service().analyzeForDashboard(command.input));
    if (command.type === 'CLARIFY') return Response.json(await service().clarify(command.reference, command.choice));
    if (command.type === 'REANALYZE') return Response.json({ plan: await service().reanalyze(command.reference) });
    if (command.type === 'EXECUTE') return Response.json({ execution: await service().executeRequest(command.reference, command.clientRequestId) });
    if (command.type === 'CONFIRM') { await service().confirm(command.executionId); return Response.json({ accepted: true }); }
    if (command.type === 'ASSIST') { await service().assist(command.executionId, command.reply); return Response.json({ accepted: true }); }
    return Response.json({ accepted: await service().cancel(command.executionId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unified request blocked.';
    const code = error instanceof UnifiedPlanError || error instanceof UnifiedExecuteRequestError || error instanceof UnifiedAdmissionError || error instanceof EngineSelectionRemovedError ? error.code : undefined;
    return Response.json({ error: message, ...(code ? { code } : {}), status: /ASK|CLARIFICATION|ambiguous|AM_PM_REQUIRED/i.test(message) ? 'ASK' : 'BLOCKED' }, { status: code === 'ENGINE_SELECTION_REMOVED' ? 400 : code === 'HARD_DENY' ? 403 : 409 });
  }
}
