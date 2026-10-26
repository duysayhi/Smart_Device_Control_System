import { randomUUID } from 'node:crypto';
import type { Observation } from '../state-observer';
import { verifyBrowserSearch, verifyDiscoveredSelection } from '../action-verifier';
import { isSensitiveControl } from '../security-policy';
import type { GoalNodeV2 } from './goal-graph';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import type { VerifiedEvidence } from './evidence-predicates';
import { isVerifiedEvidence, searchEvidenceScope } from './verification-registry';
import { observedAffordances } from './ui-affordances';
import { browserResultDescriptor } from './browser-result-contract';

export interface BrowserResultScope {
  readonly id: string; readonly deviceId: string; readonly executionId: string; readonly nodeId: string; readonly sessionId: string;
  readonly packageName: string; readonly query: string; readonly ordinal: 1; readonly searchEvidenceId: string;
  readonly beforeId: string; readonly observedAt: number;
  readonly link: Readonly<{ url: string; href: string; title: string; selector: string }>;
}
const scopes = new WeakMap<BrowserResultScope, { signature: string; attempted: boolean; acknowledged: boolean; destination?: string }>();
const candidates = new WeakMap<GroundedCandidateV2, BrowserResultScope>();
const fresh = (s: Observation, deviceId: string, packageName: string) => s.deviceSerial === deviceId && s.foregroundPackage === packageName && s.observationStatus === 'OBSERVED' &&
  Date.now() >= s.timestamp && Date.now() - s.timestamp <= 5000 && !s.nodes.some(n => n.displayed !== false &&
    (/Dialog|ProgressBar/.test(n.className) || /permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId)));
export function beginBrowserResult(node: GoalNodeV2, snapshot: Observation, search: VerifiedEvidence, sessionId: string): BrowserResultScope {
  const request = node.outcome.browserResult;
  if (node.capability !== 'OPEN_RESULT' || !request || request.ordinal !== browserResultDescriptor.ordinal || !sessionId ||
    !node.packageName || !browserResultDescriptor.packages.includes(node.packageName) || !isVerifiedEvidence(search) ||
    searchEvidenceScope(search)?.sessionId !== sessionId || searchEvidenceScope(search)?.packageName !== node.packageName || searchEvidenceScope(search)?.surface !== 'BROWSER_ORGANIC' ||
    search.deviceId !== snapshot.deviceSerial || search.executionId === '' || !node.dependencies.includes(search.nodeId) ||
    search.predicate.kind !== 'SEARCH_OUTCOME_MATCHES' || search.predicate.query !== request.query || search.search?.status !== 'RESULTS' ||
    search.observedAt > snapshot.timestamp || Date.now() - search.observedAt > 120000 || !fresh(snapshot, search.deviceId, node.packageName) ||
    snapshot.web?.status !== 'DOM_AVAILABLE' || !verifyBrowserSearch(snapshot, request.query)) throw Error('BROWSER_RESULT_SEARCH_SCOPE_UNPROVEN');
  const link = snapshot.web.document.links[0];
  if (!link || !link.visible || link.covered || isSensitiveControl(link.title) || isSensitiveControl(link.url)) throw Error('BROWSER_RESULT_ORGANIC_IDENTITY_UNPROVEN');
  const scope: BrowserResultScope = Object.freeze({ id: randomUUID(), deviceId: search.deviceId, executionId: search.executionId, nodeId: node.id, sessionId,
    packageName: node.packageName, query: request.query, ordinal: 1, searchEvidenceId: search.id, beforeId: snapshot.snapshotId, observedAt: snapshot.timestamp,
    link: Object.freeze({ url: link.url, href: link.href, title: link.title, selector: link.selector }) });
  scopes.set(scope, { signature: JSON.stringify(scope), attempted: false, acknowledged: false }); return scope;
}
function active(scope: BrowserResultScope) {
  const state = scopes.get(scope);
  return state && state.signature === JSON.stringify(scope) && Date.now() - scope.observedAt <= 120000 ? state : undefined;
}
export function browserResultTarget(scope: BrowserResultScope, snapshot: Observation) {
  const state = active(scope);
  if (!state || state.attempted || !fresh(snapshot, scope.deviceId, scope.packageName) || snapshot.web?.status !== 'DOM_AVAILABLE' || !verifyBrowserSearch(snapshot, scope.query)) return;
  const first = snapshot.web.document.links[0];
  if (!first || !first.visible || first.covered || ['url', 'href', 'title', 'selector'].some(key => first[key as keyof typeof first] !== scope.link[key as keyof typeof scope.link])) return;
  const containers = observedAffordances(snapshot, scope.executionId, scope.sessionId).filter(a => /WebView$/.test(a.className) && a.enabled && !a.sensitive && !a.destructive);
  return containers.length === 1 ? containers[0] : undefined;
}
export function bindBrowserResultCandidate(candidate: GroundedCandidateV2, scope: BrowserResultScope) { candidates.set(candidate, scope); }
export function browserResultCandidateAllowed(candidate: GroundedCandidateV2, node?: GoalNodeV2): boolean {
  const scope = candidates.get(candidate), state = scope && active(scope);
  return Boolean(scope && state && !state.attempted && candidate.browserResult?.scopeId === scope.id && candidate.action === 'CLICK' && candidate.effect === 'READ' &&
    candidate.deviceId === scope.deviceId && candidate.executionId === scope.executionId && candidate.sessionId === scope.sessionId && candidate.nodeId === scope.nodeId &&
    (!node || node.id === scope.nodeId && node.packageName === scope.packageName && node.capability === 'OPEN_RESULT' && node.outcome.browserResult?.ordinal === 1 && node.outcome.browserResult.query === scope.query));
}
export function freshBrowserResultTarget(candidate: GroundedCandidateV2, snapshot: Observation) {
  const scope = candidates.get(candidate); return scope ? browserResultTarget(scope, snapshot) : undefined;
}
export function beforeBrowserResultDispatch(candidate: GroundedCandidateV2, snapshot: Observation, destination: string) {
  const scope = candidates.get(candidate), state = scope && active(scope);
  const url = new URL(destination);
  if (!scope || !state || !browserResultTarget(scope, snapshot) || !/^https?:$/.test(url.protocol) || url.username || url.password || isSensitiveControl(destination)) throw Error('BROWSER_RESULT_STALE_OR_REPLAYED');
  state.attempted = true; state.destination = destination;
}
export function acknowledgeBrowserResult(candidate: GroundedCandidateV2) {
  const scope = candidates.get(candidate), state = scope && active(scope);
  if (!state?.attempted || state.acknowledged) throw Error('BROWSER_RESULT_DISPATCH_UNPROVEN');
  state.acknowledged = true;
}
export function browserResultReadback(scope: BrowserResultScope, snapshot: Observation) {
  const state = active(scope);
  if (!state?.acknowledged || !state.destination || !fresh(snapshot, scope.deviceId, scope.packageName) || snapshot.snapshotId === scope.beforeId ||
    snapshot.timestamp < scope.observedAt || snapshot.web?.status !== 'DOM_AVAILABLE') return;
  const selection = { itemType: 'browser' as const, ordinal: 1, identity: scope.link.url, url: state.destination, title: scope.link.title };
  if (!verifyDiscoveredSelection(selection, { foregroundPackage: scope.packageName } as Observation, snapshot)) return;
  return Object.freeze({ query: scope.query, ordinal: 1 as const, surface: 'BROWSER_ORGANIC' as const, url: state.destination, title: scope.link.title, searchEvidenceId: scope.searchEvidenceId });
}
