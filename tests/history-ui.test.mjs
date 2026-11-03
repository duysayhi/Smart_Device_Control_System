import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load, uiNodes, uiText } from './helpers/react-skill-console.mjs';

const file = path.resolve('components/history/PostgresHistory.tsx');
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const list = (items = [], page = 1, total = items.length, pageSize = 20) => ({ storageMode: 'POSTGRESQL_HISTORY', items, total, page, pageSize });
const execution = id => ({ id, device_id: secondId, original_command: null, status: 'UNVERIFIED', terminal_reason: 'UNKNOWN_EFFECT' });

test('operational Wi-Fi endpoint registry is labelled separately from PostgreSQL connection history',()=>{
  const {ConnectionHistory}=load(path.resolve('components/devices/ConnectionManager.tsx'));
  const html=renderToStaticMarkup(React.createElement(ConnectionHistory,{operationalOnly:true,pending:false,onCommand:()=>assert.fail('No command on render'),connections:[{serial:'192.168.50.9:5555',ip:'192.168.50.9',port:5555,state:'DISCONNECTED'}]}));
  assert.match(html,/Endpoint Wi-Fi đã tin cậy \(runtime\)/);assert.doesNotMatch(html,/<h3[^>]*>Lịch sử kết nối<\/h3>/);
});

// Reuse the existing TS loader and tree helpers; intercept hooks only for this component.
function harness(fetcher) {
  const slots = [], effects = new Map(), calls = [];
  let cursor = 0, tree;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const hooks = { ...React,
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.set(i, { effect, deps });
    },
  };
  const originalLoad = Module._load, oldFetch = global.fetch;
  delete load.cache[file];
  Module._load = function (id, parent, main) { return id === 'react' && parent?.filename === file ? hooks : originalLoad.call(this, id, parent, main); };
  let Component;
  try { Component = load(file).PostgresHistory; } finally { Module._load = originalLoad; }
  global.fetch = (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.body, undefined);
    assert.equal(new URL(url, 'http://history.test').pathname, '/api/history');
    calls.push({ url, init }); return fetcher(url, init, calls.length);
  };
  const render = () => {
    cursor = 0; tree = Component();
    for (const [i, pending] of effects) { slots[i]?.cleanup?.(); slots[i] = { deps: pending.deps, cleanup: pending.effect() }; }
    effects.clear(); return tree;
  };
  const find = predicate => { const node = uiNodes(tree).find(predicate); assert.ok(node, 'Expected history control'); return node; };
  return {
    calls, render, find, get tree() { return tree; },
    button: label => find(node => node.type === 'button' && uiText(node) === label),
    change(name, value) { find(node => node.props?.name === name).props.onChange({ target: { value } }); render(); },
    submit() { find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    async settle() { for (let i = 0; i < 6; i++) { await new Promise(setImmediate); render(); } },
    close() { for (const slot of slots) slot?.cleanup?.(); global.fetch = oldFetch; delete load.cache[file]; },
  };
}

test('history SSR performs no request and adds no execution controls', () => {
  const oldFetch = global.fetch; delete load.cache[file];
  global.fetch = () => assert.fail('No history IO during SSR');
  try {
    const html = renderToStaticMarkup(React.createElement(load(file).PostgresHistory));
    assert.match(html, /POSTGRESQL_HISTORY/); assert.doesNotMatch(html, /CANCEL|START|Hủy tác vụ|Chưa có tác vụ/);
  } finally { global.fetch = oldFetch; delete load.cache[file]; }
});

test('503 is explicit, clears rows, keeps safe diagnostics and never falls back or retries', async () => {
  const h = harness(async (_url, _init, count) => count === 1 ? Response.json(list([execution(firstId)])) : Response.json({ code: 'HISTORY_UNAVAILABLE', error: 'Storage offline' }, { status: 503 }));
  try {
    h.render(); await h.settle(); assert.match(uiText(h.tree), new RegExp(firstId));
    h.button('Làm mới lịch sử').props.onClick(); h.render(); assert.doesNotMatch(uiText(h.tree), new RegExp(firstId));
    await h.settle(); assert.match(uiText(h.tree), /HISTORY_UNAVAILABLE/); assert.doesNotMatch(uiText(h.tree), /Storage offline/); assert.equal(h.calls.length, 2);
    assert.doesNotMatch(uiText(h.tree), /Không có bản ghi PostgreSQL phù hợp/);
    assert.ok(h.find(node => node.props?.role === 'alert'));
  } finally { h.close(); }
});

test('refresh aborts old reads, ignores late responses and unmount aborts the latest read', async () => {
  const pending = [];
  const h = harness(() => new Promise(resolve => pending.push(resolve)));
  try {
    h.render(); h.button('Làm mới lịch sử').props.onClick(); h.render();
    assert.equal(h.calls[0].init.signal.aborted, true);
    pending[1](Response.json(list([execution(secondId)]))); await h.settle();
    pending[0](Response.json(list([execution(firstId)]))); await h.settle();
    assert.match(uiText(h.tree), new RegExp(secondId)); assert.doesNotMatch(uiText(h.tree), new RegExp(firstId)); assert.equal(h.calls.length, 2);
    h.button('Làm mới lịch sử').props.onClick(); h.render();
  } finally { h.close(); }
  assert.equal(h.calls.at(-1).init.signal.aborted, true);
});

test('API error bodies cannot expose credentials in list or detail errors', async () => {
  const credentials = 'postgresql://private-user:private-password@private-host/private-db?token=private-token';
  const fixedMessage = 'Không thể đọc lịch sử PostgreSQL. Hãy thử làm mới.';
  for (const detail of [false, true]) {
    for (const code of ['HISTORY_UNAVAILABLE', credentials, 'INVALID CODE', 'A'.repeat(81), 'HISTORY_UNAVAILABLE\n', null]) {
      const h = harness(async url => {
        const kind = new URL(url, 'http://history.test').searchParams.get('kind');
        if (detail && kind !== 'detail') return Response.json(list([execution(firstId)]));
        return Response.json({ code, error: credentials, credentials, message: credentials }, { status: 503 });
      });
      try {
        h.render(); await h.settle();
        if (detail) {
          h.find(node => node.props?.['aria-label'] === `Xem chi tiết ${firstId}`).props.onClick(); h.render(); await h.settle();
        }
        const alert = h.find(node => node.props?.role === 'alert');
        assert.equal(uiText(alert), fixedMessage + (code === 'HISTORY_UNAVAILABLE' ? ' [HISTORY_UNAVAILABLE]' : ''));
        assert.doesNotMatch(uiText(h.tree), /private-user|private-password|private-host|private-db|private-token|postgresql:\/\//);
      } finally { h.close(); }
    }
  }
});

test('execution list shows source_status UNKNOWN_EFFECT beside UNVERIFIED without opening detail', async () => {
  const h = harness(async () => Response.json(list([{ ...execution(firstId), terminal_reason: null, source_status: 'UNKNOWN_EFFECT' }])));
  try {
    h.render(); await h.settle();
    assert.ok(h.find(node => node.type === 'th' && uiText(node).includes('source_status')));
    const row = h.find(node => node.type === 'tr' && uiNodes(node).some(cell => cell.type === 'td' && uiText(cell) === firstId));
    assert.ok(uiNodes(row).some(cell => cell.type === 'td' && uiText(cell) === 'UNVERIFIED'));
    assert.ok(uiNodes(row).some(cell => cell.type === 'td' && uiText(cell) === 'UNKNOWN_EFFECT'));
    assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});

test('filters apply on submit, pagination resets, tabs use their contract fields', async () => {
  const h = harness(async url => {
    const params = new URL(url, 'http://history.test').searchParams;
    return Response.json(list([], Number(params.get('page')), 61, Number(params.get('pageSize'))));
  });
  const params = () => new URL(h.calls.at(-1).url, 'http://history.test').searchParams;
  try {
    h.render(); await h.settle(); h.button('Trang sau').props.onClick(); h.render(); await h.settle(); assert.equal(params().get('page'), '2');
    const beforeDraft = h.calls.length;
    h.change('deviceId', secondId); h.change('status', 'UNVERIFIED'); h.change('engine', 'AGENT_V2'); h.change('q', 'redacted text');
    h.change('from', '2026-01-01T12:00'); h.change('to', '2026-01-02T12:00'); assert.equal(h.calls.length, beforeDraft);
    h.submit(); await h.settle();
    assert.equal(params().get('page'), '1'); assert.equal(params().get('deviceId'), secondId); assert.equal(params().get('status'), 'UNVERIFIED');
    assert.equal(params().get('engine'), 'AGENT_V2'); assert.equal(params().get('q'), 'redacted text');
    assert.equal(params().get('from'), new Date('2026-01-01T12:00').toISOString()); assert.equal(params().get('to'), new Date('2026-01-02T12:00').toISOString());
    h.button('Thiết bị').props.onClick(); h.render(); await h.settle(); assert.equal(params().get('kind'), 'devices'); assert.equal(params().has('engine'), false);
    h.button('Kết nối').props.onClick(); h.render(); await h.settle(); h.change('transport', 'Wi-Fi'); h.submit(); await h.settle();
    assert.equal(params().get('kind'), 'connections'); assert.equal(params().get('transport'), 'Wi-Fi'); assert.equal(params().has('status'), false);
    h.change('pageSize', '50'); await h.settle(); assert.equal(params().get('pageSize'), '50'); assert.equal(params().get('page'), '1');
  } finally { h.close(); }
});

test('detail retains UNVERIFIED and audit source UNKNOWN_EFFECT; changing selection ignores stale detail', async () => {
  const pending = new Map();
  const h = harness(async url => {
    const params = new URL(url, 'http://history.test').searchParams;
    if (params.get('kind') !== 'detail') return Response.json(list([execution(firstId), execution(secondId)]));
    return new Promise(resolve => pending.set(params.get('id'), resolve));
  });
  const open = id => { h.find(node => node.props?.['aria-label'] === `Xem chi tiết ${id}`).props.onClick(); h.render(); };
  const detail = (id, marker) => Response.json({ execution: execution(id), steps: [{ status: 'UNVERIFIED' }], evidence: [], providers: [], audit: [{ sourceStatus: 'UNKNOWN_EFFECT', reason: marker }] });
  try {
    h.render(); await h.settle(); open(firstId); open(secondId);
    assert.equal(h.calls[1].init.signal.aborted, true);
    pending.get(secondId)(detail(secondId, 'current-audit')); await h.settle();
    pending.get(firstId)(detail(firstId, 'stale-audit')); await h.settle();
    assert.match(uiText(h.tree), /current-audit/); assert.doesNotMatch(uiText(h.tree), /stale-audit/);
    assert.match(uiText(h.tree), /"sourceStatus": "UNKNOWN_EFFECT"/); assert.match(uiText(h.tree), /"status": "UNVERIFIED"/);
    assert.equal(h.calls.length, 3);
  } finally { h.close(); }
});

test('transport failures and non-PostgreSQL replies show errors without private values or empty success', async () => {
  for (const fetcher of [async () => { throw Error('private-transport-value'); }, async () => Response.json({ ...list([]), storageMode: 'JSON' })]) {
    const h = harness(fetcher);
    try {
      h.render(); await h.settle(); assert.ok(h.find(node => node.props?.role === 'alert'));
      assert.doesNotMatch(uiText(h.tree), /private-transport-value|Không có bản ghi PostgreSQL phù hợp/); assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  }
});
