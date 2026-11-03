import type { Observation } from '../state-observer';
import { observedAffordances } from './ui-affordances';
import { foldIntent } from './outcome-spec';
import { visibleNode } from './navigation-semantics';

export interface SearchUserAction {
  state: 'NEEDS_USER_ACTION'; reason: string; snapshotId: string; screenshotRef: string;
}
export function searchUserAction(snapshot: Observation): SearchUserAction | undefined {
  if (snapshot.observationStatus !== 'OBSERVED') return;
  const rows = observedAffordances(snapshot, '', '');
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n));
  const permission = visible.some(n => /permissioncontroller|packageinstaller/.test(n.packageName));
  const text = foldIntent(visible.map(n => [n.text, n.description, n.resourceId].join(' ')).join(' ')).replace(/[_:/.-]/g, ' ');
  const consent = /\b(consent|privacy|terms|permission|agree|accept|onboarding|dieu khoan|dong y|cho phep|quyen rieng tu)\b/.test(text);
  const setup = visible.some(n => !n.clickable && /^(welcome\b|get started\b|set up\b|setup\b|chao mung\b|bat dau\b)/.test(foldIntent(n.text || n.description))) && rows.some(r => r.roles.includes('clickable'));
  if (!permission && !consent && !setup) return;
  return { state: 'NEEDS_USER_ACTION', reason: permission ? 'ANDROID_PERMISSION_SURFACE' : consent ? 'CONSENT_OR_PRIVACY_SURFACE' : 'SETUP_OR_SETTINGS_SURFACE',
    snapshotId: snapshot.snapshotId, screenshotRef: '/api/devices/' + encodeURIComponent(snapshot.deviceSerial) + '/screenshot?width=720&observedSnapshot=' + encodeURIComponent(snapshot.snapshotId) };
}
