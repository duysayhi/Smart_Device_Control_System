import { z } from 'zod';
import { NativeFactSchema, type EvidenceAssessment } from './read-only-verifiers';

export const EvidencePredicateV2Schema = z.discriminatedUnion('kind', [
  ...NativeFactSchema.options,
  z.object({ kind: z.literal('FOREGROUND_IS'), packageName: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('ELEMENT_VISIBLE'), label: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('TEXT_EQUALS'), value: z.string() }).strict(),
  z.object({ kind: z.literal('VALUE_EQUALS'), expression: z.string().min(1), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('ITEM_SELECTED'), label: z.string().min(1), checked: z.boolean() }).strict(),
  z.object({ kind: z.literal('CONTROL_ENABLED'), label: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('STATE_CHANGED'), beforeFingerprint: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('RECORD_READBACK_MATCHES'), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('SEARCH_OUTCOME_MATCHES'), query: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('ARTIFACT_EXISTS'), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('ARTIFACT_IDENTITY_MATCHES'), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('MEDIA_PLAYBACK_PROGRESS'), title: z.string().min(1) }).strict(),
]);
export type EvidencePredicateV2 = z.infer<typeof EvidencePredicateV2Schema>;
export interface VerifiedEvidence {
  assessment?: EvidenceAssessment;
  id: string; deviceId: string; executionId: string; nodeId: string; snapshotId: string; observedAt: number;
  provider: 'NATIVE_UI_V2' | 'ANDROID_MEDIA_V2' | 'MEDIA_STORE_V2' | 'NATIVE_RECORD_READBACK_V2' | 'ANDROID_MEDIA_URI_V2' | 'NATIVE_SEARCH_V2'; predicate: EvidencePredicateV2; verified: true;
  search?: { query: string; status: 'RESULTS' | 'NO_RESULTS'; count: number; submission?: 'EXPLICIT_RPC' | 'LIVE_TRANSITION' };
  media?: import('./media-evidence').SavedMediaIdentity;
  record?: { identity: string; packageName: string; fields: Readonly<Record<string, string | boolean>>; listSnapshotId: string; strategy?: import('./record-persistence').PersistenceStrategy };
}
