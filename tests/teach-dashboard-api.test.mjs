import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
const load = createRequire(import.meta.url);
const root = path.resolve('.');
Module._extensions['.ts'] = (m, f) => {
  const original = m.require.bind(m);
  m.require = id => original(id.startsWith('@/') ? path.join(root, id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
};
const { OfflineTeachDashboard } = load('../lib/skills/teach-dashboard.ts');
const { teachResponse } = load('../lib/skills/teach-api.ts');
const sessions = load('../app/api/teach-sessions/route.ts');
const operations = load('../app/api/teach-sessions/[id]/[operation]/route.ts');
const skills = load('../app/api/skills/route.ts');
const versions = load('../app/api/skills/[id]/versions/[version]/route.ts');
const deviceId = '10000000-0000-4000-8000-000000000001';
const newSession = () => ({ deviceId, command: 'Mở YouTube và tìm kiếm OpenAI.', name: 'YouTube search', appAlias: 'youtube' });
const actions = () => [
  { operation: 'OPEN_APPLICATION', appRef: 'youtube' },
  { operation: 'ACTIVATE_CONTROL', purpose: 'SEARCH', target: { semanticRole: 'search_action', label: 'Search', containerRole: 'toolbar' } },
  { operation: 'INPUT_TEXT', value: 'OpenAI', target: { semanticRole: 'search_field', label: 'Search', containerRole: 'search' } },
  { operation: 'SUBMIT_SEARCH' },
];
const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost' };
function req(url, body, extra = {}) {
  return new Request('http://localhost' + url, body === undefined ? { ...extra } : { method: 'POST', headers, body: JSON.stringify(body), ...extra });
}
async function post(id, operation, body) {
  return operations.POST(req(`/api/teach-sessions/${id}/${operation}`, body), { params: Promise.resolve({ id, operation }) });
}
async function created() {
  const response = await sessions.POST(req('/api/teach-sessions', newSession())); assert.equal(response.status, 200); return response.json();
}
async function recording() { const s = await created(); return (await post(s.id, 'start', { revision: s.revision })).json(); }
async function reviewed() {
  let s = await recording();
  for (const action of actions()) {
    const response = await post(s.id, 'actions', { revision: s.revision, action }); assert.equal(response.status, 200); s = await response.json();
  }
  s = await (await post(s.id, 'finish', { revision: s.revision })).json();
  const response = await post(s.id, 'compile', { revision: s.revision }); assert.equal(response.status, 200); return response.json();
}
const saveBody = r => ({ reference: r.reference, confirmed: true, name: 'Reviewed search', description: 'Offline example', parameterNames: { query: 'topic' } });
beforeEach(() => { delete globalThis.phoneCommanderTeachOfflineG1; });

test('G1 real App Router offline flow: declared search -> review -> single DRAFT -> library/readback', async () => {
  const originalFetch = global.fetch;
  global.fetch = () => assert.fail('No device, model or network dispatch is allowed');
  try {
    const r = await reviewed();
    assert.deepEqual(r.session.actions.map(a => a.operation), actions().map(a => a.operation));
    assert.deepEqual(r.session.actions.map(a => a.order), [1, 2, 3, 4]);
    assert.ok(r.session.actions.every(a => a.declarationStatus === 'DECLARED' && a.dispatchStatus === 'NOT_DISPATCHED'));
    assert.equal(JSON.stringify(r).includes('OpenAI'), false);
    assert.equal(r.compilation.status, 'DRAFT'); assert.equal(r.compilation.reviewRequired, true);
    assert.deepEqual(Object.keys(r.compilation.draft.parameters), ['query']);
    assert.equal((await (await skills.GET(req('/api/skills'))).json()).skills.length, 0, 'compile alone must not save');
    const body = saveBody(r), responses = await Promise.all([post(r.session.id, 'save-draft', body), post(r.session.id, 'save-draft', body)]);
    assert.ok(responses.every(response => response.status === 200));
    const [saved, duplicate] = await Promise.all(responses.map(response => response.json())); assert.deepEqual(saved, duplicate);
    const sequential = await (await post(r.session.id, 'save-draft', body)).json(); assert.deepEqual(saved, sequential);
    assert.equal(saved.status, 'DRAFT'); assert.equal(saved.version, 1); assert.equal(saved.storageMode, 'OFFLINE_TEST_STORAGE');
    assert.deepEqual(Object.keys(saved.definition.parameters), ['topic']);
    assert.deepEqual(saved.definition.steps[2].arguments.value, { param: 'topic' });
    assert.deepEqual(saved.definition.steps[3].verify.value, { param: 'topic' });
    const listed = await (await skills.GET(req('/api/skills'))).json(); assert.equal(listed.skills.length, 1);
    const reread = await versions.GET(req(`/api/skills/${saved.skillId}/versions/1`), { params: Promise.resolve({ id: saved.skillId, version: '1' }) });
    assert.deepEqual(await reread.json(), saved);
    saved.definition.name = 'client mutation';
    const fresh = await (await versions.GET(req('/api/skills/x/versions/1'), { params: Promise.resolve({ id: duplicate.skillId, version: '1' }) })).json();
    assert.equal(fresh.definition.name, 'Reviewed search');
    assert.equal(JSON.stringify(fresh).includes('OpenAI'), false);
    assert.doesNotMatch(JSON.stringify(fresh), /"(?:receipt|snapshot|verified|evidenceLevel|contentHash|ownership)"/);
  } finally { global.fetch = originalFetch; }
});

for (const key of ['bounds', 'rawPoint', 'raw_point', 'tapPoint', 'point', 'coordinates', 'elementId', 'candidateId', 'grant', 'proof', 'verified']) {
  test('G1 rejects client authority/geometry, including nested key: ' + key, async () => {
    const response = await sessions.POST(req('/api/teach-sessions', { ...newSession(), extra: [{ [key]: true }] }));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_PAYLOAD');
    assert.equal((await (await skills.GET(req('/api/skills'))).json()).skills.length, 0);
  });
}
test('G1 mutation origin/CSRF guards run before creating sessions', async () => {
  for (const bad of [{ 'Content-Type': 'application/json' }, { ...headers, Origin: 'https://other.invalid' },
    { ...headers, 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://localhost', 'Content-Type': 'text/plain' }]) {
    assert.equal((await sessions.POST(req('/api/teach-sessions', newSession(), { headers: bad }))).status, 403);
  }
  assert.equal((await sessions.GET(new Request('http://remote.invalid/api/teach-sessions'))).status, 403);
  assert.equal((await sessions.POST(req('/api/teach-sessions', {}))).status, 400);
});
test('G1 fixture mode/consent is explicit and a client cannot register a physical device', async () => {
  const cfg = { mode: 'OFFLINE_TEST', workspaceRoot: root, consentGranted: false, devices: [{ id: deviceId, label: 'Offline fixture' }] };
  const service = new OfflineTeachDashboard(cfg);
  const response = await teachResponse(req('/api/teach-sessions', newSession()), 'create', {}, service);
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'NO_REMOTE_CONSENT');
  assert.throws(() => new OfflineTeachDashboard({ ...cfg, mode: 'NEON' }));
  assert.equal((await sessions.POST(req('/api/teach-sessions', { ...newSession(), deviceId: '20000000-0000-4000-8000-000000000002' }))).status, 404);
  assert.equal((await sessions.POST(req('/api/teach-sessions', { ...newSession(), hardwareSerial: 'client-hardware' }))).status, 400);
});
test('G1 actions require RECORDING and current revision; stale append never increments the timeline', async () => {
  const c = await created(); assert.equal((await post(c.id, 'actions', { revision: c.revision, action: actions()[0] })).status, 409);
  let s = await (await post(c.id, 'start', { revision: c.revision })).json(); const stale = s.revision;
  s = await (await post(s.id, 'actions', { revision: s.revision, action: actions()[0] })).json();
  assert.equal((await post(s.id, 'actions', { revision: stale, action: actions()[0] })).status, 409);
  assert.equal(s.actions.length, 1); assert.equal(s.actions[0].dispatchStatus, 'NOT_DISPATCHED');
});
test('G1 unsupported/destructive/secret inputs are rejected without echo or partial declarations', async () => {
  const s = await recording();
  for (const action of [{ operation: 'TAP_POINT', x: 10, y: 20 }, { operation: 'HOME' },
    { operation: 'ACTIVATE_CONTROL', purpose: 'NAVIGATION', target: { semanticRole: 'navigation', label: 'Delete photos', containerRole: 'app' } },
    { operation: 'ASSERT_UI', predicate: { kind: 'MAGIC_SUCCESS' } }]) {
    assert.equal((await post(s.id, 'actions', { revision: s.revision, action })).status, 400);
  }
  let current = s;
  for (const action of actions().slice(0, 2)) current = await (await post(current.id, 'actions', { revision: current.revision, action })).json();
  const secret = 'token=synthetic-private-query';
  const response = await post(current.id, 'actions', { revision: current.revision, action: { ...actions()[2], value: secret } });
  assert.equal(response.status, 400); assert.equal((await response.text()).includes(secret), false);
});
test('G1 ambiguous declarations cannot be saved or silently upgraded to observed', async () => {
  let s = await recording();
  for (const a of [actions()[0], { operation: 'ACTIVATE_CONTROL', target: actions()[1].target }]) {
    s = await (await post(s.id, 'actions', { revision: s.revision, action: a })).json();
  }
  assert.equal(s.actions[1].declarationStatus, 'AMBIGUOUS');
  s = await (await post(s.id, 'finish', { revision: s.revision })).json();
  const r = await (await post(s.id, 'compile', { revision: s.revision })).json();
  assert.equal(r.compilation.status, 'AMBIGUOUS'); assert.equal(r.reference, undefined);
  assert.equal((await post(s.id, 'save-draft', { ...saveBody(r), reference: deviceId })).status, 409);
});
test('G1 save requires confirmation, rejects altered binding and leaves only one DRAFT', async () => {
  const r = await reviewed(), body = saveBody(r);
  assert.equal((await post(r.session.id, 'save-draft', { ...body, confirmed: false })).status, 400);
  assert.equal((await post(r.session.id, 'save-draft', { ...body, definition: r.compilation.draft })).status, 400);
  assert.equal((await post(r.session.id, 'save-draft', { ...body, parameterNames: { madeUp: 'topic' } })).status, 400);
  assert.equal((await post(r.session.id, 'save-draft', body)).status, 200);
  assert.equal((await post(r.session.id, 'save-draft', { ...body, name: 'Different name' })).status, 409);
  assert.equal((await (await skills.GET(req('/api/skills'))).json()).skills.length, 1);
});
test('G1 domain mapping never exposes vendor SQL/messages or creates remote consent', async () => {
  const service = new OfflineTeachDashboard({ mode: 'OFFLINE_TEST', workspaceRoot: root, consentGranted: true, devices: [{ id: deviceId, label: 'Offline fixture' }] });
  service.list = () => { throw { code: 'TH011', message: 'synthetic-private-vendor SQL', detail: 'synthetic-private' }; };
  const response = await teachResponse(req('/api/skills'), 'skills', {}, service), text = await response.text();
  assert.equal(response.status, 403); assert.equal(text.includes('synthetic-private'), false); assert.match(text, /NO_REMOTE_CONSENT/);
  assert.equal((await post(deviceId, 'publish', {})).status, 404);
});
test('G1 library uses same in-memory repository across requests and a new store starts empty', async () => {
  const r = await reviewed(); await post(r.session.id, 'save-draft', saveBody(r));
  assert.deepEqual(await (await skills.GET(req('/api/skills'))).json(), await (await skills.GET(req('/api/skills'))).json());
  const fresh = new OfflineTeachDashboard({ mode: 'OFFLINE_TEST', workspaceRoot: root, consentGranted: true, devices: [{ id: deviceId, label: 'Offline fixture' }] });
  assert.equal(fresh.list().skills.length, 0); assert.equal(fresh.fixtures().persistence, 'MEMORY_ONLY_UNTIL_PROCESS_RESTART');
});
