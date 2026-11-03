/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, file) => {
  const original = m.require.bind(m); m.require = id => original(id.startsWith('@/') ? path.join(root, id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file }).outputText, file);
};
const { OfflineTeachDashboard } = require('../lib/skills/teach-dashboard.ts');
const { PostgresTeachRepository } = require('../lib/skills/db/postgres-teach-repository.ts');
const { TeachStorageError } = require('../lib/skills/db/teach-errors.ts');
const { teachResponse } = require('../lib/skills/teach-api.ts');
const text = n => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : typeof n === 'object' ? text(n.props?.children) : String(n);
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
// Hook/JSX harness only; this is not browser acceptance.
function panel(pending) {
  const slots = []; let cursor = 0, output; const effects = new Map();
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = { ...React,
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { value: { current: initial } }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.set(i, { effect, deps }); },
    useCallback(value, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { value, deps }; return slots[i].value; },
  };
  const file = path.join(root, 'components/skills/TeachModePanel.tsx'), original = Module._load; delete require.cache[file];
  Module._load = function(id, parent, main) { return id === 'react' && parent?.filename === file ? hooks : original.call(this, id, parent, main); };
  let component; try { component = require(file).TeachModePanel; } finally { Module._load = original; }
  function render() { cursor = 0; output = component(); for (const [i, e] of effects) { slots[i]?.cleanup?.(); slots[i] = { deps: e.deps, cleanup: e.effect() }; } effects.clear(); }
  const find = predicate => { const n = nodes(output).find(predicate); assert.ok(n, 'Expected UI control'); return n; };
  return { render, get output() { return output; },
    field(label, value, checked) { find(n => n.props?.['aria-label'] === label).props.onChange({ target: checked === undefined ? { value } : { checked } }); render(); },
    button(label) { return find(n => n.type === 'button' && text(n) === label); },
    submit(label) { find(n => n.type === 'form' && nodes(n).some(c => c.type === 'button' && text(c) === label)).props.onSubmit({ preventDefault() {} }); render(); },
    async settle() { for (let i = 0; i < 600; i++) { await new Promise(resolve => setTimeout(resolve, 5)); render(); if (!pending()) { await new Promise(setImmediate); render(); return; } } assert.fail('Offline fixture did not settle'); },
    close() { for (const s of slots) s?.cleanup?.(); },
  };
}
async function fixture(failure) {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'db/teach/10_install_teach_schema.sql'), 'utf8'));
  await db.exec('SET search_path TO public');
  await db.query("INSERT INTO teach_mode.consents(subject_ref,consent_type,granted) VALUES ('local-owner','TEACH_REMOTE_STORAGE',true)");
  const map = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const driver = { query: async (sql, values) => map(await db.query(sql, values)), transaction: async work => {
    const result = await db.transaction(tx => work({ query: async (sql, values) => map(await tx.query(sql, values)) }));
    if (failure === 'commit') throw new TeachStorageError('SAVE_OUTCOME_UNKNOWN'); return result;
  } };
  const config = { mode: 'OFFLINE_TEST', workspaceRoot: root, consentGranted: true, devices: [{ id: '10000000-0000-4000-8000-000000000001', label: 'PGlite fixture only' }] };
  const service = new OfflineTeachDashboard(config, { mode: 'PGLITE_TEST', repository: new PostgresTeachRepository(driver, 'teach_mode') });
  const previous = global.fetch, requests = []; let pending = 0;
  global.fetch = async (url, init = {}) => {
    pending++; requests.push(String(url));
    try {
      const request = new Request('http://localhost' + url, { ...init, headers: { ...init.headers, ...(init.method === 'POST' ? { Origin: 'http://localhost' } : {}) } });
      const match = /^\/api\/teach-sessions\/([^/]+)\/([^/]+)$/.exec(url);
      const version = /^\/api\/skills\/([^/]+)\/versions\/(\d+)$/.exec(url);
      let response;
      if (match) response = await teachResponse(request, match[2], { id: match[1] }, service);
      else if (version) response = await teachResponse(request, 'version', { id: version[1], version: version[2] }, service);
      else if (url === '/api/skills') response = await teachResponse(request, 'skills', {}, service);
      else { assert.equal(url, '/api/teach-sessions'); response = await teachResponse(request, init.method === 'POST' ? 'create' : 'fixtures', {}, service); }
      if (failure === 'transport' && String(url).endsWith('/save-draft')) throw new TypeError('Synthetic lost response');
      return response;
    } finally { pending--; }
  };
  return { db, requests, pending: () => pending, async close() { global.fetch = previous; await db.close(); } };
}
async function review(h) {
  h.render(); await h.settle(); h.field('Tên kỹ năng', 'UI persisted search'); h.field('Câu lệnh mẫu', 'Mở YouTube và tìm OpenAI');
  h.submit('Tạo phiên dạy'); await h.settle(); h.button('Bắt đầu khai báo').props.onClick(); await h.settle();
  h.submit('Thêm bước khai báo'); await h.settle();
  h.field('Operation', 'ACTIVATE_CONTROL'); h.submit('Thêm bước khai báo'); await h.settle();
  h.field('Operation', 'INPUT_TEXT'); h.field('Giá trị mẫu', 'OpenAI'); h.submit('Thêm bước khai báo'); await h.settle();
  h.field('Operation', 'SUBMIT_SEARCH'); h.submit('Thêm bước khai báo'); await h.settle();
  h.button('Kết thúc khai báo').props.onClick(); await h.settle(); h.button('Compile').props.onClick(); await h.settle();
  h.field('Xác nhận bản nháp', undefined, true);
}
test('G2.1 UI uses backend PGlite label, Save and Library through the PostgreSQL repository', async () => {
  const f = await fixture(), h = panel(f.pending);
  try {
    await review(h); assert.match(text(h.output), /PGLITE TEST STORAGE/); assert.doesNotMatch(text(h.output), /OFFLINE TEST STORAGE/);
    const save = h.button('Lưu DRAFT'); save.props.onClick(); save.props.onClick(); await h.settle();
    assert.equal(f.requests.filter(p => p.endsWith('/save-draft')).length, 1); assert.match(text(h.output), /Đã lưu DRAFT/);
    h.button('Xem chi tiết').props.onClick(); await h.settle(); assert.match(text(h.output), /DRAFT v1/);
    assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM teach_mode.skills')).rows[0].n), 1);
  } finally { h.close(); await f.close(); }
});
for (const failure of ['commit', 'transport']) test('G2.1 UI blocks another Save after lost ' + failure + ' response and offers Library readback', async () => {
  const f = await fixture(failure), h = panel(f.pending);
  try {
    await review(h); h.button('Lưu DRAFT').props.onClick(); await h.settle();
    assert.match(text(h.output), /Kết quả lưu chưa xác định/); assert.match(text(h.output), /Skill Library/);
    assert.equal(h.button('Lưu DRAFT').props.disabled, true); assert.equal(text(h.output).includes('Đã lưu DRAFT'), false);
    assert.equal(f.requests.filter(p => p.endsWith('/save-draft')).length, 1);
    h.button('Làm mới thư viện').props.onClick(); await h.settle(); assert.match(text(h.output), /UI persisted search/);
    assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM teach_mode.skills')).rows[0].n), 1);
    assert.equal(f.requests.filter(p => p.endsWith('/save-draft')).length, 1);
  } finally { h.close(); await f.close(); }
});
