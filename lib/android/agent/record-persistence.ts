import { randomUUID, createHash } from 'node:crypto';
import type { Observation } from '../state-observer';
import { observedRecordIdentity, matchingRecordRows, recordListLabel, exactRecordFields, type RecordValues } from './record-forms';
import { observedAffordances } from './ui-affordances';
import { visibleNode } from './navigation-semantics';
import { isDescendant } from '../exploration/scroll-regions';

export type PersistenceStrategy = 'STABLE_DRAFT_ID' | 'POST_SAVE_ID' | 'EXACT_FIELDS_CREATED_AT';
export const recordPersistenceStrategies = Object.freeze([
  Object.freeze({ id: 'STABLE_DRAFT_ID', preconditions: 'Observed identity on new draft', disambiguation: 'Unique same ID list row', independentEvidence: 'Same ID and exact fields after reopen', resolve: resolveStable }),
  Object.freeze({ id: 'POST_SAVE_ID', preconditions: 'Explicit complete pre-create inventory', disambiguation: 'Exactly one new ID with requested label', independentEvidence: 'New ID and exact fields after reopen', resolve: resolveAfterSave }),
  Object.freeze({ id: 'EXACT_FIELDS_CREATED_AT', preconditions: 'Complete inventory; no matching record before creation', disambiguation: 'Exact full fields and explicit creation time within this operation', independentEvidence: 'Same fields/time after reopen; no title/latest-only match', resolve: resolveByFieldsAndTime }),
] as const);
export interface RecordDraftScope {
  id: string; deviceId: string; executionId: string; packageName: string; draft: Observation; baseline: Observation;
  fields: Readonly<RecordValues>; stableIdentity?: string; startedAt: number;
}
const scopes = new WeakMap<RecordDraftScope, string>();
const serial = (scope: RecordDraftScope) => JSON.stringify(scope);
const complete = (s: Observation) => s.nodes.some(n => visibleNode(s, n) && /^(?:record[- ]collection|record[- ]inventory):\s*complete$/i.test(n.description || n.text));
const ids = (s: Observation) => s.nodes.filter(n => visibleNode(s, n)).flatMap(n => {
  const m = (n.description || n.text).match(/^(?:record|item|note|alarm)[ _-]id:\s*([A-Za-z0-9][A-Za-z0-9._:-]{2,100})$/i); return m ? [m[1]] : [];
});
function rowMetadata(s: Observation, index: number): { fields: RecordValues; createdAt?: number } {
  const root = s.nodes[index], fields: RecordValues = {}; let createdAt: number | undefined;
  for (const n of s.nodes.filter(n => visibleNode(s, n) && (n === root || isDescendant(s.nodes, n, root)))) {
    const text = n.description || n.text, field = text.match(/^(title|body|hour|minute|enabled):\s*([\s\S]+)$/);
    if (field) { if (Object.hasOwn(fields, field[1])) return { fields: {} }; fields[field[1]] = field[1] === 'enabled' ? field[2] === 'true' ? true : field[2] === 'false' ? false : field[2] : field[2]; }
    const time = text.match(/^record-created-at:\s*(\d{13})$/);
    if (time) { if (createdAt !== undefined) return { fields: {} }; createdAt = Number(time[1]); }
  }
  return { fields, createdAt };
}
const fieldsEqual = (a: RecordValues, b: RecordValues) => Object.keys(b).every(key => a[key] === b[key]);
export function beginRecordDraft(baseline: Observation, draft: Observation, fields: RecordValues, executionId: string): RecordDraftScope | undefined {
  if (baseline.snapshotId === draft.snapshotId || baseline.timestamp > draft.timestamp || draft.timestamp - baseline.timestamp > 30000 ||
    [baseline, draft].some(s => s.observationStatus !== 'OBSERVED' || s.deviceSerial !== draft.deviceSerial || s.foregroundPackage !== draft.foregroundPackage) ||
    Date.now() - draft.timestamp > 5000 || draft.timestamp > Date.now() || baseline.nodes.some(n => /EditText/.test(n.className))) return;
  const stableIdentity = observedRecordIdentity(draft);
  if (stableIdentity && ids(baseline).includes(stableIdentity)) return;
  if (!stableIdentity && !complete(baseline)) return;
  // A complete baseline with a matching record cannot prove a unique new write by fields alone.
  if (!stableIdentity && baseline.nodes.some((_, i) => fieldsEqual(rowMetadata(baseline, i).fields, fields))) return;
  const scope = Object.freeze({ id: stableIdentity ?? 'draft:' + randomUUID(), deviceId: draft.deviceSerial, executionId, packageName: draft.foregroundPackage,
    baseline: structuredClone(baseline), draft: structuredClone(draft), fields: Object.freeze({ ...fields }), stableIdentity, startedAt: draft.timestamp });
  scopes.set(scope, serial(scope)); return scope;
}
export function validRecordDraft(scope: RecordDraftScope, snapshot: Observation, fields: RecordValues, executionId: string): boolean {
  return scopes.get(scope) === serial(scope) && scope.executionId === executionId && scope.deviceId === snapshot.deviceSerial && scope.packageName === snapshot.foregroundPackage &&
    snapshot.observationStatus === 'OBSERVED' && snapshot.timestamp >= scope.startedAt && snapshot.timestamp - scope.startedAt <= 120000 &&
    Date.now() - snapshot.timestamp >= 0 && Date.now() - snapshot.timestamp <= 5000 && fieldsEqual(scope.fields, fields) && fieldsEqual(fields, scope.fields);
}
export interface PersistenceMatch { identity: string; strategy: PersistenceStrategy; index: number; createdAt?: number }
export function resolvePersistedRecord(scope: RecordDraftScope, list: Observation, executionId: string): PersistenceMatch | undefined {
  if (!validRecordDraft(scope, list, scope.fields, executionId)) return;
  const matches = recordPersistenceStrategies.flatMap(strategy => {
    const match = strategy.resolve(scope, list, executionId); return match ? [match] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}
function resolveStable(scope: RecordDraftScope, list: Observation): PersistenceMatch | undefined {
  if (scope.stableIdentity) {
    const rows = matchingRecordRows(list, scope.stableIdentity, recordListLabel(scope.fields));
    return rows.length === 1 ? { identity: scope.stableIdentity, strategy: 'STABLE_DRAFT_ID', index: rows[0].index } : undefined;
  }
}
function newRecordRows(scope: RecordDraftScope, list: Observation, executionId: string) {
  const before = ids(scope.baseline);
  return observedAffordances(list, executionId, '').filter(row => row.enabled && !row.sensitive && !row.destructive && row.roles.includes('clickable') && row.text === recordListLabel(scope.fields) &&
    /^(?:record|item|note|alarm)[ _-]id:\s*(.+)$/i.test(row.label)).filter(row => !before.includes(row.label.match(/:\s*(.+)$/)![1]));
}
function resolveAfterSave(scope: RecordDraftScope, list: Observation, executionId: string): PersistenceMatch | undefined {
  if (scope.stableIdentity || !complete(list)) return;
  const newRows = newRecordRows(scope, list, executionId);
  if (newRows.length === 1) {
    const identity = newRows[0].label.match(/:\s*(.+)$/)![1];
    if (ids(list).filter(id => id === identity).length === 1) return { identity, strategy: 'POST_SAVE_ID', index: newRows[0].index };
  }
}
function resolveByFieldsAndTime(scope: RecordDraftScope, list: Observation, executionId: string): PersistenceMatch | undefined {
  if (scope.stableIdentity || !complete(list) || newRecordRows(scope, list, executionId).length) return;
  const exact = observedAffordances(list, executionId, '').filter(row => row.enabled && row.roles.includes('clickable') && !row.sensitive && !row.destructive).flatMap(row => {
    const data = rowMetadata(list, row.index);
    return fieldsEqual(data.fields, scope.fields) && data.createdAt !== undefined && data.createdAt >= scope.startedAt && data.createdAt <= list.timestamp ? [{ row, data }] : [];
  });
  if (exact.length !== 1) return;
  const { row, data } = exact[0];
  return { identity: 'fields-time:' + createHash('sha256').update(JSON.stringify([scope.deviceId, scope.packageName, scope.fields, data.createdAt])).digest('hex'), strategy: 'EXACT_FIELDS_CREATED_AT', index: row.index, createdAt: data.createdAt };
}
export function verifyPersistenceReadback(scope: RecordDraftScope, list: Observation, reopened: Observation, executionId: string): PersistenceMatch | undefined {
  const match = resolvePersistedRecord(scope, list, executionId);
  if (!match || !validRecordDraft(scope, reopened, scope.fields, executionId) || list.snapshotId === reopened.snapshotId || list.timestamp > reopened.timestamp || !exactRecordFields(reopened, scope.fields)) return;
  if (match.strategy !== 'EXACT_FIELDS_CREATED_AT') return observedRecordIdentity(reopened) === match.identity ? match : undefined;
  const times = reopened.nodes.filter(n => visibleNode(reopened, n) && (n.description || n.text) === 'record-created-at: ' + match.createdAt);
  return times.length === 1 && !observedRecordIdentity(reopened) ? match : undefined;
}
