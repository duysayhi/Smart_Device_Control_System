import { z } from 'zod';
import { maximalValueSpan } from './source-value';
import { IntentBindingSchema } from './intent-schema';
import { enterSearchBoundary, politeWords, trimValueSyntax } from './natural-phrasing';
import { parseTemporal, TemporalRequestSchema } from './temporal-contract';
import { matchReadStateSource } from './intent-capabilities';
import { BrowserResultSchema, browserResultRequest, browserResultDescriptor } from './browser-result-contract';

export const OutcomeKind = z.enum(['LAUNCH', 'NAVIGATE', 'SEARCH', 'OPEN_RESULT', 'CALCULATE', 'CREATE_RECORD', 'CAPTURE_MEDIA', 'SET_STATE', 'SET_STRUCTURED_STATE', 'ALARM', 'TIMER', 'FIND_ARTIFACT', 'INTENT', 'UNKNOWN']);
export const OutcomeV2Schema = z.object({
  id: z.string().min(1), kind: OutcomeKind, span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string().min(1) }).strict(),
  app: z.string().min(1).max(150).optional(), value: z.string().max(1000), negated: z.boolean(),
  semanticIntent: z.enum(['SEND_MESSAGE', 'DELETE_DATA', 'UNINSTALL_APP', 'PLAY_MEDIA', 'AMBIGUOUS_REFERENCE', 'UNSUPPORTED']).optional(),
  effect: z.enum(['READ', 'LOCAL_WRITE', 'SENSITIVE', 'UNKNOWN']), ambiguity: z.array(z.string()).max(8),
  intent: IntentBindingSchema.optional(),
  temporal: TemporalRequestSchema.optional(),
  browserResult: BrowserResultSchema.optional(),
}).strict();
export const OutcomeSpecV2Schema = z.object({ version: z.literal(2), request: z.string().min(1).max(2000), outcomes: z.array(OutcomeV2Schema).min(1).max(16) }).strict();
export type OutcomeV2 = z.infer<typeof OutcomeV2Schema>;
export type OutcomeSpecV2 = z.infer<typeof OutcomeSpecV2Schema>;
const reviewed = new WeakMap<OutcomeSpecV2, string>();
// Called only after constrained proposal validation and explicit human interpretation approval.
export function registerReviewedOutcomes(spec: OutcomeSpecV2): void { reviewed.set(spec, JSON.stringify(spec)); }
export const foldIntent = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

// Mask quoted content without changing offsets: values are data, not instructions.
export function commandMask(request: string): string {
  let quote = '', escaped = false;
  const chars = Array.from(request);
  return chars.map((char, index) => {
    if (escaped) { escaped = false; return quote ? ' '.repeat(char.length) : char; }
    if (char === '\\' && quote) { escaped = true; return ' '; }
    if (quote) { if (char === quote || quote === '\u201c' && char === '\u201d') quote = ''; return ' '.repeat(char.length); }
    if (char === "'" && /\p{L}/u.test(chars[index - 1] ?? '') && /\p{L}/u.test(chars[index + 1] ?? '')) return char;
    if (['"', "'", '\u201c'].includes(char)) { quote = char; return ' '; }
    return foldIntent(char);
  }).join('');
}

export function sourceClauseSpans(request: string): { start: number; end: number; text: string }[] {
  const mask = commandMask(request), spans: { start: number; end: number; text: string }[] = [];
  const verbs = '(?:open|launch|start|bring up|visit|show|view|see|read|check|tell me|what is|what\'s|how much|is|kiem tra|biet|search|find|look for|loc|do|lookup|calculate|compute|work out|create|add|save|capture|take|set|delete|erase|uninstall|send|share|play|mo|khoi chay|chon|xem|doc|di den|tim|tra cuu|tinh|tao|them|luu|chup|dat|cai(?=\\s+(?:dat\\s+)?bao thuc\\b)|bat|tat|xoa|gui|dang|chia se|thanh toan|ket noi|phat)';
  const boundary = new RegExp('(?:(?:[,;!?]\\s*|\\.\\s+)(?:(?:and|then|but|va|roi|sau do|tiep theo|nhung)\\s+)*|\\s+(?:and|then|but|va|roi|sau do|tiep theo|nhung)\\s+)(?=(?:(?:' + politeWords + ')\\s+)*(?:(?:do not|don\'t|never|khong(?: duoc)?|dung)\\s+)?' + verbs + '\\b)', 'g');
  const add = (start: number, end: number) => {
    while (start < end && /\s/.test(request[start])) start++;
    while (end > start && /\s/.test(request[end - 1])) end--;
    // Only unquoted sentence punctuation is syntax, not part of the user's value.
    while (end > start && /[.!?]/.test(mask[end - 1])) end--;
    while (end > start && /\s/.test(request[end - 1])) end--;
    if (end > start) {
      const compound = enterSearchBoundary(mask.slice(start, end));
      if (compound) {
        spans.push({ start, end: start + compound.end, text: request.slice(start, start + compound.end) });
        start += compound.next;
      }
      spans.push({ start, end, text: request.slice(start, end) });
    }
  };
  let start = 0;
  for (const m of mask.matchAll(boundary)) {
    // English "do a ..." is not the Vietnamese search verb "do/dò".
    // Preserve an unresolved compound rather than accepting it as a new search.
    if (/^do\s/.test(mask.slice(m.index! + m[0].length)) && !/\b(?:roi|sau do)\s+$/.test(m[0])) continue;
    add(start, m.index!); start = m.index! + m[0].length;
  }
  add(start, request.length); return spans;
}

export function understandOutcomes(request: string): OutcomeSpecV2 { return parseOutcomes(request, true); }
function parseOutcomes(request: string, generalized: boolean): OutcomeSpecV2 {
  request = request.normalize('NFC').trim();
  if (!request || request.length > 2000) throw new Error('Invalid V2 request.');
  let spans = sourceClauseSpans(request);
  if (!generalized) {
    // V1's existing result/playback planner owns these phrases; preserve its boundary contract.
    const verbs = '(?:(?:khong(?: duoc)?|dung)\\s+)?(?:mo|khoi chay|open|launch|tim(?: kiem)?|search|tra cuu|chon|xem|doc|di den|tinh|calculate|tao|them|luu|dat|cai(?=\\s+(?:dat\\s+)?bao thuc\\b)|chup|capture|bat|tat|gui|xoa|dang|chia se|thanh toan|ket noi)';
    const boundaries = new RegExp(`(?:^|[,;.!?]\\s*|\\s+(?:va|roi|sau do|tiep theo|and|then)\\s+)(?=${verbs}\\b)`, 'g'), starts = [0];
    for (const m of commandMask(request).matchAll(boundaries)) { const start = m.index! + m[0].length; if (start && !starts.includes(start)) starts.push(start); }
    spans = starts.map((start, i) => {
      const source = request.slice(start, starts[i + 1] ?? request.length), text = source.replace(/(?:[,;.!?]\s*|\s+(?:và|va|rồi|roi|sau đó|sau do|and|then)\s*)$/i, '').trim();
      start += source.indexOf(text); return { start, end: start + text.length, text };
    });
  }
  const outcomes = spans.map(({ start, end, text }, index): OutcomeV2 => {
    const normalized = foldIntent(text);
    const polite = generalized ? new RegExp('^(?:(?:' + politeWords + ')\\s+)*').exec(commandMask(text))![0].length : 0;
    const withoutCourtesy = normalized.slice(polite), negated = /^(khong(?: duoc)?|dung|do not|don't|never)\s/.test(withoutCourtesy);
    const command = withoutCourtesy.replace(/^(khong(?: duoc)?|dung|do not|don't|never)\s+/, '');
    const read = generalized ? matchReadStateSource(text) : undefined;
    if (read) return { id: `outcome-${index + 1}`, kind: 'INTENT', span: { start, end, text }, value: text,
      negated: false, effect: 'READ', ambiguity: [], intent: read };
    const time = generalized ? parseTemporal(command) : undefined;
    if (time && !/^(?:dat|tao|them)\s+bao thuc\s+(?:0\d|1\d|2[0-3]):[0-5]\d$/.test(command)) return {
      id: `outcome-${index + 1}`, kind: time.kind, span: { start, end, text }, value: text, negated, effect: 'LOCAL_WRITE',
      ambiguity: time.issue ? [time.issue] : [], ...(time.request ? { temporal: time.request } : {}),
    };
    const match = command.match(/^(mo|khoi chay|open|launch|tim kiem|tim|search|tra cuu|chon|xem|doc|di den|tinh|calculate|tao|them|luu|dat|chup|capture|take|bat|tat)\s+(.+)$/);
    let kind: OutcomeV2['kind'] = 'UNKNOWN';
    if (match) {
      const verb = match[1];
      kind = /^(mo|khoi chay|open|launch)$/.test(verb) ? 'LAUNCH' : /^(tinh|calculate)$/.test(verb) ? 'CALCULATE' :
        /^(tao|them|luu|dat)$/.test(verb) ? 'CREATE_RECORD' : /^(chup|capture|take)$/.test(verb) ? 'CAPTURE_MEDIA' :
        /^(bat|tat)$/.test(verb) ? 'SET_STATE' : /^(tim|tim kiem|search|tra cuu)$/.test(verb) ? 'SEARCH' : 'NAVIGATE';
      if (kind === 'SEARCH' && /\b(vua|anh do|tep do|artifact|record)\b/.test(match[2])) kind = 'FIND_ARTIFACT';
      if (kind === 'LAUNCH' && /^(muc|trang|tab|page|section)\s/.test(match[2])) kind = 'NAVIGATE';
      if (kind === 'CREATE_RECORD' && /^(?:bao thuc|alarm)\s/.test(match[2])) kind = 'SET_STRUCTURED_STATE';
    }
    const prefixLength = match ? normalized.indexOf(match[2]) : 0;
    let value = match ? text.slice(prefixLength).replace(/[.!?]+$/, '').trim().replace(/^(?:ứng dụng|ung dung)\s+/i, '') : text;
    let explicitApp: string | undefined;
    if (generalized && kind === 'LAUNCH') {
      const bounds = trimValueSyntax(text, commandMask(text), prefixLength, text.length, false);
      value = text.slice(bounds.start, bounds.end).replace(/^(?:ứng dụng|ung dung|app(?:lication)?|the)\s+/i, '');
    }
    if (generalized && ['SEARCH', 'CREATE_RECORD'].includes(kind)) {
      const span = maximalValueSpan(text, commandMask(text), kind);
      if (span) value = text.slice(span.start, span.end);
    }
    if (generalized && kind === 'SEARCH' && !/["'\u201c]/.test(value)) {
      const qualified = /^(?:in|on|trong|tren)\s+(.+?)\s+(?:for|ve|voi tu khoa|tu khoa|noi dung)\s+(.+)$/.exec(commandMask(value));
      if (qualified) {
        const appStart = qualified[0].indexOf(qualified[1]), queryStart = qualified[0].lastIndexOf(qualified[2]);
        explicitApp = value.slice(appStart, appStart + qualified[1].length); value = value.slice(queryStart);
      }
    }
    if (generalized && kind === 'SEARCH') {
      const qualified = /^("[^"\r\n]*"|'[^'\r\n]*'|“[^”]*”)\s+(?:in|on|trong|trên|tren)\s+(.+)$/i.exec(value);
      if (qualified) { value = qualified[1]; explicitApp = qualified[2]; }
    }
    const ambiguity = kind === 'UNKNOWN' ? ['UNSUPPORTED_OUTCOME'] : [];
    if (generalized && kind === 'SEARCH' && !explicitApp && /\s+(?:in|on|trong|tren)\s+\S/.test(commandMask(value))) ambiguity.push('AMBIGUOUS_QUERY_APPLICATION_BOUNDARY');
    if (kind === 'LAUNCH' && /\b(va|roi|sau do|and|then)\b/.test(commandMask(value))) ambiguity.push('UNPARSED_COMPOUND');
    return { id: `outcome-${index + 1}`, kind, span: { start, end, text }, ...(kind === 'LAUNCH' ? { app: value.replace(/^["']|["']$/g, '') } : explicitApp ? { app: explicitApp } : {}), value, negated,
      effect: ['CREATE_RECORD', 'CAPTURE_MEDIA', 'SET_STATE', 'SET_STRUCTURED_STATE'].includes(kind) ? 'LOCAL_WRITE' : kind === 'UNKNOWN' ? 'UNKNOWN' : 'READ', ambiguity };
  });
  if (generalized) {
    const result = browserResultRequest(request);
    if (result && outcomes.length === 3 && outcomes[0].kind === 'LAUNCH' && browserResultDescriptor.applications.includes(foldIntent(outcomes[0].app ?? '')) &&
      outcomes[1].kind === 'SEARCH' && outcomes[1].value === result.query && !outcomes.some(o => o.negated || o.ambiguity.length)) {
      outcomes[2] = { ...outcomes[2], kind: 'OPEN_RESULT', app: outcomes[0].app, effect: 'READ', browserResult: result };
    }
  }
  return OutcomeSpecV2Schema.parse({ version: 2, request, outcomes });
}

export function validateOutcomeSpans(spec: OutcomeSpecV2): void {
  const approved = reviewed.get(spec) === JSON.stringify(spec);
  spec = OutcomeSpecV2Schema.parse(spec);
  let end = 0;
  for (const outcome of spec.outcomes) {
    if (outcome.span.start < end || spec.request.slice(outcome.span.start, outcome.span.end) !== outcome.span.text) throw new Error('Outcome source spans do not match the original request.');
    end = outcome.span.end;
  }
  const parsed = understandOutcomes(spec.request);
  if (approved) return;
  if (JSON.stringify(parsed.outcomes) !== JSON.stringify(spec.outcomes)) throw new Error('Requested outcome coverage, application or parameter binding changed.');
}

export function assertLegacyCoverage(request: string, operation: string, app?: string): void {
  const outcomes = parseOutcomes(request, false).outcomes;
  if (outcomes.some(o => o.negated || ['CALCULATE', 'CREATE_RECORD', 'CAPTURE_MEDIA', 'SET_STATE', 'SET_STRUCTURED_STATE', 'FIND_ARTIFACT'].includes(o.kind))) throw new Error('UNSUPPORTED_OUTCOME: legacy goal cannot discard requested effects; use Agent V2.');
  if (outcomes.length > 1 && outcomes.some(o => o.kind === 'UNKNOWN')) throw new Error('Additional outcomes are not supported by native read navigation.');
  if (operation === 'OPEN_APP' && outcomes.some(o => o.kind !== 'LAUNCH' || o.ambiguity.length)) throw new Error('UNSUPPORTED_OUTCOME: OPEN_APP does not cover the full request.');
  if (operation === 'OPEN_APP' && app && /\b(tinh|calculate|tao|them|luu|chup|capture|dat|tim|search|chon|xem|gui|send|xoa|delete)\s+\S/.test(legacyActionWords(request, app, []))) throw new Error('UNSUPPORTED_OUTCOME: additional requested action cannot become OPEN_APP.');
}

export function legacyActionWords(request: string, app: string, values: string[]): string {
  let text = commandMask(request);
  for (const value of [app, ...values].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = foldIntent(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(^|\\s)${escaped}(?=$|[\\s,.])`, 'g'), ' ');
  }
  return text;
}

export function requestRequiresPlayback(request: string, values: string[] = []): boolean {
  return /\b(phat|play)\s+video\b/.test(legacyActionWords(request, '', values));
}
