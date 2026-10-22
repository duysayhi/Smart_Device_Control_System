import type { OutcomeV2 } from './outcome-spec';
import { foldIntent } from './outcome-spec';

export function requestedToggle(outcome: OutcomeV2): { label: string; checked: boolean } | undefined {
  if (outcome.kind !== 'SET_STATE' || outcome.negated || outcome.ambiguity.length) return;
  const match = foldIntent(outcome.span.text).match(/^(bat|tat|enable|disable)\s+(.+)$/);
  if (!match || !outcome.value.trim()) return;
  return { label: outcome.value.trim(), checked: match[1] === 'bat' || match[1] === 'enable' };
}
export function requestedPhoto(outcome: OutcomeV2): boolean {
  return outcome.kind === 'CAPTURE_MEDIA' && !outcome.negated && !outcome.ambiguity.length && /^(?:(?:mot|1|one|a)\s+)?(?:(?:tam|buc)\s+)?(?:anh|hinh|photo|picture|image)$/.test(foldIntent(outcome.value));
}
