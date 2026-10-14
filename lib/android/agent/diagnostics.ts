import { z } from 'zod';

// Fixed, local-only development probe: never accepts a model, prompt or destination from a request.
export async function probeOllama(chat: boolean, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const base = new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error('Probe requires a local Ollama URL.');
  const model = process.env.OLLAMA_MODEL ?? 'phone-commander';
  const result: Record<string, unknown> = { model, host: base.host, endpoints: [] };
  const endpoints: { path: string; status?: number; elapsedMs: number; data?: unknown; error?: string }[] = [];
  result.endpoints = endpoints;
  for (const path of ['/api/tags', '/api/ps']) {
    const start = performance.now();
    try {
      const response = await fetcher(new URL(path, base), { signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
      endpoints.push({ path, status: response.status, elapsedMs: Math.round(performance.now() - start), data: await response.json() });
    } catch (error) { endpoints.push({ path, elapsedMs: Math.round(performance.now() - start), error: error instanceof Error ? error.name : 'Error' }); }
  }
  if (!chat || endpoints.some(row => row.status !== 200)) return result;
  const start = performance.now();
  const controller = new AbortController();
  const abort = AbortSignal.any([controller.signal, AbortSignal.timeout(90000), ...(signal ? [signal] : [])]);
  try {
    const response = await fetcher(new URL('/api/chat', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort,
      body: JSON.stringify({ model, stream: true, format: z.toJSONSchema(z.object({ ready: z.boolean() }).strict()),
        messages: [{ role: 'user', content: 'Return only {"ready":true}.' }], options: { temperature: 0, num_predict: 32, num_ctx: 512 } }) });
    if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', content = '', firstTokenMs: number | undefined, final: Record<string, unknown> | undefined, bytes = 0;
    try {
      for (;;) {
        const read = await reader.read(); bytes += read.value?.byteLength ?? 0;
        if (bytes > 65536) throw new Error('Probe response too large.');
        pending += decoder.decode(read.value, { stream: !read.done });
        const lines = pending.split('\n'); pending = lines.pop() ?? '';
        if (read.done && pending.trim()) { lines.push(pending); pending = ''; }
        for (const line of lines) if (line.trim()) {
          const packet = JSON.parse(line);
          if (packet.error) throw new Error('Ollama reported an error.');
          if (typeof packet.message?.content === 'string' && packet.message.content) {
            firstTokenMs ??= Math.round(performance.now() - start); content += packet.message.content;
          }
          if (packet.done === true) final = packet;
        }
        if (read.done) break;
      }
    } finally { reader.releaseLock(); }
    if (!final) throw new Error('Missing final metrics packet.');
    z.object({ ready: z.literal(true) }).strict().parse(JSON.parse(content));
    result.chat = { status: 'VALID', elapsedMs: Math.round(performance.now() - start), firstTokenMs,
      loadMs: typeof final.load_duration === 'number' ? Math.round(final.load_duration / 1e6) : undefined,
      promptTokens: final.prompt_eval_count, outputTokens: final.eval_count,
      evalMs: typeof final.eval_duration === 'number' ? Math.round(final.eval_duration / 1e6) : undefined };
  } catch (error) { result.chat = { status: 'FAILED', elapsedMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : 'Error' }; }
  finally { controller.abort(); }
  return result;
}
