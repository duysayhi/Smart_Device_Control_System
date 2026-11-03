import { createHash } from 'node:crypto';
import { parseSkillStructure, type SkillDefinition, type SkillStep, type SkillVerifier, type TargetDescriptor } from './skill-schema';
import { validateSkill } from './skill-validator';
import { sensitiveValue, inspectJson } from './skill-safety';

export type SkillDefinitionV1 = SkillDefinition;
export type SemanticActionV1 = SkillStep;
export type SkillParameterSchema = SkillDefinition['parameters'];
export class SkillProgramError extends Error {
  constructor(readonly code: string, readonly path = '/') { super(code); }
}
export function programError(code: string, path = '/'): never { throw new SkillProgramError(code, path); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(v=>v===undefined?'null':stableJson(v)).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k=>(value as Record<string,unknown>)[k]!==undefined).sort().map(k => JSON.stringify(k) + ':' + stableJson((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value)??'null';
}
/** Runtime integrity digest only; never written to the database's content_hash column. */
export const definitionDigest = (definition: SkillDefinition) => createHash('sha256').update(stableJson(definition)).digest('hex');
export interface ReplayStep {
  step: SkillStep;
  preconditions: readonly ('DEVICE_IDENTITY' | 'OWNED_SESSION' | 'FRESH_OBSERVATION' | 'APP_FOREGROUND' | 'UNIQUE_SEMANTIC_TARGET' | 'SEARCH_SCOPE')[];
  postcondition: SkillVerifier;
}
export interface SkillProgram {
  contractVersion: 1; definition: SkillDefinition; definitionDigest: string; steps: ReplayStep[];
  goal:{appAlias:string;terminalStepId:string;postcondition:SkillVerifier};
  compatibility: { schemaVersion: 1; supported: boolean; issues: { code: string; stepId?: string }[]; experimental: true; realDevice: 'UNVERIFIED' };
}
export function loadSkillProgram(input: unknown): SkillProgram {
  const parsed = parseSkillStructure(input);
  if (!parsed.success) programError('SKILL_SCHEMA_INCOMPATIBLE',parsed.errors[0]?.path??'/');
  const validation = validateSkill(parsed.data);
  if (!validation.ok) programError('SKILL_SEMANTICS_INVALID');
  const definition = structuredClone(parsed.data), issues: SkillProgram['compatibility']['issues'] = [];
  if (validation.warnings.some(w => w.code === 'MISSING_TERMINAL_VERIFIER')) issues.push({ code: 'TERMINAL_VERIFIER_REQUIRED' });
  if(definition.steps.filter(s=>s.operation==='ACTIVATE_CONTROL'&&s.arguments.purpose==='SEARCH').length>1)issues.push({code:'MULTIPLE_SEARCH_SCOPES_UNSUPPORTED'});
  const steps = definition.steps.map(step => {
    if (step.operation === 'SCROLL_CONTAINER' && step.arguments.direction !== 'DOWN') issues.push({ code: 'SCROLL_DIRECTION_UNSUPPORTED', stepId: step.id });
    const preconditions: ReplayStep['preconditions'][number][] = ['DEVICE_IDENTITY', 'OWNED_SESSION', 'FRESH_OBSERVATION'];
    if (step.operation !== 'OPEN_APPLICATION') preconditions.push('APP_FOREGROUND');
    if ('target' in step.arguments) preconditions.push('UNIQUE_SEMANTIC_TARGET');
    if (['INPUT_TEXT', 'SUBMIT_SEARCH'].includes(step.operation)) preconditions.push('SEARCH_SCOPE');
    return { step, preconditions, postcondition: step.verify };
  });
  return { contractVersion: 1, definition, definitionDigest: definitionDigest(definition), steps,
    goal:{appAlias:definition.appScope.alias,terminalStepId:definition.steps.at(-1)!.id,postcondition:definition.steps.at(-1)!.verify},
    compatibility: { schemaVersion: 1, supported: issues.length === 0, issues, experimental: true, realDevice: 'UNVERIFIED' } };
}
export function bindSkillParameters(program: SkillProgram, input: unknown): SkillDefinition {
  if (inspectJson(input).errors.length || !input || typeof input !== 'object' || Array.isArray(input)) programError('PARAMETERS_INVALID');
  const values = input as Record<string, unknown>, declarations = program.definition.parameters;
  if (Object.keys(values).some(key => !Object.hasOwn(declarations, key))) programError('PARAMETER_UNKNOWN');
  for (const [name, declaration] of Object.entries(declarations)) {
    const value = values[name];
    if (value === undefined) { if (declaration.required) programError('PARAMETER_REQUIRED'); continue; }
    if (declaration.type === 'string' ? typeof value !== 'string' || !value.trim() || value.length > declaration.maxLength || sensitiveValue(value) :
      !Number.isSafeInteger(value) || String(value).length > declaration.maxLength) programError('PARAMETER_VALUE_INVALID');
  }
  function bind(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(bind);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length === 1 && typeof row.param === 'string') return values[row.param] ?? programError('PARAMETER_REQUIRED');
    return Object.fromEntries(Object.entries(row).map(([key, child]) => key === 'labelParam' ? ['label', values[String(child)] ?? programError('PARAMETER_REQUIRED')] : [key, bind(child)]));
  }
  const bound = { ...structuredClone(program.definition), steps: bind(program.definition.steps) };
  const parsed = parseSkillStructure(bound);
  if (!parsed.success || !validateSkill(parsed.data).ok) programError('BOUND_SKILL_INVALID');
  // A single owned search scope is supported by the current one-step seam.
  const queries = parsed.data.steps.filter(s => s.operation === 'INPUT_TEXT').map(s => String(s.arguments.value));
  if (new Set(queries).size > 1) programError('MULTIPLE_SEARCH_VALUES_UNSUPPORTED');
  return parsed.data;
}
export function semanticTargetMatches(expected: TargetDescriptor, actual: TargetDescriptor): boolean {
  const fold = (v: string | undefined) => v?.normalize('NFC').trim().toLocaleLowerCase('en-US');
  if (expected.semanticRole !== actual.semanticRole || expected.containerRole !== actual.containerRole || !expected.label || !actual.label) return false;
  // resourceIdHint is a hint across app/device versions, never a substitute for the semantic role/label.
  return fold(expected.label) === fold(actual.label);
}
