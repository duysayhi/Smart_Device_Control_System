import { randomUUID } from 'node:crypto';
import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';
import { visibleNode } from './navigation-semantics';
import { EvidencePredicateV2Schema, type EvidencePredicateV2, type VerifiedEvidence } from './evidence-predicates';
import { foldIntent } from './outcome-spec';
import { capturedMediaDelta, type MediaInventory } from './media-evidence';
import { observedLocalizedResult } from './math-keypad';
import { observedRecordIdentity, exactRecordFields, matchingRecordRows, recordListLabel, verified24HourLayout, type RecordValues } from './record-forms';
import { isMediaViewReceipt, type MediaViewReceipt } from '../media-view';
import { navigationLabel } from './ui-affordances';
import { verifyPersistenceReadback, type RecordDraftScope } from './record-persistence';
import { searchResult, searchCommitState, type SearchScope } from './generic-search';
import { NativeFactSchema, verifyNativeFact, type EvidenceAssessment } from './read-only-verifiers';
import { structuralRoles } from './widget-semantics';
import { browserResultReadback, type BrowserResultScope } from './browser-result';

const issued = new WeakSet<VerifiedEvidence>();
const searchScopes = new WeakMap<VerifiedEvidence, Readonly<{ sessionId: string; packageName: string; surface?: 'BROWSER_ORGANIC' }>>();
export const isVerifiedEvidence = (evidence: VerifiedEvidence) => issued.has(evidence);
export const searchEvidenceScope = (evidence: VerifiedEvidence) => searchScopes.get(evidence);
export function verifyBrowserResultOutcome(scope: BrowserResultScope, snapshot: Observation, context: VerificationContext): VerifiedEvidence | undefined {
  if (scope.deviceId !== context.deviceId || scope.executionId !== context.executionId || scope.nodeId !== context.nodeId || scope.packageName !== context.packageName ||
    !verifyPredicate({ kind: 'FOREGROUND_IS', packageName: context.packageName }, snapshot, context).evidence) return;
  const result = browserResultReadback(scope, snapshot); if (!result) return;
  const proof: VerifiedEvidence = Object.freeze({ id: randomUUID(), deviceId: context.deviceId, executionId: context.executionId, nodeId: context.nodeId,
    snapshotId: snapshot.snapshotId, observedAt: snapshot.timestamp, provider: 'BROWSER_RESULT_V2', verified: true,
    predicate: { kind: 'BROWSER_RESULT_MATCHES' as const, query: scope.query, ordinal: 1 as const, surface: 'BROWSER_ORGANIC' as const }, browserResult: result });
  issued.add(proof); return proof;
}
export function verifySearchOutcome(scope: SearchScope, snapshot: Observation, context: VerificationContext): VerifiedEvidence | undefined {
  if (scope.deviceId !== context.deviceId || scope.executionId !== context.executionId || scope.nodeId !== context.nodeId || scope.packageName !== context.packageName ||
    !verifyPredicate({ kind: 'FOREGROUND_IS', packageName: context.packageName }, snapshot, context).evidence) return;
  const result = searchResult(scope, snapshot); if (!result) return;
  const proof: VerifiedEvidence = Object.freeze({ id: randomUUID(), deviceId: context.deviceId, executionId: context.executionId, nodeId: context.nodeId,
    snapshotId: snapshot.snapshotId, observedAt: snapshot.timestamp, provider: scope.surface === 'BROWSER_ORGANIC' ? 'BROWSER_SEARCH_V2' : 'NATIVE_SEARCH_V2', predicate: { kind: 'SEARCH_OUTCOME_MATCHES' as const, query: result.query }, verified: true, search: Object.freeze(result),
    assessment: Object.freeze({ evidenceClass: result.status === 'NO_RESULTS' ? 'EXPLICIT_EMPTY_STATE' as const : 'CORRELATED_RESULT_STATE' as const, confidence: 'CORRELATED' as const,
      why: 'Exact committed query plus independent outcome surface; successful RPC alone is not completion and submit causality is not asserted.' }) });
  searchScopes.set(proof, Object.freeze({ sessionId: scope.sessionId, packageName: scope.packageName, ...(scope.surface ? { surface: scope.surface } : {}) }));
  issued.add(proof); return proof;
}
export function verifyMediaView(receipt: MediaViewReceipt, context: VerificationContext, physicalId: string): VerifiedEvidence | undefined {
  if (!isMediaViewReceipt(receipt) || receipt.deviceId !== context.deviceId || receipt.executionId !== context.executionId || receipt.nodeId !== context.nodeId || receipt.physicalId !== physicalId || receipt.packageName !== context.packageName ||
    Date.now() - receipt.observedAt > 5000 || !verifyPredicate({ kind: 'FOREGROUND_IS', packageName: context.packageName }, receipt.snapshot, context).evidence) return;
  const evidence: VerifiedEvidence = Object.freeze({ id: randomUUID(), deviceId: context.deviceId, executionId: context.executionId, nodeId: context.nodeId,
    snapshotId: receipt.snapshot.snapshotId, observedAt: receipt.observedAt, predicate: { kind: 'ARTIFACT_IDENTITY_MATCHES' as const, artifactId: receipt.uri }, provider: 'ANDROID_MEDIA_URI_V2', verified: true, media: receipt.media,
    assessment: { evidenceClass: 'ARTIFACT_IDENTITY' as const, confidence: 'DIRECT' as const, why: 'Issued exact-URI handoff and matching active viewer receipt; not Gallery UI search.' } });
  issued.add(evidence); return evidence;
}
export function verifyRecordReadback(draft: Observation, list: Observation, reopened: Observation, fields: RecordValues, identity: string, context: VerificationContext, scope?: RecordDraftScope): VerifiedEvidence | undefined {
  const persistence = scope ? verifyPersistenceReadback(scope, list, reopened, context.executionId) : undefined;
  if (scope && (!persistence || persistence.identity !== identity || scope.draft.snapshotId !== draft.snapshotId || JSON.stringify(scope.fields) !== JSON.stringify(fields))) return;
  if (![draft, list, reopened].every(s => s.deviceSerial === context.deviceId && s.foregroundPackage === context.packageName && s.observationStatus === 'OBSERVED') ||
    new Set([draft.snapshotId, list.snapshotId, reopened.snapshotId]).size !== 3 || draft.timestamp > list.timestamp || list.timestamp > reopened.timestamp || reopened.timestamp - draft.timestamp > 120000 ||
    (!scope && (observedRecordIdentity(draft) !== identity || observedRecordIdentity(reopened) !== identity)) || !exactRecordFields(reopened, fields) ||
    !verifyPredicate({ kind: 'FOREGROUND_IS', packageName: context.packageName }, reopened, context).evidence) return;
  if (!scope && matchingRecordRows(list, identity, recordListLabel(fields), context.executionId, '').length !== 1) return;
  if (fields.hour !== undefined && (!verified24HourLayout(draft) || !verified24HourLayout(reopened))) return;
  const evidence: VerifiedEvidence = Object.freeze({ id: randomUUID(), deviceId: context.deviceId, executionId: context.executionId, nodeId: context.nodeId,
    snapshotId: reopened.snapshotId, observedAt: reopened.timestamp, predicate: { kind: 'RECORD_READBACK_MATCHES' as const, artifactId: identity }, provider: 'NATIVE_RECORD_READBACK_V2', verified: true,
    record: Object.freeze({ identity, packageName: context.packageName, fields: Object.freeze({ ...fields }), listSnapshotId: list.snapshotId, strategy: persistence?.strategy ?? 'STABLE_DRAFT_ID' }),
    assessment: { evidenceClass: 'PROVIDER_READBACK' as const, confidence: 'DIRECT' as const, why: 'Disambiguated persisted identity and exact fields after independent reopen/readback.' } });
  issued.add(evidence); return evidence;
}
export function verifyCapturedMedia(before: MediaInventory, after: MediaInventory, snapshot: Observation, context: VerificationContext, physicalId: string): VerifiedEvidence | undefined {
  if (!verifyPredicate({ kind: 'FOREGROUND_IS', packageName: context.packageName }, snapshot, context).evidence) return;
  const media = capturedMediaDelta(before, after, context.deviceId, physicalId, context.packageName);
  if (!media) return;
  const evidence: VerifiedEvidence = Object.freeze({ id: randomUUID(), deviceId: context.deviceId, executionId: context.executionId, nodeId: context.nodeId,
    snapshotId: snapshot.snapshotId, observedAt: after.observedAt, predicate: { kind: 'ARTIFACT_EXISTS' as const, artifactId: media.uri }, provider: 'MEDIA_STORE_V2', media, verified: true,
    assessment: { evidenceClass: 'PROVIDER_READBACK' as const, confidence: 'DIRECT' as const, why: 'Unique issued MediaStore delta with owner, size, URI and device provenance.' } });
  issued.add(evidence); return evidence;
}
export interface VerificationContext {
  deviceId: string; executionId: string; nodeId: string; packageName: string;
  // Set by the executor path only after an exact expression field readback.
  observedExpression?: string;
  numberLocale?: string;
}
export function verifyPredicate(predicate: EvidencePredicateV2, snapshot: Observation, context: VerificationContext): { evidence?: VerifiedEvidence; reason: string } {
  predicate = EvidencePredicateV2Schema.parse(predicate);
  if (snapshot.deviceSerial !== context.deviceId || snapshot.foregroundPackage !== context.packageName || snapshot.observationStatus !== 'OBSERVED' ||
    Date.now() - snapshot.timestamp < 0 || Date.now() - snapshot.timestamp > 5000) return { reason: 'STALE_OR_FOREIGN_EVIDENCE' };
  if (snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId))) return { reason: 'SYSTEM_OVERLAY' };
  if (snapshot.nodes.some(n => n.displayed !== false && (/Dialog|ProgressBar/.test(n.className) || n.resourceId === 'android:id/alertTitle'))) return { reason: 'UI_NOT_READY' };
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n));
  const exact = (text: string, expected: string) => text.normalize('NFC').trim() === expected.normalize('NFC').trim();
  let verified = false;
  let assessment: EvidenceAssessment | undefined;
  const nativeFact = NativeFactSchema.safeParse(predicate);
  if (nativeFact.success) {
    assessment = nativeFact.data.kind === 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED' ? searchCommitState(nativeFact.data.scopeId, snapshot, context) : verifyNativeFact(nativeFact.data, snapshot);
    verified = Boolean(assessment);
  }
  switch (predicate.kind) {
    case 'FOREGROUND_IS': verified = context.packageName === predicate.packageName && visible.length > 0; break;
    case 'ELEMENT_VISIBLE': verified = visible.some(n => !n.clickable && foldIntent(n.text || n.description) === foldIntent(predicate.label) && /toolbar|action_bar|page_title|screen_title/.test(n.resourceId)) ||
      visible.filter(n => structuralRoles(n).includes('navigation') && navigationLabel(n.description || n.text, n.className) === foldIntent(predicate.label)).length === 1 &&
      visible.some(n => structuralRoles(n).includes('navigation') && n.enabled && n.selected === true && navigationLabel(n.description || n.text, n.className) === foldIntent(predicate.label)); break;
    case 'TEXT_EQUALS': verified = visible.some(n => exact(n.text, predicate.value)); break;
    case 'CONTROL_ENABLED': verified = visible.filter(n => (n.text || n.description) === predicate.label && n.enabled).length === 1; break;
    case 'ITEM_SELECTED': {
      const matches = visible.filter(n => foldIntent(n.description || n.text) === foldIntent(predicate.label) && n.checkable === true);
      verified = matches.length === 1 && matches[0].checked === predicate.checked; break;
    }
    case 'STATE_CHANGED': verified = geometryFingerprint(snapshot) !== predicate.beforeFingerprint; break;
    case 'VALUE_EQUALS': verified = context.observedExpression === predicate.expression && (visible.some(n => !n.clickable && !n.focused && exact(n.text, predicate.value)) || Boolean(context.numberLocale && observedLocalizedResult(snapshot, predicate.value, context.numberLocale))); break;
    case 'MEDIA_PLAYBACK_PROGRESS': verified = Boolean(snapshot.playback && snapshot.playback.packageName === context.packageName && snapshot.playback.title === predicate.title && snapshot.playback.positionMs > snapshot.playback.previousPositionMs);
      assessment = { evidenceClass: 'PLAYBACK_PROGRESS', confidence: 'DIRECT', why: 'Same app/title with independently observed advancing playback position.' }; break;
    default: if (!nativeFact.success) return { reason: 'VERIFICATION_PROVIDER_UNAVAILABLE' };
  }
  if (!verified) return { reason: 'PREDICATE_NOT_SATISFIED' };
  const evidence: VerifiedEvidence = Object.freeze({ id: randomUUID(), deviceId: context.deviceId, executionId: context.executionId, nodeId: context.nodeId,
    snapshotId: snapshot.snapshotId, observedAt: snapshot.timestamp, predicate, assessment: assessment ?? { evidenceClass: 'EXACT_NATIVE_READBACK' as const, confidence: 'DIRECT' as const, why: 'Registered backend predicate satisfied by fresh device-bound evidence.' }, provider: predicate.kind === 'MEDIA_PLAYBACK_PROGRESS' ? 'ANDROID_MEDIA_V2' : 'NATIVE_UI_V2', verified: true });
  issued.add(evidence);
  return { evidence, reason: 'VERIFIED' };
}
