import { randomUUID } from 'node:crypto';
import type { OutcomeV2 } from './outcome-spec';
import { commandMask } from './outcome-spec';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import { decidePermission } from './permission-decision';

export const OWNER_AUTHORIZED_TEST_MODE = 'OWNER_AUTHORIZED_TEST_MODE' as const;
export interface OwnerTestMode {
  mode: typeof OWNER_AUTHORIZED_TEST_MODE; id: string; deviceId: string; physicalId: string; enabledAt: number; expiresAt: number;
  fullControl?: { mode: 'FULL_CONTROL_TEST_MODE'; rollbackOnFailure: boolean; autoReview?: boolean; effects: readonly ['REVERSIBLE_SETTING', 'CREATE_ARTIFACT', 'CREATE_RECORD', 'DESIGNATED_EXTERNAL'] };
}
export interface OwnerTestExecution extends OwnerTestMode { executionId: string }
export interface OwnerPolicyAudit { at: number; event: 'ENABLED' | 'DISABLED' | 'EXPIRED' | 'BOUND'; authorizationId: string; deviceId: string; executionId?: string }
const executionChecks = new WeakMap<OwnerTestExecution, () => boolean>();
// These are action words, not text inside quoted record values.
export const destructiveTestIntent = (text: string) => /\b(delete|erase|wipe|uninstall|remove|reset|format|overwrite|replace|clear|trash|recycle|cleanup|restore|xoa|go cai dat|go bo|loai bo|khoi phuc|dat lai|don dep|lam rong|ghi de|thay the)\b/.test(commandMask(text));
export function ownerCandidateNonDestructive(candidate: GroundedCandidateV2): boolean {
  const target = candidate.target;
  if (target.sensitive || target.destructive) return false;
  if (candidate.effect === 'READ' && candidate.action === 'CLICK') {
    if (candidate.search) return true; // The search grant validates the backend-issued scope and exact phase.
    // A generic menu/item ID alone cannot prove that an unfamiliar command only navigates.
    return target.roles.includes('navigation') || /(?:\$Tab|\.Tab|TabWidget)$/.test(target.className) || /(?:^|[_:/.-])(?:nav|navigation|breadcrumb)(?:[_:/.-]|$)/.test(target.resourceId);
  }
  return true; // Registered grant/executor contracts still constrain every primitive/effect.
}
export function assertOwnerTestExecution(scope: OwnerTestExecution, deviceId: string, physicalId: string, executionId: string) {
  if (!executionChecks.get(scope)?.() || scope.deviceId !== deviceId || scope.physicalId !== physicalId || scope.executionId !== executionId || scope.expiresAt <= Date.now()) throw Error('Owner test authorization is revoked, expired, untrusted or foreign.');
}
export function ownerEffectAllowed(scope: OwnerTestExecution, outcome: OutcomeV2, deviceId: string, physicalId: string, executionId: string): boolean {
  assertOwnerTestExecution(scope, deviceId, physicalId, executionId);
  return decidePermission({ source: outcome.span.text, stage: 'EFFECT', owner: scope, deviceId, physicalId, executionId, outcome }).decision === 'ALLOW';
}
export class OwnerTestPolicy {
  private modes = new Map<string, OwnerTestMode>();
  private events: OwnerPolicyAudit[] = [];
  private audit(event: OwnerPolicyAudit['event'], mode: OwnerTestMode, executionId?: string) {
    this.events.push({ at: Date.now(), event, authorizationId: mode.id, deviceId: mode.deviceId, executionId });
    if (this.events.length > 200) this.events.shift();
  }
  list(): OwnerTestMode[] {
    for (const mode of this.modes.values()) if (mode.expiresAt <= Date.now()) { this.modes.delete(mode.deviceId); this.audit('EXPIRED', mode); }
    return [...this.modes.values()].map(mode => ({ ...mode }));
  }
  history() { return this.events.map(event => ({ ...event })); }
  enable(deviceId: string, physicalId: string, beforeEnable?: (mode: OwnerTestMode) => void, options?: { fullControl?: boolean; rollbackOnFailure?: boolean }): OwnerTestMode {
    const fullControl = options?.fullControl ? Object.freeze({ mode: 'FULL_CONTROL_TEST_MODE' as const, rollbackOnFailure: options.rollbackOnFailure === true,
      autoReview: process.env.AGENT_V2_FULL_CONTROL_AUTO_REVIEW === 'true',
      effects: Object.freeze(['REVERSIBLE_SETTING', 'CREATE_ARTIFACT', 'CREATE_RECORD', 'DESIGNATED_EXTERNAL'] as const) }) : undefined;
    const mode: OwnerTestMode = Object.freeze({ mode: OWNER_AUTHORIZED_TEST_MODE, id: randomUUID(), deviceId, physicalId, enabledAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000, ...(fullControl ? { fullControl } : {}) });
    beforeEnable?.(mode);
    this.modes.set(deviceId, mode); this.audit('ENABLED', mode); return { ...mode };
  }
  disable(deviceId: string, authorizationId: string): boolean {
    const mode = this.modes.get(deviceId);
    if (!mode || mode.id !== authorizationId) return false;
    this.modes.delete(deviceId); this.audit('DISABLED', mode); return true;
  }
  bind(deviceId: string, physicalId: string, executionId: string): OwnerTestExecution {
    this.list(); const mode = this.modes.get(deviceId);
    if (!mode || mode.physicalId !== physicalId) throw Error('Selected device has no matching owner test authorization.');
    const scope = Object.freeze({ ...mode, executionId });
    executionChecks.set(scope, () => this.modes.get(deviceId)?.id === mode.id && mode.expiresAt > Date.now());
    this.audit('BOUND', mode, executionId); return scope;
  }
}
