/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), { createHash } = require('node:crypto');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, f) => {
  const original = m.require.bind(m); m.require = id => original(id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id);
  m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: f }).outputText, f);
};

test('OFFLINE characterization: initial Dashboard markup after unified single-path UI is stable', () => {
  const originalFetch = global.fetch;
  global.fetch = () => assert.fail('Dashboard SSR must not call a provider, worker or Android');
  try {
    const Dashboard = require('../app/page.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Dashboard));
    assert.equal(createHash('sha256').update(html).digest('hex'), '270d9f325288d05c9dbdb1f305fc8b733e95ef1c97bd5c1101939f08c3602e84');
    assert.match(html, /Tác vụ Android/); assert.match(html, /Lịch sử Agent/);
    assert.doesNotMatch(html, /Hàng đợi tác vụ \(Task Queue\)/);
  } finally { global.fetch = originalFetch; }
});

test('OFFLINE characterization: legacy queue has no entry-point or dynamic references outside its own two-file island', () => {
  const island = new Set(['components/executions/TaskQueue.tsx', 'components/executions/ExecutionDetailModal.tsx']);
  for (const root of ['app', 'components', 'hooks', 'lib', 'types', 'scripts']) {
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name).split(path.sep).join('/');
        if (entry.isSymbolicLink() || /sealed|holdout/i.test(file)) continue;
        if (entry.isDirectory()) { walk(file); continue; }
        if (!/\.(?:ts|tsx|cjs|js|mjs)$/.test(file) || island.has(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /\b(?:TaskQueue|ExecutionDetailModal)\b/, file);
      }
    };
    walk(root);
  }
});
