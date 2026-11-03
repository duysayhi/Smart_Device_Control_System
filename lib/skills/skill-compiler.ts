import { z } from 'zod';
import { parseSkillStructure, type SkillDefinition } from './skill-schema';
import { validateSkill, type SkillValidation } from './skill-validator';
import { inspectJson, sensitiveValue, skillIssue, type SkillIssue } from './skill-safety';

const descriptor = z.object({ semanticRole: z.string(), label: z.string().optional(), labelParam: z.string().optional(),
  containerRole: z.string(), resourceIdHint: z.string().optional() }).strict();
const timing = { timeoutMs: z.number().int().min(1).max(120000).default(5000), onFail: z.enum(['BLOCK', 'ASK_USER']).default('BLOCK') };
const demonstration = z.object({ name: z.string(), appAlias: z.string(), actions: z.array(z.discriminatedUnion('operation', [
  z.object({ ...timing, operation: z.literal('OPEN_APPLICATION'), appRef: z.string() }).strict(),
  z.object({ ...timing, operation: z.literal('ACTIVATE_CONTROL'), target: descriptor, purpose: z.enum(['NAVIGATION', 'SEARCH']).optional() }).strict(),
  z.object({ ...timing, operation: z.literal('INPUT_TEXT'), target: descriptor, value: z.string() }).strict(),
  z.object({ ...timing, operation: z.literal('SUBMIT_SEARCH') }).strict(),
  z.object({ ...timing, operation: z.enum(['OBSERVE_UI', 'ASSERT_UI']), predicate: z.unknown() }).strict(),
  z.object({ ...timing, operation: z.literal('SCROLL_CONTAINER'), target: descriptor, direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']), maxAttempts: z.number().int().min(1).max(5) }).strict(),
  z.object({ ...timing, operation: z.literal('BACK'), reason: z.enum(['DISMISS_BENIGN', 'SEARCH_RECOVERY']) }).strict(),
])).min(1).max(20) }).strict();

export interface SkillCompilation {
  status: 'DRAFT' | 'AMBIGUOUS' | 'REJECTED'; draft?: SkillDefinition;
  reviewRequired: boolean; confidence: 'RULE_COMPILED' | 'REVIEW_REQUIRED' | 'REJECTED';
  errors: SkillIssue[]; review: { code: 'SEARCH_FIELD_UNPROVEN' | 'PURPOSE_REQUIRED' | 'REPEATED_INPUT_REVIEW'; path: string; message: string }[];
  validation?: SkillValidation;
  limitations: readonly string[];
}
export function parseDemonstration(input: unknown) {
  const parsed = demonstration.safeParse(input); return parsed.success ? parsed.data : undefined;
}
const limitations = ['Video thứ N và playback chưa được hỗ trợ trong Teach DSL v1.', 'Bản nháp cần review và xác minh trên thiết bị; compile không cấp quyền thực thi.'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rejected = (errors: SkillIssue[], validation?: SkillValidation): SkillCompilation => ({ status: 'REJECTED', reviewRequired: true,
  confidence: 'REJECTED', errors, review: [], ...(validation ? { validation } : {}), limitations: [...limitations] });

/** Pure compilation of Dashboard semantic input, not a recorder, executor, or evidence issuer. */
export function compileSkill(input: unknown): SkillCompilation {
  const inspection = inspectJson(input);
  if (inspection.errors.length) return rejected(inspection.errors);
  // Check the original values before query parameterization can remove the sample.
  const probe = validateSkill(input);
  const unsafe = probe.errors.filter(e => ['HARD_DENY', 'SENSITIVE_CONTENT', 'SENSITIVE_PARAMETER', 'UNSUPPORTED_IN_MVP', 'UNKNOWN_OPERATION', 'UNKNOWN_VERIFIER'].includes(e.code));
  if (unsafe.length) return rejected(unsafe);
  const parsed = demonstration.safeParse(input);
  if (!parsed.success) return rejected([skillIssue('INVALID_SCHEMA', '/')]);
  const source = parsed.data, steps: Record<string, unknown>[] = [], parameters: SkillDefinition['parameters'] = {};
  const review: SkillCompilation['review'] = [];
  let search: { id: string; field: z.infer<typeof descriptor>; parameter?: string; submitted?: boolean } | undefined, queries = 0;
  for (const [index, action] of source.actions.entries()) {
    if (review.length) continue;
    const id = 's' + (index + 1), base = { id, timeoutMs: action.timeoutMs, onFail: action.onFail, effectClass: 'READ' as const };
    const add = (arguments_: unknown, verify: unknown) => steps.push({ ...base, operation: action.operation, arguments: arguments_, verify });
    switch (action.operation) {
      case 'OPEN_APPLICATION':
        search = undefined; add({ appRef: action.appRef }, { kind: 'FOREGROUND_IS', appRef: action.appRef }); break;
      case 'ACTIVATE_CONTROL': {
        search = undefined;
        if (!action.purpose) { review.push({ code: 'PURPOSE_REQUIRED', path: '/actions/' + index, message: 'Cần xác nhận mục đích điều hướng hoặc tìm kiếm.' }); break; }
        if (action.purpose === 'NAVIGATION') { add({ target: action.target, purpose: action.purpose }, { kind: 'ELEMENT_VISIBLE', target: action.target }); break; }
        const next = source.actions[index + 1];
        if (next?.operation !== 'INPUT_TEXT' || next.target.semanticRole !== 'search_field' || next.target.containerRole !== 'search') {
          review.push({ code: 'SEARCH_FIELD_UNPROVEN', path: '/actions/' + index, message: 'Cần descriptor trường tìm kiếm từ thao tác nhập tiếp theo; không đoán trường.' }); break;
        }
        search = { id, field: next.target };
        add({ target: action.target, purpose: 'SEARCH' }, { kind: 'ELEMENT_VISIBLE', target: next.target }); break;
      }
      case 'INPUT_TEXT': {
        if (sensitiveValue(action.value) || !action.value.trim() || action.value.length > 500) return rejected([skillIssue('SENSITIVE_CONTENT', '/actions/' + index + '/value')]);
        if (!search || search.submitted || !same(search.field, action.target)) return rejected([skillIssue('SEARCH_SCOPE_REQUIRED', '/actions/' + index)]);
        if (search.parameter) { review.push({ code: 'REPEATED_INPUT_REVIEW', path: '/actions/' + index, message: 'Nhiều lần nhập cùng phạm vi cần review; không đoán nối hay thay thế nội dung.' }); break; }
        const parameter = ++queries === 1 ? 'query' : 'query' + queries;
        parameters[parameter] = { type: 'string', maxLength: 500, required: true, description: 'Exact search query.' };
        search.parameter = parameter;
        add({ target: action.target, value: { param: parameter } }, { kind: 'WIDGET_STATE', target: action.target, property: 'value', expected: { param: parameter } }); break;
      }
      case 'SUBMIT_SEARCH':
        if (!search?.parameter || search.submitted) return rejected([skillIssue('SEARCH_SCOPE_REQUIRED', '/actions/' + index)]);
        add({ scope: search.id }, { kind: 'SEARCH_OUTCOME_MATCHES', scope: search.id, value: { param: search.parameter } }); search.submitted = true; break;
      case 'OBSERVE_UI': case 'ASSERT_UI': add({ predicate: action.predicate }, action.predicate); break;
      case 'SCROLL_CONTAINER': add({ target: action.target, direction: action.direction, maxAttempts: action.maxAttempts }, { kind: 'STATE_CHANGED' }); break;
      case 'BACK': add({ reason: action.reason }, { kind: 'STATE_CHANGED' }); search = undefined; break;
    }
  }
  // No incomplete or silently dropped demonstration becomes a returned DSL.
  if (review.length) return { status: 'AMBIGUOUS', reviewRequired: true, confidence: 'REVIEW_REQUIRED', errors: [], review, limitations: [...limitations] };
  const candidate = { schemaVersion: 1, name: source.name, appScope: { alias: source.appAlias }, parameters, steps, maxSteps: 20 };
  const validation = validateSkill(candidate);
  if (!validation.ok) return rejected(validation.errors, validation);
  const result = parseSkillStructure(candidate);
  if (!result.success) return rejected(result.errors, validation);
  return { status: 'DRAFT', draft: result.data, reviewRequired: true, confidence: 'RULE_COMPILED', errors: [], review: [], validation, limitations: [...limitations] };
}
