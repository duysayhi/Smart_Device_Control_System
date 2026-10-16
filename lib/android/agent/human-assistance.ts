import { randomUUID } from 'node:crypto';
import type { HumanTapChoice, VisualSummary } from '../visual-grounding';
import { AndroidExecutionError, checkCancellation } from '../errors';

interface Pending {
  evidenceId: string;
  expiresAt: number;
  resolve: (choice: HumanTapChoice) => void;
  reject: (error: Error) => void;
}
// Next development reloads must not orphan a paused execution or duplicate its Session.
const globalStore = globalThis as typeof globalThis & { phoneCommanderAssistance?: Map<string, Pending>; phoneCommanderCancellation?: Map<string, AbortController> };
const pending = globalStore.phoneCommanderAssistance ??= new Map<string, Pending>();
const cancellations = globalStore.phoneCommanderCancellation ??= new Map<string, AbortController>();
export function registerAgentCancellation(controller: AbortController) {
  const token = randomUUID(); cancellations.set(token, controller);
  return { token, dispose: () => cancellations.delete(token) };
}
export function cancelAgent(token: string): boolean {
  const controller = cancellations.get(token);
  if (!controller) return false;
  cancellations.delete(token);
  controller.abort(); return true;
}

export function waitForHuman(visual: VisualSummary, signal: AbortSignal | undefined,
  publish: (token: string, expiresAt: number) => void): Promise<HumanTapChoice> {
  checkCancellation(signal);
  if (visual.status !== 'HUMAN_REQUIRED' || !visual.coherent || !visual.ordinalVerified || visual.expiresAt <= Date.now()) {
    throw new AndroidExecutionError('AMBIGUOUS', 'Visual evidence is not safe to resume.');
  }
  const expiresAt = Math.min(visual.expiresAt, Date.now() + 120000);
  return new Promise((resolve, reject) => {
    const token = randomUUID();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(token); };
    const abort = () => { cleanup(); reject(new AndroidExecutionError(signal?.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', 'Human assistance interrupted.')); };
    const timer = setTimeout(() => { cleanup(); reject(new AndroidExecutionError('TIMEOUT', 'Human assistance expired; Session will close.')); }, expiresAt - Date.now());
    pending.set(token, { evidenceId: visual.id, expiresAt,
      resolve: choice => { cleanup(); resolve(choice); }, reject: error => { cleanup(); reject(error); } });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { publish(token, expiresAt); } catch (error) { cleanup(); reject(error); }
  });
}
export function submitHumanChoice(token: string, choice: HumanTapChoice | 'CANCEL'): boolean {
  const task = pending.get(token);
  if (!task) return false;
  if (Date.now() >= task.expiresAt) { task.reject(new AndroidExecutionError('TIMEOUT', 'Human assistance expired.')); return false; }
  if (choice === 'CANCEL') { task.reject(new AndroidExecutionError('CANCELLED', 'User cancelled the pending task.')); return true; }
  if (choice.evidenceId !== task.evidenceId || choice.confirmed !== true || ![choice.x, choice.y].every(Number.isFinite)) return false;
  task.resolve(choice);
  return true;
}
