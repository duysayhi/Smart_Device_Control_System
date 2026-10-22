import { randomUUID } from 'node:crypto';
import type { Observation } from '../state-observer';
import type { GoalNodeV2 } from './goal-graph';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import { observedAffordances, type ObservedAffordance } from './ui-affordances';
import { foldIntent } from './outcome-spec';
import { visibleNode } from './navigation-semantics';
import { isDescendant } from '../exploration/scroll-regions';
import { emptyResultText, exactQuerySummary, resultSurface, type EvidenceAssessment } from './read-only-verifiers';
import { isKeyboardVisibility, type KeyboardVisibility } from './keyboard-visibility';
import { isGroundedCandidate } from './grounded-candidates-v2';

export interface SearchScope { id: string; deviceId: string; executionId: string; sessionId: string; nodeId: string; packageName: string; query: string; createdAt: number }
export interface SearchStep { phase: 'OPEN' | 'MENU' | 'DISMISS' | 'RESET' | 'FOCUS' | 'CLEAR' | 'ENTER' | 'SUBMIT'; target: ObservedAffordance; action: 'CLICK' | 'BACK' | 'SET_VALUE' | 'IME_SEARCH'; value?: string }
interface SearchRun { scope: SearchScope; signature: string; submittedAt?: number; beforeSubmit?: string; beforeResult?: string; attemptedSubmit: boolean; dismissed?: boolean; menuTried?: boolean;
  typedAt?: number; beforeTypeResult?: string; liveSnapshot?: string; liveSignature?: string; submission?: 'EXPLICIT_RPC' | 'LIVE_TRANSITION';
  editingBeforeSubmit?: boolean; outcomeSnapshot?: string; outcomeSignature?: string; outcomeWhy?: string; keyboard?: KeyboardVisibility;
  replacementRequired?: boolean; clearedAt?: number; clearedResult?: string; provenField?: string; resetTried?: boolean }
const runs = new Map<string, SearchRun>();
const activations = new WeakMap<GroundedCandidateV2, Observation>();
const fieldIdentity = (row: ObservedAffordance) => JSON.stringify([row.packageName, row.resourceId, row.className, row.bounds]);
export function isScopedSearchField(scopeId: string, row: ObservedAffordance): boolean {
  const run = runs.get(scopeId);
  return isSearchField(row) || Boolean(run && active(run.scope) && run.provenField === fieldIdentity(row) && row.enabled && row.roles.includes('editable') && !row.sensitive && !row.destructive);
}
export function noteSearchActivationAcknowledged(candidate: GroundedCandidateV2, before: Observation) {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (run && bound(run.scope, before) && isGroundedCandidate(candidate) && candidate.search!.phase === 'OPEN' && searchCandidateAllowed(candidate, { id: run.scope.nodeId, packageName: run.scope.packageName, capability: 'SEARCH', outcome: { value: run.scope.query } } as GoalNodeV2)) activations.set(candidate, before);
}
export function confirmSearchActivation(candidate: GroundedCandidateV2, after: Observation, keyboard: KeyboardVisibility, passwordIsFalse: boolean): boolean {
  const before = activations.get(candidate), run = candidate.search && runs.get(candidate.search.scopeId);
  if (!before || !run || !bound(run.scope, after) || after.snapshotId === before.snapshotId || after.timestamp < before.timestamp || !passwordIsFalse ||
    !isKeyboardVisibility(keyboard) || keyboard.deviceId !== run.scope.deviceId || keyboard.shown !== true || keyboard.observedAt < after.timestamp || Date.now() - keyboard.observedAt > 5000) return false;
  const rows = observedAffordances(after, run.scope.executionId, run.scope.sessionId).filter(r => r.roles.includes('editable'));
  if (rows.length !== 1 || !rows[0].focused || rows[0].sensitive || rows[0].destructive || !rows[0].enabled) return false;
  const old = observedAffordances(before, run.scope.executionId, run.scope.sessionId).filter(r => r.roles.includes('editable') &&
    r.packageName === rows[0].packageName && r.className === rows[0].className &&
    (r.resourceId && rows[0].resourceId ? r.resourceId === rows[0].resourceId : !r.resourceId && !rows[0].resourceId));
  if (old.some(r => r.focused)) return false;
  run.provenField = fieldIdentity(rows[0]); activations.delete(candidate); return true;
}
const emptyMessage = (n: Observation['nodes'][number]) => !n.clickable && emptyResultText(n.text || n.description);
function resultCollections(snapshot: Observation, query?: string) {
  return resultSurface(snapshot, query).containers;
}
function resultSignature(snapshot: Observation, query?: string): string | undefined {
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n)), containers = resultCollections(snapshot, query);
  const content = visible.filter(n => !/^(?:(?:search )?results for|no results for|ket qua (?:tim kiem )?cho)[:\s]/.test(foldIntent(n.text)) &&
    (emptyMessage(n) || containers.some(parent => n === parent || isDescendant(snapshot.nodes, n, parent))));
  return content.length ? JSON.stringify(content.map(n => [n.resourceId, n.className, n.text, n.description, n.clickable])) : undefined;
}
const label = (row: ObservedAffordance) => foldIntent(row.label).replace(/[,\s]+(?:phim|button)\.?$/, '').trim();
function collapsedSearch(row: ObservedAffordance): boolean {
  if (row.searchEntry && row.roles.includes('clickable') && !row.roles.includes('editable')) return true;
  return row.roles.includes('clickable') && !row.roles.includes('editable') && /TextView|SearchView/.test(row.className) &&
    /(?:^|[_-])search[_-](?:query|box|bar|text)(?:$|[_-])/.test(row.resourceId.split('/').at(-1) ?? '');
}
function benignPopup(snapshot: Observation): boolean {
  const root = snapshot.nodes[0]; if (!root || snapshot.nodes.some(n => /EditText|AutoCompleteTextView/.test(n.className))) return false;
  const area = (root.bounds[2] - root.bounds[0]) * (root.bounds[3] - root.bounds[1]);
  const rows = observedAffordances(snapshot, '', '');
  return area > 0 && area < snapshot.viewport.width * snapshot.viewport.height * .5 && snapshot.nodes.some(n => /ListView/.test(n.className)) &&
    rows.some(r => r.text.trim()) && !rows.some(r => r.sensitive || r.destructive || r.roles.includes('save') || r.roles.includes('checkable'));
}
export const searchLabel = (text: string) => /^(search|tim kiem|tim|find|tra cuu)$/.test(foldIntent(text).trim());
export function isSearchField(row: ObservedAffordance): boolean {
  const semantic = foldIntent([row.hint, row.resourceId.split('/').at(-1)?.replace(/[_-]/g, ' '), row.label === row.text ? '' : row.label].join(' '));
  return row.roles.includes('editable') && row.enabled && !row.sensitive && !row.destructive && /\b(search|query|tim kiem|tra cuu)\b/.test(semantic);
}
export function searchQuery(value: string): string {
  const trimmed = value.trim(), pairs: Record<string, string> = { '"': '"', "'": "'", '\u201c': '\u201d' };
  return pairs[trimmed[0]] && trimmed.at(-1) === pairs[trimmed[0]] ? trimmed.slice(1, -1) : trimmed;
}
export function beginSearch(node: GoalNodeV2, deviceId: string, executionId: string, sessionId: string): SearchScope {
  const query = searchQuery(node.outcome.value);
  if (node.capability !== 'SEARCH' || node.outcome.negated || !node.packageName || !query || query.length > 1000 || !sessionId) throw Error('Unsupported search scope.');
  const scope = Object.freeze({ id: randomUUID(), deviceId, executionId, sessionId, nodeId: node.id, packageName: node.packageName, query, createdAt: Date.now() });
  runs.set(scope.id, { scope, signature: JSON.stringify(scope), attemptedSubmit: false }); return scope;
}
function active(scope: SearchScope) {
  const run = runs.get(scope.id);
  return run?.scope === scope && run.signature === JSON.stringify(scope) && Date.now() - scope.createdAt <= 120000 ? run : undefined;
}
function bound(scope: SearchScope, s: Observation) {
  return active(scope) && s.deviceSerial === scope.deviceId && s.foregroundPackage === scope.packageName && s.observationStatus === 'OBSERVED' &&
    s.timestamp >= scope.createdAt && Date.now() - s.timestamp >= 0 && Date.now() - s.timestamp <= 5000 &&
    !s.nodes.some(n => visibleNode(s, n) && (/Dialog|ProgressBar/.test(n.className) || /permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId)));
}
export function searchSteps(scope: SearchScope, snapshot: Observation): SearchStep[] {
  const run = active(scope); if (!run || !bound(scope, snapshot) || run.attemptedSubmit) return [];
  const observed = observedAffordances(snapshot, scope.executionId, scope.sessionId);
  if (observed.some(r => r.roles.includes('editable') && !isScopedSearchField(scope.id, r) && r.text.trim())) return [];
  const rows = observed.filter(r => r.enabled && !r.sensitive && !r.destructive);
  const searchEntries = rows.filter(r => r.roles.includes('clickable') && (searchLabel(label(r)) ||
    r.navigationIntent === 'SEARCH' && r.roles.includes('navigation') && r.selected !== true ||
    /(?:\$Tab|\.Tab)$/.test(r.className) && /^search\s+tab\b/.test(label(r))));
  if (!run.dismissed && benignPopup(snapshot) && !searchEntries.length && rows[0]) return [{ phase: 'DISMISS', action: 'BACK', target: rows[0] }];
  const fields = rows.filter(r => isScopedSearchField(scope.id, r));
  if (fields.length > 1) return [];
  if (fields.length === 1) {
    const field = fields[0];
    if (run.replacementRequired === undefined) run.replacementRequired = Boolean(field.text);
    if (!field.focused) return field.roles.includes('clickable') ? [{ phase: 'FOCUS', action: 'CLICK', target: field }] : [];
    if (run.replacementRequired && !run.clearedAt) return [{ phase: 'CLEAR', action: 'SET_VALUE', target: field, value: '' }];
    if (field.text !== scope.query) return [{ phase: 'ENTER', action: 'SET_VALUE', target: field, value: scope.query }];
    const buttons = rows.filter(r => r.roles.includes('clickable') && !r.roles.includes('editable') && searchLabel(label(r)));
    if (buttons.length) return buttons.map(target => ({ phase: 'SUBMIT', action: 'CLICK', target }));
    return field.focused ? [{ phase: 'SUBMIT', action: 'IME_SEARCH', target: field }] : field.roles.includes('clickable') ? [{ phase: 'FOCUS', action: 'CLICK', target: field }] : [];
  }
  const open = searchEntries;
  if (open.length) return open.map(target => ({ phase: 'OPEN', action: 'CLICK', target }));
  const collapsed = rows.filter(collapsedSearch);
  if (collapsed.length) return collapsed.map(target => ({ phase: 'OPEN', action: 'CLICK', target }));
  const unknownInputs = observed.filter(r => r.roles.includes('editable'));
  if (!run.resetTried && unknownInputs.length === 1 && unknownInputs[0].focused && unknownInputs[0].text === '' && !unknownInputs[0].sensitive && !unknownInputs[0].destructive) {
    const backs = rows.filter(r => r.roles.includes('clickable') && r.roles.includes('navigation') && /^(back|navigate up|quay lai|tro ve)$/.test(label(r)));
    if (backs.length === 1) return [{ phase: 'RESET', action: 'CLICK', target: backs[0] }];
  }
  return run.menuTried ? [] : rows.filter(r => r.roles.includes('clickable') && /^(menu|open menu|more options|mo menu|tuy chon khac)$/.test(label(r))).map(target => ({ phase: 'MENU', action: 'CLICK', target }));
}
export function searchCandidateAllowed(candidate: GroundedCandidateV2, node: GoalNodeV2): boolean {
  const step = candidate.search, run = step && runs.get(step.scopeId);
  return Boolean(run && active(run.scope) && !run.attemptedSubmit && node.capability === 'SEARCH' && node.id === run.scope.nodeId && node.packageName === run.scope.packageName &&
    searchQuery(node.outcome.value) === run.scope.query && candidate.deviceId === run.scope.deviceId && candidate.executionId === run.scope.executionId && candidate.sessionId === run.scope.sessionId &&
    step!.query === run.scope.query && (step!.phase === 'DISMISS' ? candidate.action === 'BACK' && !run.dismissed :
      step!.phase === 'RESET' ? !run.resetTried && candidate.action === 'CLICK' && candidate.target.roles.includes('navigation') && /^(back|navigate up|quay lai|tro ve)$/.test(label(candidate.target)) :
      step!.phase === 'CLEAR' ? candidate.action === 'SET_VALUE' && candidate.value === '' && run.replacementRequired && !run.clearedAt && isScopedSearchField(run.scope.id, candidate.target) && candidate.target.focused :
      step!.phase === 'ENTER' ? candidate.action === 'SET_VALUE' && candidate.value === run.scope.query && isScopedSearchField(run.scope.id, candidate.target) && candidate.target.focused :
      step!.phase === 'FOCUS' ? candidate.action === 'CLICK' && isScopedSearchField(run.scope.id, candidate.target) && !candidate.target.focused :
      step!.phase === 'SUBMIT' ? candidate.action === 'CLICK' && searchLabel(label(candidate.target)) || candidate.action === 'IME_SEARCH' && isScopedSearchField(run.scope.id, candidate.target) && candidate.target.focused && candidate.target.text === run.scope.query :
      candidate.action === 'CLICK' && (step!.phase === 'OPEN' ? collapsedSearch(candidate.target) || searchLabel(label(candidate.target)) || candidate.target.navigationIntent === 'SEARCH' && candidate.target.roles.includes('navigation') || /(?:\$Tab|\.Tab)$/.test(candidate.target.className) : /^(menu|open menu|more options|mo menu|tuy chon khac)$/.test(label(candidate.target)))));
}
export function freshSearchTarget(candidate: GroundedCandidateV2, snapshot: Observation): ObservedAffordance | undefined {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (!run || !bound(run.scope, snapshot)) return;
  const equivalent = searchSteps(run.scope, snapshot).filter(step => step.phase === candidate.search!.phase && step.action === candidate.action && step.value === candidate.value &&
    step.target.label === candidate.target.label);
  if (equivalent.length !== 1) return;
  const target = equivalent[0].target, old = candidate.target;
  return target.packageName === old.packageName && target.resourceId === old.resourceId && target.className === old.className && target.bounds.join() === old.bounds.join() &&
    target.text === old.text && target.hint === old.hint && target.focused === old.focused && target.enabled && !target.sensitive && !target.destructive ? target : undefined;
}
export function searchTransitionSatisfied(candidate: GroundedCandidateV2, snapshot: Observation): boolean {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (!run || !bound(run.scope, snapshot)) return false;
  const fields = observedAffordances(snapshot, run.scope.executionId, run.scope.sessionId).filter(r => isScopedSearchField(run.scope.id, r));
  if (candidate.search!.phase === 'OPEN') {
    if (fields.length === 1) return true;
    const surfaces = observedAffordances(snapshot, run.scope.executionId, run.scope.sessionId).filter(r => collapsedSearch(r) && !r.sensitive && !r.destructive);
    return fields.length === 0 && !collapsedSearch(candidate.target) && surfaces.length === 1;
  }
  if (candidate.search!.phase === 'MENU') return searchSteps(run.scope, snapshot).some(s => s.phase === 'OPEN');
  if (candidate.search!.phase === 'RESET') return !observedAffordances(snapshot, run.scope.executionId, run.scope.sessionId).some(r => r.roles.includes('editable')) && searchSteps(run.scope, snapshot).some(s => s.phase === 'OPEN');
  if (candidate.search!.phase === 'DISMISS') return !benignPopup(snapshot) && snapshot.nodes.length > 0;
  if (candidate.search!.phase === 'FOCUS') return !candidate.target.focused && fields.length === 1 && fields[0].focused;
  if (candidate.search!.phase === 'ENTER') return fields.length === 1 && fields[0].text === run.scope.query;
  if (candidate.search!.phase === 'CLEAR') return fields.length === 1 && fields[0].focused && fields[0].text === '';
  return false;
}
export function noteSearchNavigation(candidate: GroundedCandidateV2) {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (!run || !active(run.scope)) throw Error('Search scope is no longer active.');
  if (candidate.search!.phase === 'DISMISS') run.dismissed = true;
  if (candidate.search!.phase === 'MENU') run.menuTried = true;
  if (candidate.search!.phase === 'RESET') run.resetTried = true;
}
export function beforeSearchDispatch(candidate: GroundedCandidateV2, snapshot: Observation) {
  const step = candidate.search, run = step && runs.get(step.scopeId);
  if (!run || !bound(run.scope, snapshot) || run.attemptedSubmit) throw Error('Search scope is expired, foreign or already submitted.');
  if (step!.phase === 'SUBMIT') {
    if (!run.typedAt) throw Error('Exact issued search entry has not been read back.');
    const fields = observedAffordances(snapshot, run.scope.executionId, run.scope.sessionId).filter(r => isScopedSearchField(run.scope.id, r));
    if (run.replacementRequired && (!run.clearedAt || !run.typedAt)) throw Error('Verified replacement is required before submission.');
    if (fields.length !== 1 || fields[0].text !== run.scope.query) throw Error('Exact search query is not verified before submission.');
    run.attemptedSubmit = true; run.beforeSubmit = snapshot.snapshotId; run.beforeResult = resultSignature(snapshot, run.scope.query); run.editingBeforeSubmit = fields[0].focused;
  }
}
export function noteSearchSubmitted(candidate: GroundedCandidateV2) {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (!run || !run.attemptedSubmit || candidate.search!.phase !== 'SUBMIT' || run.submittedAt) throw Error('No single known search submit dispatch.');
  run.submittedAt = Date.now(); run.submission = 'EXPLICIT_RPC';
}
export function noteSearchQueryEntered(candidate: GroundedCandidateV2, before: Observation, after: Observation) {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (!run || candidate.search!.phase !== 'ENTER' || !searchTransitionSatisfied(candidate, after)) throw Error('No exact search field readback receipt.');
  if (run.replacementRequired && !run.clearedAt) throw Error('Search clear was not independently verified.');
  run.typedAt = after.timestamp; run.beforeTypeResult = run.clearedAt ? run.clearedResult : resultSignature(before, run.scope.query);
}
export function noteSearchCleared(candidate: GroundedCandidateV2, after: Observation) {
  const run = candidate.search && runs.get(candidate.search.scopeId);
  if (!run || !isGroundedCandidate(candidate) || candidate.search!.phase !== 'CLEAR' || !run.replacementRequired || run.clearedAt || !searchTransitionSatisfied(candidate, after)) throw Error('No single verified empty search-field readback.');
  run.clearedAt = after.timestamp; run.clearedResult = resultSignature(after, run.scope.query);
}
export function observeLiveSearch(scope: SearchScope, snapshot: Observation): 'PENDING' | 'VERIFIED' | false {
  const run = active(scope);
  if (!run?.typedAt || run.attemptedSubmit || !bound(scope, snapshot) || snapshot.timestamp < run.typedAt) return false;
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n));
  const signature = resultSignature(snapshot, scope.query);
  const summary = visible.filter(n => exactQuerySummary(n.text, scope.query));
  const fields = observedAffordances(snapshot, scope.executionId, scope.sessionId).filter(r => isScopedSearchField(scope.id, r));
  if (!signature || signature === run.beforeTypeResult || summary.length !== 1 || fields.length !== 1 || fields[0].text !== scope.query || visible.some(n => /suggest|autocomplete/.test(n.resourceId))) return false;
  if (run.liveSignature !== signature) { run.liveSignature = signature; run.liveSnapshot = snapshot.snapshotId; return 'PENDING'; }
  if (run.liveSnapshot === snapshot.snapshotId) return 'PENDING';
  run.submittedAt = run.typedAt; run.beforeResult = run.beforeTypeResult; run.submission = 'LIVE_TRANSITION'; return 'VERIFIED';
}
export function searchResult(scope: SearchScope, snapshot: Observation): { query: string; status: 'RESULTS' | 'NO_RESULTS'; count: number; submission?: 'EXPLICIT_RPC' | 'LIVE_TRANSITION' } | undefined {
  const run = active(scope);
  if (!run?.submittedAt || !bound(scope, snapshot) || snapshot.timestamp < run.submittedAt || snapshot.snapshotId === run.beforeSubmit) return;
  run.outcomeWhy = 'QUERY_ECHO_MISSING_OR_AMBIGUOUS';
  const rows = observedAffordances(snapshot, scope.executionId, scope.sessionId);
  const echo = rows.filter(r => r.text === scope.query && (isScopedSearchField(scope.id, r) || /(?:search|query)/.test(r.resourceId.split('/').at(-1) ?? '')));
  if (echo.length !== 1) return;
  const signature = resultSignature(snapshot, scope.query);
  if (run.beforeResult && run.beforeResult === signature) {
    // A live result may already exist before the submit. Prove the type-time
    // transition and stable committed state instead of inventing submit causality.
    run.outcomeWhy = 'UNCHANGED_RESULT_WITHOUT_QUERY_APPLICATION_EVIDENCE';
    const keyboardDismissed = run.keyboard && isKeyboardVisibility(run.keyboard) && run.keyboard.shown === false && Date.now() - run.keyboard.observedAt <= 5000 && run.keyboard.observedAt >= (run.typedAt ?? Infinity);
    if (!run.typedAt || !signature || signature === run.beforeTypeResult || echo[0].focused && !keyboardDismissed || !searchCommitState(scope.id, snapshot)) return;
    if (run.outcomeSignature !== signature) { run.outcomeSignature = signature; run.outcomeSnapshot = snapshot.snapshotId; run.outcomeWhy = 'AWAITING_SECOND_COMMITTED_SNAPSHOT'; return; }
    if (run.outcomeSnapshot === snapshot.snapshotId) return;
  }
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n));
  run.outcomeWhy = 'SUGGESTIONS_ARE_NOT_RESULTS';
  if (visible.some(n => /suggest|autocomplete/.test(n.resourceId) && /ListView|RecyclerView/.test(n.className))) return;
  const empty = visible.filter(emptyMessage);
  const containers = resultCollections(snapshot, scope.query);
  const items = containers.flatMap(parent => visible.filter(n => n !== parent && isDescendant(snapshot.nodes, n, parent) && n.clickable));
  run.outcomeWhy = 'RESULT_SURFACE_MISSING_OR_AMBIGUOUS';
  if (empty.length === 1 && !items.length) { run.outcomeWhy = 'EXPLICIT_EMPTY_OUTCOME_STATE'; return { query: scope.query, status: 'NO_RESULTS', count: 0, submission: run.submission }; }
  if (containers.length === 1 && items.length > 0) run.outcomeWhy = 'RESULT_COLLECTION_OUTCOME_STATE';
  return containers.length === 1 && items.length > 0 ? { query: scope.query, status: 'RESULTS', count: items.length, submission: run.submission } : undefined;
}
export function searchOutcomeDiagnostic(scope: SearchScope) { return active(scope)?.outcomeWhy ?? 'COMMIT_OR_FRESH_SCOPE_EVIDENCE_MISSING'; }
export function noteSearchKeyboard(scope: SearchScope, proof: KeyboardVisibility) {
  const run = active(scope);
  if (!run || !isKeyboardVisibility(proof) || proof.deviceId !== scope.deviceId || proof.observedAt < scope.createdAt || Date.now() - proof.observedAt > 5000 || proof.observedAt > Date.now()) throw Error('Keyboard readback is foreign, stale or unissued.');
  run.keyboard = proof;
}
export function searchCommitState(scopeId: string, snapshot: Observation, context?: { deviceId: string; executionId: string; nodeId: string; packageName: string }): EvidenceAssessment | undefined {
  const run = runs.get(scopeId);
  if (context && (!run || run.scope.deviceId !== context.deviceId || run.scope.executionId !== context.executionId || run.scope.nodeId !== context.nodeId || run.scope.packageName !== context.packageName)) return;
  if (!run || !bound(run.scope, snapshot)) return;
  if (!run.submittedAt) {
    const k = run.keyboard, fields = observedAffordances(snapshot, run.scope.executionId, run.scope.sessionId).filter(r => isScopedSearchField(run.scope.id, r));
    if (run.typedAt && k && isKeyboardVisibility(k) && k.shown === false && k.observedAt >= run.typedAt && Date.now() - k.observedAt <= 5000 && fields.length === 1 && fields[0].text === run.scope.query)
      return { evidenceClass: 'KEYBOARD_READBACK', confidence: 'DIRECT', why: 'Independent InputMethodManager reports keyboard hidden after exact query readback; this alone does not prove query application.' };
    return;
  }
  if (snapshot.timestamp < run.submittedAt || snapshot.snapshotId === run.beforeSubmit) return;
  return { evidenceClass: run.submission === 'EXPLICIT_RPC' ? 'ACKNOWLEDGED_SUBMIT' : 'LIVE_QUERY_STATE', confidence: run.submission === 'EXPLICIT_RPC' ? 'DIRECT' : 'CORRELATED',
    why: run.submission === 'EXPLICIT_RPC' ? `Single acknowledged submit; pre-submit editing=${run.editingBeforeSubmit}; result causality is not asserted.` : 'Exact query summary, changed body and distinct stable snapshots; no submit causality claimed.' };
}
export function closeSearch(scope: SearchScope) { runs.delete(scope.id); }
