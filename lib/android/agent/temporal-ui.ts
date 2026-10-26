import { createHash, randomUUID } from 'node:crypto';
import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { isDescendant } from '../exploration/scroll-regions';
import { observedAffordances, navigationLabel, type ObservedAffordance } from './ui-affordances';
import type { GoalNodeV2 } from './goal-graph';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import { foldIntent, understandOutcomes, type OutcomeV2 } from './outcome-spec';
import { isClarifiedTemporal } from './temporal-clarification';
import { TemporalRequestSchema, type TemporalRequest } from './temporal-contract';

export type TemporalUiPhase = 'CREATE' | 'HOUR' | 'MINUTE' | 'SECOND' | 'PERIOD' | 'LABEL' | 'COMMIT';
export interface AlarmUiRow { hour: number; minute: number; enabled: boolean; label: string }
export interface TemporalUiInventory {
  deviceId: string; packageName: string; sessionId: string; kind: TemporalRequest['kind']; zone: string;
  observedAt: number; monotonicMs: number; snapshots: string[]; rows: readonly AlarmUiRow[];
}
export interface TemporalUiProof {
  id: string; deviceId: string; executionId: string; nodeId: string; sessionId: string;
  kind: TemporalRequest['kind']; request: TemporalRequest; identity: string; label: string; zone: string;
  observedAt: number; tier: 'UI_LIST_READBACK' | 'UI_RUNNING_READBACK'; snapshots: string[];
  beforeRows: readonly AlarmUiRow[]; afterRows: readonly AlarmUiRow[]; remaining?: number[];
  systemCorroboration?: { tier: 'SYSTEM_STATE_READBACK'; time: string };
}
export interface TemporalUiScope {
  id: string; deviceId: string; executionId: string; nodeId: string; sessionId: string;
  request: TemporalRequest; label: string; baseline: TemporalUiInventory;
}
interface Flow { scope: TemporalUiScope; source: string; outcome: OutcomeV2; created: boolean; attempted: Set<string>; phase?: TemporalUiPhase; committedAt?: number; committedWall?: number; nameIndex?: number; format24?: string }
const inventories = new WeakMap<TemporalUiInventory, string>(), scopes = new WeakMap<TemporalUiScope, Flow>();
const proofs = new WeakMap<TemporalUiProof, string>();
const commitAttempts = new Map<string, number>();
const commitKey = (scope: Pick<TemporalUiScope, 'deviceId' | 'executionId' | 'nodeId'>) => JSON.stringify([scope.deviceId, scope.executionId, scope.nodeId]);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const issuedTemporalUiInventory = (v: TemporalUiInventory) => inventories.get(v) === digest(v);
export const isTemporalUiProof = (v: TemporalUiProof) => proofs.get(v) === digest(v);
export const freshTemporalUi = (s: Observation) => s.observationStatus === 'OBSERVED' && Date.now() >= s.timestamp && Date.now() - s.timestamp <= 5000 &&
  !s.nodes.some(n => n.displayed !== false && (/permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId) || /Dialog|ProgressBar/.test(n.className)));
const shown = (n: UiNode) => n.displayed !== false && n.bounds[2] > n.bounds[0] && n.bounds[3] > n.bounds[1];
const label = (n: Pick<UiNode, 'text' | 'description'>) => foldIntent(n.description || n.text).trim();
const units = { HOUR: /^(?:hours?|gio)$/, MINUTE: /^(?:minutes?|phut)$/, SECOND: /^(?:seconds?|giay)$/ };
export function pickerValue(text: string): number | undefined {
  const m = /^\s*(\d{1,2})(?:\s*,\s*(?:hours?|minutes?|seconds?|gio|phut|giay)\s*,?)?\s*$/.exec(foldIntent(text));
  return m ? Number(m[1]) : undefined;
}
export function pickerRole(s: Observation, index: number): 'HOUR' | 'MINUTE' | 'SECOND' | undefined {
  const node = s.nodes[index], parent = node?.parentIndex === undefined ? undefined : s.nodes[node.parentIndex];
  if (!node || !shown(node) || !/EditText/.test(node.className) || !parent || !/NumberPicker/.test(parent.className)) return;
  const tokens = [node.text.split(',')[1]?.trim() ?? '', node.description.split(',')[1]?.trim() ?? '', node.hint ?? ''];
  for (const [role, re] of Object.entries(units)) if (tokens.some(t => re.test(foldIntent(t)))) return role as keyof typeof units;
}
export function temporalTab(n: Pick<ObservedAffordance, 'label' | 'className'>, kind: TemporalRequest['kind']) {
  return /(?:\$Tab|\.Tab|TabWidget)$/.test(n.className) && (kind === 'ALARM' ? /^(alarm|alarms|bao thuc|chuong bao)$/ : /^(timer|timers|hen gio|dem gio|bo dem)$/).test(navigationLabel(n.label, n.className));
}
export function alarmRows(s: Observation): AlarmUiRow[] {
  if (!freshTemporalUi(s) || s.nodes.some(n => shown(n) && /EditText|TimePicker/.test(n.className))) throw Error('UI_LIST_UNREADABLE: not a fresh list.');
  const rows: AlarmUiRow[] = [];
  for (const toggle of s.nodes.filter(n => shown(n) && /(?:Switch|CheckBox|ToggleButton)$/.test(n.className))) {
    const parent = toggle.parentIndex === undefined ? undefined : s.nodes[toggle.parentIndex];
    if (!parent || !toggle.checkable || typeof toggle.checked !== 'boolean') throw Error('UI_LIST_UNREADABLE: switch state missing.');
    const children = s.nodes.filter(n => n !== toggle && shown(n) && isDescendant(s.nodes, n, parent));
    const times = children.filter(n => /TextView$/.test(n.className) && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(n.text.trim()));
    if (times.length !== 1) throw Error('UI_LIST_UNREADABLE: no unique row time.');
    const [hour, minute] = times[0].text.trim().split(':').map(Number);
    // 12-hour rows must expose AM/PM. A bare ambiguous value is never converted.
    const text = children.map(n => n.text + ' ' + n.description).join(' ');
    const am = /\b(?:AM|sang)\b/i.test(foldIntent(text)), pm = /\b(?:PM|chieu|toi)\b/i.test(foldIntent(text));
    if (am && pm) throw Error('UI_LIST_UNREADABLE: ambiguous row period.');
    const correlation = /PhoneCommander-[a-f0-9-]{36}/.exec(text)?.[0] ?? '';
    rows.push({ hour: am || pm ? hour % 12 + (pm ? 12 : 0) : hour, minute, enabled: toggle.checked, label: correlation });
  }
  return rows;
}
export function sealTemporalUiInventory(input: TemporalUiInventory): TemporalUiInventory {
  if (!input.snapshots.length || input.rows.length > 100 || Date.now() - input.observedAt < 0 || Date.now() - input.observedAt > 5000) throw Error('STALE_UI_INVENTORY');
  const value = Object.freeze({ ...input, rows: Object.freeze(input.rows.map(r => Object.freeze({ ...r }))), snapshots: [...input.snapshots] });
  inventories.set(value, digest(value)); return value;
}
export function temporalUiPrecondition(v: TemporalUiInventory, r: TemporalRequest) {
  if (!issuedTemporalUiInventory(v) || v.kind !== r.kind || Date.now() - v.observedAt < 0 || Date.now() - v.observedAt > 5000) throw Error('STALE_UI_INVENTORY');
  if (r.kind === 'ALARM' && r.zone && new Intl.DateTimeFormat('en', { timeZone: r.zone }).resolvedOptions().timeZone !== v.zone) throw Error('TIMEZONE_MISMATCH');
  if (r.kind === 'ALARM' && v.rows.some(row => row.hour === r.hour && row.minute === r.minute)) throw Error('ALARM_DUPLICATE_TIME: no existing alarm can be reused or toggled.');
}
const exactTemporalSource = (source: string, outcome: OutcomeV2, executionId: string) => typeof source === 'string' && (understandOutcomes(source).outcomes.some(o => JSON.stringify(o) === JSON.stringify(outcome)) || isClarifiedTemporal(source, outcome, executionId));
export function beginTemporalUi(node: GoalNodeV2, baseline: TemporalUiInventory, executionId: string, source: string): TemporalUiScope {
  const request = TemporalRequestSchema.parse(node.outcome.temporal); temporalUiPrecondition(baseline, request);
  if (!exactTemporalSource(source, node.outcome, executionId)) throw Error('HARD_DENY: temporal UI values are not source-bound.');
  for (const [key, expires] of commitAttempts) if (expires < Date.now()) commitAttempts.delete(key);
  if (commitAttempts.has(commitKey({ deviceId: baseline.deviceId, executionId, nodeId: node.id }))) throw Error('TEMPORAL_UI_COMMIT_ALREADY_ATTEMPTED: no new scope or replay.');
  if (node.packageName !== baseline.packageName || node.outcome.negated || node.outcome.ambiguity.length) throw Error('TEMPORAL_UI_SCOPE_MISMATCH');
  const scope = Object.freeze({ id: randomUUID(), deviceId: baseline.deviceId, executionId, nodeId: node.id, sessionId: baseline.sessionId, request: Object.freeze(request), label: 'PhoneCommander-' + randomUUID(), baseline });
  scopes.set(scope, { scope, source, outcome: structuredClone(node.outcome), created: request.kind === 'TIMER', attempted: new Set() }); return scope;
}
export function setTemporalUiPhase(scope: TemporalUiScope, phase: TemporalUiPhase) {
  const flow = scopes.get(scope); if (!flow || flow.committedAt || flow.attempted.has(phase)) throw Error('TEMPORAL_UI_REPLAY_BLOCKED');
  flow.phase = phase;
}
function formFields(scope: TemporalUiScope, s: Observation) {
  return observedAffordances(s, scope.executionId, scope.sessionId).filter(a => pickerRole(s, a.index));
}
export function temporalFormValues(scope: TemporalUiScope, s: Observation) {
  const fields = formFields(scope, s), read = (role: 'HOUR' | 'MINUTE' | 'SECOND') => {
    const matches = fields.filter(a => pickerRole(s, a.index) === role); return matches.length === 1 ? pickerValue(matches[0].text) : undefined;
  };
  return { hour: read('HOUR'), minute: read('MINUTE'), second: read('SECOND') };
}
function periodControls(scope: TemporalUiScope, s: Observation) {
  return observedAffordances(s, scope.executionId, scope.sessionId).filter(a => /^(am|pm|sang|chieu)$/i.test(foldIntent(a.label)) && (a.roles.includes('selectable') || a.roles.includes('checkable')));
}
export function alarmFormat(scope: TemporalUiScope, s: Observation): '12' | '24' | undefined {
  if (!s.nodes.some(n => shown(n) && /TimePicker$/.test(n.className))) return;
  const controls = periodControls(scope, s);
  if (controls.length === 2 && controls.filter(a => a.selected || a.checked).length === 1) return '12';
  // A wraparound neighbor exposes the actual picker range; absence of AM/PM alone is insufficient.
  const hour = formFields(scope, s).find(a => pickerRole(s, a.index) === 'HOUR');
  const signature = digest(formFields(scope, s).map(a => [a.className, a.resourceId, a.index, s.nodes[a.index].parentIndex, a.bounds]));
  const flow = scopes.get(scope);
  const parent = hour && s.nodes[hour.index].parentIndex;
  const values = s.nodes.filter(n => parent !== undefined && n.parentIndex === parent).map(n => pickerValue(n.text));
  if (!controls.length && values.some(v => v !== undefined && v >= 13 && v <= 23) && flow) flow.format24 = signature;
  if (!controls.length && flow?.format24 === signature) return '24';
}
function requestedHour(scope: TemporalUiScope, s: Observation) {
  if (scope.request.kind !== 'ALARM') return Math.floor(scope.request.seconds / 3600);
  const format = alarmFormat(scope, s);
  if (!format) throw Error('TIME_FORMAT_UNPROVEN: no observable 24h range or selected AM/PM; no time guessed.');
  return format === '12' ? scope.request.hour % 12 || 12 : scope.request.hour;
}
function timerPickerConsistent(scope: TemporalUiScope, s: Observation): boolean {
  if (scope.request.kind !== 'TIMER') return true;
  const fields = formFields(scope, s), values = temporalFormValues(scope, s);
  if (fields.length !== 3 || new Set(fields.map(a => pickerRole(s, a.index))).size !== 3) return false;
  // Composite accessibility values can expose uncommitted/stale editor text.
  const summaries = s.nodes.filter(n => shown(n) && fields.every(a => isDescendant(s.nodes, s.nodes[a.index], n)) && n.description.trim());
  for (const summary of summaries) {
    const match = /^(\d{1,2})\s*(?:hours?|gio)\s*,?\s*(\d{1,2})\s*(?:minutes?|phut)\s*,?\s*(\d{1,2})\s*(?:seconds?|giay)\s*,?$/.exec(foldIntent(summary.description).trim());
    if (match && (Number(match[1]) !== values.hour || Number(match[2]) !== values.minute || Number(match[3]) !== values.second)) return false;
  }
  return true;
}
export function temporalFormExact(scope: TemporalUiScope, s: Observation): boolean {
  const r = scope.request, v = temporalFormValues(scope, s);
  if (v.hour !== requestedHour(scope, s) || v.minute !== (r.kind === 'ALARM' ? r.minute : Math.floor(r.seconds % 3600 / 60))) return false;
  if (r.kind === 'TIMER') return v.second === r.seconds % 60 && timerPickerConsistent(scope, s);
  if (alarmFormat(scope, s) === '12') {
    const selected = periodControls(scope, s).filter(a => a.selected || a.checked);
    if (selected.length !== 1 || /^(pm|chieu)$/.test(foldIntent(selected[0].label)) !== (r.hour >= 12)) return false;
  }
  const names = observedAffordances(s, scope.executionId, scope.sessionId).filter(a => a.roles.includes('editable') && /^(alarm name|name|ten chuong bao|ten bao thuc)$/.test(foldIntent(a.hint || a.label)));
  // Once a name is populated, the hint/field role must remain observable.
  const nameIndex = scopes.get(scope)?.nameIndex;
  return names.length <= 1 && (nameIndex === undefined ? !names.length : s.nodes[nameIndex]?.text === scope.label);
}
export interface TemporalUiStep { target: ObservedAffordance; action: 'CLICK' | 'SET_VALUE'; value?: string; phase: TemporalUiPhase; scopeId: string }
const actionControl = (a: ObservedAffordance) => a.roles.includes('clickable') && !a.roles.includes('checkable') && !a.roles.includes('editable') && /Button$|TextView$|ViewGroup$|Layout$/.test(a.className);
export function temporalUiSteps(scope: TemporalUiScope, s: Observation): TemporalUiStep[] {
  const f = scopes.get(scope); if (!f || !f.phase || f.committedAt || f.attempted.has(f.phase) || !freshTemporalUi(s) || s.deviceSerial !== scope.deviceId || s.foregroundPackage !== scope.baseline.packageName) return [];
  const phase = f.phase, a = observedAffordances(s, scope.executionId, scope.sessionId);
  let targets: ObservedAffordance[] = [], value: string | undefined;
  if (phase === 'CREATE' && scope.request.kind === 'ALARM' && !f.created) targets = a.filter(a => actionControl(a) && /^(add alarm|new alarm|create alarm|them chuong bao|them bao thuc|tao bao thuc)$/.test(foldIntent(a.label)));
  else if (f.created) {
    if (['HOUR', 'MINUTE', 'SECOND'].includes(phase)) {
      targets = formFields(scope, s).filter(a => pickerRole(s, a.index) === phase);
      const r = scope.request;
      value = String(phase === 'HOUR' ? requestedHour(scope, s) : phase === 'MINUTE' ? r.kind === 'ALARM' ? r.minute : Math.floor(r.seconds % 3600 / 60) : r.kind === 'TIMER' ? r.seconds % 60 : NaN).padStart(2, '0');
      if (value === 'NaN') targets = [];
    } else if (phase === 'PERIOD' && scope.request.kind === 'ALARM' && alarmFormat(scope, s) === '12') {
      targets = periodControls(scope, s).filter(a => /^(pm|chieu)$/.test(foldIntent(a.label)) === (scope.request.kind === 'ALARM' && scope.request.hour >= 12));
    } else if (phase === 'LABEL' && scope.request.kind === 'ALARM') {
      targets = a.filter(a => a.roles.includes('editable') && /^(alarm name|name|ten chuong bao|ten bao thuc)$/.test(foldIntent(a.hint || a.label)) && (!a.text || a.text === a.hint)); value = scope.label;
    } else if (phase === 'COMMIT' && temporalFormExact(scope, s)) {
      targets = a.filter(a => actionControl(a) && (scope.request.kind === 'ALARM' ? /^(save|luu|done|xong|confirm|xac nhan)$/ : /^(start|bat dau)$/).test(foldIntent(a.label)));
    }
  }
  return targets.length === 1 ? [{ target: targets[0], action: value === undefined ? 'CLICK' : 'SET_VALUE', value, phase, scopeId: scope.id }] : [];
}
const candidateScopes = new WeakMap<GroundedCandidateV2, TemporalUiScope>();
export function bindTemporalUiCandidate(c: GroundedCandidateV2, scope: TemporalUiScope) { candidateScopes.set(c, scope); }
export function temporalUiCandidateAllowed(c: GroundedCandidateV2, node?: GoalNodeV2) {
  const scope = candidateScopes.get(c), flow = scope && scopes.get(scope);
  return Boolean(scope && flow && exactTemporalSource(flow.source, flow.outcome, scope.executionId) && c.temporal?.scopeId === scope.id && c.temporal.phase === flow.phase && !flow.attempted.has(flow.phase!) && !flow.committedAt &&
    c.nodeId === scope.nodeId && c.executionId === scope.executionId && c.deviceId === scope.deviceId && c.sessionId === scope.sessionId && (!node || JSON.stringify(node.outcome.temporal) === JSON.stringify(scope.request)));
}
export function beforeTemporalUiDispatch(c: GroundedCandidateV2, s: Observation) {
  const scope = candidateScopes.get(c);
  if (!scope || !temporalUiCandidateAllowed(c)) throw Error('TEMPORAL_UI_SCOPE_REVOKED_OR_REPLAYED');
  const matches = temporalUiSteps(scope, s).filter(step => step.phase === c.temporal?.phase && step.target.index === c.target.index && step.value === c.value && step.action === c.action);
  if (matches.length !== 1) throw Error('TEMPORAL_UI_FORM_CHANGED: no effect sent.');
  const f = scopes.get(scope)!; f.attempted.add(c.temporal!.phase);
  if (c.temporal!.phase === 'LABEL') f.nameIndex = c.target.index;
  if (c.temporal!.phase === 'COMMIT') {
    const key = commitKey(scope);
    if (commitAttempts.has(key) || commitAttempts.size >= 4096) throw Error('TEMPORAL_UI_COMMIT_ALREADY_ATTEMPTED: no replay.');
    commitAttempts.set(key, Date.now() + 86400000); f.committedAt = performance.now(); f.committedWall = Date.now();
  }
}
export function temporalUiAcknowledged(c: GroundedCandidateV2) {
  const scope = candidateScopes.get(c), f = scope && scopes.get(scope);
  if (f && c.temporal?.phase === 'CREATE') f.created = true;
}
export function temporalUiTransition(c: GroundedCandidateV2, s: Observation) {
  const scope = candidateScopes.get(c); if (!scope || !freshTemporalUi(s)) return false;
  if (c.temporal?.phase === 'COMMIT') return true; // Transition is NOT the independent outcome proof.
  if (c.temporal?.phase === 'CREATE') return s.nodes.some(n => shown(n) && /TimePicker$/.test(n.className));
  if (c.temporal?.phase === 'PERIOD' && scope.request.kind === 'ALARM') {
    const selected = periodControls(scope, s).filter(a => a.selected || a.checked);
    return selected.length === 1 && /^(pm|chieu)$/.test(foldIntent(selected[0].label)) === (scope.request.hour >= 12);
  }
  if (c.action === 'SET_VALUE') {
    if (c.temporal?.phase === 'LABEL') return s.nodes.some(n => /EditText/.test(n.className) && n.text === c.value);
    const matches = formFields(scope, s).filter(a => pickerRole(s, a.index) === c.temporal?.phase);
    return matches.length === 1 && pickerValue(matches[0].text) === Number(c.value) && timerPickerConsistent(scope, s);
  }
  return temporalFormExact(scope, s);
}
export function runningTimer(s: Observation): number | undefined {
  if (!freshTemporalUi(s) || s.nodes.some(n => shown(n) && /EditText|NumberPicker/.test(n.className))) return;
  if (!s.nodes.some(n => shown(n) && n.clickable && /^(pause|tam dung)$/i.test(label(n)))) return;
  const values = s.nodes.filter(n => shown(n) && !n.clickable && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(n.text.trim()))
    .map(n => n.text.trim().split(':').map(Number)).filter(p => p.slice(1).every(v => v < 60)).map(p => p.reduce((sum, v) => sum * 60 + v, 0));
  return values.length === 1 && values[0] > 0 ? values[0] : undefined;
}
export function alarmDeltaReason(before: readonly AlarmUiRow[], after: readonly AlarmUiRow[], r: TemporalRequest, correlation: string): string | undefined {
  if (r.kind !== 'ALARM') return 'WRONG_KIND';
  if (before.some(row => row.hour === r.hour && row.minute === r.minute)) return 'DUPLICATE_TIME';
  const added = after.filter(row => !before.some(old => old.hour === row.hour && old.minute === row.minute));
  if (added.length !== 1 || after.length !== before.length + 1) return 'NEW_ROW_COUNT_NOT_ONE';
  if (!before.every(old => after.filter(row => digest(row) === digest(old)).length === 1)) return 'OLD_ROW_CHANGED';
  if (added[0].hour !== r.hour || added[0].minute !== r.minute || !added[0].enabled) return 'NEW_ROW_VALUE_MISMATCH';
  if (added[0].label && added[0].label !== correlation) return 'CORRELATION_MISMATCH';
}
const timerReads = new WeakMap<Observation, { scope: TemporalUiScope; monotonic: number }>();
export function noteTemporalTimerRead(scope: TemporalUiScope, s: Observation) {
  if (!scopes.has(scope) || !freshTemporalUi(s)) throw Error('STALE_TIMER_READ');
  timerReads.set(s, { scope, monotonic: performance.now() });
}
export function verifyTemporalUi(scope: TemporalUiScope, first: TemporalUiInventory | Observation, second: TemporalUiInventory | Observation): TemporalUiProof {
  const f = scopes.get(scope); if (!f?.committedAt) throw Error('TEMPORAL_UI_NO_COMMIT_ATTEMPT');
  const base = scope.baseline, r = scope.request; let snapshots: string[], rows: readonly AlarmUiRow[] = [], remaining: number[] | undefined;
  let observedAt: number;
  if ('rows' in first && 'rows' in second && r.kind === 'ALARM') {
    if (first === second || ![first, second].every(v => issuedTemporalUiInventory(v) && v.deviceId === base.deviceId && v.packageName === base.packageName && v.sessionId === base.sessionId && v.zone === base.zone && v.kind === 'ALARM' && v.observedAt >= f.committedWall! && v.monotonicMs >= f.committedAt! && Date.now() - v.observedAt >= 0 && Date.now() - v.observedAt <= 5000 && !v.snapshots.some(id => base.snapshots.includes(id))) || first.snapshots.some(id => second.snapshots.includes(id))) throw Error('UI_LIST_PROOF_FOREIGN_OR_REUSED');
    for (const v of [first, second]) {
      const reason = alarmDeltaReason(base.rows, v.rows, r, scope.label); if (reason) throw Error('UI_LIST_' + reason);
      if (f.nameIndex !== undefined && v.rows.filter(row => row.label === scope.label).length !== 1) throw Error('UI_LIST_CORRELATION_MISSING');
    }
    if (first.observedAt > second.observedAt || digest(first.rows) !== digest(second.rows)) throw Error('UI_LIST_UNSTABLE');
    snapshots = [...first.snapshots, ...second.snapshots]; rows = second.rows; observedAt = second.observedAt;
  } else if ('nodes' in first && 'nodes' in second && r.kind === 'TIMER') {
    const t1 = timerReads.get(first), t2 = timerReads.get(second);
    if (!t1 || !t2 || t1.scope !== scope || t2.scope !== scope) throw Error('UI_TIMER_MONOTONIC_READBACK_MISSING');
    const a = runningTimer(first), b = runningTimer(second), elapsed = (t2.monotonic - t1.monotonic) / 1000;
    if (!freshTemporalUi(first) || !freshTemporalUi(second) || first.snapshotId === second.snapshotId || ![first, second].every(s => s.deviceSerial === base.deviceId && s.foregroundPackage === base.packageName) || a === undefined || b === undefined || a > r.seconds || b >= a || elapsed < 1 || Math.abs(a - b - elapsed) > 2 || r.seconds - a > (performance.now() - f.committedAt) / 1000 + 2) throw Error('UI_TIMER_RUNNING_DECREASE_UNVERIFIED');
    remaining = [a, b]; snapshots = [first.snapshotId, second.snapshotId]; observedAt = second.timestamp;
  } else throw Error('UI_TEMPORAL_PROOF_KIND_MISMATCH');
  if (Date.now() < observedAt || Date.now() - observedAt > 5000) throw Error('STALE_UI_TEMPORAL_PROOF');
  const proof: TemporalUiProof = Object.freeze({ id: randomUUID(), deviceId: base.deviceId, executionId: scope.executionId, nodeId: scope.nodeId, sessionId: scope.sessionId,
    kind: r.kind, request: r, identity: 'ui-correlation:' + scope.label, label: scope.label, zone: base.zone, observedAt, tier: r.kind === 'ALARM' ? 'UI_LIST_READBACK' : 'UI_RUNNING_READBACK', snapshots, beforeRows: base.rows, afterRows: rows, ...(remaining ? { remaining } : {}) });
  proofs.set(proof, digest(proof)); return proof;
}

export function corroborateTemporalUi(proof: TemporalUiProof, alarmDump: string): TemporalUiProof {
  if (!isTemporalUiProof(proof) || proof.kind !== 'ALARM' || proof.request.kind !== 'ALARM') throw Error('TEMPORAL_UI_PROOF_UNISSUED');
  const section = /Next alarm clock information:[^\S\r\n]*\r?\n([\s\S]*?)(?:\r?\n\s*\r?\n|$)/.exec(alarmDump)?.[1] ?? '';
  const epochs = [...section.matchAll(/\btriggerTime=(\d{13})\b/g)].map(m => Number(m[1]));
  if (epochs.length !== 1) return proof;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: proof.zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(epochs[0]));
  if (Number(parts.find(p => p.type === 'hour')?.value) !== proof.request.hour || Number(parts.find(p => p.type === 'minute')?.value) !== proof.request.minute) return proof;
  const next = Object.freeze({ ...proof, systemCorroboration: { tier: 'SYSTEM_STATE_READBACK' as const, time: new Date(epochs[0]).toISOString() } });
  proofs.set(next, digest(next)); return next;
}
