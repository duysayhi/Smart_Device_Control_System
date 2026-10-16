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
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async generate<T>(schema: z.ZodType<T>, system: string, input: unknown, budget: AgentBudget, signal?: AbortSignal): Promise<T> {
    budget.consume('reasoning');
    checkCancellation(signal);
    const start = performance.now();
    const measurement: ReasoningMeasurement = { model: process.env.OLLAMA_MODEL ?? 'phone-commander', elapsedMs: 0, status: 'UNAVAILABLE' };
    const base = new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid Ollama URL.');
    const content = JSON.stringify(input);
    if (content.length > 16000) throw new Error('Agent reasoning context exceeded its safe size limit.');
    try {
      const response = await sharedReasoningScheduler.run(budget.runtimeIdentity?.executionId ?? budget.queueOwner, async queuedSignal => {
        const reply = await this.fetcher(new URL('/api/chat', base), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: queuedSignal,
        body: JSON.stringify({ model: measurement.model, stream: false,
          format: z.toJSONSchema(schema), options: { temperature: 0, num_predict: 256, num_ctx: 2048 },
          messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
        });
        // Keep the model lease until the complete response body has been consumed.
        return { ok: reply.ok, payload: reply.ok ? await reply.json() : undefined };
      }, signal, Math.max(1, Math.min(45000, budget.remaining())));
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
