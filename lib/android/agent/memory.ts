import type { Action } from '../../validators/action-plan.schema';
import type { ActionOutcome } from '../condition-executor';
import type { DiscoveredSelection } from '../exploration/types';
import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';
import { navigationLayers } from '../browser-navigation';
import type { CurrentScreenState } from './navigation-semantics';

export interface AgentActionRecord { action: Action; fingerprint: string; subgoalId: string; verification: 'VERIFIED' | 'SENT' | 'FAILED'; error?: string; reason: string; candidateId?: string; candidateSnapshotId?: string; recoverySubtaskId?: string }
export class AgentMemory {
  readonly actions: AgentActionRecord[] = [];
  readonly observations: { fingerprint: string; screen: string; packageName: string; nodeCount: number; hadDialog: boolean; navigationLayers: string[] }[] = [];
  readonly reasoningStates = new Set<string>();
  recovery?: import('./recovery').RecoveryProgress;
  readonly screenStates: CurrentScreenState[] = [];
  readonly navigation: { from: string; to?: string; action: Action; verification: 'VERIFIED' | 'SENT' | 'FAILED'; capability: string; elapsedMs: number }[] = [];
  recordScreen(state: CurrentScreenState) {
    this.screenStates.push(state);
    if (this.screenStates.length > 12) this.screenStates.shift();
  }
  selection?: DiscoveredSelection;
  lastOutcome?: ActionOutcome;
  failures: { code: string; action?: Action; message?: string }[] = [];
  private repeats = new Map<string, number>();
  observe(s: Observation, progress: number): { fingerprint: string; repeated: boolean } {
    const fingerprint = geometryFingerprint(s);
    const key = `${progress}:${fingerprint}`, count = (this.repeats.get(key) ?? 0) + 1;
    this.repeats.set(key, count);
    this.observations.push({ fingerprint, screen: s.screen, packageName: s.foregroundPackage, nodeCount: s.nodes.length,
      hadDialog: s.nodes.some(n => /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle'), navigationLayers: navigationLayers(s) });
    if (this.observations.length > 12) this.observations.shift();
    return { fingerprint, repeated: count > 3 };
  }
  alreadyAttempted(action: Action, subgoalId: string, fingerprint: string): boolean {
    return this.actions.some(row => row.subgoalId === subgoalId && JSON.stringify(row.action) === JSON.stringify(action) &&
      (row.fingerprint === fingerprint || row.verification !== 'VERIFIED' && ['CLICK', 'INPUT_TEXT', 'PRESS_KEY'].includes(action.type)));
  }
}
