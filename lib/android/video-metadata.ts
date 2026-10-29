import { normalizeUiText } from './ui-understanding';

// Exact accessibility duration fields only, never a numeric title prefix.
export function videoSeconds(text: string): number | undefined {
  const value = normalizeUiText(text);
  if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) {
    const parts = value.split(':').map(Number); if (parts.slice(1).some(n => n > 59)) return;
    return parts.reduce((a, b) => a * 60 + b, 0);
  }
  let total = 0, count = 0;
  const remaining = value.replace(/(\d+)\s*(hours?|gio|minutes?|phut|seconds?|giay)\b/g, (_m, n, unit) => {
    total += Number(n) * (/hour|gio/.test(unit) ? 3600 : /minute|phut/.test(unit) ? 60 : 1); count++; return '';
  }).replace(/[\s,]+/g, '');
  return count && !remaining ? total : undefined;
}
