import type { Observation } from '../state-observer';
import { visibleNode } from './navigation-semantics';

export const normalizeMathDisplay = (value: string) => value.replace(/\s/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
export const mathControlValue = (row: { text?: string; label: string }) => /^[\d.+*/()×÷−=\-]$/.test(row.text?.trim() ?? '') ? row.text!.trim() : row.label.trim();

export function normalizeObservedExpression(value: string, snapshot: Observation): string {
  let normalized = value.normalize('NFC');
  const keys = snapshot.nodes.filter(row => visibleNode(snapshot, row) && row.clickable && /Button/.test(row.className));
  for (const key of keys) {
    const symbol = normalizeMathDisplay(key.text), spoken = key.description.normalize('NFC').trim();
    if (!/^[+*/()\-]$/.test(symbol) || !spoken || spoken.length > 40 || !/^[\p{L} ]+$/u.test(spoken) || keys.filter(row => row.description === key.description).length !== 1) continue;
    const escaped = spoken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, 'giu'), (_, prefix) => prefix + symbol);
  }
  return normalizeMathDisplay(normalized);
}

// A numeric result elsewhere on the screen cannot establish the entered expression.
export function observedMathExpression(snapshot: Observation): string | undefined {
  const fields = snapshot.nodes.filter(row => visibleNode(snapshot, row) &&
    /(?:expression|formula|input)(?:_|$)/i.test(row.resourceId.split('/').at(-1) ?? '') &&
    /TextView|EditText/.test(row.className) && /^[\d.+*/()\-]*$/.test(normalizeObservedExpression(row.text, snapshot)));
  return fields.length === 1 ? normalizeObservedExpression(fields[0].text, snapshot) : undefined;
}

export function keypadTransition(expression: string, entered: string, snapshot: Observation): { key: string; before: string; after: string } | undefined {
  const expected = normalizeMathDisplay(expression), observed = observedMathExpression(snapshot);
  if (!expected.startsWith(entered) || entered.length >= expected.length || observed === undefined) return;
  if (entered ? observed !== entered : observed !== '' && observed !== '0') return;
  const key = expected[entered.length];
  return { key, before: observed, after: entered + key };
}

export function observedLocalizedResult(snapshot: Observation, value: string, locale: string): boolean {
  let formatted: string;
  try { formatted = new Intl.NumberFormat(Intl.getCanonicalLocales(locale)[0], { maximumFractionDigits: 12 }).format(Number(value)); }
  catch { return false; }
  const fields = snapshot.nodes.filter(row => visibleNode(snapshot, row) && /TextView|EditText/.test(row.className) && /(?:expression|formula|result)(?:_|$)/i.test(row.resourceId.split('/').at(-1) ?? ''));
  const matches = fields.filter(row => {
    const text = row.text.normalize('NFC').trim();
    return text === formatted || text.startsWith(formatted + ' ') && /^[\p{L}\p{M}\s]+$/u.test(text.slice(formatted.length).trim());
  });
  return matches.length === 1;
}
