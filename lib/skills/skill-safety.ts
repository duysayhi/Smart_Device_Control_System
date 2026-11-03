// Persisted DSL keys only. Do not add live snapshot identifiers to this list.
// SQL parity is deliberately deferred until the owner supplies an authoritative DB package.
export const FORBIDDEN_KEYS = Object.freeze([
  'bounds', 'rawPoint', 'raw_point', 'tapPoint', 'point', 'coordinates',
  'elementId', 'candidateId', 'grant', 'proof', 'verified',
] as const);

const messages = {
  FORBIDDEN_KEY: 'Live geometry, identity or authority cannot be stored in a skill.',
  INVALID_SCHEMA: 'The skill does not match the closed version 1 schema.',
  NON_JSON_INPUT: 'Only plain JSON data is accepted.',
  INPUT_LIMIT: 'The input exceeds the bounded inspection limits.',
  UNKNOWN_OPERATION: 'The operation is outside the Teach MVP allowlist.',
  UNKNOWN_VERIFIER: 'The verifier is not registered for Teach MVP.',
  VERIFIER_MISMATCH: 'The verifier does not match the operation or its arguments.',
  REGISTRY_MISMATCH: 'A Teach verifier is absent from the backend registry.',
  UNSUPPORTED_IN_MVP: 'Ordinal selection and arbitrary keys or coordinates are unsupported.',
  HARD_DENY: 'The skill contains a prohibited action or control.',
  SENSITIVE_CONTENT: 'Sensitive data cannot be stored in a skill.',
  SENSITIVE_PARAMETER: 'Sensitive parameters are not supported.',
  SEARCH_SCOPE_REQUIRED: 'Text entry and submission require the preceding search scope.',
  PARAMETER_MISMATCH: 'The parameter reference is missing or has an incompatible type.',
  APP_SCOPE_MISMATCH: 'An application reference is outside the declared alias scope.',
  TARGET_MISMATCH: 'The optional step target must match the argument target.',
  STEP_LIMIT: 'The step limit is exceeded or step identifiers are repeated.',
  TIMEOUT_LIMIT: 'The total timeout exceeds 120000 milliseconds.',
  MISSING_TERMINAL_VERIFIER: 'The last step does not prove the final outcome.',
  REAL_DEVICE_VALIDATION_REQUIRED: 'Static validation cannot establish device verification or publication.',
} as const;
export type SkillIssueCode = keyof typeof messages;
export interface SkillIssue { code: SkillIssueCode; path: string; message: string }

const pathKeys = new Set<string>([
  ...FORBIDDEN_KEYS, 'schemaVersion', 'name', 'appScope', 'alias', 'parameters', 'type', 'maxLength', 'required', 'description',
  'steps', 'id', 'operation', 'arguments', 'target', 'verify', 'effectClass', 'timeoutMs', 'onFail', 'maxSteps',
  'appRef', 'purpose', 'value', 'param', 'scope', 'predicate', 'kind', 'property', 'expected', 'reason',
  'direction', 'maxAttempts', 'semanticRole', 'label', 'labelParam', 'containerRole', 'resourceIdHint', 'ordinal', 'resultIndex',
]);
// Unknown object keys can themselves contain secrets. Never echo them in diagnostics.
export function safePath(parts: readonly PropertyKey[]): string {
  return '/' + parts.map(part => typeof part === 'number' ? String(part) : typeof part === 'string' && pathKeys.has(part) ? part : '*').join('/');
}
export function skillIssue(code: SkillIssueCode, path: string): SkillIssue { return { code, path, message: messages[code] }; }
export const foldSkillText = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[_:/.-]+/g, ' ');

export function sensitiveMetadata(text: string): boolean {
  return /\b(password|passcode|passwd|otp|pin|cvv|cvc|iban|credential|secret|token|api key|authorization|credit card|card number|payment|mat khau|ma xac (?:nhan|thuc)|thanh toan|so the)\b/.test(foldSkillText(text));
}
export function sensitiveValue(text: string): boolean {
  return /https?:\/\/|(?:bearer|basic)\s+\S+|(?:gsk_|sk-|AKIA)[A-Za-z0-9_-]{12,}|-----BEGIN|\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/i.test(text) ||
    /(?:\d[ -]?){12,}/.test(text) || /^(?:\d[ -]?){4,8}$/.test(text.trim()) ||
    /\b(password|passwd|otp|token|secret|api[_ -]?key|authorization)\s*[:=]\s*\S+/i.test(text);
}

export interface JsonInspection { errors: SkillIssue[] }
/** Bounded, iterative inspection: no getters, toJSON, logging, I/O or mutation. */
export function inspectJson(input: unknown, rejectRuntimeKeys = true): JsonInspection {
  const errors: SkillIssue[] = [], active = new WeakSet<object>();
  const pending: { value: unknown; path: PropertyKey[]; exit?: boolean }[] = [{ value: input, path: [] }];
  let nodes = 0;
  try {
    while (pending.length && errors.length < 32) {
      const item = pending.pop()!;
      if (item.exit) { active.delete(item.value as object); continue; }
      const at = safePath(item.path), value = item.value;
      if (++nodes > 10000 || item.path.length > 40) { errors.push(skillIssue('INPUT_LIMIT', at)); break; }
      if (value === null || typeof value === 'boolean') continue;
      if (typeof value === 'string') { if (value.length > 8192) errors.push(skillIssue('INPUT_LIMIT', at)); continue; }
      if (typeof value === 'number') { if (!Number.isFinite(value)) errors.push(skillIssue('NON_JSON_INPUT', at)); continue; }
      if (typeof value !== 'object') { errors.push(skillIssue('NON_JSON_INPUT', at)); continue; }
      const proto = Object.getPrototypeOf(value);
      if (active.has(value) || (!Array.isArray(value) && proto !== Object.prototype && proto !== null)) {
        errors.push(skillIssue('NON_JSON_INPUT', at)); continue;
      }
      active.add(value); pending.push({ ...item, exit: true });
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length) errors.push(skillIssue('NON_JSON_INPUT', at));
      const keys = Object.keys(descriptors).filter(key => !(Array.isArray(value) && key === 'length')).sort();
      for (const key of keys.reverse()) {
        const descriptor = descriptors[key], part = Array.isArray(value) && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : key;
        const next = [...item.path, part];
        if (!('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) {
          errors.push(skillIssue('NON_JSON_INPUT', safePath(next))); continue;
        }
        if (rejectRuntimeKeys && (FORBIDDEN_KEYS as readonly string[]).includes(key)) errors.push(skillIssue('FORBIDDEN_KEY', safePath(next)));
        pending.push({ value: descriptor.value, path: next });
      }
    }
  } catch { return { errors: [skillIssue('NON_JSON_INPUT', '/')] }; }
  return { errors: errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)) };
}
