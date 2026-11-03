/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, file) => {
  const original = m.require.bind(m); m.require = name => original(name.startsWith('@/') ? path.join(root, name.slice(2)) : name);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file }).outputText, file);
};
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
// Offline hook/JSX event harness. No DOM/browser or Android acceptance is claimed.
function harness(relative, exportName) {
  const slots = [], effects = new Map(); let cursor = 0, output;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = { ...React,
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { value: { current: initial } }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.set(i, { effect, deps }); },
    useCallback(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { value: callback, deps }; return slots[i].value; },
  };
  const file = path.join(root, relative), originalLoad = Module._load; delete require.cache[file];
  Module._load = function(name, parent, main) { if (name === 'react' && parent?.filename === file) return hooks; return originalLoad.call(this, name, parent, main); };
  let component; try { component = require(file)[exportName]; } finally { Module._load = originalLoad; }
  function render() {
    cursor = 0; output = component();
    for (const [i, e] of effects) { slots[i]?.cleanup?.(); slots[i] = { deps: e.deps, cleanup: e.effect() }; }
    effects.clear(); return output;
  }
  const find = condition => { const n = nodes(output).find(condition); assert.ok(n, 'Expected UI control'); return n; };
  return { render, get output() { return output; }, find,
    field(label, value, checked) { find(n => n.props?.['aria-label'] === label).props.onChange({ target: checked === undefined ? { value } : { checked } }); render(); },
    button(label) { return find(n => n.type === 'button' && text(n) === label); },
    submit(label) { find(n => n.type === 'form' && nodes(n).some(c => c.type === 'button' && text(c) === label)).props.onSubmit({ preventDefault() {} }); render(); },
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); render(); } },
    close() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function installOfflineApi() {
  delete global.phoneCommanderTeachOfflineG1;
  const sessions = require('../app/api/teach-sessions/route.ts'), operations = require('../app/api/teach-sessions/[id]/[operation]/route.ts');
  const skills = require('../app/api/skills/route.ts'), versions = require('../app/api/skills/[id]/versions/[version]/route.ts');
  const previous = global.fetch, requests = [];
  global.fetch = async (url, init = {}) => {
    const pathname = String(url); requests.push(pathname);
    assert.ok(pathname.startsWith('/api/teach-sessions') || pathname.startsWith('/api/skills'), 'No Android/worker/model channel');
    const request = new Request('http://localhost' + pathname, { ...init, headers: { ...init.headers, ...(init.method === 'POST' ? { Origin: 'http://localhost' } : {}) } });
    if (pathname === '/api/teach-sessions') return init.method === 'POST' ? sessions.POST(request) : sessions.GET(request);
    if (pathname === '/api/skills') return skills.GET(request);
    const operation = /^\/api\/teach-sessions\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (operation) return operations.POST(request, { params: Promise.resolve({ id: operation[1], operation: operation[2] }) });
    const version = /^\/api\/skills\/([^/]+)\/versions\/(\d+)$/.exec(pathname);
    assert.ok(version); return versions.GET(request, { params: Promise.resolve({ id: version[1], version: version[2] }) });
  };
  return { requests, close() { global.fetch = previous; delete global.phoneCommanderTeachOfflineG1; } };
}

test('G1 real panel handlers and real routes: four declared steps -> review -> one saved DRAFT -> refresh/readback', async () => {
  const api = installOfflineApi(), h = harness('components/skills/TeachModePanel.tsx', 'TeachModePanel');
  try {
    h.render(); await h.settle();
    assert.match(text(h.output), /OFFLINE TEST STORAGE/); assert.match(text(h.output), /Chưa thực thi trên điện thoại/);
    h.field('Tên kỹ năng', 'YouTube search'); h.field('Câu lệnh mẫu', 'Mở YouTube và tìm kiếm OpenAI.');
    h.submit('Tạo phiên dạy'); await h.settle();
    h.button('Bắt đầu khai báo').props.onClick(); await h.settle();
    h.submit('Thêm bước khai báo'); await h.settle();
    h.field('Operation', 'ACTIVATE_CONTROL'); h.submit('Thêm bước khai báo'); await h.settle();
    h.field('Operation', 'INPUT_TEXT'); h.field('Giá trị mẫu', 'OpenAI'); h.submit('Thêm bước khai báo'); await h.settle();
    assert.equal(h.find(n => n.props?.['aria-label'] === 'Giá trị mẫu').props.value, '');
    h.field('Operation', 'SUBMIT_SEARCH'); h.submit('Thêm bước khai báo'); await h.settle();
    const timeline = h.find(n => n.props?.['aria-label'] === 'Timeline khai báo');
    assert.equal(nodes(timeline).filter(n => n.type === 'li').length, 4);
    assert.equal((text(timeline).match(/DECLARED/g) || []).length, 4);
    assert.equal((text(timeline).match(/NOT_DISPATCHED/g) || []).length, 4);
    assert.equal(text(timeline).includes('OpenAI'), false);
    h.button('Kết thúc khai báo').props.onClick(); await h.settle(); h.button('Compile').props.onClick(); await h.settle();
    assert.match(text(h.output), /Review — DRAFT/); assert.equal(h.button('Lưu DRAFT').props.disabled, true);
    h.field('Tham số query', 'topic'); h.field('Xác nhận bản nháp', undefined, true);
    const save = h.button('Lưu DRAFT'); save.props.onClick(); save.props.onClick(); await h.settle();
    assert.equal(api.requests.filter(p => p.endsWith('/save-draft')).length, 1, 'latch prevents duplicate app fetch');
    assert.match(text(h.output), /Đã lưu DRAFT/); assert.match(text(h.output), /Tham số: topic/);
    const library = h.find(n => n.props?.['aria-label'] === 'Skill Library');
    const libraryList = nodes(library).find(n => n.type === 'ul');
    assert.equal(nodes(libraryList).filter(n => n.type === 'li').length, 1);
    h.button('Xem chi tiết').props.onClick(); await h.settle(); assert.match(text(h.output), /DRAFT v1/);
    h.button('Làm mới thư viện').props.onClick(); await h.settle(); assert.match(text(h.output), /YouTube search/);
    assert.doesNotMatch(renderToStaticMarkup(h.output), /<textarea|Publish<|Replay</);
    h.close();
    const refreshed = harness('components/skills/TeachModePanel.tsx', 'TeachModePanel');
    try { refreshed.render(); await refreshed.settle(); assert.match(text(refreshed.output), /YouTube search/); }
    finally { refreshed.close(); }
  } finally { h.close(); api.close(); }
});
test('G1 ambiguous review offers a new declaration session and never enables save', async () => {
  const api = installOfflineApi(), h = harness('components/skills/TeachModePanel.tsx', 'TeachModePanel');
  try {
    h.render(); await h.settle(); h.field('Tên kỹ năng', 'Pending search'); h.field('Câu lệnh mẫu', 'Open YouTube and search');
    h.submit('Tạo phiên dạy'); await h.settle(); h.button('Bắt đầu khai báo').props.onClick(); await h.settle();
    h.submit('Thêm bước khai báo'); await h.settle(); h.field('Operation', 'ACTIVATE_CONTROL'); h.submit('Thêm bước khai báo'); await h.settle();
    h.button('Kết thúc khai báo').props.onClick(); await h.settle(); h.button('Compile').props.onClick(); await h.settle();
    assert.match(text(h.output), /AMBIGUOUS/);
    assert.equal(nodes(h.output).some(n => n.type === 'button' && text(n) === 'Lưu DRAFT'), false);
    h.button('Khai báo lại bằng phiên mới').props.onClick(); h.render();
    assert.equal(h.button('Tạo phiên dạy').props.disabled, true, 'sample command must be entered again');
    h.field('Câu lệnh mẫu', 'Open YouTube'); assert.equal(h.button('Tạo phiên dạy').props.disabled, false);
    assert.equal(api.requests.some(p => p.endsWith('/save-draft')), false);
  } finally { h.close(); api.close(); }
});
test('G1 mode switch unmounts control component and disables switching during control work', () => {
  const h = harness('app/page.tsx', 'default');
  try {
    const control = h.render(), controlType = control.type;
    const busyControls = control.props.controls(true); assert.ok(nodes(busyControls).filter(n => n.type === 'button').every(n => n.props.disabled));
    const idleControls = control.props.controls(false), teach = nodes(idleControls).find(n => n.type === 'button' && text(n) === 'Dạy kỹ năng');
    teach.props.onClick(); const result = h.render();
    assert.equal(nodes(result).some(n => n.type === controlType), false);
    assert.ok(nodes(result).some(n => n.type === require('../components/skills/TeachWorkspace.tsx').TeachWorkspace));
  } finally { h.close(); }
});
test('G1 initial offline panel displays no observed/verified claims and no network on SSR', () => {
  const previous = global.fetch; global.fetch = () => assert.fail('SSR must not fetch any API');
  try {
    delete require.cache[require.resolve('../components/skills/TeachModePanel.tsx')];
    const { TeachModePanel } = require('../components/skills/TeachModePanel.tsx');
    const html = renderToStaticMarkup(React.createElement(TeachModePanel));
    assert.match(html, /OFFLINE TEST STORAGE/); assert.match(html, /Chưa thực thi trên điện thoại/);
    assert.doesNotMatch(html, /OBSERVED|REAL_ANDROID_VERIFIED|VERIFIED_STEP/);
    assert.match(html, /mất khi server khởi động lại/);
  } finally { global.fetch = previous; }
});
test('G1 control markup is byte-identical after removing only the approved mode chooser', () => {
  const previous = global.fetch; global.fetch = () => assert.fail('Control SSR must not fetch');
  try {
    delete require.cache[require.resolve('../app/page.tsx')];
    const Dashboard = require('../app/page.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Dashboard));
    const mode = /<nav aria-label="Chế độ Dashboard"[\s\S]*?<\/nav>/g;
    assert.equal([...html.matchAll(mode)].length, 1);
    const preserved = html.replace(mode, '');
    assert.equal(require('node:crypto').createHash('sha256').update(preserved).digest('hex'), '270d9f325288d05c9dbdb1f305fc8b733e95ef1c97bd5c1101939f08c3602e84');
  } finally { global.fetch = previous; }
});
