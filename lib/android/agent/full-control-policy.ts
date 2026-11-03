import { assertOwnerTestExecution, type OwnerTestExecution } from './owner-test-policy';
import { commandMask } from './outcome-spec';

export { SettingName, SettingMutation } from './setting-schema';
export function fullControlHardBlock(source: string): boolean {
  const text = commandMask(source);
  return /\b(delet\w*|eras\w*|wip\w*|uninstall\w*|remov\w*|reset\w*|format\w*|overwrit\w*|replac\w*|clear\w*|purge\w*|trash\w*|empty\w*|discard\w*|get rid of|free (?:up )?storage|clean (?:up|out)|xoa|go bo|go cai dat|don dep|lam rong|ghi de|thay the|khoi phuc|dat lai)\b/.test(text) ||
    /\b(password|passcode|(?:change|set|reset|doi|dat) (?:the )?pin|screen lock|lock settings|account removal|purchase|payment|buy|checkout|grant permission|revoke permission|developer|debugging|mat khau|ma khoa|ma pin|thanh toan|cap quyen|thu hoi quyen|nha phat trien)\b/.test(text) ||
    /(?:^|[,;!?]\s*|\b(?:va|roi|sau do|and|then)\s+)(?:(?:hay|vui long|please)\s+)?mua(?:\s|$)/.test(text);
}
export function assertFullControl(scope: OwnerTestExecution | undefined, deviceId: string, physicalId: string, executionId: string, source: string, effect = 'REVERSIBLE_SETTING') {
  if (fullControlHardBlock(source)) throw Error('HARD_BLOCKED: excluded destructive/security/external operation.');
  if (!scope?.fullControl || !scope.fullControl.effects.includes(effect as 'REVERSIBLE_SETTING')) throw Error('SAFE_BLOCKED: device-scoped full-control effect not enabled.');
  assertOwnerTestExecution(scope, deviceId, physicalId, executionId);
}
export function designatedRecipient(number: string): boolean {
  const configured = process.env.AGENT_V2_TEST_RECIPIENT;
  return Boolean(configured && /^\+?\d{5,15}$/.test(configured) && number === configured);
}
