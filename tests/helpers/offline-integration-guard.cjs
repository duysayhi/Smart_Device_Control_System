/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), cp = require('node:child_process');
const ports = new Set(), counters = { blockedNetwork: 0, allowedMockNetwork: 0, blockedProcesses: 0, blockedProtectedReads: 0 };
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) { this.once('listening', () => { const a = this.address(); if (a && typeof a === 'object') ports.add(a.port); }); return listen.apply(this, args); };
function allowed(host, port) {
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host ?? 'localhost') && ports.has(Number(port))) { counters.allowedMockNetwork++; return; }
  counters.blockedNetwork++; throw Error('OFFLINE_INTEGRATION: only this test process fixture servers are allowed');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = value && typeof value === 'object' ? value : { port: value, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  allowed(options.host, options.port); return connect.apply(this, args);
};
const fetch = global.fetch;
global.fetch = (input, ...args) => { const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); allowed(url.hostname, url.port); return fetch(input, ...args); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = cp[name]; cp[name] = function(command, ...args) {
    const value = String(command) + ' ' + JSON.stringify(args[0] ?? '');
    if (/(?:^|[\\/\s"'])adb(?:\.exe)?(?:[\s"']|$)|appium|ollama|agent-worker\.cjs/i.test(value)) { counters.blockedProcesses++; throw Error('OFFLINE_INTEGRATION: no real device/model/worker process'); }
    return original.call(this, command, ...args);
  };
}
function checkFile(file) {
  if (typeof file === 'number') return;
  const value = (file instanceof URL ? file.pathname : String(file)).replaceAll('\\', '/');
  if (/^\.env(?:\.|$)/i.test(path.basename(value)) || /(?:^|\/)(?:sealed|holdout)(?:\/|$)/i.test(value) || /\/tests\/[^/]*(?:held.?out|open-world)/i.test(value) || /\/tests\/fixtures\/[^/]*(?:held.?out|open-world)/i.test(value)) {
    counters.blockedProtectedReads++; throw Error('OFFLINE_INTEGRATION: DB/secret/excluded cohort reads forbidden');
  }
}
for (const name of ['readFile', 'readFileSync']) { const original = fs[name]; fs[name] = (file, ...args) => { checkFile(file); return original(file, ...args); }; }
const readFile = fs.promises.readFile; fs.promises.readFile = (file, ...args) => { checkFile(file); return readFile(file, ...args); };
process.on('exit', () => { if (process.env.PHONE_COMMANDER_TEST_EVIDENCE) fs.writeFileSync(path.join(process.env.PHONE_COMMANDER_TEST_EVIDENCE, 'tripwire-' + process.pid + '.json'), JSON.stringify(counters)); });
