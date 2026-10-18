import type { Action, ActionPlan } from '../validators/action-plan.schema';
import type { UiNode } from './targets';
import { normalizeUiText, matchUiTarget } from './ui-understanding';
import type { Observation } from './state-observer';
import { isDescendant } from './exploration/scroll-regions';
import { AndroidExecutionError } from './errors';
import { APP_PACKAGE_ALIASES } from './capabilities';
import { isWifiOffPlan, isWifiOnPlan, wifiNetworkForPlan } from './wifi-plan';
import { developmentPolicyEnabled } from './policy-mode';

export type ActionRisk = 'NAVIGATION' | 'READ' | 'DATA_CHANGE' | 'SENSITIVE' | 'UNKNOWN';
export interface PolicyDecision {
  decision: 'ALLOW' | 'CONFIRM' | 'BLOCK';
  risks: ActionRisk[];
  reasons: string[];
  llmDisagreement: boolean;
}
export function isDestructiveControl(value: string): boolean {
  return /(?:^|[\s/:.])(delete|xoa|reset|factory reset|uninstall|go cai dat|khoi phuc cai dat goc|dat lai thiet bi|erase|wipe|format|clear data|clear cache|don dep|don ngay|clean now)(?:$|\s|button)/.test(normalizeUiText(value));
}
export function isSensitiveControl(value: string): boolean {
  if (developmentPolicyEnabled()) return isDestructiveControl(value);
  const normalized = normalizeUiText(value);
  return /(?:^|[\s/:.])(subscribe|subscribed|like|comment|delete|send|purchase|payment|login|sign in|dang ky|dang nhap|thanh toan|mua hang|xoa|don dep|don ngay|clean now|optimize now|toi uu ngay|reset|factory reset|uninstall|go cai dat|khoi phuc cai dat goc|dat lai thiet bi|erase|wipe|format|clear data|clear cache)(?:$|\s|button)/.test(normalized);
}
export function unsafeBrowserInput(text: string): boolean {
  const compact = text.trim().replace(/[\u0000-\u0020]/g, '');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(compact)) return false;
  if (!/^https?:\/\//i.test(compact)) return true;
  try { return isSensitiveControl(new URL(text.trim()).pathname); }
  catch { return true; }
}
export function assessPlanPolicy(plan: ActionPlan): PolicyDecision {
  if (developmentPolicyEnabled()) {
    const destructive = plan.actions.some(action => action.type === 'CLICK' && isDestructiveControl(action.target));
    return { decision: destructive ? 'BLOCK' : 'ALLOW', risks: destructive ? ['SENSITIVE'] : ['UNKNOWN'], llmDisagreement: false,
      reasons: [destructive ? 'Destructive actions remain blocked in development mode.' : 'Development mode: sensitivity/unknown-action policy gate disabled; native grounding and verification remain required.'] };
  }
  if (isWifiOffPlan(plan) || isWifiOnPlan(plan) || wifiNetworkForPlan(plan) !== undefined) return { decision: 'CONFIRM', risks: ['NAVIGATION', 'DATA_CHANGE'], llmDisagreement: false,
    reasons: ['Changing Wi-Fi state requires device-bound, single-use confirmation.'] };
  let app = '', searchInput = false;
  const risks: ActionRisk[] = plan.actions.map(action => {
    if (action.type === 'OPEN_APP' || action.type === 'CLOSE_APP') {
      const packageName = APP_PACKAGE_ALIASES[action.app.trim().toLowerCase()] ?? action.app.trim();
      const knownApp = Object.values(APP_PACKAGE_ALIASES).includes(packageName);
      app = action.type === 'OPEN_APP' ? packageName : '';
      searchInput = false;
      return knownApp ? 'NAVIGATION' : 'UNKNOWN';
    }
    if (action.type === 'WAIT_FOR' || action.type === 'SCREENSHOT') return 'READ';
    if (action.type === 'SWIPE') return 'NAVIGATION';
    if (action.type === 'INPUT_TEXT') return app === APP_PACKAGE_ALIASES.chrome && unsafeBrowserInput(action.text) ? 'SENSITIVE' : searchInput ? 'NAVIGATION' : 'DATA_CHANGE';
    if (action.type === 'PRESS_KEY') {
      const risk = ['BACK', 'HOME'].includes(action.key) || action.key === 'ENTER' && searchInput ? 'NAVIGATION' : 'UNKNOWN';
      searchInput = false;
      return risk;
    }
    if (isSensitiveControl(action.target)) return 'SENSITIVE';
    searchInput = /^(search_button|address_bar|search_field|search_input)$/.test(action.target) && [APP_PACKAGE_ALIASES.youtube, APP_PACKAGE_ALIASES.chrome].includes(app);
    if (searchInput || action.target === 'back_button') return 'NAVIGATION';
    if (app === APP_PACKAGE_ALIASES.settings && action.target === 'wifi_settings') return 'NAVIGATION';
    if ((/^video_card_([1-9]\d?)$/.test(action.target) || action.target === 'play_button') && app === APP_PACKAGE_ALIASES.youtube ||
      /^(first_result|result_[1-9]\d?)$/.test(action.target) && app === APP_PACKAGE_ALIASES.chrome) return 'NAVIGATION';
    if (app === APP_PACKAGE_ALIASES.settings && /^(text:)?(ket noi|wi fi|thong tin dien thoai)$/.test(normalizeUiText(action.target))) return 'NAVIGATION';
    return 'UNKNOWN';
  });
  const unsafe = risks.some(risk => risk === 'SENSITIVE' || risk === 'DATA_CHANGE');
  const unknown = risks.includes('UNKNOWN');
  const disagreement = !unsafe && !unknown && plan.isSensitive || unsafe && !plan.isSensitive;
  return { decision: unsafe ? 'BLOCK' : unknown || plan.isSensitive ? 'CONFIRM' : 'ALLOW', risks, llmDisagreement: disagreement,
    reasons: unsafe ? ['Independent policy identifies a sensitive/data-changing action; automation is blocked.'] : unknown
      ? ['Action semantics are not independently proven safe; explicit confirmation is required.'] : plan.isSensitive
        ? ['Policy identifies navigation/read actions but AI marked the plan sensitive; confirmation is required. The AI flag was not rewritten.']
        : ['All planned actions are independently classified as navigation/read; runtime UI controls are still checked.'] };
}
export function assertPlanPolicy(plan: ActionPlan): PolicyDecision {
  const decision = assessPlanPolicy(plan);
  if (decision.decision !== 'ALLOW') throw new AndroidExecutionError('CONFIG_ERROR', decision.reasons.join(' '));
  return decision;
}
export function assertActionNotSensitive(action: Action): void {
  if (action.type === 'CLICK' && isSensitiveControl(action.target)) throw new AndroidExecutionError('CONFIG_ERROR', 'Sensitive UI action is blocked by independent policy.');
}
export function assertObservedControlSafe(node: UiNode): void {
  if (developmentPolicyEnabled()) {
    if ([node.resourceId, node.text, node.description].some(isDestructiveControl)) throw new AndroidExecutionError('CONFIG_ERROR', 'Destructive UI control is blocked, including in development mode.');
    return;
  }
  if (/Switch|CheckBox|RadioButton|ToggleButton/.test(node.className) || isSensitiveControl(node.resourceId) ||
    isSensitiveControl(node.text) || isSensitiveControl(node.description)) throw new AndroidExecutionError('CONFIG_ERROR', 'Observed control changes data/account state or has sensitive semantics; no click was sent.');
}

export function isReadInformationLabel(subject: string, label: string, resourceId: string): boolean {
  const text = normalizeUiText(label), topic = normalizeUiText(subject);
  if (!text || text.length > 100 || isSensitiveControl(text) || /breadcrumb|summary/.test(resourceId)) return false;
  if (/\b(luu tru|storage)\b/.test(topic)) return /^(luu tru|dung luong luu tru|storage|cham soc (pin va )?thiet bi|device care|battery and device care)$/.test(text);
  if (/\b(bo nho|memory|ram)\b/.test(topic)) return /^(bo nho|memory|ram|cham soc (pin va )?thiet bi|device care|battery and device care)$/.test(text);
  const words = topic.split(' ').filter(w => w.length > 3);
  return words.length > 0 && words.every(w => text.includes(w)) && /title|menu|tab|navigation/.test(resourceId);
}

export function assessObservedReadNavigation(snapshot: Observation, node: UiNode, subject: string, search: boolean): PolicyDecision {
  let owner: UiNode | undefined;
  for (const [kind, value] of [['accessibility_id', node.description], ['text', node.text], ['id', node.resourceId]]) {
    if (!value) continue;
    const match = matchUiTarget(snapshot, `${kind}:${value}`, true);
    if (match.status === 'MATCH') { owner = match.node; break; }
  }
  if (!owner && node.resourceId && node.text) {
    const match = matchUiTarget(snapshot, 'observed:' + JSON.stringify({ resourceId: node.resourceId, text: node.text, className: node.className }), true);
    if (match.status === 'MATCH') owner = match.node;
  }
  const trusted = snapshot.observationStatus === 'OBSERVED' && node.packageName === snapshot.foregroundPackage && node.enabled && node.displayed !== false &&
    !snapshot.nodes.some(n => /WebView/.test(n.className) && isDescendant(snapshot.nodes, node, n)) &&
    (search || /title|menu|tab|navigation/.test(node.resourceId)) &&
    (search ? /^(search|tim kiem)$/.test(normalizeUiText(node.description || node.text)) : isReadInformationLabel(subject, node.text || node.description, node.resourceId)) &&
    Boolean(owner && !snapshot.nodes.some(n => isDescendant(snapshot.nodes, n, owner) &&
      (/Switch|CheckBox|RadioButton|ToggleButton|EditText/.test(n.className) || isSensitiveControl(n.text + ' ' + n.description + ' ' + n.resourceId))));
  return { decision: trusted ? 'ALLOW' : 'BLOCK', risks: [trusted ? 'NAVIGATION' : 'UNKNOWN'], llmDisagreement: false,
    reasons: [trusted ? 'Observed unique control has goal-related read/search navigation semantics and no data-changing descendants.' : 'Observed control does not prove read-only goal navigation.'] };
}

export function assessObservedRouteControl(snapshot: Observation, node: UiNode): PolicyDecision {
  const label = normalizeUiText(node.description || node.text);
  const approved = /^(navigate up|back|quay lai|dieu huong len|tro ve|more options|more|menu|tuy chon khac|lua chon khac|exit full screen|exit fullscreen|thoat toan man hinh)$/.test(label);
  const match = [node.description && `accessibility_id:${node.description}`, node.text && `text:${node.text}`, node.resourceId && `id:${node.resourceId}`]
    .filter(Boolean).map(target => matchUiTarget(snapshot, target as string, true)).find(result => result.status === 'MATCH');
  const owner = match?.node;
  const trusted = snapshot.observationStatus === 'OBSERVED' && node.packageName === snapshot.foregroundPackage && node.enabled && node.displayed !== false && approved &&
    !snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /WebView/.test(n.className) && isDescendant(snapshot.nodes, node, n)) &&
    Boolean(owner && !snapshot.nodes.some(n => isDescendant(snapshot.nodes, n, owner) &&
      (/Switch|CheckBox|RadioButton|ToggleButton|EditText/.test(n.className) || isSensitiveControl(n.text + ' ' + n.description + ' ' + n.resourceId))));
  return { decision: trusted ? 'ALLOW' : 'BLOCK', risks: [trusted ? 'NAVIGATION' : 'UNKNOWN'], llmDisagreement: false,
    reasons: [trusted ? 'Unique native reversible navigation control; goal-specific route grounding is still required.' : 'Unproven native route control.'] };
}
