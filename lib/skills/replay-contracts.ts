import type { SkillStep } from './skill-schema';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { stableJson, programError } from './skill-program';
import { ReplayCheckpointSchema, type ReplayCheckpoint } from './replay-schemas';
export * from './replay-schemas';

export const predicateDigest = (step: SkillStep) => createHash('sha256').update(stableJson(step.verify)).digest('hex');
export function checkpointSignature(value: Omit<ReplayCheckpoint,'signature'>, key: Buffer): string { return createHmac('sha256',key).update(stableJson(value)).digest('hex'); }
export function parseCheckpoint(input: unknown, key: Buffer): ReplayCheckpoint {
  const parsed=ReplayCheckpointSchema.safeParse(input);if(!parsed.success)programError('CHECKPOINT_INVALID');
  const {signature,...body}=parsed.data,expected=checkpointSignature(body,key);
  if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))programError('CHECKPOINT_INTEGRITY_FAILED');return parsed.data;
}
