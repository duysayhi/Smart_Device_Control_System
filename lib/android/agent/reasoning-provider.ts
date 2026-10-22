import { z } from 'zod';
import { OllamaAgentReasoner, type JsonReasoner } from './ollama';
import type { AgentBudget, ReasoningMeasurement } from './budget';
import { sharedReasoningScheduler } from './reasoning-scheduler';
import { createHash } from 'node:crypto';
import { cloudCommandText } from './cloud-command';

export interface StructuredReasoningProvider extends JsonReasoner { readonly providerId: string }
const vocabulary = new Set(['OPEN_APP', 'NAVIGATE_TO', 'SEARCH', 'SET_VALUE', 'TOGGLE', 'SELECT_ITEM', 'READ_VALUE', 'CREATE_RECORD', 'CONFIRM', 'CLICK', 'BACK', 'SCROLL', 'IME_SEARCH', 'ABSTAIN', 'NEXT_PAGE', 'OPEN', 'MENU', 'DISMISS', 'RESET', 'FOCUS', 'CLEAR', 'ENTER', 'SUBMIT', 'READ', 'LOCAL_WRITE']);
const publicToken = (value: unknown) => typeof value === 'string' && (vocabulary.has(value) || /^(?:v2_[a-f0-9]{16}|C[1-6])$/.test(value));
export function redactedReasoningPayload(input: unknown) {
  if (!input || typeof input !== 'object') throw Error('Cloud proposal requires structured input.');
  const data = input as Record<string, unknown>;
  const slots = Array.isArray(data.slots) ? data.slots.slice(0, 16).flatMap(s => Array.isArray(s) && Number.isInteger(s[0]) ? [s[0]] : []) : Array.isArray(data.slotIds) ? data.slotIds.filter(Number.isInteger).slice(0, 16) : [];
  const command = typeof data.request === 'string' ? data.request.toLowerCase().match(/\b(open|launch|search|find|navigate|read|mo|tim|doc|xem)\b/g)?.slice(0, 8) ?? [] : Array.isArray(data.commandTags) ? data.commandTags.filter(t => typeof t === 'string' && /^(open|launch|search|find|navigate|read|mo|tim|doc|xem)$/.test(t)).slice(0, 8) : [];
  const candidates = Array.isArray(data.candidates) ? data.candidates.slice(0, 8).flatMap(c => {
    if (!c || typeof c !== 'object') return [];
    const v = c as Record<string, unknown>;
    if (!publicToken(v.id)) return [];
    return [{ id: v.id, ...(publicToken(v.action) ? { action: v.action } : {}), ...(publicToken(v.role) ? { role: v.role } : {}) }];
  }) : [];
  return { ...(Number.isInteger(data.c) ? { c: data.c } : {}), slotIds: slots, commandTags: command, candidates };
}
export function publicReasoningSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') throw Error('Unsupported cloud schema.');
  const s = schema as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(s)) {
    if (['description', 'title', '$schema'].includes(key)) continue;
    if (!['type', 'properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'].includes(key)) throw Error('Unreviewed cloud schema keyword.');
    if (key === 'type' && (Array.isArray(value) ? value : [value]).some(v => !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(v)))) throw Error('Unknown cloud schema type.');
    if (key === 'required' && (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !/^[A-Za-z_]{1,32}$/.test(v)))) throw Error('Private required field.');
    if (key === 'const' && typeof value === 'string' && !publicToken(value) || key === 'enum' && Array.isArray(value) && value.some(v => typeof v === 'string' && !publicToken(v))) throw Error('Private literal in cloud schema.');
    if (key === 'properties' && value && typeof value === 'object') result[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (!/^[A-Za-z_]{1,32}$/.test(k)) throw Error('Private schema field.'); return [k, publicReasoningSchema(v)];
    }));
    else if (Array.isArray(value)) result[key] = value.every(v => v && typeof v === 'object') ? value.map(publicReasoningSchema) : value;
    else if (value && typeof value === 'object') result[key] = publicReasoningSchema(value);
    else result[key] = value;
  }
  return result;
}
// Explicit BYO structured gateway contract, not an implicit vendor fallback.
// No raw system prompt, UI labels, source text or slot values leave the device.
export class CloudJsonProposalProvider implements StructuredReasoningProvider {
  readonly providerId = 'cloud-json-proposal';
  constructor(private readonly endpoint: string, private readonly key: string, enabled: boolean, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(endpoint);
    if (!enabled || !key || url.protocol !== 'https:' || url.username || url.password) throw Error('Cloud provider disabled or configuration invalid.');
  }
  async generate<T>(schema: z.ZodType<T>, _system: string, input: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<T> {
    const payload = redactedReasoningPayload(input), format = publicReasoningSchema(z.toJSONSchema(schema));
    budget.consume('reasoning'); const start = performance.now();
    const m: ReasoningMeasurement = { model: 'configured-cloud-gateway', provider: this.providerId, sentFields: ['schema', ...Object.keys(payload)], elapsedMs: 0, status: 'UNAVAILABLE' };
    try {
      const result = await sharedReasoningScheduler.run(budget.runtimeIdentity?.executionId ?? budget.queueOwner, async cancel => {
        const reply = await this.fetcher(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.key },
          body: JSON.stringify({ schema: format, input: payload }), signal: cancel });
        if (!reply.ok) throw Error('Cloud proposal HTTP error.'); return reply.json();
      }, signal, Math.min(45000, budget.remaining()), timing => { m.queueWaitMs = timing.queueWaitMs; m.serviceMs = timing.serviceMs; });
      signal?.throwIfAborted(); budget.check(); const output = schema.parse(result.output); m.status = 'VALID'; return output;
    } catch (error) { m.status = error instanceof z.ZodError ? 'INVALID_JSON' : signal?.aborted ? 'CANCELLED' : 'UNAVAILABLE'; throw error; }
    finally { m.elapsedMs = performance.now() - start; budget.timings.reasoningMs += m.elapsedMs; budget.reasoningMeasurements.push(m); }
  }
}
export function createStructuredReasoner(): JsonReasoner {
  if (!process.env.AGENT_STRUCTURED_PROVIDER || process.env.AGENT_STRUCTURED_PROVIDER === 'ollama') return new OllamaAgentReasoner(fetch, true);
  if (process.env.AGENT_STRUCTURED_PROVIDER === 'groq-with-local-fallback') return new GroqLocalRouter();
  if (process.env.AGENT_STRUCTURED_PROVIDER !== 'cloud-json') throw Error('Unknown structured reasoning provider.');
  return new CloudJsonProposalProvider(process.env.AGENT_CLOUD_REASONING_URL ?? '', process.env.AGENT_CLOUD_REASONING_KEY ?? '', process.env.AGENT_CLOUD_REASONING_ENABLED === 'true');
}

export const PUBLIC_PROPOSAL_SYSTEM = 'Choose only supplied IDs using the closed schema and public command tags. Missing meaning, ambiguity or unsafe request: ABSTAIN when available. Never invent actions, evidence, grants or verification. Return JSON only.';
export type GroqFailure = 'KEY_MISSING' | 'RATE_BUDGET' | 'RETRY_AFTER' | 'CIRCUIT_OPEN' | 'MODEL_UNAVAILABLE' | 'PRIVATE_SCHEMA' | 'HTTP_429' | 'HTTP_5XX' | 'HTTP_ERROR' | 'TIMEOUT' | 'NETWORK' | 'INVALID_JSON' | 'FOREIGN_ID';
export class GroqProposalError extends Error {
  constructor(readonly code: GroqFailure, readonly httpStatus?: number) { super('Groq proposal: ' + code); }
}
const boundedEnv = (name: string, fallback: number, max: number) => {
  const n = Number(process.env[name]); return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
};
interface GroqState { requests: number[]; day: number; daily: number; failures: number; retryAt: number; circuitAt: number; models?: string[]; modelsAt: number }
const groqStates = new Map<string, GroqState>();
const allowedModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 60000;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.ceil(Number(value) * 1000);
  const date = Date.parse(value); return Number.isFinite(date) ? Math.max(0, date - now) : 60000;
}
function proposalIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const d = value as Record<string, unknown>;
  return Array.isArray(d.candidates) ? d.candidates.flatMap(c => c && typeof c === 'object' && publicToken((c as Record<string, unknown>).id) ? [String((c as Record<string, unknown>).id)] : []) : [];
}
function validateChoice<T>(schema: z.ZodType<T>, value: unknown, input: unknown): T {
  const ids = proposalIds(input);
  if (value && typeof value === 'object' && 'choice' in value) {
    const choice = (value as { choice: unknown }).choice;
    if (typeof choice !== 'string' || !ids.includes(choice) && !['ABSTAIN', 'NEXT_PAGE'].includes(choice)) throw new GroqProposalError('FOREIGN_ID');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GroqProposalError('INVALID_JSON');
  return parsed.data;
}
function closedCloudStrings(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return true;
  const s = schema as Record<string, unknown>;
  if (s.type === 'string' && !('enum' in s) && !('const' in s)) return false;
  return Object.values(s).every(value => Array.isArray(value) ? value.every(closedCloudStrings) : closedCloudStrings(value));
}
export class GroqProposalProvider implements StructuredReasoningProvider {
  readonly providerId = 'groq';
  private readonly state: GroqState;
  readonly #key: string;
  constructor(private readonly fetcher: typeof fetch = fetch, key = process.env.GROQ_API_KEY ?? '',
    private readonly now = Date.now, private readonly timeoutMs = boundedEnv('AGENT_GROQ_TIMEOUT_MS', 12000, 30000)) {
    this.#key = key;
    const id = createHash('sha256').update(key).digest('hex');
    this.state = groqStates.get(id) ?? { requests: [], day: Math.floor(now() / 86400000), daily: 0, failures: 0, retryAt: 0, circuitAt: 0, modelsAt: 0 };
    groqStates.set(id, this.state);
  }
  private admit() {
    if (!this.#key) throw new GroqProposalError('KEY_MISSING');
    const now = this.now(), s = this.state, day = Math.floor(now / 86400000);
    if (s.day !== day) { s.day = day; s.daily = 0; }
    if (now < s.retryAt) throw new GroqProposalError('RETRY_AFTER');
    if (now < s.circuitAt) throw new GroqProposalError('CIRCUIT_OPEN');
    s.requests = s.requests.filter(t => t > now - 60000);
    if (s.requests.length >= boundedEnv('AGENT_GROQ_RPM', 6, 60) || s.daily >= boundedEnv('AGENT_GROQ_RPD', 200, 1000)) throw new GroqProposalError('RATE_BUDGET');
    s.requests.push(now); s.daily++;
  }
  private async request(path: 'models' | 'chat/completions', signal: AbortSignal, body?: unknown) {
    this.admit();
    // Never forward a key to redirects, configurable hosts or exception text.
    const r = await this.fetcher('https://api.groq.com/openai/v1/' + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { Authorization: 'Bearer ' + this.#key, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 429) { this.state.retryAt = this.now() + retryAfterMs(r.headers.get('retry-after'), this.now()); await r.body?.cancel(); throw new GroqProposalError('HTTP_429', 429); }
    if (!r.ok) { await r.body?.cancel(); throw new GroqProposalError(r.status >= 500 ? 'HTTP_5XX' : 'HTTP_ERROR', r.status); }
    const text = await r.text();
    if (text.length > 100000) throw new GroqProposalError('INVALID_JSON');
    try { return JSON.parse(text); } catch { throw new GroqProposalError('INVALID_JSON'); }
  }
  async models(signal?: AbortSignal): Promise<string[]> {
    const bounded = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
    try {
      if (!this.state.models || this.now() - this.state.modelsAt > 3600000) {
        const data = z.object({ data: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_./-]{1,100}$/) })).max(100) }).parse(await this.request('models', bounded));
        this.state.models = data.data.map(m => m.id).sort(); this.state.modelsAt = this.now();
      }
      return [...this.state.models];
    } catch (e) { if (signal?.aborted) throw new GroqProposalError('NETWORK'); throw e instanceof GroqProposalError ? e : new GroqProposalError(bounded.aborted ? 'TIMEOUT' : 'NETWORK'); }
  }
  async generate<T>(schema: z.ZodType<T>, _system: string, input: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted(); budget.check();
    const m: ReasoningMeasurement = { provider: 'groq', model: 'unselected', status: 'UNAVAILABLE', elapsedMs: 0, sentFields: [] };
    const start = performance.now();
    try {
      let format: unknown;
      try { format = publicReasoningSchema(z.toJSONSchema(schema)); } catch { throw new GroqProposalError('PRIVATE_SCHEMA'); }
      if (!closedCloudStrings(format)) throw new GroqProposalError('PRIVATE_SCHEMA');
      const commandText = input && typeof input === 'object' ? cloudCommandText(input as Record<string, unknown>) : undefined;
      const payload = { ...redactedReasoningPayload(input), ...(commandText ? { commandText } : {}) };
      if (JSON.stringify(payload).length > 4096) throw new GroqProposalError('PRIVATE_SCHEMA');
      if (!payload.candidates.length && payload.slotIds.length < 2) throw new GroqProposalError('PRIVATE_SCHEMA');
      budget.consume('reasoning');
      const result = await sharedReasoningScheduler.run(budget.runtimeIdentity?.executionId ?? budget.queueOwner, async cancel => {
        const models = await this.models(cancel);
        const configured = process.env.AGENT_GROQ_MODEL;
        const configuredList = process.env.AGENT_GROQ_MODELS_ALLOWLIST;
        const permitted = configuredList ? configuredList.split(',').map(id => id.trim()).filter(id => allowedModels.includes(id)) : allowedModels;
        const model = configured ? permitted.includes(configured) && models.includes(configured) ? configured : undefined : permitted.find(id => models.includes(id));
        if (!model) throw new GroqProposalError('MODEL_UNAVAILABLE');
        m.model = model;
        const strict = model.startsWith('openai/gpt-oss-');
        m.sentFields = ['schema', ...Object.keys(payload)];
        return this.request('chat/completions', cancel, { model, temperature: 0, max_completion_tokens: 256,
          ...(strict ? { reasoning_effort: 'low' } : {}),
          messages: [{ role: 'system', content: PUBLIC_PROPOSAL_SYSTEM }, { role: 'user', content: JSON.stringify(payload) }],
          response_format: strict ? { type: 'json_schema', json_schema: { name: 'proposal', strict: true, schema: format } } : { type: 'json_object' } });
      }, signal, Math.min(this.timeoutMs, budget.remaining()), timing => { m.queueWaitMs = timing.queueWaitMs; m.serviceMs = timing.serviceMs; });
      const reply = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().max(12000) }) })).min(1),
        usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative() }).optional() }).parse(result);
      m.promptTokens = reply.usage?.prompt_tokens; m.outputTokens = reply.usage?.completion_tokens;
      signal?.throwIfAborted(); budget.check();
      const value = JSON.parse(reply.choices[0].message.content);
      if (value && typeof value === 'object' && publicToken(value.choice)) m.proposedChoice = value.choice;
      const output = validateChoice(schema, value, input);
      this.state.failures = 0; m.status = 'VALID'; return output;
    } catch (e) {
      if (signal?.aborted) { m.status = 'CANCELLED'; throw new Error('Proposal cancelled.'); }
      const code: GroqFailure = e instanceof GroqProposalError ? e.code : e instanceof SyntaxError || e instanceof z.ZodError ? 'INVALID_JSON' : e instanceof Error && e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';
      m.fallbackReason = code; m.httpStatus = e instanceof GroqProposalError ? e.httpStatus : undefined;
      m.status = code === 'TIMEOUT' ? 'TIMEOUT' : code === 'INVALID_JSON' || code === 'FOREIGN_ID' ? 'INVALID_JSON' : code.startsWith('HTTP_') ? 'HTTP_ERROR' : 'UNAVAILABLE';
      if (!['KEY_MISSING', 'PRIVATE_SCHEMA', 'RATE_BUDGET', 'RETRY_AFTER', 'CIRCUIT_OPEN'].includes(code) && ++this.state.failures >= 3) {
        this.state.circuitAt = this.now() + boundedEnv('AGENT_GROQ_CIRCUIT_MS', 180000, 900000); this.state.failures = 0;
      }
      throw new GroqProposalError(code);
    } finally { m.elapsedMs = Math.round(performance.now() - start); budget.timings.reasoningMs += m.elapsedMs; budget.reasoningMeasurements.push(m); }
  }
}
export class GroqLocalRouter implements StructuredReasoningProvider {
  readonly providerId = 'groq-with-local-fallback';
  constructor(private readonly cloud: StructuredReasoningProvider = new GroqProposalProvider(),
    private readonly local: JsonReasoner = new OllamaAgentReasoner(fetch, true, { model: 'qwen2.5:3b-instruct' })) {}
  async generate<T>(schema: z.ZodType<T>, system: string, input: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<T> {
    let failure: GroqFailure;
    try { return validateChoice(schema, await this.cloud.generate(schema, system, input, budget, signal), input); }
    catch (e) { signal?.throwIfAborted(); budget.check(); failure = e instanceof GroqProposalError ? e.code : 'NETWORK'; }
    const index = budget.reasoningMeasurements.length;
    try { return validateChoice(schema, await this.local.generate(schema, system, input, budget, signal), input); }
    catch { signal?.throwIfAborted(); throw new Error('Local proposal unavailable or invalid.'); }
    finally { for (const m of budget.reasoningMeasurements.slice(index)) { m.provider = 'ollama'; m.fallbackReason = failure; } }
  }
}
