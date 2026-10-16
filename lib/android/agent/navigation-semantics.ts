import type { AgentGoal } from './schema';
import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { normalizeUiText, matchUiTarget } from '../ui-understanding';
import { clippedBounds, isDescendant } from '../exploration/scroll-regions';
import { isSensitiveControl, isReadInformationLabel } from '../security-policy';

export const isReadLocationGoal = (goal: AgentGoal) => goal.spec.operation === 'FIND_PLACE';
export const storageSubject = (goal: AgentGoal) => isReadLocationGoal(goal) && /\b(bo nho|luu tru|storage|memory)\b/.test(normalizeUiText(goal.spec.targetText ?? ''));
export function goalPackageAllowed(goal: AgentGoal, packageName: string): boolean {
  // A bounded read-only Settings destination profile, not permission to open arbitrary apps.
  return packageName === goal.packageName || goal.spec.app === 'settings' && isReadLocationGoal(goal) &&
    (packageName === 'com.android.settings.intelligence' || storageSubject(goal) && packageName === 'com.samsung.android.lool' ||
      /\b(luu tru|storage)\b/.test(normalizeUiText(goal.spec.targetText ?? '')) && packageName === 'com.sec.android.app.myfiles');
}
export function locationSearchQuery(goal: AgentGoal): string | undefined {
  const phrase = goal.spec.targetText;
  if (!phrase || !isReadLocationGoal(goal)) return;
  return phrase.match(/lưu trữ|storage|bộ nhớ|memory/i)?.[0] ?? phrase;
}
export function hasUnsavedInput(goal: AgentGoal, snapshot: Observation): boolean {
  return snapshot.nodes.some(n => n.focused && /EditText|AutoCompleteTextView/.test(n.className) && n.text.trim() &&
    !(isReadLocationGoal(goal) && /search|query/.test(n.resourceId) && n.text === locationSearchQuery(goal)));
}
export function observedTarget(snapshot: Observation, node: UiNode): string | undefined {
  for (const [kind, value] of [['accessibility_id', node.description], ['text', node.text], ['id', node.resourceId]]) {
    if (!value) continue;
    const target = `${kind}:${value}`, match = matchUiTarget(snapshot, target, true);
    if (match.status === 'MATCH') return target;
  }
  if (node.resourceId && node.text) {
    const target = 'observed:' + JSON.stringify({ resourceId: node.resourceId, text: node.text, className: node.className });
    if (matchUiTarget(snapshot, target, true).status === 'MATCH') return target;
  }
}
export function visibleNode(snapshot: Observation, node: UiNode): boolean {
  if (!node.enabled || node.displayed === false || node.packageName !== snapshot.foregroundPackage) return false;
  const b = node.bounds, clip = clippedBounds(snapshot, node), area = (b[2] - b[0]) * (b[3] - b[1]);
  return area > 0 && Math.max(0, clip[2] - clip[0]) * Math.max(0, clip[3] - clip[1]) >= .9 * area;
}
export function searchControl(snapshot: Observation): UiNode | undefined {
  const nodes = snapshot.nodes.filter(n => visibleNode(snapshot, n) && !/EditText|AutoCompleteTextView/.test(n.className) &&
    /^(search|tim kiem)$/.test(normalizeUiText(n.description || n.text)));
  return nodes.length === 1 && observedTarget(snapshot, nodes[0]) ? nodes[0] : undefined;
}
export function readNavigationLabel(goal: AgentGoal, node: UiNode): boolean {
  const label = normalizeUiText(node.text || node.description);
  if (!isReadLocationGoal(goal) || !label || label.length > 100 || isSensitiveControl(label)) return false;
  return isReadInformationLabel(goal.spec.targetText ?? '', label, node.resourceId);
}
export function safeNavigationOwner(snapshot: Observation, node: UiNode): boolean {
  const target = observedTarget(snapshot, node);
  if (!target || !visibleNode(snapshot, node)) return false;
  const match = matchUiTarget(snapshot, target, true), owner = match.node;
  return match.status === 'MATCH' && Boolean(owner && visibleNode(snapshot, owner) &&
    !snapshot.nodes.some(n => isDescendant(snapshot.nodes, n, owner) &&
      (/Switch|CheckBox|RadioButton|ToggleButton|EditText/.test(n.className) || isSensitiveControl(n.text + ' ' + n.description + ' ' + n.resourceId))));
}
export function readLocationVerified(goal: AgentGoal, snapshot: Observation): boolean {
  if (!isReadLocationGoal(goal) || !goalPackageAllowed(goal, snapshot.foregroundPackage) || snapshot.observationStatus !== 'OBSERVED') return false;
  if (snapshot.nodes.some(n => /EditText|AutoCompleteTextView/.test(n.className) && (n.focused || /search|query/.test(n.resourceId)) || /ProgressBar|Dialog/.test(n.className))) return false;
  const labels = capacityTextEvidence(snapshot);
  if (/\b(luu tru|storage)\b/.test(normalizeUiText(goal.spec.targetText ?? ''))) return Boolean(storageFreeEvidence(goal, snapshot));
  // Finding a search row alone is not proof that the requested capacity can be read.
  return storageSubject(goal) && labels.some(label => /^(bo nho|luu tru|dung luong luu tru|storage|memory)$/.test(normalizeUiText(label))) &&
    labels.some(label => /^\d+(?:[.,]\d+)?\s*(?:GB|MB|TB)\s*\/\s*\d+(?:[.,]\d+)?\s*(?:GB|MB|TB)$/i.test(label.trim()) ||
      /^(da su dung|da dung|con trong|tong(?: dung luong)?|used|available|total|free)(?:\s|:)/.test(normalizeUiText(label)) && /\d+(?:[.,]\d+)?\s*(?:GB|MB|TB)\b/i.test(label)) &&
    labels.some(label => /^(da su dung|da dung|con trong|tong(?: dung luong)?|used|available|total|free)(?:\s|:)/.test(normalizeUiText(label)) && /\d/.test(label));
}
export function storageFreeEvidence(goal: AgentGoal, snapshot: Observation): { label: string; value: string; packageName: string; snapshotId: string; basis?: { used: string; total: string; derived: true } } | undefined {
  if (!isReadLocationGoal(goal) || !/\b(luu tru|storage)\b/.test(normalizeUiText(goal.spec.targetText ?? '')) ||
    !goalPackageAllowed(goal, snapshot.foregroundPackage) || snapshot.observationStatus !== 'OBSERVED' ||
    snapshot.nodes.some(n => /EditText|AutoCompleteTextView/.test(n.className) && (n.focused || /search|query/.test(n.resourceId)) || /ProgressBar|Dialog/.test(n.className))) return;
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n));
  if (!visible.some(n => /^(luu tru|dung luong luu tru|storage)$/.test(normalizeUiText(n.text || n.description)))) return;
  if (visible.some(n => /^(bo nho|memory|ram)$/.test(normalizeUiText(n.text || n.description)))) return;
  const found = visible.flatMap(n => {
    const label = n.text || n.description;
    if (!/^(con trong|kha dung|trong|available|free)(?:\s|:)/.test(normalizeUiText(label))) return [];
    const value = label.match(/\d+(?:[.,]\d+)?\s*(?:GB|MB|TB)\b/i)?.[0];
    return value ? [{ label, value }] : [];
  });
  if (!found.length && snapshot.foregroundPackage === 'com.sec.android.app.myfiles') {
    const prefix = snapshot.foregroundPackage + ':id/';
    const internal = visible.filter(n => n.resourceId === prefix + 'viewpager_storage_name' && /^(bo nho trong|internal storage)$/.test(normalizeUiText(n.text)));
    const used = visible.filter(n => n.resourceId === prefix + 'used_space_size');
    const total = visible.filter(n => n.resourceId === prefix + 'total_space_size');
    if (internal.length !== 1 || used.length !== 1 || total.length !== 1 || used[0].parentIndex === undefined || used[0].parentIndex !== total[0].parentIndex ||
      !visible.some(n => n.resourceId === prefix + 'as_usage_label' && /^(da dung|used)$/.test(normalizeUiText(n.text)))) return;
    const card = snapshot.nodes[internal[0].parentIndex ?? -1]?.parentIndex;
    if (card === undefined || !isDescendant(snapshot.nodes, used[0], snapshot.nodes[card]) || !isDescendant(snapshot.nodes, total[0], snapshot.nodes[card])) return;
    const pattern = /^(\d+)(?:[.,](\d{1,3}))?\s*(GB|MB|TB)$/i;
    const a = used[0].text.match(pattern), b = total[0].text.match(pattern);
    if (!a || !b || a[3].toUpperCase() !== b[3].toUpperCase()) return;
    const decimals = Math.max(a[2]?.length ?? 0, b[2]?.length ?? 0), scale = 10 ** decimals;
    const units = (m: RegExpMatchArray) => Number(m[1]) * scale + Number((m[2] ?? '').padEnd(decimals, '0'));
    const usedUnits = units(a), totalUnits = units(b);
    if (usedUnits < 0 || totalUnits <= 0 || usedUnits > totalUnits) return;
    const value = ((totalUnits - usedUnits) / scale).toFixed(decimals).replace('.', ',') + ' ' + b[3].toUpperCase();
    return { label: `Còn trống khoảng ${value} (tổng ${total[0].text} - đã dùng ${used[0].text})`, value,
      packageName: snapshot.foregroundPackage, snapshotId: snapshot.snapshotId, basis: { used: used[0].text, total: total[0].text, derived: true } };
  }
  if (found.length !== 1) return;
  return { ...found[0], packageName: snapshot.foregroundPackage, snapshotId: snapshot.snapshotId };
}
export function capacityTextEvidence(snapshot: Observation): string[] {
  const numeric = /^\d+(?:[.,]\d+)?\s*(?:GB|MB|TB)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:GB|MB|TB))?$/i;
  return snapshot.nodes.filter(n => visibleNode(snapshot, n)).map(n => n.text || n.description).filter(label => {
    const text = normalizeUiText(label);
    return /^(bo nho|luu tru|dung luong luu tru|storage|memory)$/.test(text) || numeric.test(label.trim()) ||
      /^(da su dung|da dung|con trong|tong(?: dung luong)?|used|available|total|free)(?:\s|:)/.test(text) && /\d+(?:[.,]\d+)?\s*(?:GB|MB|TB|%)/i.test(label);
  }).slice(0, 16);
}
