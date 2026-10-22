/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-commander-m6a-validation-'));
const summary = { node: process.execPath, startedAt: new Date().toISOString(), directory, files: [], pass: 0, fail: 0 };
const files = fs.readdirSync('tests').filter(f => f.endsWith('.test.cjs')).sort();
for (const file of files) {
  const started = performance.now(), child = spawnSync(process.execPath, ['--test', path.join('tests', file)], { encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const output = (child.stdout ?? '') + '\n' + (child.stderr ?? '') + (child.error ? '\n' + child.error.stack : '');
  const log = path.join(directory, file + '.log'); fs.writeFileSync(log, output);
  const row = { file, exitCode: child.status, signal: child.signal, elapsedMs: performance.now() - started, pass: Number(/^# pass (\d+)$/m.exec(output)?.[1] ?? 0), fail: Number(/^# fail (\d+)$/m.exec(output)?.[1] ?? 0), log };
  summary.files.push(row); summary.pass += row.pass; summary.fail += row.fail;
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(row));
}
summary.finishedAt = new Date().toISOString(); summary.exitCode = summary.files.some(row => row.exitCode !== 0) ? 1 : 0;
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail, files: files.length, summary: path.join(directory, 'summary.json') })); process.exitCode = summary.exitCode;
