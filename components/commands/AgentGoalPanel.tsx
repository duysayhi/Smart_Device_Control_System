'use client';
import { useEffect, useState } from 'react';
import { Play, Square, RefreshCw, Check, Crosshair, Layers, X } from 'lucide-react';
import Image from 'next/image';
import type { AndroidAdbDevice } from '@/types/device';
import type { AgentProgress } from '@/lib/android/agent/schema';
import { latestDeviceTasks } from '../../lib/android/agent/runtime-schema';
import type { AgentRuntimeControl } from '@/hooks/useAgentRuntimes';
import type { OwnerTestMode } from '@/lib/android/agent/owner-test-policy';

interface Props {
  text: string; onText: (text: string) => void; devices: AndroidAdbDevice[]; serial: string;
  onSerial: (serial: string) => void; onRefresh: () => void; selectedDeviceIds: string[]; runtime: AgentRuntimeControl;
  inspectedExecutionId?: string;
  controlsMode?: 'all' | 'results' | 'group';
}
const labels: Record<AgentProgress['status'], string> = {
  PLANNING: 'Đang lập mục tiêu', OBSERVING: 'Đang quan sát', DECIDING: 'Đang quyết định', EXECUTING: 'Đang thực thi',
  EXPLORING: 'Đang khám phá', VERIFYING: 'Đang xác minh', NEED_HUMAN_ASSISTANCE: 'Cần hỗ trợ', COMPLETED: 'Đã xác minh mục tiêu',
  BLOCKED: 'Bị chặn', FAILED: 'Thất bại', CANCELLED: 'Đã hủy',
};
export function OwnerTestModeControl({ mode, disabled, onChange }: { mode?: OwnerTestMode; disabled: boolean; onChange(enabled: boolean): void }) {
  return <div className="border-l-2 border-amber-400 pl-2 text-xs space-y-1" aria-label="Owner authorized test mode">
    <label className="flex items-center gap-2">
      <input type="checkbox" role="switch" aria-label="OWNER_AUTHORIZED_TEST_MODE" checked={Boolean(mode)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      Chế độ thử nghiệm chủ sở hữu · {mode ? 'BẬT' : 'TẮT'}
    </label>
    {mode && <p className="break-all text-amber-800">{mode.deviceId} · Hết hạn {new Date(mode.expiresAt).toLocaleTimeString('vi-VN')}</p>}
  </div>;
}
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
export function NavigationProgressView({ event }: { event: AgentProgress }) {
  if (!event.currentScreen || !event.navigation) return null;
  const state = event.currentScreen, navigation = event.navigation;
  return <div aria-label="Current screen navigation" className="border-l-2 border-cyan-500 pl-2 space-y-1 break-words">
    <p className="font-medium">{state.screenType} · {state.confidence}</p>
    <p>{state.foregroundPackage}{state.foregroundActivity ? ` · ${state.foregroundActivity}` : ''}</p>
    <p>Chức năng cần đạt: {navigation.required.name} · {navigation.required.ready ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</p>
    <p>{navigation.phase === 'NAVIGATING' ? 'Đang điều hướng' : navigation.phase === 'BLOCKED' ? 'Cần hỗ trợ điều hướng' : 'Thực hiện mục tiêu chính'}</p>
    {navigation.lastAction && <p>{navigation.lastAction} · {navigation.verification}</p>}
    {state.activeOverlay && <p>Lớp phủ: {state.activeOverlay}</p>}
    <p className="text-slate-500">{navigation.actionCount} bước điều hướng · {(navigation.navigationMs / 1000).toFixed(1)} s · Nhận diện {navigation.recognitionMs} ms</p>
  </div>;
}
export function AgentGoalPanel({ text, onText, devices, serial, onSerial, onRefresh, selectedDeviceIds, runtime, inspectedExecutionId, controlsMode = 'all' }: Props) {
  const [error, setError] = useState<{ deviceId: string; message: string }>(), [submitting, setSubmitting] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number; evidenceId: string }>();
  const [now, setNow] = useState(0);
  const [version, setVersion] = useState<1 | 2>(1);
  const latestTasks = latestDeviceTasks(runtime.tasks), currentTask = latestTasks.get(serial);
  const task = runtime.tasks.find(task => task.executionId === inspectedExecutionId && task.deviceId === serial) ?? currentTask, latest = task?.latest;
  const device = devices.find(device => device.serial === serial), busy = currentTask && !currentTask.finishedAt;
  const ownerMode = runtime.ownerTestModes?.find(mode => mode.deviceId === serial && mode.physicalId === device?.physicalId && mode.expiresAt > now);
  const pendingAssistance = task?.status === 'WAITING_HUMAN' && latest?.assistance?.resumable && latest.visual?.status === 'HUMAN_REQUIRED' ? latest : undefined;
  const selected = selectedDeviceIds.filter(id => devices.some(d => d.serial === id && d.status === 'device' && (d.connectionType === 'USB' || d.identityVerified)));
  const batchBlocked = selected.some(id => { const current = latestTasks.get(id); return current && !current.finishedAt; });
  useEffect(() => {
    if (!pendingAssistance && !latest?.v2?.assistance && !runtime.ownerTestModes?.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [pendingAssistance, latest?.v2?.assistance, runtime.ownerTestModes?.length]);
  async function issue(operation: () => Promise<void>) {
    setSubmitting(true); setError(undefined);
    try { await operation(); } catch (failure) { setError({ deviceId: serial, message: failure instanceof Error ? failure.message : 'Không thể gửi lệnh.' }); }
    finally { setSubmitting(false); }
  }
  const start = (ids: string[]) => issue(async () => {
    await runtime.command({ type: 'START', requestId: crypto.randomUUID(), jobs: ids.map(deviceId => ({ deviceId, goal: text, ...(version === 2 ? { agentVersion: 2 as const,
      ...(runtime.ownerTestModes?.some(mode => mode.deviceId === deviceId && mode.physicalId === devices.find(d => d.serial === deviceId)?.physicalId && mode.expiresAt > Date.now()) ? { ownerAuthorizedTest: true as const } : {}) } : {}) })) });
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
  if (controlsMode === 'group') return <section className="flex flex-wrap gap-2 items-center text-xs" aria-label="Legacy group execution">
    <fieldset disabled={submitting || batchBlocked} aria-label="Engine chạy nhóm" className="flex flex-wrap items-center gap-3">
      <legend className="mb-2 text-slate-500">Engine chạy nhóm</legend>
      <label className="flex items-center gap-1.5"><input type="radio" name="group-agent-version" checked={version === 1} onChange={() => setVersion(1)} className="accent-indigo-600" />Agent V1</label>
      <label className="flex items-center gap-1.5"><input type="radio" name="group-agent-version" checked={version === 2} onChange={() => setVersion(2)} className="accent-indigo-600" />Agent V2</label>
    </fieldset>
    <button type="button" onClick={() => void start(selected)} disabled={submitting || selected.length < 2 || batchBlocked || !text.trim()} className="flex gap-2 items-center border rounded-md p-2 disabled:opacity-50"><Layers size={14} /> Chạy nhóm ({selected.length})</button>
    {error && <p role="alert">{error.message}</p>}
  </section>;
  return <section className="flex flex-col gap-3 min-w-0 w-full" aria-label="Goal Agent">
    {controlsMode !== 'results' && <>
    <fieldset disabled={Boolean(busy) || submitting} className="flex gap-3 text-xs" aria-label="Agent version">
      <label className="flex gap-1 items-center"><input type="radio" name="agent-version" checked={version === 1} onChange={() => setVersion(1)} />Agent V1</label>
      <label className="flex gap-1 items-center"><input type="radio" name="agent-version" checked={version === 2} onChange={() => setVersion(2)} />Agent V2</label>
    </fieldset>
    <label className="text-xs font-semibold text-slate-700" htmlFor="agent-goal">Mục tiêu</label>
    <textarea id="agent-goal" value={text} onChange={event => onText(event.target.value)} rows={3} className="resize-y rounded-md border border-slate-200 p-3 text-xs w-full" />
    <div className="flex gap-2 items-center">
      <select aria-label="Thiết bị Agent" value={serial} onChange={event => onSerial(event.target.value)} className="border border-slate-200 rounded-md p-2 text-xs min-w-0 flex-1">
        <option value="">Chọn điện thoại</option>{devices.map(device => <option key={device.serial} value={device.serial}>{device.model} · {device.serial} · {device.status}</option>)}
      </select>
      <button type="button" onClick={onRefresh} title="Làm mới thiết bị" aria-label="Làm mới thiết bị" className="p-2 border border-slate-200 rounded-md"><RefreshCw size={14} /></button>
    </div>
    {version === 2 && <OwnerTestModeControl mode={ownerMode}
      disabled={submitting || (!ownerMode && (Boolean(busy) || !device?.identityVerified || !device.physicalId || device.status !== 'device'))}
      onChange={enabled => { const physicalId = ownerMode?.physicalId ?? device?.physicalId; if (physicalId) void issue(() => runtime.command({ type: 'SET_OWNER_TEST_MODE', deviceId: serial, physicalId, enabled, ...(!enabled && ownerMode ? { authorizationId: ownerMode.id } : {}) })); }} />}
    {version === 2 && <label className="flex items-center gap-2 text-xs text-slate-700">
      <input type="checkbox" aria-label="Full-control test mode" checked={Boolean(ownerMode?.fullControl)}
        disabled={submitting || Boolean(busy) || !ownerMode}
        onChange={event => { const physicalId = ownerMode?.physicalId; if (physicalId) void issue(() => runtime.command({ type: 'SET_OWNER_TEST_MODE', deviceId: serial, physicalId, enabled: true, fullControl: event.target.checked, rollbackOnFailure: true })); }} />
      Full-control test
    </label>}
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void start([serial])} disabled={submitting || Boolean(busy) || !text.trim() || device?.status !== 'device' || device.connectionType === 'Wi-Fi' && !device.identityVerified}
        className="flex gap-2 items-center justify-center bg-indigo-600 text-white rounded-md px-3 py-2 text-xs flex-1 disabled:opacity-50"><Play size={14} /> Chạy Agent</button>
      <button type="button" onClick={() => void start(selected)} disabled={submitting || selected.length < 2 || batchBlocked || !text.trim()}
        className="flex gap-2 items-center justify-center border border-slate-200 rounded-md px-3 py-2 text-xs disabled:opacity-50"><Layers size={14} /> Chạy nhóm ({selected.length})</button>
      <button type="button" onClick={() => task && void issue(() => runtime.command({ type: 'CANCEL', executionId: task.executionId, deviceId: task.deviceId }))}
        disabled={!task || Boolean(task.finishedAt) || task.cancelRequested || submitting} className="flex gap-2 items-center justify-center border border-slate-200 rounded-md px-3 py-2 text-xs disabled:opacity-50"><Square size={14} /> Hủy</button>
    </div>
    </>}
    {latest?.v2?.mutations && <section className="text-xs min-w-0" aria-label="Mutation journal">
      <p className="font-semibold">{latest.v2.mutations.restored ? 'Restoration verified' : 'Manual restoration required'}</p>
      <ul className="space-y-1">{latest.v2.mutations.records.map(record => <li key={record.id} className="break-words">
        {record.state}: {record.before} → {record.desired} · {record.restoration}
      </li>)}</ul>
    </section>}
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
      {latest?.reasoningMeasurements?.slice(-3).map((m, index) => <p key={index} className="text-slate-500" aria-label="Reasoning provider">
        {m.provider ?? 'ollama'} · {m.model} · {m.status} · {m.elapsedMs} ms{m.fallbackReason ? ` · fallback: ${m.fallbackReason}` : ''}
      </p>)}
      {task.ownerTestMode && <p className="text-amber-800 break-all">Quyền của lượt chạy: OWNER_AUTHORIZED_TEST_MODE · {task.ownerTestMode.deviceId} · {task.ownerTestMode.id}</p>}
      {latest?.v2 && <div aria-label="V2 outcomes" className="border-l-2 border-emerald-500 pl-2 space-y-2">
        <p className="font-medium">V2 · {latest.v2.result ?? latest.v2.graph.coverage}{latest.v2.completion ? ` · ${latest.v2.completion}` : ''}</p>
        {latest.v2.analysis && <p className="text-slate-500">{latest.v2.analysis.syntax} · {latest.v2.analysis.semantics} · {latest.v2.analysis.execution} · {latest.v2.analysis.source}</p>}
        {latest.v2.temporal && <p className="break-words" aria-label="Temporal evidence tier">{latest.v2.temporal.tier ?? 'UNVERIFIED'} · {latest.v2.temporal.kind} · {latest.v2.temporal.zone} · LEFT-IN-PLACE{latest.v2.temporal.label ? ` · ${latest.v2.temporal.label}` : ''}</p>}
        {latest.v2.search && <p className="break-words">Search: {latest.v2.search.query} · {latest.v2.search.state ?? latest.v2.search.phase}{latest.v2.search.status ? ` · ${latest.v2.search.status}` : ''}</p>}
        {latest.v2.search?.diagnostic && <p className="text-amber-700 break-words">{latest.v2.search.diagnostic.dispatchState} · {latest.v2.search.diagnostic.code}: {latest.v2.search.diagnostic.cause}</p>}
        {latest.v2.search?.userAction && <div className="text-amber-700 space-y-1" aria-label="Search needs user action">
          <p>NEEDS_USER_ACTION: {latest.v2.search.userAction.reason}</p>
          <a className="underline" href={latest.v2.search.userAction.screenshotRef} target="_blank" rel="noreferrer">Xem màn hình thiết bị hiện tại</a>
          <p className="break-all text-xs">Snapshot: {latest.v2.search.userAction.snapshotId}</p>
        </div>}
        {latest.currentScreen && <p>{latest.currentScreen.screenType} · {latest.currentScreen.confidence}</p>}
        {latest.v2.availableAffordances && <p className="text-slate-500">{latest.v2.availableAffordances.join(' · ')}</p>}
        {latest.v2.discovery?.next && <p className="text-slate-500">{latest.v2.discovery.next.parentId}: {latest.v2.discovery.next.purpose} · {latest.v2.discovery.next.reason}</p>}
        {latest.v2.uiUnderstanding && <p className="text-slate-500">UI: {latest.v2.uiUnderstanding.state} · {latest.v2.uiUnderstanding.widgets} widgets · {latest.v2.uiUnderstanding.groups} groups · {latest.v2.uiUnderstanding.unknown} unknown</p>}
        <ol className="space-y-2">{latest.v2.graph.nodes.map(node => <li key={node.id}>
          <p>{node.outcome.span.text} · {node.status}</p>
          {latest.v2?.graph.primitiveBindings?.filter(b => b.nodeId === node.id).map(b => <p key={b.nodeId} className="text-slate-500">{b.primitive} · {b.state}{b.missing.length ? ` · ${b.missing.join(', ')}` : ''}</p>)}
          <p className="text-slate-500">{node.outcome.semanticIntent ?? node.capability} · {node.packageName ?? node.app ?? 'Chưa xác định ứng dụng'}</p>
          {node.dependencies.length > 0 && <p className="text-slate-500">Sau: {node.dependencies.join(', ')}</p>}
          {node.reason && <p className="text-amber-700">{node.reason}</p>}
          {node.evidenceIds.length > 0 && <p className="text-emerald-700 break-all">Evidence: {node.evidenceIds.join(', ')}</p>}
        </li>)}</ol>
        {latest.v2.coverage && <p>{latest.v2.coverage.eligible}/{latest.v2.coverage.observed} controls · {latest.v2.coverage.offered} candidates · Trang {latest.v2.coverage.page + 1}</p>}
        {latest.v2.interaction && <p className="text-slate-500 break-all">{latest.v2.interaction.action} · {latest.v2.interaction.candidateId} · Snapshot {latest.v2.interaction.snapshotId}</p>}
        {latest.v2.artifacts && <ul className="space-y-1" aria-label="Verified artifacts">{latest.v2.artifacts.map(artifact => <li key={artifact.id} className="break-all text-emerald-700">
          {artifact.kind} · {artifact.provider} · {artifact.mediaUri ?? artifact.recordIdentity ?? artifact.id}{artifact.size !== undefined ? ` · ${artifact.size} bytes` : ''}{artifact.recordFields ? ` · ${artifact.recordFields.join(', ')}` : ''}{artifact.persistenceStrategy ? ` · ${artifact.persistenceStrategy}` : ''}
        </li>)}</ul>}
        {latest.v2.artifactResolution && <p className="text-emerald-700">Đối chiếu: {latest.v2.artifactResolution}</p>}
        {latest.v2.assistance && task.status === 'WAITING_HUMAN' && <div className="space-y-2" aria-label="V2 assistance">
          <p>{latest.v2.assistance.reason}</p>
          <p>{latest.v2.assistance.category} · {latest.v2.assistance.sessionRetained ? 'Session đang giữ' : 'Chưa mở Session'} · {Math.max(0, Math.ceil((latest.v2.assistance.expiresAt - now) / 1000))} s</p>
          {latest.v2.assistance.choices.map(choice => <button key={choice.id} type="button" disabled={submitting || now >= latest.v2!.assistance!.expiresAt}
            className="flex items-center gap-2 border border-slate-200 rounded px-2 py-1 text-left break-all"
            onClick={() => void issue(() => runtime.command({ type: 'ASSIST_V2', executionId: task.executionId, deviceId: task.deviceId, token: latest.v2!.assistance!.token, approved: true, choice: choice.id }))}><Check size={14} className="shrink-0" />{choice.label}</button>)}
          <button type="button" disabled={submitting} className="flex items-center gap-2 text-rose-700" onClick={() => void issue(() => runtime.command({ type: 'ASSIST_V2', executionId: task.executionId, deviceId: task.deviceId, token: latest.v2!.assistance!.token, approved: false, choice: '' }))}><X size={14} />Không cho phép</button>
        </div>}
      </div>}
      <p className="text-slate-600">{latest?.subgoal}</p><p>{latest?.reason}</p>
      <p className="text-slate-500">{latest?.foregroundPackage} · {latest?.screen}</p>
        {latest && <NavigationProgressView event={latest} />}
      {latest?.failure && task.status !== 'COMPLETED' && <p className="text-amber-700">{latest.failure.code}: {latest.failure.message}</p>}
      {latest?.recovery && <RecoveryProgressView recovery={latest.recovery} />}
      {latest?.counters && <p className="text-slate-500">{latest.verifiedSubgoals}/{latest.totalSubgoals} mục tiêu con · {latest.counters.steps} bước · {latest.counters.snapshots} snapshot · {latest.counters.scrolls} cuộn · {latest.counters.reasoning} AI</p>}
      {latest?.timings && <p className="text-slate-500">{(latest.timings.totalMs / 1000).toFixed(1)} s · Quan sát {(latest.timings.observationMs / 1000).toFixed(1)} s · AI {(latest.timings.reasoningMs / 1000).toFixed(1)} s</p>}
      {latest?.profiling && <p className="text-slate-500">RPC {latest.profiling.rpcCount} · {(latest.profiling.rpcMs / 1000).toFixed(2)} s · ADB {latest.profiling.adbCount} · {(latest.profiling.adbMs / 1000).toFixed(2)} s · Parse {latest.profiling.parseCount} · {latest.profiling.parseMs.toFixed(1)} ms · Grounding {latest.profiling.groundingMs.toFixed(1)} ms</p>}
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
