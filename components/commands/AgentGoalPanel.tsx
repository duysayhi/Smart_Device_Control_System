'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import Image from 'next/image';
import type { AndroidAdbDevice } from '@/types/device';
import type { AgentProgress } from '@/lib/android/agent/schema';

interface Props {
  text: string; onText: (text: string) => void; devices: AndroidAdbDevice[]; serial: string;
  onSerial: (serial: string) => void; onRefresh: () => void; onBusy: (busy: boolean) => void;
}
const labels: Record<AgentProgress['status'], string> = {
  PLANNING: 'Đang lập mục tiêu', OBSERVING: 'Đang quan sát', DECIDING: 'Đang quyết định', EXECUTING: 'Đang thực thi',
  EXPLORING: 'Đang khám phá', VERIFYING: 'Đang xác minh', NEED_HUMAN_ASSISTANCE: 'Cần hỗ trợ', COMPLETED: 'Đã xác minh mục tiêu',
  BLOCKED: 'Bị chặn', FAILED: 'Thất bại', CANCELLED: 'Đã hủy',
};
export function AgentGoalPanel({ text, onText, devices, serial, onSerial, onRefresh, onBusy }: Props) {
  const [busy, setBusy] = useState(false), [events, setEvents] = useState<AgentProgress[]>([]), [error, setError] = useState<string>();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), [serial]);
  const latest = events.at(-1), device = devices.find(d => d.serial === serial);
  async function run() {
    const controller = new AbortController(); abort.current = controller;
    let completeSeen = false;
    setBusy(true); onBusy(true); setError(undefined); setEvents([{ type: 'progress', status: 'PLANNING', reason: 'Đang kiểm tra mục tiêu và phạm vi an toàn.' }]);
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: serial, goal: text }), signal: controller.signal });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Agent không thể bắt đầu.'); }
      if (!response.body) throw new Error('Không nhận được tiến trình Agent.');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
      try {
        for (;;) {
          const result = await reader.read();
          pending += decoder.decode(result.value, { stream: !result.done });
          if (pending.length > 16_000_000) throw new Error('Tiến trình vượt giới hạn dữ liệu.');
          const lines = pending.split('\n'); pending = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) {
            const event = JSON.parse(line) as AgentProgress;
            if (event.type === 'complete') completeSeen = true;
            setEvents(current => [...current.slice(-39), event]);
          }
          if (result.done) break;
        }
        if (!completeSeen) throw new Error('Luồng Agent kết thúc trước khi nhận trạng thái cuối đã xác minh.');
      } finally { reader.releaseLock(); }
    } catch (failure) {
      if (controller.signal.aborted) setEvents(current => [...current, { type: 'complete', status: 'CANCELLED', reason: 'Đã gửi yêu cầu hủy; backend đóng Session và nhả khóa.' }]);
      else {
        setError(failure instanceof Error ? failure.message : 'Lỗi Agent.');
        setEvents(current => [...current, { type: 'complete', status: 'FAILED', reason: 'Chưa nhận được kết quả cuối hợp lệ; không coi goal đã hoàn thành.' }]);
      }
    } finally { if (!completeSeen) controller.abort(); abort.current = null; setBusy(false); onBusy(false); }
  }
  return <section className="flex flex-col gap-3 min-w-0 w-full" aria-label="Goal Agent">
    <label className="text-xs font-semibold text-slate-700" htmlFor="agent-goal">Mục tiêu</label>
    <textarea id="agent-goal" value={text} disabled={busy} onChange={event => onText(event.target.value)} rows={3}
      className="resize-y rounded-md border border-slate-200 p-3 text-xs w-full" />
    <div className="flex gap-2 items-center">
      <select aria-label="Thiết bị Agent" disabled={busy} value={serial} onChange={event => onSerial(event.target.value)} className="border border-slate-200 rounded-md p-2 text-xs min-w-0 flex-1">
        <option value="">Chọn điện thoại</option>{devices.map(d => <option key={d.serial} value={d.serial}>{d.model} · {d.serial} · {d.status}</option>)}
      </select>
      <button type="button" onClick={onRefresh} disabled={busy} title="Làm mới thiết bị" aria-label="Làm mới thiết bị" className="p-2 border border-slate-200 rounded-md"><RefreshCw size={14} /></button>
    </div>
    <div className="flex gap-2">
      <button type="button" onClick={run} disabled={busy || !text.trim() || device?.status !== 'device' || device?.connectionType !== 'USB'} className="flex gap-2 items-center justify-center bg-indigo-600 text-white rounded-md px-3 py-2 text-xs flex-1 disabled:opacity-50"><Play size={14} /> Chạy Agent</button>
      <button type="button" onClick={() => abort.current?.abort()} disabled={!busy} className="flex gap-2 items-center justify-center border border-slate-200 rounded-md px-3 py-2 text-xs disabled:opacity-50"><Square size={14} /> Hủy</button>
    </div>
    {error && <p role="alert" className="text-xs text-rose-600 break-words">{error}</p>}
    {latest && <div aria-live="polite" className="border-t border-slate-200 pt-3 text-xs space-y-2 break-words">
      <p className="font-semibold">{labels[latest.status]}</p><p>{latest.description ?? text}</p><p className="text-slate-600">{latest.subgoal}</p>
      <p>{latest.reason}</p><p className="text-slate-500">{latest.foregroundPackage} · {latest.screen}</p>
      {latest.counters && <p className="text-slate-500">{latest.verifiedSubgoals}/{latest.totalSubgoals} mục tiêu con · {latest.counters.steps} bước · {latest.counters.snapshots} snapshot · {latest.counters.scrolls} cuộn · {latest.counters.reasoning} AI</p>}
      {latest.assistance && <p className="text-amber-700">Cần hỗ trợ: {latest.assistance.category}. Session sẽ đóng; chưa hỗ trợ tiếp tục từ xác nhận này.</p>}
      {latest.visual && <Image src={latest.visual.image.dataUrl} alt="Bằng chứng vùng mục tiêu đang bị chặn" width={latest.visual.image.crop[2] - latest.visual.image.crop[0]} height={latest.visual.image.crop[3] - latest.visual.image.crop[1]} unoptimized className="w-full h-auto max-h-80 object-contain" />}
      <ol className="border-t border-slate-100 pt-2 space-y-1 max-h-52 overflow-auto">{events.slice(-12).map((event, index) => <li key={index} className="text-slate-500">{labels[event.status]}{event.action ? ` · ${event.action.type}` : ''}: {event.reason}</li>)}</ol>
    </div>}
  </section>;
}
