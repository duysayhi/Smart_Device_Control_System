import { z } from 'zod';
import { compileSkill, parseDemonstration, type SkillCompilation } from './skill-compiler';
import { SanitizedTeachSnapshotSchema } from './snapshot-sanitizer';
import { inspectJson } from './skill-safety';
import { loadSkillProgram, programError, type SkillProgram } from './skill-program';

const uuid = z.uuid();
const context = { recordingRef: uuid, deviceId: z.string().min(1).max(256), physicalId: z.string().regex(/^android:[a-f0-9]{64}$/), executionId: uuid, sessionId: z.string().min(1).max(200) };
const receipt = z.object({ id: uuid, requestId: uuid, ...context, leaseId: uuid, operation: z.string().min(1).max(40),
  dispatch: z.enum(['ACK', 'NOT_SENT', 'UNKNOWN']), verification: z.enum(['PASSED', 'FAILED', 'UNVERIFIED']),
  evidenceId: uuid.optional(), reason: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(), at: z.number().finite(), action: z.unknown().optional(),
  before: SanitizedTeachSnapshotSchema, after: SanitizedTeachSnapshotSchema.optional(), beforeSnapshotId: uuid, afterSnapshotId: uuid.optional(),
  provenance: z.enum(['ANDROID_RUNTIME', 'SIMULATED_RECEIPT', 'LEGACY_UNATTESTED']).optional() }).strict();
export const RecordedSourceV1Schema = z.object({ contractVersion: z.literal(1), name: z.string().min(1).max(120), appAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  origin: z.enum(['ANDROID_RUNTIME', 'SIMULATED_RECEIPT']), ownerParameterizationConfirmed: z.boolean(), ...context,
  actions: z.array(z.object({ order: z.number().int().positive(), persistence: z.literal('PERSISTED'), receipt }).strict()).min(1).max(20) }).strict();
export type RecordedActionV1 = z.infer<typeof receipt>;
export interface RecordedCompilation {
  contractVersion: 1; compilation: SkillCompilation; program?: SkillProgram;
  provenance: 'ANDROID_RUNTIME' | 'OFFLINE_TEST'; evidenceReferences: { stepId: string; receiptId: string; evidenceId: string; beforeId: string; afterId: string }[];
  maxStatus: 'PENDING_VALIDATION'; reviewRequired: true;
}
/** Pure normalization; caller supplies backend-held source, never client-issued proof. No evidence is minted. */
export function compileRecordedSkill(input: unknown): RecordedCompilation {
  // Runtime identifiers occur only in this separate provenance envelope, never in the DSL.
  if (inspectJson(input, false).errors.length) programError('RECORDED_SOURCE_INVALID');
  const parsed = RecordedSourceV1Schema.safeParse(input);
  if (!parsed.success) programError('RECORDED_SOURCE_INVALID');
  const source = parsed.data, receipts = new Set<string>(), requests = new Set<string>(), refs: RecordedCompilation['evidenceReferences'] = [];
  for (const [index, row] of source.actions.entries()) {
    const r = row.receipt;
    if (row.order !== index + 1 || receipts.has(r.id) || requests.has(r.requestId)) programError('RECORDED_ORDER_OR_REPLAY_INVALID');
    receipts.add(r.id); requests.add(r.requestId);
    if ((Object.keys(context) as (keyof typeof context)[]).some(key => r[key] !== source[key])) programError('RECORDED_CONTEXT_MISMATCH');
    if (r.provenance !== source.origin) programError('RECORDED_PROVENANCE_UNATTESTED');
    if (r.dispatch === 'UNKNOWN' || r.verification !== 'PASSED' || !r.evidenceId || !r.after || !r.afterSnapshotId || r.beforeSnapshotId === r.afterSnapshotId || !r.action) programError('RECORDED_EVIDENCE_INCOMPLETE');
    if (r.dispatch === 'NOT_SENT' && !['OPEN_APPLICATION', 'OBSERVE_UI', 'ASSERT_UI'].includes(r.operation)) programError('RECORDED_EFFECT_NOT_OBSERVED');
    if (r.operation !== (r.action as {operation?:unknown}).operation) programError('RECORDED_ACTION_MISMATCH');
    refs.push({ stepId: 's' + (index + 1), receiptId: r.id, evidenceId: r.evidenceId, beforeId: r.beforeSnapshotId, afterId: r.afterSnapshotId });
  }
  const demo = parseDemonstration({ name: source.name, appAlias: source.appAlias, actions: source.actions.map(row => row.receipt.action) });
  if (!demo) programError('RECORDED_ACTION_INVALID');
  if (demo.actions.some(a => a.operation === 'INPUT_TEXT') && !source.ownerParameterizationConfirmed) programError('PARAMETER_REVIEW_REQUIRED');
  const compilation = compileSkill(demo);
  return { contractVersion: 1, compilation, ...(compilation.draft ? { program: loadSkillProgram(compilation.draft) } : {}),
    provenance: source.origin === 'ANDROID_RUNTIME' ? 'ANDROID_RUNTIME' : 'OFFLINE_TEST', evidenceReferences: refs, maxStatus: 'PENDING_VALIDATION', reviewRequired: true };
}
