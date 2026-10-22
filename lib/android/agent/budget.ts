import { AgentLimitsSchema, type AgentLimits } from './schema';
import { randomUUID } from 'node:crypto';

export class AgentLimitError extends Error {}
export interface ReasoningMeasurement {
  provider?: string; sentFields?: string[]; fallbackReason?: string; httpStatus?: number; proposedChoice?: string;
  model: string; elapsedMs: number; responseMs?: number; loadMs?: number; promptTokens?: number;
  queueWaitMs?: number; serviceMs?: number; deadlineRemainingMs?: number;
  promptByteUpperBound?: number;
  outputTokens?: number; evalMs?: number; status: 'VALID' | 'TIMEOUT' | 'HTTP_ERROR' | 'INVALID_JSON' | 'UNAVAILABLE' | 'CANCELLED' | 'CONTEXT_LIMIT';
}
export class AgentBudget {
  readonly measurements: { layer: 'ADB' | 'APPIUM' | 'XML' | 'CATALOG'; kind: string; elapsedMs: number; offsetMs: number }[] = [];
  measure(layer: 'ADB' | 'APPIUM' | 'XML' | 'CATALOG', kind: string, elapsedMs: number) { if (this.measurements.length < 1024) this.measurements.push({ layer, kind, elapsedMs, offsetMs: performance.now() - this.started }); }
  readonly queueOwner = randomUUID();
  runtimeIdentity?: { executionId: string; deviceId: string; physicalId?: string };
  readonly reasoningMeasurements: ReasoningMeasurement[] = [];
  readonly snapshotSources: Record<string, number> = {};
  readonly profiling = { rpcCount: 0, rpcMs: 0, sourceRpcMs: 0, elementRpcMs: 0, parseCount: 0, parseMs: 0, groundingMs: 0, adbCount: 0, adbMs: 0, singletonClausesSkipped: 0, singletonCandidatesSkipped: 0 };
  readonly webVerification: { phase: string; urlMatches?: boolean; titleMatches?: boolean; ready?: boolean; pageError?: boolean; changed?: boolean }[] = [];
  readonly limits: AgentLimits;
  readonly started = performance.now();
  readonly counters = { steps: 0, snapshots: 0, scrolls: 0, reasoning: 0, retries: 0, replans: 0, iterations: 0, recoverySubtasks: 0 };
  readonly timings = { planningMs: 0, sessionSetupMs: 0, assistanceMs: 0, recoveryMs: 0, observationMs: 0, reasoningMs: 0, executionMs: 0, verificationMs: 0, totalMs: 0 };
  constructor(limits: Partial<AgentLimits> = {}) { this.limits = AgentLimitsSchema.parse(limits); }
  remaining(): number { return Math.max(0, this.limits.timeMs - (performance.now() - this.started)); }
  check(): void { if (!this.remaining()) throw new AgentLimitError('Goal time budget exhausted.'); }
  consume(kind: keyof AgentBudget['counters']): void {
    this.check();
    if (this.counters[kind] >= this.limits[kind]) throw new AgentLimitError(`Goal ${kind} budget exhausted.`);
    this.counters[kind]++;
  }
  recordSnapshot(source = 'UNATTRIBUTED') { this.consume('snapshots'); this.snapshotSources[source] = (this.snapshotSources[source] ?? 0) + 1; }
  summary() { this.timings.totalMs = Math.round(performance.now() - this.started); return { counters: { ...this.counters }, timings: { ...this.timings }, reasoningMeasurements: this.reasoningMeasurements.map(row => ({ ...row })), measurements: this.measurements.slice(), snapshotSources: { ...this.snapshotSources }, webVerification: this.webVerification.slice(-24), profiling: { ...this.profiling } }; }
}
