import { createHash } from 'node:crypto';
import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';
import { detectScrollRegion } from '../exploration/scroll-regions';
import { explorationGoal } from '../exploration/types';
import { observedAffordances, navigationLabel, type ObservedAffordance } from './ui-affordances';
import type { GoalNodeV2 } from './goal-graph';
import { foldIntent } from './outcome-spec';
import { arithmeticOracle } from './goal-compiler';
import { keypadTransition, normalizeMathDisplay, mathControlValue, observedMathExpression } from './math-keypad';
import { requestedToggle } from './state-target';
import { visibleNode } from './navigation-semantics';
import { recordSteps, type RecordState } from './record-forms';
import { ownerCandidateNonDestructive } from './owner-test-policy';
import { searchSteps, freshSearchTarget, type SearchScope, type SearchStep } from './generic-search';
import { rebindTarget } from './target-identity';
import { temporalUiSteps, bindTemporalUiCandidate, type TemporalUiScope, type TemporalUiPhase } from './temporal-ui';
import { browserResultTarget, bindBrowserResultCandidate, type BrowserResultScope } from './browser-result';

export interface GroundedCandidateV2 {
  id: string; deviceId: string; executionId: string; nodeId: string; snapshotId: string; sessionId: string; fingerprint: string;
  target: ObservedAffordance; action: 'CLICK' | 'SET_VALUE' | 'SCROLL' | 'BACK' | 'IME_SEARCH';
  search?: { scopeId: string; query: string; phase: SearchStep['phase'] };
  value?: string; desired?: boolean; parameterSource: 'USER_REQUEST' | 'DETERMINISTIC_ORACLE'; effect: 'READ' | 'LOCAL_WRITE';
  verification: 'STATE_CHANGED' | 'TEXT_EQUALS' | 'ITEM_SELECTED'; description: string;
  keypad?: { key: string; before: string; after: string };
  capture?: boolean;
  browserResult?: { scopeId: string };
  temporal?: { scopeId: string; phase: TemporalUiPhase };
  record?: { phase: RecordState['phase']; field?: string; identity?: string };
}
export interface CandidatePage { candidates: GroundedCandidateV2[]; coverage: { observed: number; eligible: number; offered: number; page: number } }
const issued = new WeakMap<GroundedCandidateV2, string>();
export const isGroundedCandidate = (candidate: GroundedCandidateV2) => issued.get(candidate) === JSON.stringify(candidate);
const cleanLabel = (text: string) => foldIntent(text).replace(/^(?:muc|trang|tab|page|section)\s+/, '').trim();
export function generateGroundedCandidates(node: GoalNodeV2, snapshot: Observation, executionId: string, sessionId: string, expressionObserved: boolean, page = 0, enteredKeys = '', mediaReady = false, recordState?: RecordState, ownerMode = false, searchScope?: SearchScope, temporalScope?: TemporalUiScope, browserScope?: BrowserResultScope): CandidatePage {
  const affordances = observedAffordances(snapshot, executionId, sessionId), rows: GroundedCandidateV2[] = [];
  const blocked = snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId));
  const add = (target: ObservedAffordance, action: GroundedCandidateV2['action'], effect: GroundedCandidateV2['effect'], value?: string, desired?: boolean, keypad?: GroundedCandidateV2['keypad'], capture?: boolean, record?: GroundedCandidateV2['record'], search?: GroundedCandidateV2['search'], temporal?: GroundedCandidateV2['temporal'], browserResult?: GroundedCandidateV2['browserResult']) => {
    if (!target.enabled || target.destructive || target.sensitive || blocked) return;
    const data = { deviceId: snapshot.deviceSerial, executionId, nodeId: node.id, snapshotId: snapshot.snapshotId, sessionId, fingerprint: geometryFingerprint(snapshot),
      target, action, effect, value, desired, keypad, capture, record, search, ...(temporal ? { temporal } : {}), ...(browserResult ? { browserResult } : {}), parameterSource: 'USER_REQUEST' as const,
      verification: action === 'SET_VALUE' ? 'TEXT_EQUALS' as const : 'STATE_CHANGED' as const,
      description: `${action}: ${target.label || target.className}`.slice(0, 160) };
    const candidate = { ...data, id: 'v2_' + createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16) };
    if (temporalScope && temporal) bindTemporalUiCandidate(candidate, temporalScope);
    if (browserScope && browserResult) bindBrowserResultCandidate(candidate, browserScope);
    if (ownerMode && !ownerCandidateNonDestructive(candidate)) return;
    issued.set(candidate, JSON.stringify(candidate)); rows.push(candidate);
  };
  const dialogs = affordances.filter(row => /Dialog/.test(row.className));
  const dialog = dialogs.length === 1 ? dialogs[0] : !dialogs.length ? affordances.find(row => row.resourceId === 'android:id/alertTitle') : undefined;
  const unsaved = snapshot.nodes.some(row => /EditText|AutoCompleteTextView/.test(row.className) && row.focused && row.text.trim());
  if (!dialog && node.capability === 'OPEN_RESULT' && browserScope) {
    const target = browserResultTarget(browserScope, snapshot);
    if (target) add(target, 'CLICK', 'READ', undefined, undefined, undefined, undefined, undefined, undefined, undefined, { scopeId: browserScope.id });
  }
  if (!dialog && node.outcome.temporal && temporalScope) for (const step of temporalUiSteps(temporalScope, snapshot)) add(step.target, step.action, 'LOCAL_WRITE', step.value, undefined, undefined, undefined, undefined, undefined, { scopeId: step.scopeId, phase: step.phase });
  if (!dialog && node.capability === 'SEARCH' && searchScope) for (const step of searchSteps(searchScope, snapshot)) add(step.target, step.action, 'READ', step.value, undefined, undefined, undefined, undefined, { scopeId: searchScope.id, query: searchScope.query, phase: step.phase });
  if (dialog && !unsaved && !affordances.some(row => row.sensitive || row.destructive)) add(dialog, 'BACK', 'READ');
  if (!dialog && node.capability === 'NAVIGATE') {
    const target = cleanLabel(node.outcome.value);
    const words = target.split(/\s+/).filter(word => word.length > 2);
    for (const row of affordances) if (row.roles.includes('clickable') && (cleanLabel(navigationLabel(row.label, row.className)) === target || words.length >= 2 && words.every(word => cleanLabel(row.label).includes(word))) && !row.roles.includes('save') && !row.roles.includes('capture') && !row.roles.includes('checkable') &&
      (/tab|menu|navigation|nav|toolbar|title|list|item/.test(row.resourceId) || row.roles.includes('navigation'))) add(row, 'CLICK', 'READ');
    if (!rows.length && !affordances.some(row => row.roles.includes('editable') && row.focused)) {
      for (const row of affordances) if (row.roles.includes('navigation') && row.roles.includes('clickable') && /^(back|navigate up|quay lai|tro ve|menu|more options)$/.test(cleanLabel(row.label))) add(row, 'CLICK', 'READ');
      const region = detectScrollRegion(snapshot, explorationGoal('read navigation'), 'down');
      if (!rows.length && region.status === 'FOUND') {
        const target = affordances.find(row => row.index === region.region.index);
        if (target) add(target, 'SCROLL', 'READ');
      }
    }
  }
  if (!dialog && node.capability === 'CALCULATE') {
    const oracle = arithmeticOracle(node.outcome.value);
    const keys = affordances.filter(a => a.roles.includes('clickable') && /Button/.test(a.className) && !a.roles.includes('editable'));
    const labels = keys.map(mathControlValue);
    const mathContext = labels.includes('=') && labels.some(label => /^[+−\-×*/÷]$/.test(label)) && labels.filter(label => /^\d$/.test(label)).length >= 3;
    const inputs = affordances.filter(row => row.roles.includes('editable') && !row.sensitive && !row.destructive);
    const keypadSupported = observedMathExpression(snapshot) !== undefined && [...new Set(normalizeMathDisplay(oracle.expression))].every(key => labels.filter(label => normalizeMathDisplay(label) === key).length === 1);
    if (mathContext && !keypadSupported && !expressionObserved && inputs.length === 1 && (!inputs[0].label || /^[\d.\s+*/()×÷−\-=]*$/.test(inputs[0].label))) add(inputs[0], 'SET_VALUE', 'LOCAL_WRITE', oracle.expression);
    if (mathContext && expressionObserved) for (const row of keys.filter(a => mathControlValue(a) === '=')) add(row, 'CLICK', 'LOCAL_WRITE');
    if (mathContext && !expressionObserved && keypadSupported) {
      const transition = keypadTransition(oracle.expression, enteredKeys, snapshot);
      if (transition) for (const row of keys.filter(a => normalizeMathDisplay(mathControlValue(a)) === transition.key)) add(row, 'CLICK', 'LOCAL_WRITE', undefined, undefined, transition);
    }
  }
  if (!dialog && node.capability === 'SET_STATE') {
    const desired = requestedToggle(node.outcome);
    if (desired) for (const row of affordances) if (row.roles.includes('checkable') && row.roles.includes('clickable') && cleanLabel(row.label) === cleanLabel(desired.label) && row.checked !== desired.checked) add(row, 'CLICK', 'LOCAL_WRITE', undefined, desired.checked);
  }
  if (!dialog && ['CREATE_RECORD', 'SET_STRUCTURED_STATE'].includes(node.capability) && recordState) {
    for (const step of recordSteps(node, recordState, snapshot, executionId, sessionId)) add(step.target, step.phase === 'FIELD' && step.desired === undefined ? 'SET_VALUE' : 'CLICK', 'LOCAL_WRITE', step.value, step.desired, undefined, undefined,
      { phase: step.phase, field: step.field, identity: step.identity });
  }
  const preview = snapshot.nodes.some(row => visibleNode(snapshot, row) && !row.clickable &&
    (/SurfaceView|TextureView/.test(row.className) || /^(?:camera_)?preview(?:_layer)?$|^viewfinder$/.test(row.resourceId.split('/').at(-1) ?? '')) &&
    (row.bounds[2] - row.bounds[0]) * (row.bounds[3] - row.bounds[1]) >= snapshot.viewport.width * snapshot.viewport.height * .2);
  if (!dialog && node.capability === 'CAPTURE_MEDIA' && mediaReady && preview) {
    for (const row of affordances) if (row.roles.includes('capture') && row.roles.includes('clickable')) add(row, 'CLICK', 'LOCAL_WRITE', undefined, undefined, undefined, true);
  }
  // Identical labels/effects cannot be distinguished by an arbitrary manifest ID.
  const distinct = rows.filter(row => rows.filter(other => other.action === row.action && cleanLabel(other.target.label) === cleanLabel(row.target.label) && other.value === row.value).length === 1);
  const score = (row: GroundedCandidateV2) => (cleanLabel(row.target.label) === cleanLabel(node.outcome.value) ? 100 : row.action === 'SCROLL' ? 10 : 50) +
    (row.target.roles.includes('navigation') ? 5 : 0) - row.target.label.length / 1000;
  distinct.sort((a, b) => score(b) - score(a));
  const size = 8, maxPage = Math.max(0, Math.ceil(distinct.length / size) - 1), selected = Math.min(Math.max(0, page), maxPage);
  return { candidates: distinct.slice(selected * size, (selected + 1) * size), coverage: { observed: affordances.length, eligible: distinct.length, offered: Math.min(size, Math.max(0, distinct.length - selected * size)), page: selected } };
}
export function revalidateGroundedCandidate(candidate: GroundedCandidateV2, node: GoalNodeV2, fresh: Observation, executionId: string, sessionId: string, expressionObserved: boolean, enteredKeys = '', mediaReady = false, _reviewedTarget = false, recordState?: RecordState, searchScope?: SearchScope): GroundedCandidateV2 | undefined {
  void _reviewedTarget; // Kept for callers; user review cannot replace native target identity.
  const changed = geometryFingerprint(fresh) !== candidate.fingerprint;
  const rebound = candidate.search ? undefined : rebindTarget(candidate.target, fresh, candidate.action === 'CLICK');
  if (!isGroundedCandidate(candidate) || candidate.deviceId !== fresh.deviceSerial || candidate.executionId !== executionId || candidate.nodeId !== node.id || candidate.sessionId !== sessionId ||
    Date.now() - fresh.timestamp < 0 || Date.now() - fresh.timestamp > 5000 || changed && !(searchScope && candidate.search && freshSearchTarget(candidate, fresh) || rebound)) return;
  const firstPage = generateGroundedCandidates(node, fresh, executionId, sessionId, expressionObserved, 0, enteredKeys, mediaReady, recordState, false, searchScope);
  const total = firstPage.coverage.eligible;
  for (let page = 0; page < Math.ceil(total / 8); page++) {
    const row = (page === 0 ? firstPage : generateGroundedCandidates(node, fresh, executionId, sessionId, expressionObserved, page, enteredKeys, mediaReady, recordState, false, searchScope)).candidates.find(row => row.action === candidate.action && JSON.stringify(row.record) === JSON.stringify(candidate.record) && JSON.stringify(row.search) === JSON.stringify(candidate.search) &&
      (changed ? row.target.index === rebound?.index || Boolean(candidate.search && freshSearchTarget(candidate, fresh)?.index === row.target.index) : row.target.index === candidate.target.index) && row.capture === candidate.capture && JSON.stringify(row.keypad) === JSON.stringify(candidate.keypad) &&
      row.value === candidate.value && row.desired === candidate.desired && row.effect === candidate.effect);
    if (row) return row;
  }
}
