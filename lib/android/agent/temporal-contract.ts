import { z } from 'zod';

const zone = z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Invalid IANA time zone');
export const TemporalRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALARM'), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), zone: zone.optional(), clock: z.literal('DEVICE_LOCAL'), enabled: z.literal(true) }).strict(),
  z.object({ kind: z.literal('TIMER'), seconds: z.number().int().min(1).max(86400), start: z.literal(true) }).strict(),
]);
export type TemporalRequest = z.infer<typeof TemporalRequestSchema>;
export type TemporalParse = { request?: TemporalRequest; issue?: 'AM_PM_REQUIRED' | 'INVALID_TIME' | 'INVALID_DURATION' | 'UNSUPPORTED_TEMPORAL_QUALIFIER'; kind: TemporalRequest['kind'] };
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u0111\u0110]/g, 'd').toLowerCase().trim();

// Source-exact grammar produces a typed contract, not an executable UI script.
export function parseTemporal(source: string): TemporalParse | undefined {
  const s = fold(source).replace(/[.!?]+$/, '').replace(/^(?:please|hay|vui long)\s+/, '');
  const alarm = /^(?:(?:dat|cai(?:\s+dat)?|tao|them|set|create|add)\s+(?:an?\s+)?)?(?:bao thuc|alarm)\s+(?:(?:for|at|luc|vao)\s+)?(.+)$/.exec(s);
  if (alarm) {
    let value = alarm[1], timeZone: string | undefined;
    const suffix = /\s+(?:timezone|mui gio)\s+([a-z_]+\/[a-z_]+(?:\/[a-z_]+)?)$/i.exec(value);
    if (suffix) {
      const original = source.slice(source.toLowerCase().lastIndexOf(suffix[1]));
      timeZone = original.trim(); value = value.slice(0, suffix.index);
    }
    value = value.replace(/^(\d{1,2})\s+(?:gio\s+)?ruoi(?=\s|$)/, '$1:30');
    const m = /^(\d{1,2})(?:(?::|\s*(?:gio|hours?|h)\s*)(\d{1,2})?(?:\s*(?:phut|minutes?))?)?\s*(am|pm|sang|chieu|toi|trua)?$/.exec(value);
    if (!m) return { kind: 'ALARM', issue: 'UNSUPPORTED_TEMPORAL_QUALIFIER' };
    if (/:\D|:$/.test(value)) return { kind: 'ALARM', issue: 'INVALID_TIME' };
    let hour = Number(m[1]); const minute = Number(m[2] ?? 0), period = m[3];
    if (minute > 59 || hour > 23 || period && (hour < 1 || hour > 12)) return { kind: 'ALARM', issue: 'INVALID_TIME' };
    if (!period && hour >= 1 && hour <= 12 && !/^0\d/.test(m[1])) return { kind: 'ALARM', issue: 'AM_PM_REQUIRED' };
    if (period) hour = hour % 12 + (['pm', 'chieu', 'toi', 'trua'].includes(period) ? 12 : 0);
    const parsed = TemporalRequestSchema.safeParse({ kind: 'ALARM', hour, minute, clock: 'DEVICE_LOCAL', enabled: true, ...(timeZone ? { zone: timeZone } : {}) });
    return parsed.success ? { kind: 'ALARM', request: parsed.data } : { kind: 'ALARM', issue: 'INVALID_TIME' };
  }
  const timer = /^(?:hen gio|bao toi sau|(?:dat|bat dau|chay|start|set)\s+(?:(?:a|the)\s+)?(?:timer|bo dem nguoc|hen gio))\s+(?:for\s+)?(.+)$/.exec(s);
  if (!timer) return;
  const factors: Record<string, number> = { gio: 3600, hour: 3600, hours: 3600, h: 3600, phut: 60, minute: 60, minutes: 60, min: 60, mins: 60, giay: 1, second: 1, seconds: 1, sec: 1, s: 1 };
  const seen = new Set<number>(); let seconds = 0, end = 0;
  for (const m of timer[1].matchAll(/(\d+)\s*(hours?|minutes?|seconds?|mins?|sec|gio|phut|giay|h|s)\b/g)) {
    if (timer[1].slice(end, m.index).replace(/\b(?:and|va)\b/g, '').trim()) return { kind: 'TIMER', issue: 'INVALID_DURATION' };
    const factor = factors[m[2]];
    if (seen.has(factor)) return { kind: 'TIMER', issue: 'INVALID_DURATION' };
    seen.add(factor); seconds += Number(m[1]) * factor; end = m.index! + m[0].length;
  }
  if (!seen.size || timer[1].slice(end).trim()) return { kind: 'TIMER', issue: 'INVALID_DURATION' };
  const parsed = TemporalRequestSchema.safeParse({ kind: 'TIMER', seconds, start: true });
  return parsed.success ? { kind: 'TIMER', request: parsed.data } : { kind: 'TIMER', issue: 'INVALID_DURATION' };
}

export const temporalAction = (kind: TemporalRequest['kind'], show = false) => 'android.intent.action.' + (show ? kind === 'ALARM' ? 'SHOW_ALARMS' : 'SHOW_TIMERS' : kind === 'ALARM' ? 'SET_ALARM' : 'SET_TIMER');
export function temporalExtras(request: TemporalRequest, label: string): string[] {
  request = TemporalRequestSchema.parse(request);
  if (!/^PhoneCommander-[a-f0-9-]{36}$/.test(label)) throw Error('HARD_DENY: backend operation identity required.');
  const root = 'android.intent.extra.alarm.';
  return [...(request.kind === 'ALARM' ? ['--ei', root + 'HOUR', String(request.hour), '--ei', root + 'MINUTES', String(request.minute)] : ['--ei', root + 'LENGTH', String(request.seconds)]), '--es', root + 'MESSAGE', label, '--ez', root + 'SKIP_UI', 'false'];
}
