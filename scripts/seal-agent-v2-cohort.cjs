/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const output = path.resolve('tests/sealed/discovery-to-execution.json');
if (fs.existsSync(output)) throw Error('Sealed cohort already exists; never overwrite it during development.');
const pick = values => values[crypto.randomInt(values.length)];
const concepts = ['estuaries', 'canopies', 'instruments', 'currents', 'timetables', 'exhibits', 'observatories', 'habitats'];
const surfaces = ['native-tab', 'native-menu', 'live-search', 'unknown-widget'];
const states = ['home', 'old-results', 'unfocused-query', 'dialog', 'already-selected', 'duplicate-target'];
const cases = Array.from({ length: 18 }, (_, i) => ({ id: crypto.randomUUID(), cohort: ['TASK', 'APPLICATION', 'INITIAL_STATE'][i % 3],
  query: pick(concepts) + ' ' + crypto.randomBytes(3).toString('hex'), surface: pick(surfaces), initialState: pick(states),
  language: pick(['vi-accented', 'vi-unaccented', 'en']), realAppAssignment: 'REQUIRES_READ_ONLY_ELIGIBILITY_AT_M5' }));
const plain = Buffer.from(JSON.stringify({ version: 1, cases })), key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv), encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
fs.mkdirSync(path.dirname(output), { recursive: true });
const keyFile = path.join(os.tmpdir(), 'phone-commander-sealed-' + crypto.randomUUID() + '.key');
fs.writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 });
fs.writeFileSync(output, JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', count: cases.length,
  sha256: crypto.createHash('sha256').update(plain).digest('hex'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64'), keyFile }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ sealed: output, count: cases.length, status: 'NOT_OPENED', realAndroidAssignment: 'DEFERRED_M5' }));
