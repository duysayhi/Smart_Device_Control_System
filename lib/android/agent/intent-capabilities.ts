import { randomUUID } from 'node:crypto';
import { IntentRequestSchema, type IntentRequest, type IntentBinding } from './intent-schema';
import { sourceSlots } from './source-slots';
import { commandMask, foldIntent, sourceClauseSpans, OutcomeSpecV2Schema, type OutcomeSpecV2 } from './outcome-spec';
import { politeWords } from './natural-phrasing';

export interface IntentCapability {
  name: IntentRequest['name']; effect: 'READ_ONLY' | 'NON_PERSISTING' | 'PERSISTING';
  requiredGrants: readonly string[]; executor: 'ANDROID_INTENT' | 'READ_ONLY_ADB' | 'SYSTEM_SETTING'; verifier: string; implemented: boolean;
}
export const intentCapabilities: Readonly<Record<IntentRequest['name'], IntentCapability>> = Object.freeze({
  OPEN_APP: { name: 'OPEN_APP', effect: 'NON_PERSISTING', requiredGrants: ['SOURCE_BOUND', 'INSTALLED_APP', 'DEVICE_SESSION'], executor: 'ANDROID_INTENT', verifier: 'NATIVE_FOREGROUND_AND_RESUMED_ACTIVITY', implemented: true },
  OPEN_URL: { name: 'OPEN_URL', effect: 'NON_PERSISTING', requiredGrants: ['SOURCE_BOUND', 'RESOLVED_HANDLER', 'DEVICE_SESSION'], executor: 'ANDROID_INTENT', verifier: 'BROWSER_FOREGROUND_ACTIVITY_AND_URL_READBACK', implemented: true },
  OPEN_DIALER: { name: 'OPEN_DIALER', effect: 'NON_PERSISTING', requiredGrants: ['SOURCE_BOUND', 'DIAL_ONLY', 'DEVICE_SESSION'], executor: 'ANDROID_INTENT', verifier: 'DIALER_FOREGROUND_ACTIVITY_AND_NUMBER', implemented: true },
  OPEN_SETTINGS: { name: 'OPEN_SETTINGS', effect: 'NON_PERSISTING', requiredGrants: ['SOURCE_BOUND', 'SCREEN_ONLY', 'DEVICE_SESSION'], executor: 'ANDROID_INTENT', verifier: 'RESOLVED_SETTINGS_RESUMED_ACTIVITY', implemented: true },
  READ_STATE: { name: 'READ_STATE', effect: 'READ_ONLY', requiredGrants: ['SOURCE_BOUND', 'DEVICE_SESSION'], executor: 'READ_ONLY_ADB', verifier: 'TWO_INDEPENDENT_READ_PATHS_AGREE', implemented: true },
  COMPOSE_SMS: { name: 'COMPOSE_SMS', effect: 'PERSISTING', requiredGrants: ['SOURCE_BOUND', 'NO_SEND', 'PROVEN_NO_AUTO_DRAFT', 'DEVICE_SESSION'], executor: 'ANDROID_INTENT', verifier: 'COMPOSE_BODY_AND_PROVEN_NO_PERSISTENCE', implemented: false },
  SET_DEVICE_STATE: { name: 'SET_DEVICE_STATE', effect: 'PERSISTING', requiredGrants: ['SOURCE_BOUND', 'FULL_CONTROL', 'SINGLE_USE', 'PRE_POST_STATE', 'JOURNAL', 'EXACT_UNDO'], executor: 'SYSTEM_SETTING', verifier: 'INDEPENDENT_STATE_PAIR_AND_RESTORATION', implemented: true },
});
for (const contract of Object.values(intentCapabilities)) { Object.freeze(contract.requiredGrants); Object.freeze(contract); }
const scalar = (text: string) => text.startsWith('"') ? JSON.parse(text) as string : text;

const readStateAliases = {
  battery: ['battery', 'pin'], wifi: ['wi-fi', 'wi fi', 'wifi'], bluetooth: ['bluetooth'],
  brightness: ['brightness', 'screen brightness', 'do sang', 'do sang man hinh'],
  media_volume: ['media_volume', 'media volume', 'am luong media', 'am luong da phuong tien'],
  ring_volume: ['ring_volume', 'ring volume', 'ringtone volume', 'am luong chuong'],
  dnd: ['dnd', 'do not disturb', 'khong lam phien'], rotation: ['rotation', 'auto rotation', 'xoay man hinh'],
  flashlight: ['flashlight', 'torch', 'den pin'], airplane: ['airplane', 'airplane mode', 'che do may bay'],
} as const;

// Read bindings use a single whole-clause slot, independent of model value
// slots. Only this closed grammar can derive the enum from the exact source.
export function matchReadStateSource(text: string): IntentBinding | undefined {
  const command = foldIntent(text).replace(/[.!?]+$/, '').trim().replace(new RegExp('^(?:(?:' + politeWords + ')\\s+)+'), '');
  for (const [state, aliases] of Object.entries(readStateAliases)) {
    const label = '(?:' + [...aliases].sort((a, b) => b.length - a.length).join('|') + ')';
    const numeric = ['battery', 'brightness', 'media_volume', 'ring_volume'].includes(state);
    const status = '(?:status|state|trang thai)';
    const measure = numeric ? '(?:level|percentage|remaining|con bao nhieu|con lai bao nhieu|bao nhieu|muc|phan tram)' : '(?:on or off|enabled or disabled|dang bat hay tat|bat hay tat)';
    const subject = '(?:the )?(?:current |trang thai )?' + label;
    const tail = '(?: (?:' + status + '|' + measure + '))?(?: (?:now|currently|hien tai))?';
    const patterns = [
      '^(?:read|check|show(?: me)?|tell me|doc|kiem tra|xem|biet) ' + subject + tail + '$',
      '^(?:what is|what\'s) ' + subject + tail + '$',
      '^' + subject + ' (?:' + status + '|' + measure + ')(?: (?:now|currently|hien tai))?$',
    ];
    if (numeric) patterns.push('^how much ' + subject + '(?: (?:is )?(?:left|remaining))?$');
    else patterns.push(
      '^is ' + subject + ' (?:currently )?(?:on(?: or off)?|off|enabled(?: or disabled)?|disabled)$',
      '^(?:tell me|check) whether ' + subject + ' is (?:on or off|enabled or disabled)$',
      '^(?:(?:xem|biet|kiem tra) )?' + subject + ' co (?:dang )?bat khong$',
    );
    if (patterns.some(pattern => new RegExp(pattern).test(command))) {
      const parsed = IntentRequestSchema.parse({ name: 'READ_STATE', args: { state } });
      return { request: parsed, slots: { state: 1 } };
    }
  }
}

// Full-clause matching is deliberately closed. Unmatched language stays on the
// existing reviewed UI/discovery path; a value cannot absorb another action.
export function matchIntentSource(request: string, start: number, end: number): IntentBinding | undefined {
  const text = request.slice(start, end), folded = foldIntent(text);
  const read = matchReadStateSource(text);
  if (read) return read;
  if (/\b(delete|erase|wipe|uninstall|remove|reset|format|overwrite|send|call|xoa|gui|goi|ghi de|khong|never|don't|do not)\b/.test(commandMask(text))) return;
  const patterns: [IntentRequest['name'], RegExp, string[]][] = [
    ['OPEN_APP', /^(?:open(?: app)?|mo(?: ung dung)?) (\S+)$/, ['packageName']],
    ['OPEN_URL', /^(?:open url|mo url) ("[^"]+"|\S+)$/, ['url']],
    ['OPEN_DIALER', /^(?:open dialer|mo ban phim quay so) ("[^"]+"|\+?\d+)$/, ['number']],
    ['OPEN_SETTINGS', /^(?:open settings|mo man hinh cai dat) (\S+)$/, ['action']],
    ['COMPOSE_SMS', /^(?:compose sms|soan sms) (\+?\d+) ("[^"]+")$/, ['number', 'body']],
  ];
  let plan; try { plan = sourceSlots(text); } catch { return; }
  const clause = plan.clauses[0];
  if (plan.clauses.length !== 1) return;
  const setting = /^(?:set|dat) (wifi|bluetooth|dnd|rotation|brightness|media_volume|ring_volume|flashlight|airplane) (\d+)$/.exec(folded);
  if (setting) {
    const at = text.lastIndexOf(setting[2]), slot = clause.slots.find(s => s.start === at && s.end === text.length && !s.ambiguous);
    const parsed = IntentRequestSchema.safeParse({ name: 'SET_DEVICE_STATE', args: { state: setting[1], value: Number(setting[2]) } });
    if (slot && parsed.success) return { request: parsed.data, slots: { value: slot.id } };
    return;
  }
  for (const [name, regex, keys] of patterns) {
    const m = regex.exec(folded); if (!m) continue;
    // Folded matching selects the grammar only; values are reconstructed from
    // original source slots, never from normalized model output.
    const args: Record<string, string> = {}, slots: Record<string, number> = {};
    let cursor = 0;
    for (let i = 0; i < keys.length; i++) {
      const at = folded.indexOf(m[i + 1], cursor); cursor = at + m[i + 1].length;
      const candidates = clause.slots.filter(s => s.start === at && s.end === cursor && !s.ambiguous);
      if (candidates.length !== 1) return;
      args[keys[i]] = scalar(candidates[0].text); slots[keys[i]] = candidates[0].id;
    }
    const parsed = IntentRequestSchema.safeParse({ name, args });
    if (parsed.success) return { request: parsed.data, slots };
  }
}
export function proposeIntentOutcomes(request: string): OutcomeSpecV2 | undefined {
  if (request !== request.normalize('NFC').trim()) return;
  const clauses = sourceClauseSpans(request);
  if (!clauses.length || clauses.length > 12) return;
  const outcomes = [];
  for (const [index, c] of clauses.entries()) {
    let binding; try { binding = matchIntentSource(request, c.start, c.end); } catch { return; }
    if (!binding) return;
    outcomes.push({ id: 'outcome-' + (index + 1), kind: 'INTENT' as const, span: { start: c.start, end: c.end, text: c.text },
      value: c.text, negated: false, effect: binding.request.name === 'SET_DEVICE_STATE' ? 'LOCAL_WRITE' as const : 'READ' as const, ambiguity: [], intent: binding });
  }
  return OutcomeSpecV2Schema.parse({ version: 2, request, outcomes });
}

export interface IntentApproval { id: string; deviceId: string; executionId: string; physicalId: string; source: string; createdAt: number }
const approvals = new WeakMap<IntentApproval, string>();
export function approveIntentSource(source: string, deviceId: string, executionId: string, physicalId: string): IntentApproval {
  const approval = Object.freeze({ id: randomUUID(), deviceId, executionId, physicalId, source, createdAt: Date.now() });
  approvals.set(approval, JSON.stringify(approval)); return approval;
}
export function assertIntentApproval(approval: IntentApproval, deviceId: string, executionId: string, sourceSpan: { start: number; end: number }, binding: IntentBinding, allowJournaledSetting = false) {
  if (approvals.get(approval) !== JSON.stringify(approval) || approval.deviceId !== deviceId || approval.executionId !== executionId || Date.now() - approval.createdAt > 180000 || Date.now() < approval.createdAt ||
    JSON.stringify(matchIntentSource(approval.source, sourceSpan.start, sourceSpan.end)) !== JSON.stringify(binding)) throw Error('SAFE_BLOCKED: foreign, expired or non-source-bound intent approval.');
  const contract = intentCapabilities[binding.request.name];
  if (!contract.implemented || !contract.verifier || contract.effect === 'PERSISTING' && !(allowJournaledSetting && binding.request.name === 'SET_DEVICE_STATE')) throw Error('NOT_IMPLEMENTED: independent effect/verifier contract missing.');
}
