import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';

export class NavigationBlocked extends Error {}

export class NavigationGraph {
  private readonly visits = new Map<string, number>();
  private readonly transitions: { from: string; to: string; action: string; verified: boolean }[] = [];
  constructor(private readonly deviceId: string, private readonly maxDepth = 12) {}
  observe(snapshot: Observation): string {
    if (snapshot.deviceSerial !== this.deviceId) throw new NavigationBlocked('Foreign navigation snapshot.');
    const key = geometryFingerprint(snapshot), count = (this.visits.get(key) ?? 0) + 1;
    this.visits.set(key, count);
    if (count > 3 || this.visits.size > 40) throw new NavigationBlocked('Navigation loop/budget exceeded.');
    return key;
  }
  record(before: Observation, after: Observation, action: string, verified: boolean) {
    if (before.deviceSerial !== this.deviceId || after.deviceSerial !== this.deviceId || this.transitions.length >= this.maxDepth) throw new NavigationBlocked('Navigation depth/device limit.');
    if (!verified) throw new NavigationBlocked('NAVIGATION_TRANSITION_UNVERIFIED: no route hint or mutation replay.');
    this.transitions.push({ from: geometryFingerprint(before), to: geometryFingerprint(after), action, verified });
  }
  hints() { return this.transitions.map(row => ({ ...row })); }
}
