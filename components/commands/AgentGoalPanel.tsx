'use client';
import { useEffect, useState } from 'react';
import { Play, Square, RefreshCw, Check, Crosshair, Layers } from 'lucide-react';
import Image from 'next/image';
import type { AndroidAdbDevice } from '@/types/device';
import type { AgentProgress } from '@/lib/android/agent/schema';
import { latestDeviceTasks } from '../../lib/android/agent/runtime-schema';
import type { AgentRuntimeControl } from '@/hooks/useAgentRuntimes';

interface Props {
  text: string; onText: (text: string) => void; devices: AndroidAdbDevice[]; serial: string;
  onSerial: (serial: string) => void; onRefresh: () => void; selectedDeviceIds: string[]; runtime: AgentRuntimeControl;
  inspectedExecutionId?: string;
}
const labels: Record<AgentProgress['status'], string> = {
  PLANNING: 'Đang lập mục tiêu', OBSERVING: 'Đang quan sát', DECIDING: 'Đang quyết định', EXECUTING: 'Đang thực thi',
  EXPLORING: 'Đang khám phá', VERIFYING: 'Đang xác minh', NEED_HUMAN_ASSISTANCE: 'Cần hỗ trợ', COMPLETED: 'Đã xác minh mục tiêu',
  BLOCKED: 'Bị chặn', FAILED: 'Thất bại', CANCELLED: 'Đã hủy',
};
export function RecoveryProgressView({ recovery }: { recovery: NonNullable<AgentProgress['recovery']> }) {
  if (!recovery.history.length) return null;
  return <div aria-label="Recovery progress" className="border-l-2 border-amber-400 pl-2 space-y-1">
    <p className="font-medium">Recovery · {recovery.parentStatus}</p>
    {recovery.history.map(task => <div key={task.subtaskId}>
      <p>{task.description} · {task.status}</p>
      <p className="text-slate-500">{task.triggerReason} · {task.attempts} lần · {(task.elapsedMs / 1000).toFixed(1)} s</p>
      {task.outcome && <p>{task.outcome}</p>}
    </div>)}
    {recovery.parentStatus === 'RUNNING' && <p>Đã xác minh recovery, tiếp tục mục tiêu chính.</p>}
  </div>;
}
export function AgentGoalPanel({ text, onText, devices, serial, onSerial, onRefresh, selectedDeviceIds, runtime, inspectedExecutionId }: Props) {
  const [error, setError] = useState<{ deviceId: string; message: string }>(), [submitting, setSubmitting] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number; evidenceId: string }>();
  const [now, setNow] = useState(0);
  const latestTasks = latestDeviceTasks(runtime.tasks), currentTask = latestTasks.get(serial);
  const task = runtime.tasks.find(task => task.executionId === inspectedExecutionId && task.deviceId === serial) ?? currentTask, latest = task?.latest;
  const device = devices.find(device => device.serial === serial), busy = currentTask && !currentTask.finishedAt;
  const pendingAssistance = task?.status === 'WAITING_HUMAN' && latest?.assistance?.resumable && latest.visual?.status === 'HUMAN_REQUIRED' ? latest : undefined;
  const selected = selectedDeviceIds.filter(id => devices.some(d => d.serial === id && d.status === 'device' && d.connectionType === 'USB'));
  const batchBlocked = selected.some(id => { const current = latestTasks.get(id); return current && !current.finishedAt; });
  useEffect(() => {
    if (!pendingAssistance) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [pendingAssistance]);
  async function issue(operation: () => Promise<void>) {
    setSubmitting(true); setError(undefined);
    try { await operation(); } catch (failure) { setError({ deviceId: serial, message: failure instanceof Error ? failure.message : 'Không thể gửi lệnh.' }); }
    finally { setSubmitting(false); }
  }
  const start = (ids: string[]) => issue(async () => {
    await runtime.command({ type: 'START', requestId: crypto.randomUUID(), jobs: ids.map(deviceId => ({ deviceId, goal: text })) });
    onSerial(ids.includes(serial) ? serial : ids[0]);
  });
  async function confirmPoint() {
    const visual = pendingAssistance?.visual, assistance = pendingAssistance?.assistance;
    if (!task || !visual || !assistance?.token || point?.evidenceId !== visual.id || now >= assistance.expiresAt) return;
    await issue(() => runtime.command({ type: 'ASSIST', executionId: task.executionId, deviceId: task.deviceId, token: assistance.token!, evidenceId: visual.id, confirmed: true,
      x: visual.image.crop[0] + point.x * (visual.image.crop[2] - visual.image.crop[0]),
      y: visual.image.crop[1] + point.y * (visual.image.crop[3] - visual.image.crop[1]) }));
    setPoint(undefined);
  }
  return <section className="flex flex-col gap-3 min-w-0 w-full" aria-label="Goal Agent">
    <label className="text-xs font-semibold text-slate-700" htmlFor="agent-goal">Mục tiêu</label>
    <textarea id="agent-goal" value={text} onChange={event => onText(event.target.value)} rows={3} className="resize-y rounded-md border border-slate-200 p-3 text-xs w-full" />
    <div className="flex gap-2 items-center">
      <select aria-label="Thiết bị Agent" value={serial} onChange={event => onSerial(event.target.value)} className="border border-slate-200 rounded-md p-2 text-xs min-w-0 flex-1">
        <option value="">Chọn điện thoại</option>{devices.map(device => <option key={device.serial} value={device.serial}>{device.model} · {device.serial} · {device.status}</option>)}
      </select>
      <button type="button" onClick={onRefresh} title="Làm mới thiết bị" aria-label="Làm mới thiết bị" className="p-2 border border-slate-200 rounded-md"><RefreshCw size={14} /></button>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void start([serial])} disabled={submitting || Boolean(busy) || !text.trim() || device?.status !== 'device' || device.connectionType !== 'USB'}
        className="flex gap-2 items-center justify-center bg-indigo-600 text-white rounded-md px-3 py-2 text-xs flex-1 disabled:opacity-50"><Play size={14} /> Chạy Agent</button>
      <button type="button" onClick={() => void start(selected)} disabled={submitting || selected.length < 2 || batchBlocked || !text.trim()}
        className="flex gap-2 items-center justify-center border border-slate-200 rounded-md px-3 py-2 text-xs disabled:opacity-50"><Layers size={14} /> Chạy nhóm ({selected.length})</button>
      <button type="button" onClick={() => task && void issue(() => runtime.command({ type: 'CANCEL', executionId: task.executionId, deviceId: task.deviceId }))}
        disabled={!task || Boolean(task.finishedAt) || task.cancelRequested || submitting} className="flex gap-2 items-center justify-center border border-slate-200 rounded-md px-3 py-2 text-xs disabled:opacity-50"><Square size={14} /> Hủy</button>
    </div>
    {runtime.reasoning && <p className="text-xs text-slate-500">Qwen: {runtime.reasoning.running} đang chạy · {runtime.reasoning.waiting} đang chờ</p>}
    {(error?.deviceId === serial || runtime.error) && <p role="alert" className="text-xs text-rose-600 break-words">{error?.deviceId === serial ? error.message : runtime.error}</p>}
    {runtime.tasks.length > 0 && <div className="divide-y divide-slate-100 text-xs" aria-label="Tác vụ theo thiết bị">
      {[...latestTasks.values()].map(current => <div key={current.executionId} className="flex gap-2 items-center py-2">
        <button type="button" onClick={() => onSerial(current.deviceId)} className="text-left min-w-0 flex-1 break-words underline decoration-slate-300">{current.deviceId} · {current.status}</button>
        {!current.finishedAt && <button type="button" aria-label={`Hủy ${current.deviceId}`} title="Hủy tác vụ" disabled={current.cancelRequested || submitting}
          onClick={() => void issue(() => runtime.command({ type: 'CANCEL', executionId: current.executionId, deviceId: current.deviceId }))} className="p-1.5 border border-slate-200 rounded"><Square size={12} /></button>}
      </div>)}
      {task && runtime.tasks.filter(item => item.batchId === task.batchId && !item.finishedAt).length > 1 && <button type="button"
        onClick={() => void issue(() => runtime.command({ type: 'CANCEL_BATCH', batchId: task.batchId }))} className="flex gap-2 items-center py-2 text-rose-700"><Square size={12} /> Hủy nhóm</button>}
    </div>}
    {task && <div aria-live="polite" className="border-t border-slate-200 pt-3 text-xs space-y-2 break-words">
      <p className="font-semibold">{task.deviceId} · {task.status}</p><p>{task.request}</p>
      <p className="text-slate-600">{latest?.subgoal}</p><p>{latest?.reason}</p>
      <p className="text-slate-500">{latest?.foregroundPackage} · {latest?.screen}</p>
      {latest?.failure && task.status !== 'COMPLETED' && <p className="text-amber-700">{latest.failure.code}: {latest.failure.message}</p>}
      {latest?.recovery && <RecoveryProgressView recovery={latest.recovery} />}
      {latest?.counters && <p className="text-slate-500">{latest.verifiedSubgoals}/{latest.totalSubgoals} mục tiêu con · {latest.counters.steps} bước · {latest.counters.snapshots} snapshot · {latest.counters.scrolls} cuộn · {latest.counters.reasoning} AI</p>}
      {latest?.timings && <p className="text-slate-500">{(latest.timings.totalMs / 1000).toFixed(1)} s · Quan sát {(latest.timings.observationMs / 1000).toFixed(1)} s · AI {(latest.timings.reasoningMs / 1000).toFixed(1)} s</p>}
      {latest?.resultEvidence && <p className="font-semibold text-emerald-700">{latest.resultEvidence.label}</p>}
      {latest?.destinationEvidence && <p className="text-emerald-700">{latest.destinationEvidence.ordinal}. {latest.destinationEvidence.title}</p>}
      {pendingAssistance && <p className="text-amber-700">{task.deviceId} · Chờ xác nhận vùng phát · {Math.max(0, Math.ceil((pendingAssistance.assistance!.expiresAt - now) / 1000))} s</p>}
      {pendingAssistance?.visual && <div className="space-y-2">
        <p>{pendingAssistance.visual.ordinal}. {pendingAssistance.visual.selectedTitle}</p>
        <div className="relative w-full">
          <Image src={pendingAssistance.visual.image.dataUrl} alt={`Vùng video cần xác nhận trên ${task.deviceId}`}
            width={pendingAssistance.visual.image.crop[2] - pendingAssistance.visual.image.crop[0]} height={pendingAssistance.visual.image.crop[3] - pendingAssistance.visual.image.crop[1]}
            unoptimized className="w-full h-auto cursor-crosshair" onError={() => { setPoint(undefined); setError({ deviceId: serial, message: 'Không tải được ảnh xác nhận.' }); }} onClick={event => {
              if (submitting) return; const bounds = event.currentTarget.getBoundingClientRect();
              setPoint({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, evidenceId: pendingAssistance.visual!.id });
            }} />
          {point?.evidenceId === pendingAssistance.visual.id && <Crosshair size={24} className="absolute text-red-600 pointer-events-none" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: 'translate(-50%, -50%)' }} />}
        </div>
        <button type="button" onClick={() => void confirmPoint()} disabled={submitting || point?.evidenceId !== pendingAssistance.visual.id || now >= pendingAssistance.assistance!.expiresAt}
          className="flex gap-2 items-center rounded-md bg-indigo-600 text-white px-3 py-2 disabled:opacity-50"><Check size={14} /> Xác nhận vùng phát</button>
      </div>}
      <ol className="border-t border-slate-100 pt-2 space-y-1 max-h-52 overflow-auto">{task.events.slice(-12).map((event, index) => <li key={index} className="text-slate-500">{labels[event.status]}{event.action ? ` · ${event.action.type}` : ''}: {event.reason}</li>)}</ol>
    </div>}
  </section>;
}
