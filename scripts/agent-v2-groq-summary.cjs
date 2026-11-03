/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const provider of ['local', 'groq', 'router']) for (const set of ['m4b', 'fresh']) {
  const rows = report.runs.filter(x => x.provider === provider && x.set === set);
  const ms = rows.map(x => x.elapsedMs).sort((a, b) => a - b), measurements = rows.flatMap(x => x.measurements);
  console.log(JSON.stringify({ provider, set, n: rows.length, faithful: rows.filter(x => x.faithful).length,
    falseAccepts: rows.filter(x => x.falseAccept).length, rawFalseAccepts: rows.filter(x => x.rawFalseAccept).length,
    invalid: measurements.filter(x => x.status === 'INVALID_JSON').length,
    medianMs: Math.round((ms[15] + ms[16]) / 2), p95Ms: Math.round(ms[Math.ceil(ms.length * .95) - 1]),
    promptTokens: measurements.reduce((s, x) => s + (x.promptTokens || 0), 0), outputTokens: measurements.reduce((s, x) => s + (x.outputTokens || 0), 0),
    http: measurements.filter(x => x.status === 'HTTP_ERROR').length, http429: measurements.filter(x => x.httpStatus === 429).length,
    fallbacks: rows.filter(x => x.measurements.some(m => m.provider === 'ollama')).length, forced: rows.filter(x => x.forced).length,
    fallbackReasons: measurements.filter(x => x.provider === 'ollama').map(x => x.fallbackReason), models: [...new Set(measurements.map(x => x.model))] }));
}
console.log(JSON.stringify({ peakWorkingSetBytes: report.peakWorkingSetBytes, memorySamples: report.memory.length }));
