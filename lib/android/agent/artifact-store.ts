import { randomUUID } from 'node:crypto';
import type { VerifiedEvidence } from './evidence-predicates';
import { isVerifiedEvidence } from './verification-registry';
export interface MediaViewGrant { artifactId: string; deviceId: string; physicalId: string; executionId: string; nodeId: string; sessionId: string; packageName: string; expiresAt: number; media: import('./media-evidence').SavedMediaIdentity }
const viewGrants = new WeakSet<MediaViewGrant>();
export function consumeMediaViewGrant(grant: MediaViewGrant, deviceId: string, sessionId: string) {
  if (!viewGrants.has(grant) || grant.deviceId !== deviceId || grant.sessionId !== sessionId || grant.expiresAt <= Date.now()) throw Error('Media view grant is untrusted, expired, replayed or foreign.');
  viewGrants.delete(grant);
}

export interface ArtifactRef {
  id: string; deviceId: string; physicalId: string; executionId: string; nodeId: string;
  kind: 'OBSERVED_STATE' | 'SAVED_MEDIA' | 'RECORD'; evidenceId: string; provider: string; createdAt: number; expiresAt: number;
  media?: import('./media-evidence').SavedMediaIdentity;
  record?: import('./evidence-predicates').VerifiedEvidence['record'];
  sensitivity: 'PRIVATE_METADATA'; consumers: readonly string[];
}
export class ArtifactStore {
  private readonly artifacts = new Map<string, ArtifactRef>();
  constructor(private readonly deviceId: string, private readonly physicalId: string, private readonly executionId: string) {}
  put(evidence: VerifiedEvidence, consumers: string[], ttlMs = 120000): ArtifactRef {
    if (!isVerifiedEvidence(evidence) || evidence.deviceId !== this.deviceId || evidence.executionId !== this.executionId || Date.now() - evidence.observedAt > 5000 || ttlMs < 1 || ttlMs > 300000) throw new Error('Artifact evidence is untrusted, stale or foreign.');
    if (this.artifacts.size >= 32) throw new Error('Artifact budget exceeded.');
    if ([...this.artifacts.values()].some(ref => ref.evidenceId === evidence.id || evidence.media && ref.media?.uri === evidence.media.uri || evidence.record && ref.record?.identity === evidence.record.identity && ref.record.packageName === evidence.record.packageName)) throw new Error('Duplicate artifact/evidence cannot become another identity.');
    const ref: ArtifactRef = Object.freeze({ id: randomUUID(), deviceId: this.deviceId, physicalId: this.physicalId, executionId: this.executionId, nodeId: evidence.nodeId,
      kind: evidence.media ? 'SAVED_MEDIA' : evidence.record ? 'RECORD' : 'OBSERVED_STATE', media: evidence.media, record: evidence.record, evidenceId: evidence.id, provider: evidence.provider, createdAt: Date.now(), expiresAt: Date.now() + ttlMs, sensitivity: 'PRIVATE_METADATA', consumers: Object.freeze([...consumers]) });
    this.artifacts.set(ref.id, ref); return ref;
  }
  read(id: string, deviceId: string, executionId: string, consumer: string, physicalId = this.physicalId): ArtifactRef {
    const ref = this.artifacts.get(id);
    if (!ref || ref.deviceId !== deviceId || ref.executionId !== executionId || ref.physicalId !== physicalId || !ref.consumers.includes(consumer) || ref.expiresAt <= Date.now()) throw new Error('Artifact unavailable for this consumer/device/execution.');
    return ref;
  }
  ids() { return [...this.artifacts.keys()]; }
  issueView(id: string, consumer: string, packageName: string, sessionId: string): MediaViewGrant {
    const ref = this.read(id, this.deviceId, this.executionId, consumer);
    if (ref.kind !== 'SAVED_MEDIA' || !ref.media || !/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(packageName) || !sessionId) throw Error('No typed media identity/viewer for this consumer.');
    const grant = Object.freeze({ artifactId: id, deviceId: this.deviceId, physicalId: this.physicalId, executionId: this.executionId, nodeId: consumer, sessionId, packageName,
      expiresAt: Math.min(ref.expiresAt, Date.now() + 10000), media: ref.media });
    viewGrants.add(grant); return grant;
  }
  summaries() { return [...this.artifacts.values()].map(ref => ({ id: ref.id, kind: ref.kind, provider: ref.provider, evidenceId: ref.evidenceId, mediaUri: ref.media?.uri, mimeType: ref.media?.mimeType, size: ref.media?.size, recordIdentity: ref.record?.identity, recordFields: ref.record ? Object.keys(ref.record.fields) : undefined, persistenceStrategy: ref.record?.strategy })); }
  dispose() { this.artifacts.clear(); }
}
