import type { AgentGoal } from './schema';
import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { discoveredApplication } from './application-discovery';
import { observedTarget, safeNavigationOwner, visibleNode } from './navigation-semantics';
import { normalizeUiText, matchUiTarget } from '../ui-understanding';
import { isSensitiveControl } from '../security-policy';

const readLabels = /^(albums?|thu vien|library|folders?|thu muc|history|lich su|favorites?|yeu thich|calendar|lich|about|gioi thieu|thong tin|photos|anh|videos|tep|files|downloads|tai xuong|world clock|gio quoc te)$/;
const navigationRole = /(?:^|[_/:])(tab|tabs|menu|navigation|nav|toolbar|title|action_bar)(?:$|[_/:])/;
export function genericNativeGoal(goal: AgentGoal): boolean {
  return Boolean(discoveredApplication(goal) && ['OPEN_PAGE', 'FIND_ELEMENT'].includes(goal.spec.operation));
}
export function applicationUiBlocked(goal: AgentGoal, snapshot: Observation): string | undefined {
  if (!discoveredApplication(goal)) return;
  if (snapshot.nodes.some(n => n.displayed !== false &&
    (n.packageName === 'com.android.systemui' && /keyguard|lock_icon|bouncer|notification_panel|notification_stack_scroller|qs_panel/.test(n.resourceId) ||
      /\.aodservice$/.test(n.packageName)))) return 'Android is locked or covered by System UI. Unlock the phone and return to the app; no automatic unlock or click is allowed.';
  if (snapshot.foregroundPackage === goal.packageName && !snapshot.nodes.some(n => visibleNode(snapshot, n))) return 'The foreground package has no visible native app content. Do not treat the package name alone as a ready app.';
}
export function nativeContextSafe(goal: AgentGoal, snapshot: Observation): boolean {
  const app = discoveredApplication(goal);
  return Boolean(app && snapshot.deviceSerial === app.serial && snapshot.observationStatus === 'OBSERVED' &&
    snapshot.foregroundPackage === app.packageName && !applicationUiBlocked(goal, snapshot) && !snapshot.nodes.some(n =>
      /permissioncontroller|packageinstaller/.test(n.packageName) || /Dialog|WebView/.test(n.className) ||
      n.resourceId === 'android:id/alertTitle' || /EditText|AutoCompleteTextView/.test(n.className) && n.focused));
}
export function nativeReadControl(goal: AgentGoal, snapshot: Observation, node: UiNode): boolean {
  const label = normalizeUiText(node.text || node.description), target = normalizeUiText(goal.spec.targetText ?? '');
  const selector = observedTarget(snapshot, node), owner = selector ? matchUiTarget(snapshot, selector, true).node : undefined;
  return goal.spec.operation === 'OPEN_PAGE' && nativeContextSafe(goal, snapshot) && readLabels.test(label) &&
    (label === target || target.split(' ').length > 1 && target.includes(label)) &&
    navigationRole.test(node.resourceId) && !/Switch|CheckBox|RadioButton|ToggleButton|EditText/.test(node.className) &&
    !isSensitiveControl(node.text + ' ' + node.description + ' ' + node.resourceId) &&
    safeNavigationOwner(snapshot, node) && Boolean(owner && !/Switch|CheckBox|RadioButton|ToggleButton|EditText/.test(owner.className) &&
      !isSensitiveControl(owner.text + ' ' + owner.description + ' ' + owner.resourceId));
}
export function nativePageVerified(goal: AgentGoal, snapshot: Observation, label = goal.spec.targetText ?? ''): boolean {
  if (!nativeContextSafe(goal, snapshot)) return false;
  const target = normalizeUiText(label);
  // A clickable result row or an unselected tab is not destination evidence.
  const headingRole = (node: UiNode) => {
    if (/toolbar|action_bar|page_title|screen_title/.test(node.resourceId)) return true;
    let index = node.parentIndex;
    const visited = new Set<number>();
    while (index !== undefined && !visited.has(index)) {
      visited.add(index); const parent = snapshot.nodes[index];
      if (!parent || parent.clickable) return false;
      if (/toolbar|action_bar/.test(parent.resourceId)) return true;
      index = parent.parentIndex;
    }
    return false;
  };
  return snapshot.nodes.some(n => visibleNode(snapshot, n) && !n.clickable &&
    normalizeUiText(n.text || n.description) === target && headingRole(n) &&
    !/tab|menu_item|breadcrumb/.test(n.resourceId) && !isSensitiveControl(n.text + ' ' + n.description));
}
