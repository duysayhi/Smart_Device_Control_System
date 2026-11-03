'use client';

import { useEffect, useState } from 'react';

type HistoryKind = 'executions' | 'devices' | 'connections';
type Row = Record<string, unknown> & { id: string };
type HistoryList = {
  storageMode: 'POSTGRESQL_HISTORY';
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
};
type HistoryDetail = { execution: Row; steps: RowData[]; evidence: RowData[]; providers: RowData[]; audit: RowData[] };
type RowData = Record<string, unknown>;
type Filters = { deviceId: string; status: string; engine: string; from: string; to: string; q: string; transport: string };
const emptyFilters: Filters = { deviceId: '', status: '', engine: '', from: '', to: '', q: '', transport: '' };
const buttonClass = 'rounded border border-slate-200 px-3 py-2 text-xs disabled:opacity-50';
const inputClass = 'rounded border border-slate-200 bg-white px-2 py-1 text-sm';
const unavailable = 'Không thể đọc lịch sử PostgreSQL. Hãy thử làm mới.';
class HistoryReadError extends Error {}

function isRecord(value: unknown): value is RowData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRow(value: unknown): value is Row {
  return isRecord(value) && typeof value.id === 'string';
}

function isRecords(value: unknown): value is RowData[] {
  return Array.isArray(value) && value.every(isRecord);
}

async function readHistory(url: string, signal: AbortSignal): Promise<HistoryList | HistoryDetail> {
  const response = await fetch(url, { method: 'GET', cache: 'no-store', signal });
  // Never expose transport errors, HTML error bodies, or a different history source.
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const candidate = isRecord(body) && typeof body.code === 'string' ? body.code : '';
    const code = candidate.match(/^[A-Z0-9_]{1,80}$/)?.[0];
    throw new HistoryReadError(`${unavailable}${code && code === candidate ? ` [${code}]` : ''}`);
  }
  const params = new URLSearchParams(url.split('?')[1]);
  if (params.get('kind') === 'detail') {
    if (!isRecord(body) || !isRow(body.execution) || body.execution.id !== params.get('id') ||
      !isRecords(body.steps) || !isRecords(body.evidence) || !isRecords(body.providers) || !isRecords(body.audit)) {
      throw new HistoryReadError('Phản hồi chi tiết PostgreSQL không hợp lệ.');
    }
    return { execution: body.execution, steps: body.steps, evidence: body.evidence, providers: body.providers, audit: body.audit };
  }
  if (!isRecord(body) || body.storageMode !== 'POSTGRESQL_HISTORY' || !Array.isArray(body.items) || !body.items.every(isRow) ||
    typeof body.total !== 'number' || !Number.isSafeInteger(body.total) || body.total < 0 ||
    typeof body.page !== 'number' || !Number.isSafeInteger(body.page) || body.page < 1 ||
    typeof body.pageSize !== 'number' || !Number.isSafeInteger(body.pageSize) || body.pageSize < 1 ||
    body.page !== Number(params.get('page')) || body.pageSize !== Number(params.get('pageSize'))) {
    throw new HistoryReadError('Phản hồi lịch sử PostgreSQL không hợp lệ.');
  }
  return { storageMode: 'POSTGRESQL_HISTORY', items: body.items, total: body.total, page: body.page, pageSize: body.pageSize };
}

function useHistoryRequest(url: string | null, refresh: number) {
  const key = `${refresh}:${url ?? ''}`;
  const [result, setResult] = useState<{ key: string; data?: HistoryList | HistoryDetail; error?: string }>();
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let active = true;
    void readHistory(url, controller.signal).then(
      data => { if (active && !controller.signal.aborted) setResult({ key, data }); },
      error => { if (active && !controller.signal.aborted) setResult({ key, error: error instanceof HistoryReadError ? error.message : unavailable }); },
    );
    return () => { active = false; controller.abort(); };
  }, [url, key]);
  // Hide old rows immediately, including the render before effect cleanup runs.
  return {
    data: url && result?.key === key ? result.data : undefined,
    error: url && result?.key === key ? result.error : undefined,
    loading: Boolean(url && result?.key !== key),
  };
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

const columns: Record<HistoryKind, [string, string][]> = {
  executions: [
    ['id', 'Execution UUID'], ['device_id', 'Device UUID'], ['model', 'Model'], ['original_command', 'Lệnh (đã che dữ liệu)'],
    ['engine', 'Engine'], ['status', 'Trạng thái'], ['source_status', 'Trạng thái nguồn (source_status)'], ['terminal_reason', 'Lý do kết thúc'], ['started_at', 'Bắt đầu'],
    ['finished_at', 'Kết thúc'], ['model_calls', 'Model calls'], ['rpc_count', 'RPC'], ['adb_count', 'ADB'], ['execute_ms', 'Thời gian (ms)'],
  ],
  devices: [['id', 'Device UUID'], ['model', 'Model'], ['status', 'Trạng thái ghi nhận gần nhất'], ['first_seen_at', 'Lần đầu'], ['last_seen_at', 'Gần nhất']],
  connections: [['id', 'Audit UUID'], ['device_id', 'Device UUID'], ['event_type', 'Sự kiện'], ['mode', 'Kết nối'], ['created_at', 'Thời điểm'], ['reason', 'Lý do / sourceStatus']],
};

export function PostgresHistory({projectionStatus}:{projectionStatus?:string}={}) {
  const [kind, setKind] = useState<HistoryKind>('executions');
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filterError, setFilterError] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [refresh, setRefresh] = useState(0);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const params = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) });
  for (const field of ['deviceId', 'from', 'to', 'q'] as const) {
    if (filters[field]) params.set(field, filters[field]);
  }
  if (kind !== 'connections' && filters.status) params.set('status', filters.status);
  if (kind === 'executions' && filters.engine) params.set('engine', filters.engine);
  if (kind === 'connections' && filters.transport) params.set('transport', filters.transport);
  const listRequest = useHistoryRequest(`/api/history?${params}`, refresh);
  const detailRequest = useHistoryRequest(executionId ? `/api/history?${new URLSearchParams({ kind: 'detail', id: executionId })}` : null, refresh);
  const list = listRequest.data && 'items' in listRequest.data ? listRequest.data : undefined;
  const detail = detailRequest.data && 'execution' in detailRequest.data ? detailRequest.data : undefined;
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  const changeDraft = (field: keyof Filters, value: string) => setDraft(current => ({ ...current, [field]: value }));
  const changePage = (next: number) => { setExecutionId(null); setPage(next); };

  return <section aria-label="Lịch sử PostgreSQL" className="min-w-0 border-t border-slate-200 pt-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">Lịch sử PostgreSQL</h3><p className="text-xs text-slate-500">Chỉ đọc · POSTGRESQL_HISTORY</p></div>
      <button type="button" className={buttonClass} onClick={() => setRefresh(current => current + 1)}>Làm mới lịch sử</button>
    </div>
    <p className="text-xs text-slate-500">Trạng thái được giữ nguyên từ lịch sử. UNVERIFIED chưa được xác minh; UNKNOWN_EFFECT trong audit là tác động chưa rõ.</p>
    {projectionStatus&&<p role="status" className="text-xs text-amber-800">Đồng bộ lịch sử từ Worker: {projectionStatus}. Đây không phải trạng thái xác minh thao tác Android.</p>}
    <nav aria-label="Loại lịch sử" className="flex flex-wrap gap-2">
      {(['executions', 'devices', 'connections'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} className={buttonClass}
        onClick={() => { setKind(value); setPage(1); setExecutionId(null); setFilterError(undefined); }}>
        {{ executions: 'Thực thi', devices: 'Thiết bị', connections: 'Kết nối' }[value]}
      </button>)}
    </nav>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      const from = draft.from ? new Date(draft.from) : null;
      const to = draft.to ? new Date(draft.to) : null;
      if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) {
        setFilterError('Khoảng thời gian không hợp lệ.'); return;
      }
      setFilters({ ...draft, deviceId: draft.deviceId.trim(), status: draft.status.trim(), engine: draft.engine.trim(), q: draft.q.trim(), from: from?.toISOString() ?? '', to: to?.toISOString() ?? '' });
      setFilterError(undefined); setPage(1); setExecutionId(null); setRefresh(current => current + 1);
    }}>
      <label className="flex flex-col gap-1 text-xs">Device UUID<input className={inputClass} name="deviceId" value={draft.deviceId} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" onChange={event => changeDraft('deviceId', event.target.value)} /></label>
      {kind !== 'connections' && <label className="flex flex-col gap-1 text-xs">Trạng thái<input className={inputClass} name="status" value={draft.status} onChange={event => changeDraft('status', event.target.value)} placeholder="UNVERIFIED" /></label>}
      {kind === 'executions' && <label className="flex flex-col gap-1 text-xs">Engine<input className={inputClass} name="engine" value={draft.engine} onChange={event => changeDraft('engine', event.target.value)} /></label>}
      {kind === 'connections' && <label className="flex flex-col gap-1 text-xs">Kết nối<select className={inputClass} name="transport" value={draft.transport} onChange={event => changeDraft('transport', event.target.value)}>
        <option value="">Tất cả</option><option value="USB">USB</option><option value="Wi-Fi">Wi-Fi</option>
      </select></label>}
      <label className="flex flex-col gap-1 text-xs">Từ (giờ địa phương)<input className={inputClass} type="datetime-local" name="from" value={draft.from} onChange={event => changeDraft('from', event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs">Đến (giờ địa phương)<input className={inputClass} type="datetime-local" name="to" value={draft.to} onChange={event => changeDraft('to', event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs">Tìm văn bản đã che dữ liệu<input className={inputClass} type="search" name="q" value={draft.q} onChange={event => changeDraft('q', event.target.value)} /></label>
      <button type="submit" className={buttonClass}>Áp dụng bộ lọc</button>
      <button type="button" className={buttonClass} onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setFilterError(undefined); setPage(1); setExecutionId(null); }}>Xóa bộ lọc</button>
    </form>
    {filterError && <p role="alert" className="text-xs text-rose-600">{filterError}</p>}
    {listRequest.error && <p role="alert" className="text-sm text-rose-600">{listRequest.error}</p>}
    {listRequest.loading && <p role="status" className="text-xs text-slate-500">Đang đọc lịch sử PostgreSQL…</p>}
    {list && <>
      {list.items.length === 0 ? <p className="text-xs text-slate-500">Không có bản ghi PostgreSQL phù hợp.</p> : <div className="overflow-x-auto">
        <table className="w-full text-left text-xs"><caption className="sr-only">{{ executions: 'Lịch sử thực thi', devices: 'Lịch sử thiết bị', connections: 'Audit kết nối' }[kind]}</caption>
          <thead><tr className="border-b border-slate-200">{columns[kind].map(([field, label]) => <th scope="col" className="p-2" key={field}>{label}</th>)}{kind === 'executions' && <th scope="col" className="p-2">Chi tiết</th>}</tr></thead>
          <tbody>{list.items.map(row => <tr key={row.id} className="border-b border-slate-100 align-top">
            {columns[kind].map(([field]) => <td key={field} className="p-2 min-w-24 max-w-sm whitespace-pre-wrap break-words">{display(row[field])}</td>)}
            {kind === 'executions' && <td className="p-2"><button type="button" className={buttonClass} aria-label={`Xem chi tiết ${row.id}`} onClick={() => setExecutionId(row.id)}>Xem chi tiết</button></td>}
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
    <div className="flex flex-wrap items-center gap-3 text-xs" aria-label="Phân trang lịch sử">
      <button type="button" className={buttonClass} disabled={!list || page <= 1} onClick={() => changePage(page - 1)}>Trang trước</button>
      <span>{list ? `Trang ${list.page} / ${totalPages} · ${list.total} bản ghi` : `Trang ${page}`}</span>
      <button type="button" className={buttonClass} disabled={!list || page >= totalPages} onClick={() => changePage(page + 1)}>Trang sau</button>
      <label>Số dòng <select className={inputClass} name="pageSize" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); changePage(1); }}>
        {[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
    </div>
    {executionId && <section aria-label="Chi tiết thực thi" className="border-t border-slate-200 pt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold break-all">Chi tiết {executionId}</h4><button type="button" className={buttonClass} onClick={() => setExecutionId(null)}>Đóng chi tiết</button></div>
      {detailRequest.loading && <p role="status" className="text-xs text-slate-500">Đang đọc chi tiết…</p>}
      {detailRequest.error && <p role="alert" className="text-sm text-rose-600">{detailRequest.error}</p>}
      {detail && <>
        <div><h5 className="text-xs font-semibold">Execution</h5><pre className="text-xs whitespace-pre-wrap break-words">{display(detail.execution)}</pre></div>
        {(['steps', 'evidence', 'providers', 'audit'] as const).map(section => <div key={section}>
          <h5 className="text-xs font-semibold">{{ steps: 'Steps', evidence: 'Evidence', providers: 'Providers', audit: 'Audit / sourceStatus' }[section]} ({detail[section].length})</h5>
          {detail[section].length ? <pre className="text-xs whitespace-pre-wrap break-words">{display(detail[section])}</pre> : <p className="text-xs text-slate-500">Không có bản ghi.</p>}
        </div>)}
      </>}
    </section>}
  </section>;
}
