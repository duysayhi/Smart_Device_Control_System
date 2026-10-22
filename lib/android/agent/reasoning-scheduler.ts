export class ReasoningQueueError extends Error {}
export interface ReasoningTiming { queueWaitMs: number; serviceMs: number; totalMs: number; outcome: 'SUCCESS' | 'QUEUE_ERROR' | 'SERVICE_ERROR' }
interface Waiter { owner: string; grant: () => void; reject: (error: Error) => void; cleanup: () => void }

// Only model work enters this queue; Android I/O never acquires this lease.
export class ReasoningScheduler {
  private waiting: Waiter[] = [];
  private active = 0;
  private lastOwner?: string;
  constructor(readonly capacity = 16) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('Invalid reasoning queue capacity.');
  }
  summary() { return { running: this.active, waiting: this.waiting.length, concurrency: 1, capacity: this.capacity }; }
  async run<T>(owner: string, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 45000, onTiming?: (timing: ReasoningTiming) => void): Promise<T> {
    signal?.throwIfAborted();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ReasoningQueueError('Reasoning admission rejected: deadline already expired.');
    if (this.waiting.length >= this.capacity) throw new ReasoningQueueError('Shared reasoning queue is full.');
    const started = performance.now();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new DOMException('Reasoning deadline exceeded.', 'TimeoutError')), Math.max(1, Math.floor(timeoutMs)));
    const bounded = AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])]);
    try { await new Promise<void>((resolve, reject) => {
      const abort = () => { this.waiting = this.waiting.filter(row => row !== item); item.cleanup(); reject(bounded.reason); this.drain(); };
      const item: Waiter = { owner, grant: resolve, reject, cleanup: () => bounded.removeEventListener('abort', abort) };
      this.waiting.push(item); bounded.addEventListener('abort', abort, { once: true });
      if (bounded.aborted) abort(); else this.drain();
    }); } catch (error) { clearTimeout(timer); try { onTiming?.({ queueWaitMs: Math.round(performance.now() - started), serviceMs: 0, totalMs: Math.round(performance.now() - started), outcome: 'QUEUE_ERROR' }); } catch { /* Telemetry cannot change queue ownership. */ } throw error; }
    const serviceStarted = performance.now(); let succeeded = false;
    try { bounded.throwIfAborted(); const result = await operation(bounded); bounded.throwIfAborted(); succeeded = true; return result; }
    finally {
      clearTimeout(timer); this.active--; this.drain();
      try { onTiming?.({ queueWaitMs: Math.round(serviceStarted - started), serviceMs: Math.round(performance.now() - serviceStarted), totalMs: Math.round(performance.now() - started), outcome: succeeded ? 'SUCCESS' : 'SERVICE_ERROR' }); } catch { /* Telemetry cannot change action authorization. */ }
    }
  }
  private drain() {
    if (this.active || !this.waiting.length) return;
    // Alternate owners when possible, retaining FIFO within an owner.
    const alternate = this.waiting.findIndex(item => item.owner !== this.lastOwner);
    const [item] = this.waiting.splice(alternate < 0 ? 0 : alternate, 1);
    item.cleanup(); this.active++; this.lastOwner = item.owner; item.grant();
  }
}
const store = globalThis as typeof globalThis & { phoneReasoningQueue?: ReasoningScheduler };
export const sharedReasoningScheduler = store.phoneReasoningQueue ??= new ReasoningScheduler();
