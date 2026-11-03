import type { Observation } from '../state-observer';
import { isNodeInteractable } from '../screen-state';
import { observedAffordances, type ObservedAffordance } from './ui-affordances';

// Native pixels, not a fraction of the screen. A moved/replaced target is not a new authorization.
export const TARGET_BOUNDS_TOLERANCE_PX = 4;
export function rebindTarget(target: ObservedAffordance, snapshot: Observation, clickable: boolean): ObservedAffordance | undefined {
  if (snapshot.deviceSerial !== target.deviceId || snapshot.foregroundPackage !== target.packageName || snapshot.observationStatus !== 'OBSERVED' ||
    Date.now() - snapshot.timestamp < 0 || Date.now() - snapshot.timestamp > 5000 ||
    snapshot.nodes.some(n => n.displayed !== false && (/permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId) || /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle'))) return;
  const matches = observedAffordances(snapshot, target.executionId, target.sessionId).filter(row =>
    row.packageName === target.packageName && row.className === target.className && row.resourceId === target.resourceId && row.label === target.label && row.text === target.text && row.description === target.description && row.hint === target.hint &&
    row.enabled && !row.sensitive && !row.destructive && row.focused === target.focused && row.checked === target.checked && row.selected === target.selected &&
    JSON.stringify(row.roles) === JSON.stringify(target.roles));
  if (matches.length !== 1) return;
  const match = matches[0], node = snapshot.nodes[match.index];
  if (match.bounds.length !== 4 || match.bounds.some((v, i) => Math.abs(v - target.bounds[i]) > TARGET_BOUNDS_TOLERANCE_PX)) return;
  if (clickable && !isNodeInteractable(node, snapshot.nodes, snapshot.viewport, 'grounded target', match.index)) return;
  return match;
}
