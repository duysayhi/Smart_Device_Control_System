/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const keys = Object.entries(process.env).filter(([k, v]) => /(?:KEY|TOKEN)$/.test(k) && v?.length >= 16).map(([, v]) => v);
const hits = [], skip = new Set(['.git', '.next', 'node_modules', 'sealed', '.local-drivers']);
if (process.argv.includes('--include-build')) skip.delete('.next');
let count = 0;
function check(p) {
  if (fs.statSync(p).size > 10000000) return;
  const text = fs.readFileSync(p, 'utf8'); count++;
  if (keys.some(k => text.includes(k)) || /gsk_[A-Za-z0-9]{24,}/.test(text)) hits.push(p);
}
function visit(root) {
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (skip.has(d.name) || d.name.startsWith('.env') || d.isSymbolicLink()) continue;
    const p = path.join(root, d.name);
    if (d.isDirectory()) visit(p); else if (/\.(?:ts|tsx|cjs|json|jsonl|md|log|txt)$/.test(d.name) || d.name === '.gitignore') check(p);
  }
}
visit(process.cwd());
for (const d of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) if (d.isFile() && /^agent-v2-(?:groq|m4e)-/.test(d.name) && /\.(?:json|log)$/.test(d.name)) check(path.join(os.tmpdir(), d.name));
console.log(JSON.stringify({ scannedFiles: count, matchingPaths: hits, includeBuild: process.argv.includes('--include-build'), maxFileBytes: 10000000,
  exclusions: ['environment files', 'dependencies', ...(skip.has('.next') ? ['build'] : []), '.git', 'sealed cohort', 'unrelated TEMP files'], toolTranscriptNotScannable: true }));
if (hits.length) process.exitCode = 1;
