import { randomUUID } from 'node:crypto';
import type { AndroidAdbDevice } from '../../../types/device';
import { AgentBudget } from './budget';
import type { AgentGoal, AgentProgress } from './schema';
import type { AgentExecution } from './agent-loop';
import { runAgent } from './agent-loop';
import { planGoal } from './goal-planner';
import { createAgentExecution } from './agent-loop';
import { listAndroidDevices, runAdb } from '../adb';
import { asAndroidError, checkCancellation, AndroidExecutionError } from '../errors';
import type { Observation } from '../state-observer';
import { waitForHuman, submitHumanChoice } from './human-assistance';
import { type DeviceTask, type RuntimeCommandValue, terminalTask } from './runtime-schema';
import { discoverApplication } from './application-discovery';

export interface RuntimeAdapter {
  discover(): Promise<AndroidAdbDevice[]>;
  plan(request: string, budget: AgentBudget, signal: AbortSignal, serial?: string): Promise<AgentGoal>;
  open(goal: AgentGoal, budget: AgentBudget, serial: string, signal: AbortSignal): Promise<AgentExecution>;
}
export const androidRuntimeAdapter: RuntimeAdapter = {
  discover: listAndroidDevices,
  async plan(request, budget, signal, serial) {
    if (!serial) throw new Error('Application discovery requires the selected device.');
    return (await planGoal(request, budget, undefined, signal, app => discoverApplication(serial, app, runAdb, signal))).goal;
  },
  open: (goal, budget, serial, signal) => createAgentExecution(goal, budget, serial, runAdb, signal),
};
interface RuntimeEntry { task: DeviceTask; controller: AbortController; done?: Promise<void>; memory?: unknown; disconnected: boolean }
export class DeviceRuntimeRegistry {
  private entries = new Map<string, RuntimeEntry>();
  // Scheduling index only. acquireDeviceLock remains the authoritative device owner.
  private activeBySerial = new Map<string, string>();
  private requests = new Map<string, { jobs: string; ids: string[] }>();
  constructor(private readonly adapter: RuntimeAdapter = androidRuntimeAdapter, private readonly changed: () => void = () => {}) {}
  restore(tasks: DeviceTask[]) {
    for (const source of tasks.slice(-40)) {
      const task: DeviceTask = structuredClone(source);
      if (!terminalTask(task.status)) {
        task.status = 'BLOCKED'; task.finishedAt = Date.now(); task.events = [];
        task.latest = { type: 'complete', status: 'BLOCKED', reason: 'Worker restarted; no automatic resume. Inspect the device lock and start a fresh execution.' };
      }
      this.entries.set(task.executionId, { task, controller: new AbortController(), disconnected: task.status === 'DISCONNECTED' });
    }
    const batches = new Set([...this.entries.values()].map(entry => entry.task.batchId));
    for (const batchId of batches) {
      const tasks = [...this.entries.values()].map(entry => entry.task).filter(task => task.batchId === batchId);
      this.requests.set(batchId, { jobs: JSON.stringify(tasks.map(task => ({ deviceId: task.deviceId, goal: task.request }))), ids: tasks.map(task => task.executionId) });
    }
  }
  list(): DeviceTask[] { return [...this.entries.values()].map(entry => structuredClone(entry.task)); }
  persisted(): DeviceTask[] {
    return this.list().map(task => ({ ...task, events: [], latest: task.latest && { ...task.latest, visual: undefined, assistance: undefined, cancellationToken: undefined } }));
  }
  async refreshConnections() {
    const devices = await this.adapter.discover();
    for (const entry of this.entries.values()) {
      const state = devices.find(d => d.serial === entry.task.deviceId)?.status ?? 'disconnected';
      entry.task.connectionState = state;
      if (this.activeBySerial.get(entry.task.deviceId) === entry.task.executionId && state !== 'device') {
        entry.disconnected = true; entry.controller.abort();
        entry.task.status = 'DISCONNECTED'; this.changed();
      }
    }
    return devices;
  }
  async start(input: Extract<RuntimeCommandValue, { type: 'START' }>): Promise<DeviceTask[]> {
    const existing = this.requests.get(input.requestId), jobsKey = JSON.stringify(input.jobs);
    if (existing) {
      if (existing.jobs !== jobsKey) throw new Error('Request ID cannot be reused for different jobs.');
      return existing.ids.map(id => structuredClone(this.entries.get(id)!.task));
    }
    const devices = await this.adapter.discover();
    // Discovery can yield; check idempotency again before the atomic scheduling section.
    if (this.requests.has(input.requestId)) return this.start(input);
    const serials = input.jobs.map(job => job.deviceId);
    if (new Set(serials).size !== serials.length) throw new Error('A batch cannot contain the same device twice.');
    if (this.activeBySerial.size + serials.length > 4) throw new Error('At most four device executions may be active.');
    for (const serial of serials) {
      if (this.activeBySerial.has(serial)) throw new Error('Device already has a scheduled execution: ' + serial);
      if (!devices.some(d => d.serial === serial && d.status === 'device' && d.connectionType === 'USB')) throw new Error('Device must be an authorized USB Android: ' + serial);
    }
    this.prune();
    const created = input.jobs.map(job => {
      const task: DeviceTask = { executionId: randomUUID(), batchId: input.requestId, deviceId: job.deviceId, request: job.goal, status: 'QUEUED', createdAt: Date.now(), connectionState: 'device', events: [] };
      const entry: RuntimeEntry = { task, controller: new AbortController(), disconnected: false };
      this.entries.set(task.executionId, entry); this.activeBySerial.set(task.deviceId, task.executionId);
      return entry;
    });
    this.requests.set(input.requestId, { jobs: jobsKey, ids: created.map(e => e.task.executionId) }); this.changed();
    for (const entry of created) entry.done = Promise.resolve().then(() => this.execute(entry));
    return created.map(entry => structuredClone(entry.task));
  }
  cancel(executionId: string, deviceId: string): boolean {
    const entry = this.entries.get(executionId);
    if (!entry || entry.task.deviceId !== deviceId || !this.activeBySerial.has(deviceId) || terminalTask(entry.task.status)) return false;
    entry.task.cancelRequested = true; entry.controller.abort(); this.changed(); return true;
  }
  cancelBatch(batchId: string): number {
    let count = 0;
    for (const { task } of this.entries.values()) if (task.batchId === batchId && this.cancel(task.executionId, task.deviceId)) count++;
    return count;
  }
  confirm(input: Extract<RuntimeCommandValue, { type: 'ASSIST' }>): boolean {
    const task = this.entries.get(input.executionId)?.task;
    if (!task || task.deviceId !== input.deviceId || task.status !== 'WAITING_HUMAN' || task.cancelRequested ||
      task.latest?.assistance?.token !== input.token || task.latest.assistance.evidenceId !== input.evidenceId) return false;
    return submitHumanChoice(input.token, { evidenceId: input.evidenceId, confirmed: true, x: input.x, y: input.y });
  }
  async settled(executionId: string) { await this.entries.get(executionId)?.done; }
  async shutdown() {
    for (const entry of this.entries.values()) if (this.activeBySerial.get(entry.task.deviceId) === entry.task.executionId) entry.controller.abort();
    await Promise.all([...this.entries.values()].map(entry => entry.done));
  }
  private prune() {
    const finished = [...this.entries.values()].filter(entry => !this.activeBySerial.has(entry.task.deviceId) && terminalTask(entry.task.status));
    while (this.entries.size > 36 && finished.length) {
      const entry = finished.shift()!; this.entries.delete(entry.task.executionId);
      this.requests.delete(entry.task.batchId);
    }
  }
  private async execute(entry: RuntimeEntry) {
    const { task, controller } = entry, budget = new AgentBudget();
    budget.runtimeIdentity = { executionId: task.executionId, deviceId: task.deviceId };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(budget.limits.timeMs)]);
    let execution: AgentExecution | undefined, loopOwnsCleanup = false;
    const publish = (event: AgentProgress) => {
      task.latest = structuredClone(event);
      task.events.push({ ...structuredClone(event), visual: undefined, assistance: event.assistance && { ...event.assistance, token: undefined } });
      if (task.events.length > 24) task.events.shift();
      task.status = entry.disconnected ? 'DISCONNECTED' : event.status === 'NEED_HUMAN_ASSISTANCE' && event.assistance?.resumable ? 'WAITING_HUMAN' :
        event.type === 'complete' && ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(event.status) ? event.status as DeviceTask['status'] : 'RUNNING';
      if (event.failure?.code === 'DEVICE_ERROR') { entry.disconnected = true; task.status = 'DISCONNECTED'; }
      this.changed();
    };
    try {
      checkCancellation(signal); task.status = 'RUNNING';
      publish({ type: 'progress', status: 'PLANNING', reason: 'Validating this device goal and its safety scope.', description: task.request });
      const planStart = performance.now(), goal = await this.adapter.plan(task.request, budget, signal, task.deviceId);
      budget.timings.planningMs = Math.round(performance.now() - planStart); checkCancellation(signal);
      const setupStart = performance.now(); execution = await this.adapter.open(goal, budget, task.deviceId, signal);
      const owned = execution;
      const ownSnapshot = (snapshot: Observation) => {
        if (snapshot.deviceSerial !== task.deviceId) throw new AndroidExecutionError('SESSION_ERROR', 'Observation belongs to another device; execution stopped.');
        return snapshot;
      };
      execution = { backend: owned.backend, observe: async signal => ownSnapshot(await owned.observe(signal)),
        execute: (action, signal, progress, candidate) => owned.execute(action, signal, progress, candidate), discoveryMemory: () => owned.discoveryMemory(),
        verificationSnapshot: () => { const snapshot = owned.verificationSnapshot?.(); return snapshot && ownSnapshot(snapshot); },
        confirmVisualTap: owned.confirmVisualTap ? (choice, plan, signal) => owned.confirmVisualTap!(choice, plan, signal) : undefined,
        close: () => owned.close() };
      budget.timings.sessionSetupMs = Math.round(performance.now() - setupStart); loopOwnsCleanup = true;
      const result = await runAgent(goal, budget, execution, undefined, signal, publish,
        (visual, ready) => waitForHuman({ ...visual, expiresAt: Math.min(visual.expiresAt, Date.now() + budget.remaining()) }, signal, ready));
      entry.memory = result.memory;
    } catch (error) {
      const failure = asAndroidError(error);
      if (failure.code === 'DEVICE_ERROR') entry.disconnected = true;
      publish({ type: 'complete', status: controller.signal.aborted ? 'CANCELLED' : 'FAILED', reason: failure.message,
        failure: { code: failure.code, message: failure.message }, ...budget.summary() });
    } finally {
      if (execution && !loopOwnsCleanup) {
        try { await execution.close(); } catch { publish({ type: 'complete', status: 'FAILED', reason: 'Session cleanup failed; inspect the retained device lock.' }); }
      }
      if (entry.disconnected) task.status = 'DISCONNECTED';
      task.finishedAt = Date.now();
      // Tokens/screenshots are ephemeral and never needed for finished executions.
      if (task.latest) { task.latest.visual = undefined; task.latest.assistance = undefined; }
      this.activeBySerial.delete(task.deviceId); this.changed();
    }
  }
}
