import { decidePermission } from '../agent/permission-decision';
import { assertSafeSource } from '../safety-envelope';
import { planChromeCommand } from '../capabilities';
import { planWifiOff, planWifiOn, planWifiNavigation, planWifiConnection } from '../wifi-plan';
import { commandMask, sourceClauseSpans } from '../agent/outcome-spec';
import { EngineSelectionRemovedError, type PlanView } from './contracts';
import { requireDemoCapabilities } from './demo-catalog';

export function legacyRecipe(source: string) {
  const exactWifi = planWifiOff(source) ?? planWifiOn(source) ?? planWifiNavigation(source);
  if (exactWifi) return exactWifi;
  const wifi = planWifiConnection(source);
  // A free-form SSID cannot swallow a second requested action.
  if (wifi && (sourceClauseSpans(source).length > 1 && !planWifiNavigation(source) || /\b(?:va|roi|and|then)\s+(?:chup|tao|gui|mo|open|set|create)\b/.test(commandMask(source)))) return;
  if (wifi) return wifi;
  return sourceClauseSpans(source).length <= 2 ? planChromeCommand(source) : undefined;
}
export class UnifiedAdmissionError extends Error {
  constructor(readonly code: string, message: string) { super(code + ': ' + message); }
}
export function assertUnifiedSource(source: string) {
  try {
    assertSafeSource(source);
    if (decidePermission({ source, stage: 'REQUEST' }).decision === 'DENY') throw Error('DENY');
  } catch {
    throw new UnifiedAdmissionError('HARD_DENY', 'Yêu cầu bị từ chối toàn bộ vì có hành vi phá hủy dữ liệu hoặc nằm ngoài phạm vi an toàn.');
  }
}
export function routeCapability(source: string, backend?: string, removedEngine?: unknown): { engine: 'V2'; reason: string; catalog: PlanView['catalog'] } {
  assertUnifiedSource(source);
  if (removedEngine !== undefined) throw new EngineSelectionRemovedError();
  let capabilities;
  try { capabilities = requireDemoCapabilities(source); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('BLOCKED: UNSUPPORTED_PHRASING: ')) {
      throw new UnifiedAdmissionError('UNSUPPORTED_PHRASING', message.slice('BLOCKED: UNSUPPORTED_PHRASING: '.length));
    }
    const code = /CAPABILITY_DISABLED/.test(message) ? 'CAPABILITY_DISABLED' : /NEEDS_CLARIFICATION/.test(message) ? 'NEEDS_CLARIFICATION' : 'UNSUPPORTED_OUTCOME';
    throw new UnifiedAdmissionError(code, code === 'CAPABILITY_DISABLED' ? 'Chưa hỗ trợ trong danh mục demo. ' + message.replace(/^BLOCKED: CAPABILITY_DISABLED: /, '') : 'Yêu cầu ngoài danh mục hoặc chưa rõ nghĩa; hãy nêu rõ từng mục tiêu.');
  }
  if (backend !== undefined && backend !== 'appium') throw new UnifiedAdmissionError('BACKEND_UNSUPPORTED', 'V2 requires Appium; no backend fallback.');
  return { engine: 'V2', reason: 'Catalog allowlist -> V2 typed preparation; no alternate engine.', catalog: capabilities.map(row => ({
    capability: row.id, status: row.status === 'EXPERIMENTAL' ? 'EXPERIMENTAL' : 'ENABLED',
    label: row.status === 'EXPERIMENTAL' ? 'EXPERIMENTAL / UNVERIFIED: ' + row.label : row.label,
  })) };
}
