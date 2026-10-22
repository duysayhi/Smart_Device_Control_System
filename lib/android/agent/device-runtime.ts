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
import { acquireDeviceLock } from '../appium/session-manager';
import { androidV2Adapter, runAgentV2, type V2Adapter } from './agent-v2';
import { submitAssistanceV2 } from './human-assistance-v2';
import { OwnerTestPolicy, assertOwnerTestExecution, type OwnerTestExecution, type OwnerTestMode } from './owner-test-policy';
import { decidePermission } from './permission-decision';

export interface RuntimeAdapter {
  v2?(serial: string, budget: AgentBudget): V2Adapter;
  reserve?(serial: string, executionId: string): Promise<() => Promise<void>>;
  discover(): Promise<AndroidAdbDevice[]>;
  plan(request: string, budget: AgentBudget, signal: AbortSignal, serial?: string): Promise<AgentGoal>;
  open(goal: AgentGoal, budget: AgentBudget, serial: string, signal: AbortSignal): Promise<AgentExecution>;
}
export const androidRuntimeAdapter: RuntimeAdapter = {
  async reserve(serial, executionId) {
    const identity = (await listAndroidDevices()).find(device => device.serial === serial);
    if (!identity || identity.status !== 'device') throw new Error('Device disconnected before planning.');
    const release = await acquireDeviceLock('device-reservation:' + (identity.physicalId ?? serial));
    try { await release.recordSession('', executionId, serial); return release; }
    catch (error) { await release(); throw error; }
  },
  discover: listAndroidDevices,
  async plan(request, budget, signal, serial) {
    if (!serial) throw new Error('Application discovery requires the selected device.');
    return (await planGoal(request, budget, undefined, signal, app => discoverApplication(serial, app, runAdb, signal))).goal;
  },
  open: (goal, budget, serial, signal) => createAgentExecution(goal, budget, serial, runAdb, signal),
};
interface RuntimeEntry { task: DeviceTask; controller: AbortController; done?: Promise<void>; memory?: unknown; disconnected: boolean; ownerScope?: OwnerTestExecution }
export class DeviceRuntimeRegistry {
  private readonly ownerPolicy = new OwnerTestPolicy();
  ownerTestModes() { return this.ownerPolicy.list(); }
  ownerPolicyAudit() { return this.ownerPolicy.history(); }
  async setOwnerTestMode(input: Extract<RuntimeCommandValue, { type: 'SET_OWNER_TEST_MODE' }>, beforeEnable?: (mode: OwnerTestMode) => void) {
    if (!input.enabled) {
      const current = this.ownerPolicy.list().find(mode => mode.deviceId === input.deviceId);
      if (current && current.physicalId !== input.physicalId) throw Error('Owner test physical identity mismatch.');
      const disabled = this.ownerPolicy.disable(input.deviceId, input.authorizationId!);
      if (disabled) for (const entry of this.entries.values()) if (entry.ownerScope?.id === input.authorizationId) this.cancel(entry.task.executionId, entry.task.deviceId);
      this.changed(); return disabled;
    }
    const device = (await this.adapter.discover()).find(d => d.serial === input.deviceId && d.status === 'device');
    if (!device?.physicalId || device.physicalId !== input.physicalId || !device.identityVerified) throw Error('Owner test mode requires a currently identity-verified physical device.');
    if (this.activeBySerial.has(input.deviceId) || this.activeByPhysical.has(input.physicalId)) throw Error('Enable owner test mode only while the device is idle.');
    this.ownerPolicy.enable(input.deviceId, input.physicalId, beforeEnable, { fullControl: input.fullControl, rollbackOnFailure: input.rollbackOnFailure }); this.changed(); return true;
  }
  private entries = new Map<string, RuntimeEntry>();
  // Scheduling index only. acquireDeviceLock remains the authoritative device owner.
  private activeBySerial = new Map<string, string>();
  private activeByPhysical = new Map<string, string>();
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
      this.requests.set(batchId, { jobs: JSON.stringify(tasks.map(task => ({ deviceId: task.deviceId, goal: task.request, ...(task.agentVersion ? { agentVersion: task.agentVersion } : {}), ...(task.ownerTestMode ? { ownerAuthorizedTest: true } : {}) }))), ids: tasks.map(task => task.executionId) });
    }
  }
  list(): DeviceTask[] { return [...this.entries.values()].map(entry => structuredClone(entry.task)); }
  persisted(): DeviceTask[] {
    return this.list().map(task => ({ ...task, events: [], latest: task.latest && { ...task.latest, visual: undefined, assistance: undefined, cancellationToken: undefined,
      v2: task.latest.v2 && { ...task.latest.v2, assistance: undefined } } }));
  }
  async refreshConnections() {
    const devices = await this.adapter.discover();
    for (const mode of this.ownerPolicy.list()) {
      const device = devices.find(d => d.serial === mode.deviceId && d.status === 'device' && d.identityVerified && d.physicalId === mode.physicalId);
      if (!device) this.ownerPolicy.disable(mode.deviceId, mode.id);
    }
    for (const entry of this.entries.values()) {
      if (entry.ownerScope && !terminalTask(entry.task.status)) {
        try { assertOwnerTestExecution(entry.ownerScope, entry.task.deviceId, entry.task.physicalId!, entry.task.executionId); }
        catch { this.cancel(entry.task.executionId, entry.task.deviceId); }
      }
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
    const physicalIds = serials.map(serial => devices.find(d => d.serial === serial)?.physicalId ?? serial);
    if (new Set(physicalIds).size !== physicalIds.length) throw new Error('USB/Wi-Fi transports in this batch refer to the same physical device.');
    if (this.activeBySerial.size + serials.length > 4) throw new Error('At most four device executions may be active.');
    for (const serial of serials) {
      if (this.activeBySerial.has(serial)) throw new Error('Device already has a scheduled execution: ' + serial);
      const device = devices.find(d => d.serial === serial && d.status === 'device');
      if (!device || device.connectionType === 'Wi-Fi' && !device.identityVerified) throw new Error('Device must be an authorized, identity-verified Android transport: ' + serial);
      if (this.activeByPhysical.has(device.physicalId ?? serial)) throw new Error('Physical device already has an Agent through another transport.');
    }
    // Validate all authorization requests before atomically scheduling any job.
    for (const job of input.jobs) if (job.ownerAuthorizedTest) {
      const device = devices.find(d => d.serial === job.deviceId)!;
      if (job.agentVersion !== 2 || !device.identityVerified || !device.physicalId || !this.ownerPolicy.list().some(mode => mode.deviceId === job.deviceId && mode.physicalId === device.physicalId)) throw Error('Owner test mode is not enabled for this exact verified V2 device.');
    }
    this.prune();
    const created = input.jobs.map(job => {
      const device = devices.find(d => d.serial === job.deviceId)!;
      const task: DeviceTask = { executionId: randomUUID(), batchId: input.requestId, deviceId: job.deviceId, physicalId: device.physicalId,
        connectionMode: device.connectionType, request: job.goal, ...(job.agentVersion ? { agentVersion: job.agentVersion } : {}), status: 'QUEUED', createdAt: Date.now(), connectionState: 'device', events: [] };
      const ownerScope = job.ownerAuthorizedTest ? this.ownerPolicy.bind(task.deviceId, task.physicalId!, task.executionId) : undefined;
      if (ownerScope) task.ownerTestMode = this.ownerPolicy.list().find(mode => mode.id === ownerScope.id);
      const entry: RuntimeEntry = { task, controller: new AbortController(), disconnected: false, ownerScope };
      return entry;
    });
    for (const entry of created) {
      this.entries.set(entry.task.executionId, entry); this.activeBySerial.set(entry.task.deviceId, entry.task.executionId);
      this.activeByPhysical.set(entry.task.physicalId ?? entry.task.deviceId, entry.task.executionId);
    }
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
  confirmV2(input: Extract<RuntimeCommandValue, { type: 'ASSIST_V2' }>): boolean {
    const task = this.entries.get(input.executionId)?.task;
    if (!task || task.deviceId !== input.deviceId || task.status !== 'WAITING_HUMAN' || task.cancelRequested || task.latest?.v2?.assistance?.token !== input.token) return false;
    return submitAssistanceV2(input);
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
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(budget.limits.timeMs), ...(entry.ownerScope ? [AbortSignal.timeout(Math.max(0, entry.ownerScope.expiresAt - Date.now()))] : [])]);
    let execution: AgentExecution | undefined, loopOwnsCleanup = false;
    let releaseReservation: (() => Promise<void>) | undefined;
    const publish = (event: AgentProgress) => {
      task.latest = structuredClone(event);
      task.events.push({ ...structuredClone(event), visual: undefined, assistance: event.assistance && { ...event.assistance, token: undefined },
        v2: event.v2 && { ...structuredClone(event.v2), assistance: undefined } });
      if (task.events.length > 24) task.events.shift();
      task.status = entry.disconnected ? 'DISCONNECTED' : event.status === 'NEED_HUMAN_ASSISTANCE' && (event.assistance?.resumable || event.v2?.assistance) ? 'WAITING_HUMAN' :
        event.type === 'complete' && ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(event.status) ? event.status as DeviceTask['status'] : 'RUNNING';
      if (event.failure?.code === 'DEVICE_ERROR') { entry.disconnected = true; task.status = 'DISCONNECTED'; }
      this.changed();
    };
    try {
      if (decidePermission({ source: task.request, stage: 'REQUEST' }).decision === 'DENY') {
        publish({ type: 'complete', status: 'BLOCKED', reason: 'HARD_BLOCKED: excluded destructive/security/purchase request; no device effect.', ...budget.summary() });
        return;
      }
      releaseReservation = await this.adapter.reserve?.(task.deviceId, task.executionId);
      checkCancellation(signal); task.status = 'RUNNING';
      publish({ type: 'progress', status: 'PLANNING', reason: 'Validating this device goal and its safety scope.', description: task.request });
      if (task.agentVersion === 2) {
        const adapter = this.adapter.v2?.(task.deviceId, budget) ?? (this.adapter === androidRuntimeAdapter ? androidV2Adapter(task.deviceId, budget) : undefined);
        if (!adapter) throw new Error('No V2 runtime adapter is registered.');
        await runAgentV2(task.request, task.deviceId, task.executionId, task.physicalId ?? task.deviceId, budget, adapter, publish, signal, undefined, entry.ownerScope);
        return;
      }
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
      if (task.latest) { task.latest.visual = undefined; task.latest.assistance = undefined; if (task.latest.v2) task.latest.v2.assistance = undefined; }
      this.activeBySerial.delete(task.deviceId); this.changed();
      this.activeByPhysical.delete(task.physicalId ?? task.deviceId);
      await releaseReservation?.();
    }
  }
}
