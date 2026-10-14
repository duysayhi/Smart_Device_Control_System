import type { Action, ActionPlan } from '../validators/action-plan.schema';
import type { UiNode } from './targets';
import { normalizeUiText } from './ui-understanding';
import { AndroidExecutionError } from './errors';
import { APP_PACKAGE_ALIASES } from './capabilities';

export type ActionRisk = 'NAVIGATION' | 'READ' | 'DATA_CHANGE' | 'SENSITIVE' | 'UNKNOWN';
export interface PolicyDecision {
  decision: 'ALLOW' | 'CONFIRM' | 'BLOCK';
  risks: ActionRisk[];
  reasons: string[];
  llmDisagreement: boolean;
}
export function isSensitiveControl(value: string): boolean {
  const normalized = normalizeUiText(value);
  return /(?:^|[\s/:.])(subscribe|subscribed|like|comment|delete|send|purchase|payment|login|sign in|dang ky|dang nhap|thanh toan|mua hang|xoa)(?:$|\s|button)/.test(normalized);
}
export function unsafeBrowserInput(text: string): boolean {
  const compact = text.trim().replace(/[\u0000-\u0020]/g, '');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(compact)) return false;
  if (!/^https?:\/\//i.test(compact)) return true;
  try { return isSensitiveControl(new URL(text.trim()).pathname); }
  catch { return true; }
}
export function assessPlanPolicy(plan: ActionPlan): PolicyDecision {
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
  if (/Switch|CheckBox|RadioButton|ToggleButton/.test(node.className) || isSensitiveControl(node.resourceId) ||
    isSensitiveControl(node.text) || isSensitiveControl(node.description)) throw new AndroidExecutionError('CONFIG_ERROR', 'Observed control changes data/account state or has sensitive semantics; no click was sent.');
}
