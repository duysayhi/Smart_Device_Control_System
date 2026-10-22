import { randomUUID } from 'node:crypto';
import type { V2Assistance } from './goal-graph';

type Reply = { approved: boolean; choice: string };
interface Pending { deviceId: string; executionId: string; expiresAt: number; choices: string[]; complete(reply: Reply): void }
const requests = new Map<string, Pending>();
export async function waitForAssistanceV2(input: Omit<V2Assistance, 'token' | 'expiresAt'> & { deviceId: string; executionId: string },
  remaining: number, signal: AbortSignal | undefined, publish: (request: V2Assistance) => void): Promise<Reply> {
  signal?.throwIfAborted();
  if (!input.choices.length || input.choices.length > 12 || remaining <= 0 || requests.size >= 8) throw new Error('Human assistance unavailable within the current budget.');
  const token = randomUUID(), expiresAt = Date.now() + Math.min(120000, remaining);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); requests.delete(token); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new Error('CANCELLED')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Human assistance expired.')); }, expiresAt - Date.now());
    requests.set(token, { deviceId: input.deviceId, executionId: input.executionId, expiresAt, choices: input.choices.map(choice => choice.id), complete(reply) { cleanup(); resolve(reply); } });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { publish({ token, expiresAt, category: input.category, choices: input.choices, reason: input.reason, sessionRetained: input.sessionRetained }); }
    catch (error) { cleanup(); reject(error); }
  });
}
export function submitAssistanceV2(input: { token: string; deviceId: string; executionId: string; approved: boolean; choice: string }): boolean {
  const request = requests.get(input.token);
  if (!request || request.deviceId !== input.deviceId || request.executionId !== input.executionId || request.expiresAt <= Date.now() || input.approved && !request.choices.includes(input.choice)) return false;
  request.complete({ approved: input.approved, choice: input.choice }); return true;
}
