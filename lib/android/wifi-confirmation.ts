import { randomUUID } from 'node:crypto';
import type { ActionPlan } from '../validators/action-plan.schema';
import { isWifiOffPlan, isWifiOnPlan, wifiNetworkForPlan } from './wifi-plan';

type Pending = { serial: string; plan: string; expires: number };
const store = globalThis as typeof globalThis & { phoneCommanderWifiConfirmations?: Map<string, Pending> };
const pending = store.phoneCommanderWifiConfirmations ??= new Map<string, Pending>();
export function issueWifiConfirmation(serial: string, plan: ActionPlan): string {
  if (!isWifiOffPlan(plan) && !isWifiOnPlan(plan) && wifiNetworkForPlan(plan) === undefined) throw new Error('Only a bounded Wi-Fi plan can be confirmed.');
  for (const [key, value] of pending) if (value.expires <= Date.now()) pending.delete(key);
  if (pending.size >= 256) throw new Error('Too many pending confirmations.');
  const token = randomUUID();
  pending.set(token, { serial, plan: JSON.stringify(plan), expires: Date.now() + 120000 });
  return token;
}
export function consumeWifiConfirmation(token: string, serial: string, plan: ActionPlan): boolean {
  const entry = pending.get(token);
  if (!entry || entry.expires <= Date.now() || entry.serial !== serial || entry.plan !== JSON.stringify(plan) ||
    (!isWifiOffPlan(plan) && !isWifiOnPlan(plan) && wifiNetworkForPlan(plan) === undefined)) return false;
  pending.delete(token);
  return true;
}
