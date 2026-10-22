import { z } from 'zod';
import type { AgentProgress } from './schema';
const serial = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const EvidenceQuery = z.object({ executionId: z.string().uuid(), deviceId: serial, evidenceId: z.string().uuid() }).strict();
export const RuntimeCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('START'), requestId: z.string().uuid(), jobs: z.array(z.object({ deviceId: serial, goal: z.string().trim().min(1).max(2000), agentVersion: z.literal(2).optional(), ownerAuthorizedTest: z.literal(true).optional() }).strict().refine(job => !job.ownerAuthorizedTest || job.agentVersion === 2, 'Owner test mode is V2 only.')).min(1).max(4) }).strict(),
  z.object({ type: z.literal('SET_OWNER_TEST_MODE'), deviceId: serial, physicalId: z.string().min(1).max(200), enabled: z.boolean(), authorizationId: z.string().uuid().optional(), fullControl: z.boolean().optional(), rollbackOnFailure: z.boolean().optional() }).strict().refine(input => input.enabled || Boolean(input.authorizationId), 'Revocation requires the current authorization ID.'),
  z.object({ type: z.literal('CANCEL'), executionId: z.string().uuid(), deviceId: serial }).strict(),
  z.object({ type: z.literal('CANCEL_BATCH'), batchId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('ASSIST_V2'), executionId: z.string().uuid(), deviceId: serial, token: z.string().uuid(), approved: z.boolean(), choice: z.string().max(200) }).strict(),
  z.object({ type: z.literal('ASSIST'), executionId: z.string().uuid(), deviceId: serial, token: z.string().uuid(), evidenceId: z.string().uuid(),
    x: z.number().finite(), y: z.number().finite(), confirmed: z.literal(true) }).strict(),
]);
export type RuntimeCommandValue = z.infer<typeof RuntimeCommand>;
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'WAITING_HUMAN' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'DISCONNECTED';
export interface DeviceTask {
  ownerTestMode?: import('./owner-test-policy').OwnerTestMode;
  agentVersion?: 2;
  physicalId?: string;
  connectionMode?: 'USB' | 'Wi-Fi';
  executionId: string; batchId: string; deviceId: string; request: string; status: ExecutionStatus;
  createdAt: number; finishedAt?: number; cancelRequested?: boolean; connectionState?: string;
  latest?: AgentProgress; events: AgentProgress[];
}
export const terminalTask = (status: ExecutionStatus) => ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'DISCONNECTED'].includes(status);
export function latestDeviceTasks(tasks: DeviceTask[]): Map<string, DeviceTask> {
  const latest = new Map<string, DeviceTask>();
  for (const task of tasks) if (!latest.has(task.deviceId) || latest.get(task.deviceId)!.createdAt <= task.createdAt) latest.set(task.deviceId, task);
  return latest;
}
