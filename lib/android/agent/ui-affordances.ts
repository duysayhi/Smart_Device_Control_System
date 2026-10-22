import type { Observation } from '../state-observer';
import { visibleNode } from './navigation-semantics';
import { foldIntent } from './outcome-spec';
import { isDescendant } from '../exploration/scroll-regions';
import { structuralRoles } from './widget-semantics';

export interface ObservedAffordance {
  deviceId: string; executionId: string; sessionId: string; snapshotId: string; elementId: string; index: number;
  packageName: string; className: string; label: string; text: string; resourceId: string; parent?: string;
  bounds: number[]; enabled: boolean; focused: boolean; checked?: boolean;
  hint?: string; selected?: boolean; description?: string;
  navigationIntent?: 'SEARCH';
  searchEntry?: boolean;
  roles: ('clickable' | 'editable' | 'checkable' | 'selectable' | 'scrollable' | 'navigation' | 'save' | 'capture' | 'unknown')[];
  sensitive: boolean; destructive: boolean; provenance: 'ACCESSIBILITY'; confidence: 'OBSERVED_ATTRIBUTES';
}
export function navigationLabel(label: string, className = ''): string {
  const text = foldIntent(label).trim();
  return /(?:\$Tab|\.Tab|TabWidget)$/.test(className) ? text.replace(/\s+tab\s+\d+\s+(?:of|cua)\s+\d+\.?$/, '').trim() : text;
}
export const sensitiveAffordance = (value: string) => /\b(password|mat khau|permission|quyen|payment|thanh toan|purchase|mua hang|send|gui|share|chia se|login|dang nhap|account|tai khoan|post|dang bai)\b/.test(foldIntent(value).replace(/[_:/.-]/g, ' '));
export const destructiveAffordance = (value: string) => /\b(delete|xoa|reset|uninstall|go cai dat|go bo|loai bo|erase|wipe|clear|format|remove|overwrite|replace|trash|recycle|cleanup|restore|ghi de|thay the|khoi phuc|dat lai|don dep|lam rong)\b/.test(foldIntent(value.replace(/([a-z])([A-Z])/g, '$1 $2')).replace(/[_:/.-]/g, ' '));
export function observedAffordances(snapshot: Observation, executionId: string, sessionId: string): ObservedAffordance[] {
  if (snapshot.observationStatus !== 'OBSERVED') return [];
  return snapshot.nodes.flatMap((node, index) => {
    if (!visibleNode(snapshot, node) || !snapshot.elements[index]) return [];
    const label = node.description || node.text, normalized = foldIntent(label), roles: ObservedAffordance['roles'] = [];
    if (node.clickable) roles.push('clickable');
    if (/EditText|AutoCompleteTextView/.test(node.className)) roles.push('editable');
    if (node.checkable === true && typeof node.checked === 'boolean') roles.push('checkable');
    if (node.selected !== undefined) roles.push('selectable');
    if (node.scrollable) roles.push('scrollable');
    if (/^(back|navigate up|quay lai|tro ve|menu|more options|search|tim kiem)$/.test(normalized)) roles.push('navigation');
    if (!roles.includes('navigation') && structuralRoles(node).includes('navigation')) roles.push('navigation');
    const searchLabels = snapshot.nodes.filter(child => child !== node && visibleNode(snapshot, child) && isDescendant(snapshot.nodes, child, node) &&
      /^(search|tim kiem|find|tra cuu)$/.test(foldIntent(child.description || child.text).trim()));
    const parent = node.parentIndex === undefined ? undefined : snapshot.nodes[node.parentIndex];
    const peers = parent && !parent.scrollable && !/ListView|RecyclerView|GridView/.test(parent.className)
      ? snapshot.nodes.filter(peer => peer.parentIndex === node.parentIndex && peer.className === node.className && peer.enabled && peer.displayed !== false) : [];
    const selectionGroup = peers.length >= 2 && peers.length <= 8 && peers.every(peer => typeof peer.selected === 'boolean') &&
      peers.filter(peer => peer.selected === true).length === 1 && peers.filter(peer => peer.clickable).length >= 1;
    const searchNavigation = node.clickable && (node.checkable || structuralRoles(node).includes('navigation') || selectionGroup) && searchLabels.length === 1 &&
      !snapshot.nodes.some(child => child !== node && child.clickable && isDescendant(snapshot.nodes, child, node));
    const placeholders = snapshot.nodes.filter(child => child.parentIndex === index && !child.clickable && visibleNode(snapshot, child) &&
      /TextView/.test(child.className) && /^(search|tim kiem|find|tra cuu)\s+\S/.test(foldIntent(child.text).trim()));
    let inCollection = false, ancestor = node.parentIndex; const visited = new Set<number>();
    while (ancestor !== undefined && !visited.has(ancestor)) {
      visited.add(ancestor); const parent = snapshot.nodes[ancestor];
      if (!parent) { inCollection = true; break; }
      if (parent.scrollable || /RecyclerView|ListView|GridView/.test(parent.className)) inCollection = true;
      ancestor = parent.parentIndex;
    }
    const searchEntry = node.clickable && !inCollection && placeholders.length === 1 && !node.checkable;
    if (searchNavigation && !roles.includes('navigation')) roles.push('navigation');
    if (/^(save|luu|confirm|xac nhan|done|xong)$/.test(normalized)) roles.push('save');
    if (/^(capture|take photo|chup anh|chup)$/.test(normalized)) roles.push('capture');
    const queryValue = node.clickable && /TextView|SearchView/.test(node.className) && /(?:^|[_-])search[_-](?:query|box|bar|text)(?:$|[_-])/.test(node.resourceId.split('/').at(-1) ?? '');
    const content = [(roles.includes('editable') || queryValue) && label === node.text ? '' : label, node.hint ?? '', node.resourceId, node.className].join(' ');
    return [{ deviceId: snapshot.deviceSerial, executionId, sessionId, snapshotId: snapshot.snapshotId, index,
      elementId: snapshot.elements[index].elementId, packageName: node.packageName, className: node.className, label,
      text: roles.includes('editable') && node.showingHint === true && node.hint === node.text ? '' : node.text, description: node.description, resourceId: node.resourceId,
      parent: snapshot.elements[index].parentElementId, bounds: [...node.bounds], enabled: node.enabled, focused: node.focused, checked: node.checked, hint: node.hint, selected: node.selected,
      ...(searchNavigation ? { navigationIntent: 'SEARCH' as const } : {}),
      ...(searchEntry ? { searchEntry: true } : {}),
      roles: roles.length ? roles : ['unknown'], sensitive: node.password === true || sensitiveAffordance(content) || /permissioncontroller|packageinstaller/.test(node.packageName) || snapshot.nodes.some(child => child !== node && isDescendant(snapshot.nodes, child, node) &&
        (/Switch|CheckBox|RadioButton|ToggleButton|EditText/.test(child.className) || sensitiveAffordance(child.text + ' ' + child.description + ' ' + child.resourceId + ' ' + (child.hint ?? '')) || destructiveAffordance(child.text + ' ' + child.description + ' ' + (child.hint ?? '')))),
      destructive: destructiveAffordance(content), provenance: 'ACCESSIBILITY', confidence: 'OBSERVED_ATTRIBUTES' }];
  });
}
