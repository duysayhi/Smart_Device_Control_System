import { z } from 'zod';
import type { EvidencePredicateV2 } from '../android/agent/evidence-predicates';
import { inspectJson, safePath, sensitiveMetadata, sensitiveValue, skillIssue, type SkillIssue } from './skill-safety';
export { FORBIDDEN_KEYS } from './skill-safety';

const alias = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const content = (limit: number) => z.string().min(1).max(limit).refine(value => !sensitiveValue(value));
const parameterName = identifier.refine(value => !sensitiveMetadata(value) && !/^(?:ordinal|resultIndex)$/i.test(value));
const parameterRef = z.object({ param: parameterName }).strict();
const textValue = z.union([content(500), parameterRef]);
const parameter = z.object({ type: z.enum(['string', 'integer']), maxLength: z.number().int().min(1).max(500),
  required: z.boolean(), description: content(500) }).strict();

const targetDescriptor = z.object({
  semanticRole: z.enum(['navigation', 'search_action', 'search_field', 'search_results', 'scroll_container', 'dialog', 'status']),
  label: content(120).optional(), labelParam: parameterName.optional(),
  containerRole: z.enum(['app', 'toolbar', 'navigation', 'search', 'results', 'dialog']),
  resourceIdHint: z.string().regex(/^[A-Za-z0-9_:/.-]{1,160}$/).optional(),
}).strict().refine(target => (target.label !== undefined) !== (target.labelParam !== undefined));

// These are declarative bindings to existing predicates, NOT serialized evidence.
// appRef/target/scope are resolved to fresh backend context by a later, approved seam.
const predicate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FOREGROUND_IS'), appRef: alias }).strict(),
  z.object({ kind: z.literal('ELEMENT_VISIBLE'), target: targetDescriptor }).strict(),
  z.object({ kind: z.literal('CONTROL_ENABLED'), target: targetDescriptor }).strict(),
  z.object({ kind: z.literal('TEXT_EQUALS'), value: content(500) }).strict(),
  z.object({ kind: z.literal('WIDGET_STATE'), target: targetDescriptor, property: z.literal('value'), expected: textValue }).strict(),
  z.object({ kind: z.literal('STATE_CHANGED') }).strict(),
  z.object({ kind: z.literal('SEARCH_OUTCOME_MATCHES'), scope: identifier, value: textValue }).strict(),
  z.object({ kind: z.literal('KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED'), scope: identifier }).strict(),
]);
export const SKILL_VERIFIERS = Object.freeze(predicate.options.map(option => option.shape.kind.value)) satisfies readonly EvidencePredicateV2['kind'][];
export type SkillVerifier = z.infer<typeof predicate>;

const common = { id: identifier, target: targetDescriptor.optional(), verify: predicate, effectClass: z.literal('READ'),
  timeoutMs: z.number().int().min(1).max(120000), onFail: z.enum(['BLOCK', 'ASK_USER']) };
const step = z.discriminatedUnion('operation', [
  z.object({ ...common, operation: z.literal('OPEN_APPLICATION'), arguments: z.object({ appRef: alias }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('ACTIVATE_CONTROL'), arguments: z.object({ target: targetDescriptor, purpose: z.enum(['NAVIGATION', 'SEARCH']) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('INPUT_TEXT'), arguments: z.object({ target: targetDescriptor, value: textValue }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('SUBMIT_SEARCH'), arguments: z.object({ scope: identifier }).strict() }).strict(),
  // Two public spellings of one observation/assertion family; neither dispatches an effect.
  z.object({ ...common, operation: z.enum(['OBSERVE_UI', 'ASSERT_UI']), arguments: z.object({ predicate }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('SCROLL_CONTAINER'), arguments: z.object({ target: targetDescriptor,
    direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']), maxAttempts: z.number().int().min(1).max(5) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('BACK'), arguments: z.object({ reason: z.enum(['DISMISS_BENIGN', 'SEARCH_RECOVERY']) }).strict() }).strict(),
]);
export const SKILL_OPERATION_FAMILIES = Object.freeze([
  'OPEN_APPLICATION', 'ACTIVATE_CONTROL', 'INPUT_TEXT', 'SUBMIT_SEARCH', 'OBSERVE_UI/ASSERT_UI', 'SCROLL_CONTAINER', 'BACK',
] as const);
export const SKILL_OPERATIONS = Object.freeze([
  'OPEN_APPLICATION', 'ACTIVATE_CONTROL', 'INPUT_TEXT', 'SUBMIT_SEARCH', 'OBSERVE_UI', 'ASSERT_UI', 'SCROLL_CONTAINER', 'BACK',
] as const);

const rawSkill = z.object({ schemaVersion: z.literal(1), name: content(120), appScope: z.object({ alias }).strict(),
  parameters: z.record(parameterName, parameter).refine(parameters => Object.keys(parameters).length <= 20),
  steps: z.array(step).min(1).max(20), maxSteps: z.number().int().min(1).max(20).default(20),
}).strict();
export type SkillDefinition = z.infer<typeof rawSkill>;
export type SkillStep = SkillDefinition['steps'][number];
export type TargetDescriptor = z.infer<typeof targetDescriptor>;
export type SkillTextValue = z.infer<typeof textValue>;
// Shared validation exports; the persisted DSL shape and schemaVersion stay unchanged.
export const SkillTargetDescriptorSchema = targetDescriptor;
export const SkillStepSchema = step;
export const SkillVerifierSchema = predicate;
export type SkillParse = { success: true; data: SkillDefinition } | { success: false; errors: SkillIssue[] };

/** Public errors never expose Zod's received values or unrecognized key names. */
export function parseSkillStructure(input: unknown): SkillParse {
  const inspected = inspectJson(input);
  if (inspected.errors.length) return { success: false, errors: inspected.errors };
  try {
    const result = rawSkill.safeParse(input);
    if (!result.success) return { success: false, errors: result.error.issues.slice(0, 32).map(issue => skillIssue('INVALID_SCHEMA', safePath(issue.path))) };
    const errors: SkillIssue[] = [], skill = result.data;
    if (skill.steps.length > skill.maxSteps || new Set(skill.steps.map(s => s.id)).size !== skill.steps.length) errors.push(skillIssue('STEP_LIMIT', '/steps'));
    if (skill.steps.reduce((sum, s) => sum + s.timeoutMs, 0) > 120000) errors.push(skillIssue('TIMEOUT_LIMIT', '/steps'));
    return errors.length ? { success: false, errors } : { success: true, data: skill };
  } catch { return { success: false, errors: [skillIssue('INVALID_SCHEMA', '/')] }; }
}

// Zod remains usable by future contracts without leaking its internal raw diagnostics.
export const SkillSchema = z.unknown().transform((input, context) => {
  const result = parseSkillStructure(input);
  if (result.success) return result.data;
  for (const issue of result.errors) context.addIssue({ code: 'custom', message: issue.message,
    path: issue.path.split('/').slice(1).filter(Boolean).map(p => /^\d+$/.test(p) ? Number(p) : p) });
  return z.NEVER;
});
