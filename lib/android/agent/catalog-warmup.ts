import type { AndroidAdbDevice } from '../../../types/device';
import { AppCatalog } from './app-catalog';
import { runAdb } from '../adb';
import { readDeviceOwnership } from '../appium/session-manager';
import type { AdbRunner } from '../executor';

interface Job { serial: string; physicalId: string }
type Scanner = (job: Job, signal: AbortSignal) => Promise<void>;
export async function warmLauncherCatalog(job: Job, signal: AbortSignal, ownership = readDeviceOwnership, run: AdbRunner = runAdb) {
  const yieldToOwner = new AbortController(), combined = AbortSignal.any([signal, yieldToOwner.signal]);
  const quietRead: AdbRunner = async (args, timeout, options) => {
    combined.throwIfAborted();
    if (await ownership(job.serial) || await ownership(job.physicalId)) { yieldToOwner.abort(); combined.throwIfAborted(); }
    return run(args, timeout, { ...options, signal: combined });
  };
  await new AppCatalog(job.serial, quietRead, undefined, { budgetMs: 30000, expectedPhysicalId: job.physicalId }).planningInventory(combined);
}
// One read-only worker across devices; task admission drains it before taking an execution reservation.
export class CatalogWarmup {
  private queue = new Map<string, Job>();
  private seen = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private closed = false;
  constructor(private readonly idle: () => boolean, private readonly scan: Scanner = warmLauncherCatalog, private readonly delayMs = 250) {}
  connected(devices: readonly AndroidAdbDevice[]) {
    const connected = new Set<string>();
    for (const d of devices) if (d.status === 'device' && d.identityVerified && d.physicalId) {
      const key = d.physicalId + '|' + d.serial; connected.add(key);
      if (!this.seen.has(key)) this.queue.set(key, { serial: d.serial, physicalId: d.physicalId });
    }
    for (const key of this.seen) if (!connected.has(key)) this.seen.delete(key);
    for (const key of this.queue.keys()) if (!connected.has(key)) this.queue.delete(key);
    this.schedule();
  }
  schedule() {
    if (this.closed || this.timer || this.pending || !this.queue.size || !this.idle()) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.start(); }, this.delayMs);
    this.timer.unref?.();
  }
  private async start() {
    if (this.closed || !this.idle() || this.pending) return;
    const first = this.queue.entries().next().value;
    if (!first) return;
    const [key, job] = first; this.queue.delete(key);
    const controller = new AbortController(); this.controller = controller;
    this.pending = Promise.resolve().then(() => this.scan(job, controller.signal)).then(() => { if (!controller.signal.aborted) this.seen.add(key); }).catch(() => {})
      .finally(() => { if (controller.signal.aborted && !this.closed) this.queue.set(key, job); this.pending = undefined; this.controller = undefined; this.schedule(); });
    await this.pending;
  }
  async pause() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    this.controller?.abort();
    await this.pending;
    // The aborted job stays queued, but cannot restart during START's discovery await.
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
  }
  async close() { this.closed = true; this.queue.clear(); await this.pause(); }
}
