import { randomUUID } from 'node:crypto';
import type { ActionPlan } from '../validators/action-plan.schema';
import { assertSafePlan } from './safety-envelope';
import { assessPlanPolicy } from './security-policy';
import { decidePermission } from './agent/permission-decision';

interface Authorization { deviceId: string; physicalId: string; source: string; plan: string; expiresAt: number }
const state = globalThis as typeof globalThis & { phoneCommanderPlanAuthorizations?: Map<string, Authorization> };
const issued = state.phoneCommanderPlanAuthorizations ??= new Map<string, Authorization>();
// Separate from client JSON: the server's interpreted source/plan/device are authoritative.
export function issuePlanAuthorization(deviceId: string, physicalId: string, source: string, plan: ActionPlan) {
  assertSafePlan(source, plan);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId) || !physicalId) throw Error('Invalid authorization device identity.');
  for (const [id, row] of issued) if (row.expiresAt <= Date.now()) issued.delete(id);
  if (issued.size >= 256) throw Error('Too many pending interpretations.');
  const token = randomUUID();
  issued.set(token, { deviceId, physicalId, source, plan: JSON.stringify(plan), expiresAt: Date.now() + 120000 });
  return token;
}
export function consumePlanAuthorization(token: string, deviceId: string, physicalId: string, source: string, plan: ActionPlan) {
  assertSafePlan(source, plan);
  const row = issued.get(token);
  if (!row || row.deviceId !== deviceId || row.physicalId !== physicalId || row.source !== source || row.plan !== JSON.stringify(plan) || row.expiresAt <= Date.now()) throw Error('Source/plan/device authorization missing, foreign, changed, expired or replayed.');
  issued.delete(token);
}
export function assertLegacyExecutionPolicy(plan: ActionPlan) {
  // The development preference is not device authorization. Always use strict classification here.
  const policy = assessPlanPolicy(plan, true);
  if (decidePermission({ source: plan.intent, stage: 'LEGACY', legacy: policy.decision }).decision !== 'ALLOW') throw Error(policy.reasons.join(' '));
}
