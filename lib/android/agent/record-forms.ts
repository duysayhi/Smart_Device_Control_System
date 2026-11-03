import type { OutcomeV2 } from './outcome-spec';
import { foldIntent } from './outcome-spec';
import type { Observation } from '../state-observer';
import { observedAffordances, type ObservedAffordance } from './ui-affordances';
import { visibleNode } from './navigation-semantics';
import { validRecordDraft, resolvePersistedRecord, type RecordDraftScope } from './record-persistence';

export interface RecordValues { [field: string]: string | boolean }
export interface RecordState { phase: 'CREATE' | 'FIELD' | 'SAVE' | 'REOPEN'; field?: keyof RecordValues; identity?: string; draftScope?: RecordDraftScope }
export interface RecordStep { phase: RecordState['phase']; target: ObservedAffordance; value?: string; desired?: boolean; field?: string; identity?: string }
export function requestedRecord(outcome: OutcomeV2): RecordValues | undefined {
  if (outcome.negated || outcome.ambiguity.length) return;
  if (outcome.kind === 'SET_STRUCTURED_STATE') {
    const time = foldIntent(outcome.value).match(/^(?:bao thuc|alarm)\s+([01]?\d|2[0-3]):([0-5]\d)$/);
    return time ? { hour: time[1].padStart(2, '0'), minute: time[2], enabled: true } : undefined;
  }
  if (outcome.kind !== 'CREATE_RECORD') return;
  const match = outcome.value.match(/^(?:ghi chú|ghi chu|bản ghi|ban ghi|record|note)\s+(?:tên|ten|title)\s+(.+?),\s*(?:nội dung|noi dung|body)\s+(.+)$/iu);
  if (!match) return;
  const unquote = (text: string) => text.trim().replace(/^"([\s\S]*)"$/, '$1');
  const title = unquote(match[1]), body = unquote(match[2]);
  return title && body && title.length <= 160 && body.length <= 800 ? { title, body } : undefined;
}
export function observedRecordIdentity(snapshot: Observation): string | undefined {
  const ids = snapshot.nodes.filter(row => visibleNode(snapshot, row)).flatMap(row => {
    const match = (row.description || row.text).match(/^(?:record|item|note|alarm)[ _-]id:\s*([A-Za-z0-9][A-Za-z0-9._:-]{2,100})$/i);
    return match ? [match[1]] : [];
  });
  return ids.length === 1 ? ids[0] : undefined;
}
export function recordFieldRole(row: ObservedAffordance): keyof RecordValues | undefined {
  if (!row.roles.includes('editable') && !row.roles.includes('checkable')) return;
  const semantic = foldIntent([row.hint ?? '', row.resourceId.split('/').at(-1)?.replace(/[_-]/g, ' '), row.label === row.text ? '' : row.label].join(' '));
  const roles = [['title', /\b(title|subject|tieu de|ten)\b/], ['body', /\b(body|content|noi dung|description)\b/], ['hour', /\b(hour|gio)\b/], ['minute', /\b(minute|phut)\b/], ['enabled', /\b(enabled|active|kich hoat|bat)\b/]] as const;
  const matches = roles.filter(([key, pattern]) => pattern.test(semantic) && (key === 'enabled' ? row.roles.includes('checkable') : row.roles.includes('editable')));
  return matches.length === 1 ? matches[0][0] : undefined;
}
export const recordListLabel = (values: RecordValues) => typeof values.title === 'string' ? values.title : `${values.hour}:${values.minute}`;
export function verified24HourLayout(snapshot: Observation): boolean {
  const rows = snapshot.nodes.filter(row => visibleNode(snapshot, row));
  return rows.some(row => /\b24[ -]?(?:h|hour|gio)\b/.test(foldIntent([row.text, row.description, row.hint].join(' '))) && (!row.checkable || row.checked === true)) &&
    !rows.some(row => /^(am|pm|am\/pm)$/i.test((row.description || row.text).trim()));
}
export function matchingRecordRows(snapshot: Observation, identity: string, label: string, executionId = '', sessionId = '') {
  const matching = observedAffordances(snapshot, executionId, sessionId).filter(row => !row.sensitive && !row.destructive && row.roles.includes('clickable') && row.label.match(/^(?:record|item|note|alarm)[ _-]id:\s*(.+)$/i)?.[1] === identity);
  return matching.length === 1 && matching[0].text === label ? matching : [];
}
export function recordSteps(node: { outcome: OutcomeV2 }, state: RecordState, snapshot: Observation, executionId: string, sessionId: string): RecordStep[] {
  const values = requestedRecord(node.outcome);
  if (!values) return [];
  const rows = observedAffordances(snapshot, executionId, sessionId).filter(row => !row.sensitive && !row.destructive);
  const exactFields = (Object.keys(values) as (keyof RecordValues)[]).every(field => {
    const matches = rows.filter(row => recordFieldRole(row) === field); return matches.length === 1 && (typeof values[field] === 'boolean' ? matches[0].checked === values[field] : matches[0].text === values[field]);
  });
  if (state.phase === 'CREATE') return rows.filter(row => row.roles.includes('clickable') && /^(new|create|new record|create record|new note|tao moi|them moi)$/.test(foldIntent(row.label))).map(target => ({ phase: state.phase, target }));
  if (state.phase === 'REOPEN') {
    if (state.draftScope) {
      const match = resolvePersistedRecord(state.draftScope, snapshot, executionId), target = rows.find(row => row.index === match?.index);
      return target && match && match.identity === state.identity ? [{ phase: state.phase, target, identity: match.identity }] : [];
    }
    return matchingRecordRows(snapshot, state.identity ?? '', recordListLabel(values), executionId, sessionId).map(target => ({ phase: state.phase, target, identity: state.identity }));
  }
  if (!state.identity || (state.draftScope ? !validRecordDraft(state.draftScope, snapshot, values, executionId) || state.identity !== state.draftScope.id || observedRecordIdentity(snapshot) !== state.draftScope.stableIdentity : observedRecordIdentity(snapshot) !== state.identity)) return [];
  if (node.outcome.kind === 'SET_STRUCTURED_STATE' && !verified24HourLayout(snapshot)) return [];
  if (state.phase === 'FIELD' && state.field && Object.hasOwn(values, state.field)) return rows.filter(row => recordFieldRole(row) === state.field).map(target => ({ phase: state.phase, target, field: String(state.field), ...(typeof values[state.field!] === 'boolean' ? { desired: values[state.field!] as boolean } : { value: values[state.field!] as string }), identity: state.identity }));
  if (state.phase === 'SAVE' && exactFields) return rows.filter(row => row.roles.includes('save') && row.roles.includes('clickable')).map(target => ({ phase: state.phase, target, identity: state.identity }));
  return [];
}
export function exactRecordFields(snapshot: Observation, values: RecordValues): boolean {
  const rows = observedAffordances(snapshot, '', '');
  return (Object.keys(values) as (keyof RecordValues)[]).every(field => {
    const matches = rows.filter(row => recordFieldRole(row) === field); return matches.length === 1 && (typeof values[field] === 'boolean' ? matches[0].checked === values[field] : matches[0].text === values[field]);
  });
}
