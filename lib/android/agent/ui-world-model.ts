import type { Observation } from '../state-observer';
import { observedAffordances } from './ui-affordances';
import { structuralRoles, type StructuralRole } from './widget-semantics';

export interface UiWorldModel {
  deviceId: string; executionId: string; sessionId: string; snapshotId: string;
  packageName: string; observedAt: number;
  state: 'READY' | 'STALE' | 'UNOBSERVED' | 'SYSTEM_OVERLAY' | 'LOADING';
  widgets: { ref: string; parent?: string; identity?: string; label: string;
    roles: string[]; evidence: string[]; allowed: boolean; reason?: string }[];
  groups: { ref: string; kind: StructuralRole; members: string[] }[];
  web?: { status: string; context?: string; headings: string[]; linksObserved: number; actionable: false };
}

export function understandUiWorld(snapshot: Observation, executionId: string, sessionId: string): UiWorldModel {
  const affordances = observedAffordances(snapshot, executionId, sessionId);
  const age = Date.now() - snapshot.timestamp;
  const state: UiWorldModel['state'] = snapshot.observationStatus !== 'OBSERVED' ? 'UNOBSERVED' : age < 0 || age > 5000 ? 'STALE' :
    snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId)) ? 'SYSTEM_OVERLAY' :
    snapshot.nodes.some(n => n.displayed !== false && /ProgressBar/.test(n.className)) ? 'LOADING' : 'READY';
  const widgets = affordances.map(a => {
    const native = snapshot.nodes[a.index], structural = structuralRoles(native);
    const unique = a.resourceId && affordances.filter(b => b.packageName === a.packageName && b.resourceId === a.resourceId && b.className === a.className).length === 1;
    const understood = structural.some(r => r !== 'unknown') || a.roles.some(r => !['unknown', 'clickable', 'selectable'].includes(r));
    const roles = understood ? [...new Set([...a.roles.filter(r => r !== 'unknown'), ...structural.filter(r => r !== 'unknown')])] : ['unknown'];
    const reason = state !== 'READY' ? state : a.packageName !== snapshot.foregroundPackage ? 'FOREIGN_PACKAGE' :
      a.destructive ? 'DESTRUCTIVE' : a.sensitive ? 'SENSITIVE' : !a.enabled ? 'DISABLED' : !understood ? 'UNKNOWN_WIDGET' : undefined;
    return { ref: a.elementId, parent: a.parent, identity: unique ? `${a.packageName}|${a.className}|${a.resourceId}` : undefined,
      label: a.label.slice(0, 160), roles: roles.length ? roles : ['unknown'],
      evidence: [`class:${a.className}`, ...(native.checkable ? ['native:checkable'] : []), ...(native.scrollable ? ['native:scrollable'] : [])],
      allowed: !reason, reason };
  });
  // Only explicit hierarchy membership is grouped; geometry alone cannot bind fields.
  const groups: UiWorldModel['groups'] = [];
  for (const widget of widgets) {
    const members = widgets.filter(child => child.parent === widget.ref).map(child => child.ref);
    if (!members.length) continue;
    for (const kind of ['form', 'collection', 'dialog', 'selection'] as const) if (widget.roles.includes(kind)) groups.push({ ref: widget.ref, kind, members });
  }
  const web = snapshot.web;
  return { deviceId: snapshot.deviceSerial, executionId, sessionId, snapshotId: snapshot.snapshotId, packageName: snapshot.foregroundPackage,
    observedAt: snapshot.timestamp, state, widgets, groups,
    ...(web ? { web: { status: web.status, ...(web.status === 'DOM_AVAILABLE' ? { context: web.context } : {}),
      headings: web.status === 'DOM_AVAILABLE' ? web.document.headings.slice(0, 20) : [],
      linksObserved: web.status === 'DOM_AVAILABLE' ? web.document.links.length : 0, actionable: false as const } } : {}) };
}
