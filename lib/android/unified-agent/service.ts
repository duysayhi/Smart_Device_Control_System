import { randomUUID } from 'node:crypto';
import { AnalyzeInput, ClientRequestId, parseAnalyzeInput, type ExecutionView, type PlanView, type PreparedView, type AssistanceResponse, type AnalysisView, type ClarificationView } from './contracts';
import { alarmPeriodChoices } from './clarification';
import { assertUnifiedSource, routeCapability, UnifiedAdmissionError } from './capability-router';
import type { DeviceTask } from '../agent/runtime-schema';
import type { ExecutionStreamEvent } from '../../../types/execution';

export interface DeviceContext {
  deviceId: string; physicalId: string; backend: string; runtimeHash: string; policyMode: string; ownerId?: string; busy: boolean;
}
interface PrivatePlan { view: PlanView; input: ReturnType<typeof AnalyzeInput.parse>; binding: string; workerReference: string; consumed: boolean }
interface PendingClarification { view: ClarificationView; input: ReturnType<typeof AnalyzeInput.parse>; binding: string; choices: { id: 'am' | 'pm'; source: string }[] }
interface LiveExecution { view: ExecutionView; plan: PrivatePlan; controller: AbortController; running?: Promise<void> }
interface ExecuteRequest {
  reference: string; deviceId: string; state: 'IN_FLIGHT' | 'RESOLVED' | 'REJECTED'; expiresAt: number; promise: Promise<ExecutionView>;
}
const executeRequestTtlMs = 300000, executeRequestLimit = 100;
export interface UnifiedAdapters {
  context(deviceId: string): Promise<DeviceContext>;
  prepare(source: string, deviceId: string, engine: 'V2'): Promise<PreparedView>;
  start(reference: string): Promise<DeviceTask>;
  tasks(): Promise<DeviceTask[]>;
  cancel(task: DeviceTask): Promise<void>;
  assist?(task: DeviceTask, reply: AssistanceResponse): Promise<void>;
}
const binding = (c: DeviceContext) => JSON.stringify([c.deviceId, c.physicalId, c.backend, c.runtimeHash, c.policyMode, c.ownerId]);
const terminal = (e: ExecutionView) => Boolean(e.finishedAt);
function parseInput(input: unknown) {
  if (input && typeof input === 'object' && 'source' in input && typeof input.source === 'string') assertUnifiedSource(input.source);
  return parseAnalyzeInput(input);
}
function requireBackend(c: DeviceContext) {
  if (c.backend !== 'appium') throw new UnifiedAdmissionError('BACKEND_UNSUPPORTED', 'V2 requires Appium; no backend fallback.');
}
export class UnifiedNotSentError extends Error {}
export class UnifiedPlanError extends Error {
  constructor(readonly code: 'PLAN_EXPIRED' | 'PLAN_UNAVAILABLE' | 'PLAN_REPLAYED', message: string) { super(message); }
}
export class UnifiedExecuteRequestError extends Error {
  constructor(readonly code: 'REQUEST_KEY_CONFLICT' | 'REQUEST_CACHE_FULL', message: string) { super(message); }
}
// Retained as a pure compatibility verifier for legacy characterization, never dispatched here.
export function actionPlanCompletion(event: Extract<ExecutionStreamEvent, { type: 'complete' }>): string {
  if (event.success && event.status === 'SUCCESS' && event.steps.length > 0 && event.steps.every(s => s.status === 'SUCCESS' && s.verification === 'VERIFIED')) return 'COMPLETED';
  if (event.status === 'FAILED' || event.steps.some(s => s.status === 'FAILED')) return 'FAILED';
  return event.status === 'SENT' || event.steps.some(s => s.status === 'SENT') ? 'SENT' : 'FAILED';
}

export class UnifiedAgentService {
  private plans = new Map<string, PrivatePlan>();
  private clarifications = new Map<string, PendingClarification>();
  private executions = new Map<string, LiveExecution>();
  private executeRequests = new Map<string, ExecuteRequest>();
  private busy(physicalId: string) { return [...this.executions.values()].some(l => l.view.plan.physicalId === physicalId && !terminal(l.view)); }
  constructor(private readonly adapters: UnifiedAdapters, private readonly now: () => number = Date.now) {}
  async analyzeForDashboard(input: unknown): Promise<AnalysisView> {
    const parsed = parseInput(input), options = alarmPeriodChoices(parsed.source);
    if (!options) return { plan: await this.analyze(parsed) };
    const route = routeCapability(parsed.source);
    const c = await this.adapters.context(parsed.deviceId); requireBackend(c);
    if (c.busy || this.busy(c.physicalId)) throw Error('BLOCKED: selected physical device already has an execution.');
    for (const [id, old] of this.clarifications) if (old.view.expiresAt <= this.now()) this.clarifications.delete(id);
    if (this.clarifications.size >= 100) throw Error('Too many pending clarification requests.');
    const view: ClarificationView = { reference: randomUUID(), source: parsed.source, deviceId: parsed.deviceId, catalog: route.catalog,
      expiresAt: this.now() + 120000, kind: 'ALARM_PERIOD', question: options.question,
      choices: options.choices.map(({ id, label }) => ({ id, label })) };
    this.clarifications.set(view.reference, { view, input: parsed, binding: binding(c), choices: options.choices });
    return { clarification: structuredClone(view) };
  }
  async clarify(reference: string, choice: 'am' | 'pm'): Promise<AnalysisView> {
    const pending = this.clarifications.get(reference), selected = pending?.choices.find(c => c.id === choice);
    if (!pending || !selected || pending.view.expiresAt <= this.now()) throw Error('Clarification expired, used or unavailable; analyze again.');
    this.clarifications.delete(reference);
    const c = await this.adapters.context(pending.input.deviceId);
    if (binding(c) !== pending.binding || c.busy || this.busy(c.physicalId) || pending.view.expiresAt <= this.now()) throw Error('Clarification device, permission or expiry changed; analyze again.');
    const result = await this.analyzeForDashboard({ ...pending.input, source: selected.source });
    if (result.plan) {
      result.plan.clarifiedFrom = pending.view.source;
      this.plans.get(result.plan.reference)!.view.clarifiedFrom = pending.view.source;
    }
    return result;
  }
  async reanalyze(reference: string): Promise<PlanView> {
    const old = this.plans.get(reference);
    if (!old || old.consumed) throw new UnifiedPlanError('PLAN_UNAVAILABLE', 'Plan used or unavailable; analyze the command again.');
    old.consumed = true;
    const fresh = await this.analyze(old.input);
    if (old.view.clarifiedFrom) { fresh.clarifiedFrom = old.view.clarifiedFrom; this.plans.get(fresh.reference)!.view.clarifiedFrom = fresh.clarifiedFrom; }
    return fresh;
  }
  async analyze(input: unknown): Promise<PlanView> {
    const parsed = parseInput(input), { source, deviceId } = parsed, route = routeCapability(source);
    const c = await this.adapters.context(deviceId); requireBackend(c);
    if (c.busy || this.busy(c.physicalId)) throw Error('BLOCKED: selected physical device already has an execution.');
    const result = await this.adapters.prepare(source, deviceId, 'V2');
    const fresh = await this.adapters.context(deviceId);
    if (binding(c) !== binding(fresh) || fresh.busy || this.busy(fresh.physicalId)) throw Error('Device or permission changed during analysis; analyze again.');
    const reference = randomUUID(), expiresAt = Math.min(result.expiresAt, this.now() + 85000);
    if (expiresAt <= this.now()) throw Error('Analysis authorization expired; analyze again.');
    const view: PlanView = { reference, source, deviceId, physicalId: c.physicalId, engine: 'V2', catalog: route.catalog,
      expiresAt, summary: result.summary, steps: result.steps, confirmations: result.confirmations, reason: route.reason, analysisMetrics: result.metrics };
    for (const [id, old] of this.plans) if (old.view.expiresAt <= this.now() || old.consumed) this.plans.delete(id);
    if (this.plans.size >= 100) throw Error('Too many pending plans.');
    this.plans.set(reference, { view, input: parsed, binding: binding(c), consumed: false, workerReference: result.reference });
    return structuredClone(view);
  }
  executeRequest(reference: string, clientRequestId: string): Promise<ExecutionView> {
    const key = ClientRequestId.parse(clientRequestId);
    for (const [id, old] of this.executeRequests) {
      if (old.state !== 'IN_FLIGHT' && old.expiresAt <= this.now()) this.executeRequests.delete(id);
    }
    const old = this.executeRequests.get(key), plan = this.plans.get(reference);
    if (old) {
      if (old.reference !== reference || plan && old.deviceId !== plan.view.deviceId) {
        throw new UnifiedExecuteRequestError('REQUEST_KEY_CONFLICT', 'Request key is bound to a different plan or device.');
      }
      return old.promise.then(value => structuredClone(value));
    }
    if (!plan) throw new UnifiedPlanError('PLAN_UNAVAILABLE', 'Plan used, expired or unavailable after restart; analyze again.');
    if (this.executeRequests.size >= executeRequestLimit) {
      throw new UnifiedExecuteRequestError('REQUEST_CACHE_FULL', 'Execute request cache is full; no execution admitted.');
    }
    // Reserve the key before any await. Pending entries are never evicted; all new admissions fail closed at capacity.
    const entry: ExecuteRequest = { reference, deviceId: plan.view.deviceId, state: 'IN_FLIGHT', expiresAt: Infinity,
      promise: Promise.resolve().then(() => this.execute(reference)).then(value => {
        entry.state = 'RESOLVED'; entry.expiresAt = this.now() + executeRequestTtlMs; return value;
      }, error => {
        entry.state = 'REJECTED'; entry.expiresAt = this.now() + executeRequestTtlMs; throw error;
      }),
    };
    this.executeRequests.set(key, entry);
    return entry.promise.then(value => structuredClone(value));
  }
  async execute(reference: string): Promise<ExecutionView> {
    const p = this.plans.get(reference);
    if (!p) throw new UnifiedPlanError('PLAN_UNAVAILABLE', 'Plan used, expired or unavailable after restart; analyze again.');
    if (p.consumed) throw new UnifiedPlanError('PLAN_REPLAYED', 'Plan used; analyze again.');
    if (p.view.expiresAt <= this.now()) throw new UnifiedPlanError('PLAN_EXPIRED', 'Plan expired; analyze again.');
    const c = await this.adapters.context(p.view.deviceId);
    if (binding(c) !== p.binding || c.busy || this.busy(c.physicalId) || p.consumed || p.view.expiresAt <= this.now()) throw Error('Device, permission, source version, expiry or replay check failed.');
    p.consumed = true;
    // Consume before the first await/dispatch. No alternate engine is tried on failure.
    const id = randomUUID(), live: LiveExecution = { view: { id, plan: structuredClone(p.view), status: 'QUEUED' }, plan: p, controller: new AbortController() };
    this.executions.set(id, live);
    for (const [oldId, old] of this.executions) if (this.executions.size > 40 && terminal(old.view)) this.executions.delete(oldId);
    live.running = this.dispatch(live);
    return structuredClone(live.view);
  }
  private async dispatch(live: LiveExecution) {
    const p = live.plan, view = live.view;
    try {
      if (live.controller.signal.aborted) { view.status = 'CANCELLED'; view.finishedAt = this.now(); return; }
      const task = await this.adapters.start(p.workerReference);
      if (task.request !== p.view.source || task.deviceId !== p.view.deviceId || task.physicalId !== p.view.physicalId || task.agentVersion !== 2) throw Error('Worker task binding mismatch; inspect original worker execution.');
      view.workerExecutionId = task.executionId; view.task = task; view.status = task.status; view.rawStatus = task.status;
      if (live.controller.signal.aborted) await this.adapters.cancel(task);
    } catch (error) {
      view.status = error instanceof UnifiedNotSentError ? 'BLOCKED' : 'UNKNOWN_EFFECT'; view.reason = error instanceof Error ? error.message : 'Dispatch outcome uncertain; no replay.';
      // A lost response is reconciled by the immutable reference, never by resending START.
      if (error instanceof UnifiedNotSentError) view.finishedAt = this.now();
    }
  }
  async list(): Promise<ExecutionView[]> {
    if ([...this.executions.values()].some(l => !l.view.finishedAt)) {
      const tasks = await this.adapters.tasks();
      for (const live of this.executions.values()) {
        const task = tasks.find(t => t.executionId === live.view.workerExecutionId || t.batchId === live.plan.workerReference);
        if (!task || task.deviceId !== live.plan.view.deviceId || task.request !== live.plan.view.source || task.physicalId !== live.plan.view.physicalId || task.agentVersion !== 2) continue;
        live.view.task = task; live.view.workerExecutionId = task.executionId; live.view.rawStatus = task.status; live.view.status = task.status;
        live.view.finishedAt = task.finishedAt; live.view.reason = task.latest?.reason;
        if (live.controller.signal.aborted && !task.finishedAt && !task.cancelRequested) await this.adapters.cancel(task);
      }
    }
    return [...this.executions.values()].map(l => structuredClone(l.view));
  }
  async cancel(id: string) {
    const live = this.executions.get(id); if (!live || terminal(live.view)) return false;
    live.view.cancelRequested = true; live.controller.abort();
    if (live.view.task) await this.adapters.cancel(live.view.task);
    return true;
  }
  async assist(id: string, reply: AssistanceResponse) {
    const live = this.executions.get(id);
    if (!live || live.controller.signal.aborted || reply.kind !== 'V2' || !this.adapters.assist) throw Error('Assistance execution/engine mismatch.');
    const task = (await this.adapters.tasks()).find(t => t.executionId === live.view.workerExecutionId && t.deviceId === live.plan.view.deviceId && t.physicalId === live.plan.view.physicalId && t.request === live.plan.view.source && t.agentVersion === 2);
    if (!task || task.status !== 'WAITING_HUMAN' || task.finishedAt || task.cancelRequested) throw Error('Assistance is not pending on this execution.');
    await this.adapters.assist(task, reply);
  }
  async confirm(_id: string) {
    void _id;
    throw new UnifiedAdmissionError('LEGACY_CONFIRMATION_REMOVED', 'Unified không hỗ trợ CONFIRM legacy; hãy phân tích lại bằng capability V2.');
  }
}
