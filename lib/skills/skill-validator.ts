import { EvidencePredicateV2Schema, type EvidencePredicateV2 } from '../android/agent/evidence-predicates';
import { forbiddenDispatchControl } from '../android/safety-envelope';
import { sensitiveAffordance } from '../android/agent/ui-affordances';
import { parseSkillStructure, SKILL_OPERATIONS, SKILL_VERIFIERS, type SkillDefinition, type SkillStep, type SkillTextValue, type TargetDescriptor } from './skill-schema';
import { inspectJson, safePath, sensitiveMetadata, sensitiveValue, skillIssue, type SkillIssue } from './skill-safety';

// A subset of the actual registry contract. No verifier is invented or executed here.
const allow = (...kinds: EvidencePredicateV2['kind'][]) => Object.freeze(kinds);
export const OPERATION_VERIFIERS = Object.freeze({
  OPEN_APPLICATION: allow('FOREGROUND_IS'),
  ACTIVATE_CONTROL: allow('ELEMENT_VISIBLE', 'CONTROL_ENABLED'),
  INPUT_TEXT: allow('WIDGET_STATE'),
  SUBMIT_SEARCH: allow('SEARCH_OUTCOME_MATCHES', 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED'),
  OBSERVE_UI: SKILL_VERIFIERS, ASSERT_UI: SKILL_VERIFIERS,
  SCROLL_CONTAINER: allow('STATE_CHANGED', 'ELEMENT_VISIBLE'),
  BACK: allow('STATE_CHANGED', 'ELEMENT_VISIBLE'),
} satisfies Record<SkillStep['operation'], readonly EvidencePredicateV2['kind'][]>);

export interface SkillValidation {
  ok: boolean; errors: SkillIssue[]; warnings: SkillIssue[]; maxStatus: 'DRAFT' | 'PENDING_VALIDATION';
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isSearchField = (target: TargetDescriptor) => target.semanticRole === 'search_field' && target.containerRole === 'search';
const issueOrder = (a: SkillIssue, b: SkillIssue) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code);
function result(errors: SkillIssue[], warnings: SkillIssue[] = []): SkillValidation {
  return { ok: errors.length === 0, errors: errors.sort(issueOrder), warnings: warnings.sort(issueOrder), maxStatus: errors.length ? 'DRAFT' : 'PENDING_VALIDATION' };
}

/** Input is inspected before property access; all diagnostics use closed codes/paths. */
function inspectSemantics(input: unknown): SkillIssue[] {
  const errors: SkillIssue[] = [], stack = [{ value: input, path: [] as PropertyKey[] }];
  while (stack.length) {
    const { value, path } = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    for (const key of Object.keys(value).sort().reverse()) {
      const child: unknown = (value as Record<string, unknown>)[key];
      const next = [...path, Array.isArray(value) ? Number(key) : key], at = safePath(next);
      if ((key === 'ordinal' || key.toLowerCase() === 'resultindex') && (typeof child !== 'number' || child > 1)) errors.push(skillIssue('UNSUPPORTED_IN_MVP', at));
      if (path.at(-1) === 'parameters' && sensitiveMetadata(key)) errors.push(skillIssue('SENSITIVE_PARAMETER', at));
      if (path.at(-1) === 'parameters' && /^(?:ordinal|resultIndex)$/i.test(key)) errors.push(skillIssue('UNSUPPORTED_IN_MVP', at));
      if (typeof child === 'string') {
        if (key === 'operation' && !(SKILL_OPERATIONS as readonly string[]).includes(child)) {
          errors.push(skillIssue(/HOME|PRESS_KEY|TAP_POINT|SWIPE|SELECT.*RESULT|PLAY/i.test(child) ? 'UNSUPPORTED_IN_MVP' : 'UNKNOWN_OPERATION', at));
        }
        if (key === 'kind' && (path.includes('verify') || path.includes('predicate')) && !(SKILL_VERIFIERS as readonly string[]).includes(child)) errors.push(skillIssue('UNKNOWN_VERIFIER', at));
        if (sensitiveValue(child)) errors.push(skillIssue('SENSITIVE_CONTENT', at));
        if (['semanticRole', 'label', 'resourceIdHint', 'purpose', 'reason', 'operation', 'appRef'].includes(key)) {
          if (forbiddenDispatchControl(child)) errors.push(skillIssue('HARD_DENY', at));
          if (sensitiveMetadata(child) || sensitiveAffordance(child)) errors.push(skillIssue('SENSITIVE_CONTENT', at));
        }
      } else if (child && typeof child === 'object') stack.push({ value: child, path: next });
      if (errors.length >= 32) return errors.slice(0, 32);
    }
  }
  return errors;
}

function validateBindings(skill: SkillDefinition): SkillIssue[] {
  const errors: SkillIssue[] = [];
  const parameter = (name: string, path: string) => {
    const declaration = skill.parameters[name];
    if (!declaration || declaration.type !== 'string' || !declaration.required) errors.push(skillIssue('PARAMETER_MISMATCH', path));
  };
  const target = (descriptor: TargetDescriptor, path: string) => { if (descriptor.labelParam) parameter(descriptor.labelParam, path + '/labelParam'); };
  const text = (value: SkillTextValue, path: string) => { if (typeof value !== 'string') parameter(value.param, path + '/param'); };
  let search: { id: string; target?: TargetDescriptor; value?: SkillTextValue } | undefined;
  const submitted = new Map<string, SkillTextValue>();
  for (const [index, step] of skill.steps.entries()) {
    const at = '/steps/' + index, verify = step.verify;
    if (!(OPERATION_VERIFIERS[step.operation] as readonly string[]).includes(verify.kind)) errors.push(skillIssue('VERIFIER_MISMATCH', at + '/verify'));
    if (step.target) {
      target(step.target, at + '/target');
      if (!('target' in step.arguments) || !same(step.target, step.arguments.target)) errors.push(skillIssue('TARGET_MISMATCH', at + '/target'));
    }
    if ('target' in step.arguments) target(step.arguments.target, at + '/arguments/target');
    if ('target' in verify) target(verify.target, at + '/verify/target');
    if (verify.kind === 'WIDGET_STATE') {
      text(verify.expected, at + '/verify/expected');
      if (!isSearchField(verify.target)) errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/verify/target'));
    }
    if (verify.kind === 'FOREGROUND_IS' && verify.appRef !== skill.appScope.alias) errors.push(skillIssue('APP_SCOPE_MISMATCH', at + '/verify/appRef'));
    if (verify.kind === 'SEARCH_OUTCOME_MATCHES') text(verify.value, at + '/verify/value');
    switch (step.operation) {
      case 'OPEN_APPLICATION':
        search = undefined; submitted.clear();
        if (step.arguments.appRef !== skill.appScope.alias) errors.push(skillIssue('APP_SCOPE_MISMATCH', at + '/arguments/appRef'));
        if (verify.kind !== 'FOREGROUND_IS' || verify.appRef !== step.arguments.appRef) errors.push(skillIssue('VERIFIER_MISMATCH', at + '/verify'));
        break;
      case 'ACTIVATE_CONTROL': {
        const searchAction = step.arguments.purpose === 'SEARCH';
        if (searchAction ? !['search_action', 'search_field'].includes(step.arguments.target.semanticRole) : step.arguments.target.semanticRole !== 'navigation') errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/arguments/target'));
        if (searchAction && ('target' in verify ? !isSearchField(verify.target) : true)) errors.push(skillIssue('VERIFIER_MISMATCH', at + '/verify'));
        search = searchAction ? { id: step.id, ...('target' in verify ? { target: verify.target } : {}) } : undefined;
        break;
      }
      case 'INPUT_TEXT':
        text(step.arguments.value, at + '/arguments/value');
        if (!search || !isSearchField(step.arguments.target) || !same(search.target, step.arguments.target)) errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/arguments/target'));
        if (verify.kind !== 'WIDGET_STATE' || !same(verify.target, step.arguments.target) || !same(verify.expected, step.arguments.value)) errors.push(skillIssue('VERIFIER_MISMATCH', at + '/verify'));
        if (search) { search.target = step.arguments.target; search.value = step.arguments.value; }
        break;
      case 'SUBMIT_SEARCH':
        if (!search || search.id !== step.arguments.scope || search.value === undefined || submitted.has(step.arguments.scope)) errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/arguments/scope'));
        if (!('scope' in verify) || verify.scope !== step.arguments.scope || verify.kind === 'SEARCH_OUTCOME_MATCHES' && !same(verify.value, search?.value)) errors.push(skillIssue('VERIFIER_MISMATCH', at + '/verify'));
        if (search?.value !== undefined) submitted.set(search.id, search.value);
        break;
      case 'OBSERVE_UI': case 'ASSERT_UI':
        if (!same(step.arguments.predicate, verify)) errors.push(skillIssue('VERIFIER_MISMATCH', at + '/verify'));
        if (verify.kind === 'SEARCH_OUTCOME_MATCHES' && !same(submitted.get(verify.scope), verify.value)) errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/verify/scope'));
        if (verify.kind === 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED' && !submitted.has(verify.scope)) errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/verify/scope'));
        break;
      case 'SCROLL_CONTAINER':
        if (step.arguments.target.semanticRole !== 'scroll_container') errors.push(skillIssue('VERIFIER_MISMATCH', at + '/arguments/target'));
        break;
      case 'BACK':
        if (step.arguments.reason === 'SEARCH_RECOVERY' && !search) errors.push(skillIssue('SEARCH_SCOPE_REQUIRED', at + '/arguments/reason'));
        search = undefined; submitted.clear(); break;
    }
  }
  return errors;
}

export function validateSkill(input: unknown): SkillValidation {
  const inspection = inspectJson(input);
  if (inspection.errors.length) return result(inspection.errors);
  const errors = inspectSemantics(input), parsed = parseSkillStructure(input);
  if (!parsed.success) return result([...errors, ...parsed.errors]);
  const registered = new Set<string>(EvidencePredicateV2Schema.options.map(option => option.shape.kind.value));
  if (SKILL_VERIFIERS.some(kind => !registered.has(kind))) errors.push(skillIssue('REGISTRY_MISMATCH', '/steps'));
  errors.push(...validateBindings(parsed.data));
  if (errors.length) return result(errors);
  const last = parsed.data.steps.at(-1)!, kind = last.verify.kind;
  const terminal = !['SCROLL_CONTAINER', 'BACK', 'INPUT_TEXT'].includes(last.operation) &&
    ['FOREGROUND_IS', 'ELEMENT_VISIBLE', 'SEARCH_OUTCOME_MATCHES'].includes(kind);
  const warnings = [skillIssue('REAL_DEVICE_VALIDATION_REQUIRED', '/')];
  if (!terminal) warnings.push(skillIssue('MISSING_TERMINAL_VERIFIER', '/steps/' + (parsed.data.steps.length - 1) + '/verify'));
  return result([], warnings);
}
