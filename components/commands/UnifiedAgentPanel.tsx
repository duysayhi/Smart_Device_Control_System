'use client';
import { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw, Bot, Sparkles } from 'lucide-react';
import type { AndroidAdbDevice } from '@/types/device';
import type { AgentRuntimeControl } from '@/hooks/useAgentRuntimes';
import type { PlanView, ExecutionView, AnalysisView, ClarificationView } from '@/lib/android/unified-agent/contracts';
import { AgentGoalPanel, OwnerTestModeControl } from './AgentGoalPanel';

interface Props {
  text: string; onText(text: string): void; devices: AndroidAdbDevice[]; serial: string; onSerial(serial: string): void;
  onRefresh(): void; runtime: AgentRuntimeControl; selectedDeviceIds: string[]; inspectedExecutionId?: string;
}
export function UnifiedAgentPanel(props: Props) {
  const { text, serial, devices, runtime, onText, onSerial, onRefresh } = props;
  const [plan, setPlan] = useState<PlanView>();
  const [entries, setEntries] = useState<ExecutionView[]>([]), [selected, setSelected] = useState<string>();
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [clock, setClock] = useState(0);
  const [clarification, setClarification] = useState<ClarificationView>(), [period, setPeriod] = useState<'am' | 'pm' | ''>('');
  const generation = useRef(0), mounted = useRef(true);
  const executePending = useRef(false);
  const current = entries.find(e => e.id === selected), busy = current && !current.finishedAt;
  const device = devices.find(d => d.serial === serial), workerBusy = runtime.tasks.some(t => !t.finishedAt && (t.deviceId === serial || t.physicalId === device?.physicalId));
  const activeWorker = runtime.tasks.find(t => !t.finishedAt && (t.deviceId === serial || Boolean(device?.physicalId) && t.physicalId === device?.physicalId));
  const nativeTaskId = props.inspectedExecutionId ?? current?.workerExecutionId ?? activeWorker?.executionId;
  const mode = runtime.ownerTestModes?.find(m => m.deviceId === serial && m.physicalId === device?.physicalId && m.expiresAt > clock);
  const deviceAvailable = device?.status === 'device' && device.identityVerified === true && Boolean(device.physicalId);
  const deviceProblem = plan && (plan.deviceId !== serial ? 'CHANGED' : !deviceAvailable ? 'LOST' : plan.physicalId !== device?.physicalId ? 'CHANGED' : undefined);
  const [planBinding, setPlanBinding] = useState<{ reference?: string; problem?: 'LOST' | 'CHANGED' }>({});
  // Remember an observed disconnect until a new plan reference is issued, including after recovery.
  if (planBinding.reference !== plan?.reference) setPlanBinding({ reference: plan?.reference, problem: deviceProblem || undefined });
  else if (deviceProblem && !planBinding.problem) setPlanBinding({ reference: plan?.reference, problem: deviceProblem });
  const planDeviceProblem = deviceProblem || (planBinding.reference === plan?.reference ? planBinding.problem : undefined);
  const planValid = plan && !planDeviceProblem && deviceAvailable && plan.source === text.trim() && plan.deviceId === serial && plan.expiresAt > clock;
  const canReanalyze = deviceAvailable && plan?.deviceId === serial && plan?.physicalId === device?.physicalId;
  const planMessage = planDeviceProblem === 'LOST' ? 'Thiết bị đã mất kết nối; chọn lại thiết bị và phân tích lại'
    : planDeviceProblem === 'CHANGED' ? 'Kế hoạch không còn hợp lệ do đổi thiết bị; phân tích lại'
    : plan && plan.source !== text.trim() ? 'Câu lệnh đã thay đổi; phân tích lại'
    : planValid ? 'Sẵn sàng thực thi' : 'Kế hoạch hết hạn; phân tích lại';
  const clarificationValid = deviceAvailable && clarification && clarification.source === text.trim() && clarification.deviceId === serial && clarification.expiresAt > clock;
  useEffect(() => { generation.current++; }, [serial, device?.status, device?.physicalId, device?.identityVerified]);
  async function api(body?: unknown) {
    const response = await fetch('/api/unified-agent', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const value = await response.json(); if (!response.ok) throw Error(value.error ?? 'Backend unavailable.'); return value;
  }
  useEffect(() => {
    mounted.current = true;
    const poll = async () => {
      try { const result = await fetch('/api/unified-agent', { cache: 'no-store' }); if (!result.ok) return; const data = await result.json(); if (mounted.current) setEntries(data.executions); } catch { /* Keep the last evidence; never infer completion from a failed poll. */ }
    };
    void poll(); const timer = setInterval(() => { setClock(Date.now()); void poll(); }, 1500);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  function invalidate() { generation.current++; setPlan(undefined); setClarification(undefined); setPeriod(''); setError(''); }
  async function operation(work: () => Promise<void>) {
    setPending(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); }
    finally { setClock(Date.now()); setPending(false); }
  }
  function showAnalysis(data: AnalysisView) {
    setClock(Date.now()); setPlan(data.plan); setClarification(data.clarification); setPeriod('');
    if (data.plan?.clarifiedFrom) onText(data.plan.source);
  }
  async function analyze() {
    if (!deviceAvailable) return;
    const epoch = ++generation.current; setPlan(undefined); setClarification(undefined); setPeriod(''); setSelected(undefined);
    await operation(async () => {
      const data = await api({ type: 'ANALYZE', input: { source: text, deviceId: serial } });
      if (mounted.current && epoch === generation.current) showAnalysis(data);
    });
  }
  async function clarify() {
    if (!clarificationValid || !clarification || !period) return;
    const epoch = generation.current, reference = clarification.reference, choice = period;
    await operation(async () => {
      const data = await api({ type: 'CLARIFY', reference, choice });
      if (mounted.current && epoch === generation.current) showAnalysis(data);
    });
  }
  async function reanalyze() {
    if (!plan || !canReanalyze) return;
    const epoch = ++generation.current, reference = plan.reference;
    setPlan(undefined); setSelected(undefined);
    await operation(async () => {
      const data = await api({ type: 'REANALYZE', reference });
      if (mounted.current && epoch === generation.current) showAnalysis(data);
    });
  }
  async function execute() {
    if (executePending.current || pending || workerBusy || busy || !planValid || !plan) return;
    const reference = plan.reference;
    executePending.current = true;
    try {
      await operation(async () => {
        const clientRequestId = crypto.randomUUID();
        const data = await api({ type: 'EXECUTE', reference, clientRequestId });
        setPlan(undefined);
        setSelected(data.execution.id); setEntries(old => [...old.filter(e => e.id !== data.execution.id), data.execution]);
      });
    } finally { executePending.current = false; }
  }
  function changeMode(enabled: boolean, fullControl?: boolean) {
    const physicalId = mode?.physicalId ?? device?.physicalId; if (!physicalId) return;
    invalidate(); void operation(() => runtime.command({ type: 'SET_OWNER_TEST_MODE', deviceId: serial, physicalId, enabled,
      ...(!enabled && mode ? { authorizationId: mode.id } : {}), ...(fullControl !== undefined ? { fullControl, rollbackOnFailure: true } : {}) }));
  }
  const assistanceRuntime: AgentRuntimeControl = { ...runtime, command: async command => {
    if (current?.workerExecutionId && (command.type === 'ASSIST' || command.type === 'ASSIST_V2') && command.executionId === current.workerExecutionId) {
      const reply = command.type === 'ASSIST_V2' ? { kind: 'V2', token: command.token, approved: command.approved, choice: command.choice }
        : { kind: 'V1', token: command.token, evidenceId: command.evidenceId, x: command.x, y: command.y, confirmed: command.confirmed };
      await api({ type: 'ASSIST', executionId: current.id, reply });
    } else await runtime.command(command);
  } };
  return <section aria-label="Unified Agent" className="min-w-0 space-y-3 text-xs">
    <div id="unified-command-surface" className="min-w-0 space-y-3">
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600"><Sparkles size={15} /></span>
      <h3 className="font-semibold text-sm text-slate-900">Điều khiển bằng câu lệnh</h3>
    </div>
    <label htmlFor="unified-command" className="sr-only">Câu lệnh</label>
    <textarea id="unified-command" rows={3} value={text} onChange={e => { invalidate(); onText(e.target.value); }} disabled={pending}
      className="w-full min-w-0 resize-y border border-slate-200 bg-slate-50 rounded-lg p-3 text-xs leading-relaxed focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="min-w-0 flex-1">
      <label htmlFor="unified-device" className="mb-1 block text-[10px] font-semibold text-slate-400">THIẾT BỊ ANDROID QUA ADB</label>
      <select id="unified-device" aria-label="Thiết bị Unified Agent" value={serial} onChange={e => { invalidate(); onSerial(e.target.value); }} disabled={pending} className="w-full min-w-0 border border-slate-200 bg-white rounded-md px-2 py-1.5 text-xs">
        <option value="">Chọn điện thoại</option>{serial && !device && <option value={serial}>{serial} - OFFLINE</option>}{devices.map(d => <option key={d.serial} value={d.serial}>{d.model} - {d.serial} - {d.status === 'offline' ? 'OFFLINE' : d.status}</option>)}
      </select>
      </div>
      <button type="button" title="Làm mới thiết bị" aria-label="Làm mới thiết bị" onClick={onRefresh} className="shrink-0 rounded-md p-2 text-slate-500 hover:bg-white hover:text-indigo-600"><RefreshCw size={15} /></button>
    </div>
    <OwnerTestModeControl mode={mode} disabled={pending || !mode && (workerBusy || Boolean(busy) || !device?.identityVerified)} onChange={enabled => changeMode(enabled)} />
    <label className="flex items-center gap-2"><input type="checkbox" aria-label="Full-control test mode" checked={Boolean(mode?.fullControl)} disabled={pending || workerBusy || Boolean(busy) || !mode} onChange={e => changeMode(true, e.target.checked)} />Full-control test</label>
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => void analyze()} disabled={pending || workerBusy || Boolean(busy) || !text.trim() || !deviceAvailable} className="flex justify-center items-center gap-1 border border-slate-300 rounded-md py-2 disabled:opacity-50"><Bot size={14} className="text-indigo-600" />Phân tích</button>
      <button type="button" onClick={() => void execute()} disabled={pending || workerBusy || Boolean(busy) || !planValid} className="flex justify-center items-center gap-1 bg-indigo-600 text-white rounded-md py-2 disabled:opacity-50"><Play size={14} />Thực thi</button>
      <button type="button" onClick={() => void operation(async () => {
        if (busy && current) await api({ type: 'CANCEL', executionId: current.id });
        else if (activeWorker) await runtime.command({ type: 'CANCEL', executionId: activeWorker.executionId, deviceId: activeWorker.deviceId });
      })} disabled={pending || !busy && !activeWorker || Boolean(busy ? current?.cancelRequested : activeWorker?.cancelRequested)} className="flex justify-center items-center gap-1 border rounded-md py-2 disabled:opacity-50"><Square size={14} />Dừng</button>
    </div>
    {pending && <p role="status">Đang xử lý...</p>}
    {error && <p role="alert" className="text-rose-700 break-words">{error}</p>}
    {clarification && <fieldset aria-label="Làm rõ thời gian báo thức" className="border-y py-3 space-y-2">
      <legend className="font-semibold">{clarification.question}</legend>
      {clarification.catalog.map(row => <p key={row.capability}>{row.status}: {row.label}</p>)}
      {clarification.choices.map(choice => <label key={choice.id} className="flex items-center gap-2">
        <input type="radio" name="alarm-period" value={choice.id} checked={period === choice.id} disabled={pending || !clarificationValid} onChange={() => setPeriod(choice.id)} />{choice.label}
      </label>)}
      {clarificationValid ? <button type="button" disabled={pending || !period} onClick={() => void clarify()} className="border rounded-md p-2 disabled:opacity-50">Xác nhận thời gian</button>
        : <button type="button" disabled={pending || !deviceAvailable} onClick={() => void analyze()} className="border rounded-md p-2">Phân tích lại câu lệnh</button>}
    </fieldset>}
    {plan && <section aria-label="Kế hoạch thực hiện" className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-slate-100 break-words">
      <h4 className="border-b border-slate-800 px-3 py-2 font-semibold">Kế hoạch thực hiện</h4>
      <div className="max-h-60 overflow-y-auto space-y-2 bg-slate-900 p-3"><p>{plan.summary}</p>
      <ul aria-label="Danh mục khả năng" className="space-y-1">{plan.catalog.map(row => <li key={row.capability} className={row.status === 'EXPERIMENTAL' ? 'text-amber-300' : 'text-emerald-300'}>{row.status}: {row.label}</li>)}</ul>
      {plan.clarifiedFrom && <p className="text-slate-400">Câu lệnh ban đầu: {plan.clarifiedFrom}</p>}
      <ol className="list-decimal pl-5 space-y-1">{plan.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      {plan.confirmations.map((line, i) => <p key={i} className="text-amber-300">{line}</p>)}
      <p className="text-indigo-300">{planMessage}</p>
      {!planValid && <button type="button" disabled={pending || workerBusy || Boolean(busy) || !canReanalyze} onClick={() => void reanalyze()} className="flex items-center gap-1 border rounded-md p-2"><RefreshCw size={14} />Phân tích lại kế hoạch</button>}
      {plan.analysisMetrics && <p className="text-slate-400">Phân tích: {plan.analysisMetrics.timings.totalMs} ms · {plan.analysisMetrics.counters.reasoning} model calls · ADB {plan.analysisMetrics.profiling.adbCount}</p>}
      </div>
    </section>}
    {current && <section aria-label="Unified execution progress" aria-live="polite" className="border-y py-3 space-y-2 break-words">
      <h4 className="font-semibold">{current.plan.engine} - {current.status}</h4><p>{current.plan.source}</p>
      {current.cancelRequested && !current.finishedAt && <p>Đã yêu cầu dừng; đang chờ engine kết thúc và đóng Session.</p>}
      {current.reason && <p>{current.reason}</p>}
      {current.steps?.map(step => <div key={step.index} className="grid grid-cols-[1fr_auto] gap-2 border-b py-1">
        <span>{step.index + 1}. {step.action.type}</span><span>{step.phase ?? step.status} - {step.verification ?? ''}</span>
        <p className="col-span-2">{step.postcondition ?? step.error ?? step.waitingFor}</p>
        {step.evidence && <details className="col-span-2"><summary>Bằng chứng</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(step.evidence, null, 2)}</pre></details>}
      </div>)}
    </section>}
    {nativeTaskId && <AgentGoalPanel text={text} onText={onText} devices={devices} serial={current?.plan.deviceId ?? serial} onSerial={onSerial} onRefresh={onRefresh} runtime={assistanceRuntime} selectedDeviceIds={props.selectedDeviceIds} controlsMode="results" inspectedExecutionId={nativeTaskId} />}
    {entries.length > 0 && <details><summary>Lịch sử Unified Agent ({entries.length})</summary><ul className="max-h-48 overflow-y-auto divide-y">{[...entries].reverse().map(e => <li key={e.id}><button type="button" className="text-left w-full py-2 break-words" onClick={() => setSelected(e.id)}>{e.plan.source} - {e.status} - {e.plan.engine}</button></li>)}</ul></details>}
    </div>
  </section>;
}
