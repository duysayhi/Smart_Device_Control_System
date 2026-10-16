/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
}).outputText, file);
if (process.argv.includes('--stop')) {
  const path = require('node:path'), { runtimeDirectory } = require('../lib/android/agent/runtime-storage.ts');
  (async () => {
    const address = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(), 'address.json'), 'utf8'));
    const response = await fetch(`http://127.0.0.1:${address.port}/shutdown`, { method: 'POST', headers: { Authorization: 'Bearer ' + address.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ cancelActive: true }) });
    if (!response.ok) throw Error('Worker did not accept shutdown; inspect active tasks.');
    console.log('Worker shutdown requested; active executions will be cancelled and cleaned up.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
} else require('../lib/android/agent/worker-server.ts').startWorker().catch(error => { console.error(error.message); process.exitCode = 1; });
