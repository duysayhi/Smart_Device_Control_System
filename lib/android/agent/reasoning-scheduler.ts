export class ReasoningQueueError extends Error {}
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
  async run<T>(owner: string, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 45000): Promise<T> {
    signal?.throwIfAborted();
    if (this.waiting.length >= this.capacity) throw new ReasoningQueueError('Shared reasoning queue is full.');
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new DOMException('Reasoning deadline exceeded.', 'TimeoutError')), Math.max(1, Math.floor(timeoutMs)));
    const bounded = AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])]);
    try { await new Promise<void>((resolve, reject) => {
      const abort = () => { this.waiting = this.waiting.filter(row => row !== item); item.cleanup(); reject(bounded.reason); this.drain(); };
      const item: Waiter = { owner, grant: resolve, reject, cleanup: () => bounded.removeEventListener('abort', abort) };
      this.waiting.push(item); bounded.addEventListener('abort', abort, { once: true });
      if (bounded.aborted) abort(); else this.drain();
    }); } catch (error) { clearTimeout(timer); throw error; }
    try { bounded.throwIfAborted(); const result = await operation(bounded); bounded.throwIfAborted(); return result; }
    finally { clearTimeout(timer); this.active--; this.drain(); }
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
