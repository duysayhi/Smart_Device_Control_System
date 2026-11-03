import { z } from 'zod';
import { checkCancellation } from '../errors';
import type { AgentBudget, ReasoningMeasurement } from './budget';
import { sharedReasoningScheduler } from './reasoning-scheduler';

export class AgentReasoningError extends Error {
  constructor(readonly code: ReasoningMeasurement['status']) { super(`Agent reasoning ${code}.`); }
}

export interface JsonReasoner {
  generate<T>(schema: z.ZodType<T>, system: string, input: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<T>;
}
export class OllamaAgentReasoner implements JsonReasoner {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly conservativeContext = false, private readonly options: { model?: string; think?: false } = {}) {}
  async generate<T>(schema: z.ZodType<T>, system: string, input: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<T> {
    budget.consume('reasoning');
    checkCancellation(signal);
    const start = performance.now();
    const measurement: ReasoningMeasurement = { model: this.options.model ?? process.env.OLLAMA_MODEL ?? 'phone-commander', elapsedMs: 0, status: 'UNAVAILABLE' };
    measurement.deadlineRemainingMs = Math.floor(budget.remaining());
    const base = new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid Ollama URL.');
    const content = JSON.stringify(input);
    if (content.length > 16000) throw new Error('Agent reasoning context exceeded its safe size limit.');
    try {
      if (this.conservativeContext) {
        // UTF-8 bytes bound byte-tokenized content conservatively; reserve framing/output.
        measurement.promptByteUpperBound = Buffer.byteLength(system + content + JSON.stringify(z.toJSONSchema(schema)), 'utf8');
        if (measurement.promptByteUpperBound > 2048 - 256 - 256) throw new AgentReasoningError('CONTEXT_LIMIT');
      }
      const response = await sharedReasoningScheduler.run(budget.runtimeIdentity?.executionId ?? budget.queueOwner, async queuedSignal => {
        const reply = await this.fetcher(new URL('/api/chat', base), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: queuedSignal,
        body: JSON.stringify({ model: measurement.model, stream: false, keep_alive: '10m', ...(this.options.think === false ? { think: false } : {}),
          format: z.toJSONSchema(schema), options: { temperature: 0, num_predict: 256, num_ctx: 2048 },
          messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
        });
        // Keep the model lease until the complete response body has been consumed.
        return { ok: reply.ok, payload: reply.ok ? await reply.json() : undefined };
      }, signal, Math.min(45000, budget.remaining()), timing => { measurement.queueWaitMs = timing.queueWaitMs; measurement.serviceMs = timing.serviceMs; });
      measurement.responseMs = Math.round(performance.now() - start);
      if (!response.ok) throw new AgentReasoningError('HTTP_ERROR');
      const payload = z.object({ message: z.object({ content: z.string().max(12000) }),
        load_duration: z.number().nonnegative().optional(), prompt_eval_count: z.number().int().nonnegative().optional(),
        eval_count: z.number().int().nonnegative().optional(), eval_duration: z.number().nonnegative().optional() }).parse(response.payload);
      measurement.loadMs = payload.load_duration === undefined ? undefined : Math.round(payload.load_duration / 1e6);
      measurement.promptTokens = payload.prompt_eval_count; measurement.outputTokens = payload.eval_count;
      measurement.evalMs = payload.eval_duration === undefined ? undefined : Math.round(payload.eval_duration / 1e6);
      checkCancellation(signal); budget.check();
      const parsed = schema.parse(JSON.parse(payload.message.content)); measurement.status = 'VALID'; return parsed;
    } catch (error) {
      measurement.status = signal?.aborted ? signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' : error instanceof AgentReasoningError ? error.code :
        error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : error instanceof SyntaxError || error instanceof z.ZodError ? 'INVALID_JSON' : 'UNAVAILABLE';
      throw error;
    } finally {
      measurement.elapsedMs = Math.round(performance.now() - start);
      budget.timings.reasoningMs += measurement.elapsedMs; budget.reasoningMeasurements.push(measurement);
    }
  }
}
