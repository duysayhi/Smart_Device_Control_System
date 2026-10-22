import { commandMask, foldIntent } from './agent/outcome-spec';
import type { Action, ActionPlan } from '../validators/action-plan.schema';
import { decidePermission } from './agent/permission-decision';

const excluded = /\b(delet\w*|eras\w*|wip\w*|uninstall\w*|remov\w*|reset\w*|format\w*|overwrit\w*|replac\w*|purge\w*|trash\w*|discard\w*|clear (?:all|app|data|cache|storage)|factory|purchase\w*|payment\w*|buy|checkout|password|passcode|change pin|grant permission|revoke permission|xoa|go bo|go cai dat|don dep|lam rong|ghi de|thay the|khoi phuc|dat lai|mat khau|doi ma pin|thanh toan|mua hang|cap quyen|thu hoi quyen)\b/;
export const forbiddenSource = (source: string) => excluded.test(commandMask(source).replace(/[_:/.-]+/g, ' '));
export const forbiddenControl = (label: string) => {
  const words = foldIntent(label.replace(/([a-z])([A-Z])/g, '$1 $2')).replace(/[_:/.-]+/g, ' ');
  return excluded.test(words);
};
export const forbiddenDispatchControl = (label: string) => forbiddenControl(label) || /\b(send|call|gui|goi|publish|post|dang bai|accept permission|allow permission)\b/.test(foldIntent(label).replace(/[_:/.-]+/g, ' '));
export function assertSafeSource(source: string) {
  if (source.length > 2000 || decidePermission({ source, stage: 'REQUEST' }).decision === 'DENY') throw Error('HARD_BLOCKED: excluded destructive/security/purchase request; no device effect.');
}
export function assertSafeAction(action: Action) {
  if ((action.type === 'CLICK' || action.type === 'WAIT_FOR') && forbiddenDispatchControl(action.target)) throw Error('HARD_BLOCKED: excluded control; no device effect.');
}
export function assertSafePlan(source: string, plan: ActionPlan) {
  assertSafeSource(source);
  for (const action of plan.actions) assertSafeAction(action);
}
