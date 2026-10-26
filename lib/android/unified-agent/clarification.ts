import { understandOutcomes } from '../agent/outcome-spec';
import { parseTemporal } from '../agent/temporal-contract';

export function alarmPeriodChoices(source: string) {
  const spec = understandOutcomes(source);
  const outcome = spec.outcomes.find(o => !o.negated && o.kind === 'ALARM' && o.ambiguity.length === 1 && o.ambiguity[0] === 'AM_PM_REQUIRED');
  if (!outcome) return;
  const text = outcome.span.text;
  const suffix = /\s+(?:timezone|mui gio|múi giờ)\s+\S+$/i.exec(text);
  const insertion = suffix?.index ?? text.length;
  const choices = (['am', 'pm'] as const).map(id => {
    const refined = text.slice(0, insertion) + ' ' + id.toUpperCase() + text.slice(insertion);
    const parsed = parseTemporal(refined);
    if (parsed?.request?.kind !== 'ALARM') return;
    const { hour, minute } = parsed.request;
    return { id, label: `${id === 'am' ? 'Buổi sáng' : 'Buổi chiều'} (${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')})`,
      source: spec.request.slice(0, outcome.span.start) + refined + spec.request.slice(outcome.span.end) };
  });
  if (!choices[0] || !choices[1]) return;
  return { question: 'Bạn muốn đặt báo thức vào buổi sáng hay buổi chiều?', choices: [choices[0], choices[1]] };
}
