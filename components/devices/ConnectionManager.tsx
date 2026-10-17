'use client';
import { useCallback, useEffect, useState } from 'react';
import { Cable, Wifi, Link2, Unplug, RefreshCw, Terminal, ArrowRight } from 'lucide-react';
import type { AndroidAdbDevice } from '@/types/device';

interface Connection {
  serial: string; ip: string; port: number; physicalId?: string; model?: string;
  state: string; lastConnectedAt?: number; error?: string; currentSessionId?: string; currentExecutionId?: string;
}
export function ConnectionManager({ devices, selectedSerial, onSelect, onRefresh }: {
  devices: AndroidAdbDevice[]; selectedSerial: string; onSelect: (serial: string) => void; onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'USB' | 'Wi-Fi'>('USB');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [discovered, setDiscovered] = useState<{ name: string; ip: string; port: number }[]>([]);
  const [ip, setIp] = useState(''), [port, setPort] = useState(''), [pairPort, setPairPort] = useState('');
  const [usb, setUsb] = useState(''), [tcpPort, setTcpPort] = useState('5555');
  const [pairing, setPairing] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/devices/wireless', { cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Không đọc được trạng thái kết nối.');
      setConnections(value.connections);
      setDiscovered(value.discovered ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không đọc được kết nối.'); }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void reload(); });
    const timer = setInterval(() => { if (!document.hidden) { void reload(); void onRefresh(); } }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [reload, onRefresh]);
  const command = async (body: object) => {
    setPending(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/devices/wireless', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Kết nối thất bại.');
      setMessage(value.message);
      if (value.connection?.state === 'CONNECTED') { onSelect(value.connection.serial); setTab('Wi-Fi'); }
      await onRefresh(); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Kết nối thất bại.'); }
    finally { setPending(false); }
  };
  const inputClass = 'h-9 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800';
  const buttonClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs text-slate-700 disabled:opacity-40';
  const visible = devices.filter(device => device.connectionType === tab);
  const safePairCommand = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && /^\d{4,5}$/.test(pairPort) ? `adb pair ${ip}:${pairPort}` : 'adb pair <IP>:<PAIRING_PORT>';
  return <section aria-label="Quản lý kết nối thiết bị" className="min-w-0 border-b border-slate-200 pb-4 text-slate-800">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Quản lý kết nối thiết bị</h2>
      <div className="flex items-center gap-1" role="tablist" aria-label="Phương thức kết nối">
        {(['USB', 'Wi-Fi'] as const).map(mode => <button key={mode} role="tab" aria-selected={tab === mode} onClick={() => setTab(mode)} className={`${buttonClass} ${tab === mode ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : ''}`}>
          {mode === 'USB' ? <Cable size={14} /> : <Wifi size={14} />}{mode}
        </button>)}
        <button title="Làm mới kết nối" aria-label="Làm mới kết nối" disabled={pending} className={buttonClass} onClick={() => { void reload(); void onRefresh(); }}><RefreshCw size={14} /></button>
      </div>
    </div>
    <div className="mb-3 divide-y divide-slate-200">
      {!visible.length && <p className="py-2 text-xs text-slate-500">Chưa có thiết bị {tab} trong ADB.</p>}
      {visible.map(device => <div key={device.serial} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
        <div className="min-w-0 text-xs"><strong>{device.model}</strong><span className="ml-2 text-slate-500">{device.busy ? 'BUSY' : device.status === 'device' ? 'CONNECTED' : device.status}</span>
          <div className="break-all text-slate-500">{device.serial} · {device.osVersion || 'Android'} · {device.identityVerified ? 'Danh tính đã xác minh' : 'Chưa xác minh danh tính'}</div>
          {device.currentSessionId && <div className="break-all text-slate-500">Session: {device.currentSessionId}</div>}
          {device.currentExecutionId && <div className="break-all text-slate-500">Execution: {device.currentExecutionId}</div>}
        </div>
        <button className={buttonClass} disabled={pending || device.busy || device.status !== 'device' || tab === 'Wi-Fi' && !device.identityVerified} onClick={() => { onSelect(device.serial); void onRefresh(); }}>
          {selectedSerial === device.serial ? 'Đang chọn' : 'Chọn transport'}<ArrowRight size={13} />
        </button>
      </div>)}
    </div>
    {tab === 'Wi-Fi' && <div className="space-y-3">
      {discovered.map(endpoint => <button key={endpoint.name} type="button" className={buttonClass} onClick={() => { setIp(endpoint.ip); setPort(String(endpoint.port)); }}>
        <Wifi size={14} /><span className="break-all">DISCOVERED · {endpoint.ip}:{endpoint.port}</span>
      </button>)}
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void command({ type: 'CONNECT', ip, port: Number(port) }); }}>
        <label className="flex min-w-0 flex-col gap-1 text-xs">IP điện thoại<input aria-label="IP điện thoại" value={ip} onChange={e => setIp(e.target.value)} required className={inputClass} placeholder="Địa chỉ IPv4 trong LAN" /></label>
        <label className="flex w-32 flex-col gap-1 text-xs">Connection port<input aria-label="Connection port" type="number" min="1024" max="65535" value={port} onChange={e => setPort(e.target.value)} required className={inputClass} /></label>
        <button className={buttonClass} disabled={pending}><Link2 size={14} />Kết nối</button>
        <button type="button" className={buttonClass} onClick={() => setPairing(!pairing)}><Terminal size={14} />Ghép nối Android 11+</button>
      </form>
      {pairing && <div className="border-l-2 border-indigo-300 pl-3 text-xs">
        <p className="mb-2">Trên điện thoại: Developer options → Wireless debugging → Pair device with pairing code. Chỉ nhập mã trong terminal. Pairing port khác connection port.</p>
        <label className="flex max-w-44 flex-col gap-1">Pairing port<input aria-label="Pairing port" type="number" min="1024" max="65535" value={pairPort} onChange={e => setPairPort(e.target.value)} className={inputClass} /></label>
        <code className="mt-2 block break-all bg-slate-100 p-2">{safePairCommand}</code>
      </div>}
      <form className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3" onSubmit={event => { event.preventDefault(); void command({ type: 'USB_TO_WIFI', serial: usb, port: Number(tcpPort), ...(ip ? { ip } : {}) }); }}>
        <label className="flex min-w-0 flex-col gap-1 text-xs">USB → Wi-Fi<select aria-label="Thiết bị USB để chuyển Wi-Fi" required value={usb} onChange={e => setUsb(e.target.value)} className={inputClass}>
          <option value="">Chọn thiết bị USB</option>{devices.filter(d => d.connectionType === 'USB').map(d => <option key={d.serial} value={d.serial} disabled={d.status !== 'device' || d.busy}>{d.model} · {d.serial}</option>)}
        </select></label>
        <label className="flex w-32 flex-col gap-1 text-xs">TCP/IP port<input type="number" min="1024" max="65535" required value={tcpPort} onChange={e => setTcpPort(e.target.value)} className={inputClass} /></label>
        <button disabled={pending} className={buttonClass}><Wifi size={14} />Chuyển sang Wi-Fi</button>
      </form>
      {connections.map(connection => <div key={connection.serial} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 py-2 text-xs">
        <div className="min-w-0"><strong className="break-all">{connection.model || connection.serial}</strong><span className="ml-2">{connection.state}</span>
          <div className="break-all text-slate-500">{connection.ip}:{connection.port}{connection.lastConnectedAt ? ` · ${new Date(connection.lastConnectedAt).toLocaleTimeString()}` : ''}</div>
          {connection.error && <div role="alert" className="break-words text-red-600">{connection.error}</div>}
        </div>
        <div className="flex gap-1">
          <button title="Kết nối lại cùng endpoint, không resume execution" aria-label={`Kết nối lại ${connection.serial}`} className={buttonClass} disabled={pending} onClick={() => void command({ type: 'RECONNECT', serial: connection.serial })}><RefreshCw size={14} /></button>
          <button title="Ngắt kết nối ADB Wi-Fi" aria-label={`Ngắt ${connection.serial}`} className={buttonClass} disabled={pending || connection.state === 'BUSY'} onClick={() => void command({ type: 'DISCONNECT', serial: connection.serial })}><Unplug size={14} /></button>
        </div>
      </div>)}
    </div>}
    {pending && <p role="status" className="mt-2 text-xs text-indigo-700">Đang xử lý kết nối…</p>}
    {message && <p role="status" className="mt-2 break-words text-xs text-emerald-700">{message}</p>}
    {error && <p role="alert" className="mt-2 break-words text-xs text-red-600">{error}</p>}
  </section>;
}
