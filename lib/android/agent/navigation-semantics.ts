import type { AgentGoal } from './schema';
import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { normalizeUiText, matchUiTarget } from '../ui-understanding';
import { clippedBounds, isDescendant } from '../exploration/scroll-regions';
import { isSensitiveControl, isReadInformationLabel } from '../security-policy';

export type RequiredCapability = { name: 'APP_READY' | 'SEARCH_CONTENT' | 'FIND_SECTION' | 'READ_PAGE' | 'SELECT_RESULT'; target?: string; ready: boolean };
export interface CurrentScreenState {
  deviceId: string; executionId: string; snapshotId: string; foregroundPackage: string; foregroundActivity?: string;
  screenType: 'ROOT' | 'CONTENT_DETAIL' | 'SEARCH_ENTRY' | 'SEARCH_INPUT' | 'SEARCH_RESULTS' | 'MEDIA_PLAYBACK' | 'FULLSCREEN' | 'MENU' | 'DIALOG' | 'LOADING' | 'LIST' | 'FORM' | 'UNKNOWN';
  navigationContext: 'ROOT' | 'DETAIL' | 'FULLSCREEN' | 'OVERLAY' | 'UNKNOWN';
  visibleCapabilities: string[]; activeOverlay?: 'DIALOG' | 'MENU' | 'SYSTEM_UI'; focusedElement?: string;
  loadingState: boolean; confidence: 'EVIDENCE' | 'UNKNOWN' | 'AMBIGUOUS'; evidence: string[]; observedAt: number;
}

function screenHeadings(s: Observation): UiNode[] {
  return s.nodes.filter(n => {
    if (!visibleNode(s, n) || n.clickable || !(n.text || n.description).trim()) return false;
    if (/toolbar|action_bar|page_title|screen_title/.test(n.resourceId)) return true;
    let parent = n.parentIndex;
    const visited = new Set<number>();
    while (parent !== undefined && !visited.has(parent)) {
      visited.add(parent);
      const ancestor = s.nodes[parent];
      if (!ancestor || ancestor.clickable) return false;
      if (/toolbar|action_bar/.test(ancestor.resourceId)) return true;
      parent = ancestor.parentIndex;
    }
    return false;
  });
}

export function understandCurrentScreen(s: Observation, executionId: string): CurrentScreenState {
  const visible = s.nodes.filter(n => visibleNode(s, n));
  const input = visible.filter(n => n.focused && /EditText|AutoCompleteTextView/.test(n.className));
  const dialog = visible.some(n => /Dialog/.test(n.className) || n.resourceId === 'android:id/alertTitle');
  const menu = visible.some(n => /PopupWindow/.test(n.className) || /:id\/(app_menu_list|popup_menu|menu_list)$/.test(n.resourceId));
  const system = s.nodes.some(n => n.displayed !== false && /permissioncontroller|packageinstaller/.test(n.packageName) ||
    n.displayed !== false && n.packageName === 'com.android.systemui' && /keyguard|bouncer|notification_panel|qs_panel/.test(n.resourceId));
  const loading = visible.some(n => /ProgressBar/.test(n.className));
  const players = visible.filter(n => /:id\/(watch_player|player_view)$/.test(n.resourceId));
  const searchInput = input.length === 1 && /search|query|url_bar|omnibox|address/.test(input[0].resourceId);
  const search = searchControl(s) || visible.find(n => /:id\/(url_bar|omnibox|address_bar)$/.test(n.resourceId));
  const fullscreen = players.some(n => {
    const [l, t, r, b] = n.bounds;
    return (r - l) * (b - t) >= s.viewport.width * s.viewport.height * .85;
  }) && visible.some(n => /:id\/(fullscreen|player_overlays|watch_player)$/.test(n.resourceId)) && !search;
  const media = s.screen === 'VIDEO_PLAYER' && players.length > 0;
  const up = visible.some(n => /^(navigate up|back|quay lai|dieu huong len|tro ve)$/.test(normalizeUiText(n.description || n.text)) && safeNavigationOwner(s, n));
  const list = visible.some(n => n.scrollable && /RecyclerView|ListView|ScrollView/.test(n.className));
  const heading = screenHeadings(s).length > 0;
  const root = !up && visible.some(n => /:id\/(bottom_navigation|bottom_navigation_view|bottom_bar|navigation_bar|pivot_bar)$/.test(n.resourceId)) &&
    visible.some(n => n.selected && /^(home|trang chu)$/.test(normalizeUiText(n.text || n.description)));
  const observed = s.observationStatus === 'OBSERVED' && visible.length > 0 && !system;
  const screenType: CurrentScreenState['screenType'] = !observed ? 'UNKNOWN' : dialog ? 'DIALOG' : menu ? 'MENU' : loading ? 'LOADING' :
    fullscreen ? 'FULLSCREEN' : searchInput ? 'SEARCH_INPUT' : s.screen === 'SEARCH_RESULTS' || s.web?.status === 'DOM_AVAILABLE' && s.web.document.links.length > 0 && /[?&](q|query)=/.test(s.web.document.url) ? 'SEARCH_RESULTS' :
    media ? 'MEDIA_PLAYBACK' : input.length ? 'FORM' : root ? 'ROOT' :
    s.web?.status === 'DOM_AVAILABLE' || visible.some(n => /WebView/.test(n.className)) || up && heading ? 'CONTENT_DETAIL' : search ? 'SEARCH_ENTRY' : list ? 'LIST' : 'UNKNOWN';
  return { deviceId: s.deviceSerial, executionId, snapshotId: s.snapshotId, foregroundPackage: s.foregroundPackage,
    foregroundActivity: s.activity, screenType, navigationContext: system || dialog || menu ? 'OVERLAY' : fullscreen ? 'FULLSCREEN' : media || up && heading ? 'DETAIL' : root ? 'ROOT' : 'UNKNOWN',
    visibleCapabilities: [...(search || searchInput ? ['SEARCH_CONTENT'] : []), ...(searchInput ? ['SEARCH_INPUT'] : []), ...(list ? ['BROWSE_CONTENT'] : [])],
    activeOverlay: system ? 'SYSTEM_UI' : dialog ? 'DIALOG' : menu ? 'MENU' : undefined,
    focusedElement: input.length === 1 ? s.elements[s.nodes.indexOf(input[0])]?.elementId : undefined,
    loadingState: loading, confidence: !observed || screenType === 'UNKNOWN' ? 'UNKNOWN' : input.length > 1 ? 'AMBIGUOUS' : 'EVIDENCE',
    evidence: visible.filter(n => n === search || players.includes(n) || /toolbar|action_bar|metadata|menu|Dialog/.test(n.resourceId + n.className)).slice(0, 8)
      .map(n => n.resourceId || n.className), observedAt: s.timestamp };
}

export function resolveRequiredCapability(goal: AgentGoal, s: Observation): RequiredCapability {
  const c = goal.subgoals[goal.currentSubgoal]?.criterion;
  const same = goalPackageAllowed(goal, s.foregroundPackage) && s.observationStatus === 'OBSERVED';
  if (!c || c.kind === 'FOREGROUND') return { name: 'APP_READY', ready: same && s.nodes.some(n => visibleNode(s, n)) };
  if (c.kind === 'SEARCH_RESULTS') {
    const target = goal.spec.resultType === 'browser' ? 'address_bar' : 'search_button';
    const match = matchUiTarget(s, target, false);
    return { name: 'SEARCH_CONTENT', target, ready: same && (match.status === 'MATCH' && Boolean(match.node && visibleNode(s, match.node)) ||
      understandCurrentScreen(s, goal.id).visibleCapabilities.includes('SEARCH_INPUT')) };
  }
  const target = c.target;
  const match = matchUiTarget(s, target, false);
  return { name: c.kind === 'DESTINATION' ? 'SELECT_RESULT' : c.kind === 'NATIVE_PAGE' ? 'READ_PAGE' : 'FIND_SECTION', target,
    ready: same && match.status === 'MATCH' && Boolean(match.node && visibleNode(s, match.node)) };
}

// Route evidence is derived afresh; no remembered back stack authorizes an action.
export function capabilityRouteNodes(goal: AgentGoal, s: Observation): { index: number; kind: 'UP' | 'MENU' | 'EXIT_FULLSCREEN' | 'MEDIA_BACK' }[] {
  const required = resolveRequiredCapability(goal, s), state = understandCurrentScreen(s, goal.id);
  if (required.ready || required.name === 'APP_READY' || required.name === 'SELECT_RESULT' || !goalPackageAllowed(goal, s.foregroundPackage) ||
    state.confidence !== 'EVIDENCE' || state.activeOverlay || state.loadingState || hasUnsavedInput(goal, s) || goal.spec.isSensitive ||
    s.nodes.some(n => visibleNode(s, n) && /EditText|AutoCompleteTextView/.test(n.className) && n.text.trim())) return [];
  const nodes: ReturnType<typeof capabilityRouteNodes> = [];
  s.nodes.forEach((n, index) => {
    if (!visibleNode(s, n) || !safeNavigationOwner(s, n)) return;
    const label = normalizeUiText(n.description || n.text);
    if (/^(navigate up|back|quay lai|dieu huong len|tro ve)$/.test(label) && state.navigationContext === 'DETAIL') nodes.push({ index, kind: 'UP' });
    if (state.screenType === 'FULLSCREEN' && /^(exit full screen|exit fullscreen|thoat toan man hinh)$/.test(label)) nodes.push({ index, kind: 'EXIT_FULLSCREEN' });
    if (required.name === 'SEARCH_CONTENT' && /^(more options|more|menu|tuy chon khac|lua chon khac)$/.test(label) &&
      /toolbar|action_bar|menu/.test(n.resourceId)) nodes.push({ index, kind: 'MENU' });
  });
  if (required.name === 'SEARCH_CONTENT' && ['MEDIA_PLAYBACK', 'FULLSCREEN'].includes(state.screenType) && !nodes.some(n => n.kind !== 'MENU')) {
    const players = s.nodes.map((n, index) => ({ n, index })).filter(({ n }) => visibleNode(s, n) && n.resourceId.endsWith(':id/watch_player'));
    if (players.length === 1) nodes.push({ index: players[0].index, kind: 'MEDIA_BACK' });
  }
  return nodes;
}

export function verifyCapabilityRoute(goal: AgentGoal, before: Observation, after: Observation, kind: string): boolean {
  if (after.observationStatus !== 'OBSERVED' || before.snapshotId === after.snapshotId || before.deviceSerial !== after.deviceSerial ||
    !goalPackageAllowed(goal, after.foregroundPackage) || before.foregroundPackage !== after.foregroundPackage ||
    after.timestamp < before.timestamp || Date.now() - after.timestamp > 5000) return false;
  const old = understandCurrentScreen(before, goal.id), fresh = understandCurrentScreen(after, goal.id);
  if (fresh.activeOverlay === 'SYSTEM_UI' || fresh.confidence !== 'EVIDENCE') return false;
  if (resolveRequiredCapability(goal, after).ready) return true;
  if (kind === 'MENU') return fresh.screenType === 'MENU' && old.screenType !== 'MENU';
  if (old.screenType === 'FULLSCREEN') return fresh.screenType === 'MEDIA_PLAYBACK';
  // A changed heading proves one level of Up, not completion of the parent goal.
  if (kind === 'UP' && !['FORM', 'DIALOG', 'FULLSCREEN'].includes(fresh.screenType)) {
    const headings = (s: Observation) => screenHeadings(s).map(n => n.text || n.description).join('|');
    return Boolean(headings(before) && headings(after) && headings(before) !== headings(after));
  }
  return false;
}

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
