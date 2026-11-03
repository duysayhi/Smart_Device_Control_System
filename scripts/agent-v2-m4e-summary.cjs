/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const median = xs => { const a = [...xs].sort((a, b) => a - b), n = a.length; return n ? Math.round(n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const summaries = [];
for (const variant of ['local', 'groq-public', 'groq-command', 'router']) for (const set of ['m4b', 'fresh1', 'fresh2']) {
  const a = r.runs.filter(x => x.variant === variant && x.set === set), m = a.flatMap(x => x.measurements), times = a.map(x => x.elapsedMs).sort((a, b) => a - b);
  const row = { variant, set, n: a.length, faithful: a.filter(x => x.faithful).length, rawFalseAccepts: a.filter(x => x.rawFalseAccept).length,
    falseAccepts: a.filter(x => x.falseAccept).length, abstains: a.filter(x => x.abstained).length, invalidJSON: m.filter(x => x.status === 'INVALID_JSON').length,
    skipped: a.filter(x => x.skipped).length, modelAttempts: m.length, validModelResponses: m.filter(x => x.status === 'VALID').length,
    pipelineMedianMs: median(times), pipelineP95Ms: Math.round(times[Math.ceil(times.length * .95) - 1]), modelMedianMs: median(m.filter(x => x.status === 'VALID').map(x => x.elapsedMs)),
    promptTokens: m.reduce((s, x) => s + (x.promptTokens || 0), 0), outputTokens: m.reduce((s, x) => s + (x.outputTokens || 0), 0),
    httpErrors: m.filter(x => x.status === 'HTTP_ERROR').length, http429: m.filter(x => x.httpStatus === 429).length,
    fallbackCount: a.filter(x => x.measurements.some(m => m.provider === 'ollama')).length,
    forcedAdmitted: a.filter(x => x.forced && !x.skipped).length, rawUnobserved: a.filter(x => !x.skipped && !x.raw).length };
  summaries.push(row); console.log(JSON.stringify(row));
}
const fresh = summaries.filter(x => x.variant === 'router' && x.set !== 'm4b');
const localMs = median(r.runs.filter(x => x.variant === 'local').flatMap(x => x.measurements).filter(x => x.status === 'VALID').map(x => x.elapsedMs));
const cloudMs = median(r.runs.filter(x => x.variant === 'groq-command').flatMap(x => x.measurements).filter(x => x.status === 'VALID').map(x => x.elapsedMs));
console.log(JSON.stringify({ gate: fresh.every(x => x.n === 32 && x.falseAccepts === 0 && x.faithful >= 26) && cloudMs !== null && localMs !== null && cloudMs < localMs,
  localModelMedianMs: localMs, groqModelMedianMs: cloudMs, peakWorkingSetBytes: r.peakWorkingSetBytes, memorySamples: r.memory.length }));
