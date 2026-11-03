'use client';
import { SkillReplayConsole } from './SkillReplayConsole';
import { SkillReplayPreview } from './SkillReplayPreview';
import { readReplayHandle, replayReference } from '@/lib/skills/replay-console-state';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SKILL_OPERATIONS, SKILL_VERIFIERS } from '@/lib/skills/skill-schema';
import type { TargetDescriptor } from '@/lib/skills/skill-schema';
import type { DeclaredAction, OfflineTeachDashboard } from '@/lib/skills/teach-dashboard';

type Session = ReturnType<OfflineTeachDashboard['create']>;
type Review = ReturnType<OfflineTeachDashboard['compile']>;
type Library = Awaited<ReturnType<OfflineTeachDashboard['listSkills']>>;
type Version = Awaited<ReturnType<OfflineTeachDashboard['versionView']>>;
type Fixtures = ReturnType<OfflineTeachDashboard['fixtures']>;
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json(); if (!response.ok) throw Object.assign(Error(value.error ?? 'Không thể xử lý phiên dạy.'), { code: value.code }); return value as T;
}
const roles: TargetDescriptor['semanticRole'][] = ['navigation', 'search_action', 'search_field', 'search_results', 'scroll_container', 'dialog', 'status'];
const containers: TargetDescriptor['containerRole'][] = ['app', 'toolbar', 'navigation', 'search', 'results', 'dialog'];
const fieldClass = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm min-w-0';
const buttonClass = 'rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';

export function TeachModePanel({libraryOnly=false,onReplayBusy,externalBusy=false}:{libraryOnly?:boolean;onReplayBusy?:(busy:boolean)=>void;externalBusy?:boolean}={}) {
  const [fixtures, setFixtures] = useState<Fixtures>();
  const [deviceId, setDeviceId] = useState('');
  const [command, setCommand] = useState('');
  const [name, setName] = useState('');
  const [appAlias, setAppAlias] = useState('youtube');
  const [session, setSession] = useState<Session>();
  const [operation, setOperation] = useState<DeclaredAction['operation']>('OPEN_APPLICATION');
  const [label, setLabel] = useState('Search');
  const [role, setRole] = useState<TargetDescriptor['semanticRole']>('search_action');
  const [container, setContainer] = useState<TargetDescriptor['containerRole']>('toolbar');
  const [purpose, setPurpose] = useState<'NAVIGATION' | 'SEARCH'>('SEARCH');
  const [value, setValue] = useState('');
  const [direction, setDirection] = useState<'UP' | 'DOWN' | 'LEFT' | 'RIGHT'>('DOWN');
  const [attempts, setAttempts] = useState(1);
  const [reason, setReason] = useState<'DISMISS_BENIGN' | 'SEARCH_RECOVERY'>('SEARCH_RECOVERY');
  const [predicate, setPredicate] = useState<(typeof SKILL_VERIFIERS)[number]>('FOREGROUND_IS');
  const [scope, setScope] = useState('s2');
  const [review, setReview] = useState<Review>();
  const [description, setDescription] = useState('');
  const [parameterNames, setParameterNames] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [library, setLibrary] = useState<Library>({ storageMode: 'OFFLINE_TEST_STORAGE', skills: [] });
  const [selected, setSelected] = useState<Version>();
  const [versionChoice,setVersionChoice]=useState(1),[replayBusy,setReplayBusy]=useState(false);
  const reportReplayBusy=useCallback((value:boolean)=>{setReplayBusy(value);onReplayBusy?.(value);},[onReplayBusy]);
  const [saved, setSaved] = useState(false);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const inFlight = useRef(true), mounted = useRef(false);
  const perform = useCallback(async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError('');
    try { await work(); } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Không thể xử lý phiên dạy offline.'); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; let active = true;
    void Promise.all([api<Fixtures>('/api/teach-sessions'), api<Library>('/api/skills')]).then(async ([data, skills]) => {
      if (active) { setFixtures(data); setDeviceId(data.devices[0]?.id ?? ''); setLibrary(skills); }
      if(active&&libraryOnly&&typeof sessionStorage!=='undefined'){
        const saved=readReplayHandle(sessionStorage);if(saved){const reference=replayReference(saved),version=await api<Version>(`/api/skills/${reference.skillId}/versions/${reference.version}`);
          if(active){setSelected(version);setVersionChoice(reference.version);}
        }
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Không thể đọc storage offline.'); })
      .finally(() => { if (active) { inFlight.current = false; setPending(false); } });
    return () => { active = false; mounted.current = false; };
  }, [libraryOnly]);
  const sessionUrl = session ? '/api/teach-sessions/' + session.id : '';
  const recording = session?.status === 'RECORDING';
  const storageMode = fixtures?.storageMode ?? library.storageMode;
  const needsTarget = ['ACTIVATE_CONTROL', 'INPUT_TEXT', 'SCROLL_CONTAINER', 'OBSERVE_UI', 'ASSERT_UI'].includes(operation);
  const target = { semanticRole: operation === 'INPUT_TEXT' ? 'search_field' : operation === 'SCROLL_CONTAINER' ? 'scroll_container' : role,
    label, containerRole: operation === 'INPUT_TEXT' ? 'search' : operation === 'SCROLL_CONTAINER' ? 'results' : container } satisfies TargetDescriptor;
  function buildAction(): DeclaredAction {
    switch (operation) {
      case 'OPEN_APPLICATION': return { operation, appRef: appAlias };
      case 'ACTIVATE_CONTROL': return { operation, target, purpose };
      case 'INPUT_TEXT': return { operation, target, value };
      case 'SUBMIT_SEARCH': return { operation };
      case 'SCROLL_CONTAINER': return { operation, target, direction, maxAttempts: attempts };
      case 'BACK': return { operation, reason };
      case 'OBSERVE_UI': case 'ASSERT_UI': {
        const assertion = predicate === 'FOREGROUND_IS' ? { kind: predicate, appRef: appAlias } :
          predicate === 'ELEMENT_VISIBLE' || predicate === 'CONTROL_ENABLED' ? { kind: predicate, target } :
            predicate === 'TEXT_EQUALS' ? { kind: predicate, value } :
              predicate === 'WIDGET_STATE' ? { kind: predicate, target, property: 'value', expected: value } :
                predicate === 'SEARCH_OUTCOME_MATCHES' ? { kind: predicate, scope, value: { param: 'query' } } :
                  predicate === 'KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED' ? { kind: predicate, scope } : { kind: 'STATE_CHANGED' };
        return { operation, predicate: assertion };
      }
    }
  }
  return <section aria-label="Dạy kỹ năng offline" className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
    {!libraryOnly&&<>
    <h1 className="text-lg font-semibold">Dạy kỹ năng</h1>
    <p className="text-sm font-medium text-amber-800">{storageMode === 'POSTGRESQL_STORAGE' ? 'POSTGRESQL STORAGE' : storageMode === 'PGLITE_TEST_STORAGE' ? 'PGLITE TEST STORAGE' : 'OFFLINE TEST STORAGE'} — Chưa thực thi trên điện thoại.</p>
    <p className="text-xs text-slate-600">{storageMode === 'OFFLINE_TEST_STORAGE' ? 'Các bước hiện tại được khai báo bằng form. Dữ liệu chỉ ở bộ nhớ tiến trình, mất khi server khởi động lại.' : storageMode === 'PGLITE_TEST_STORAGE' ? 'DRAFT lưu qua PostgreSQL repository trên PGlite thử nghiệm trong bộ nhớ. Phiên khai báo và review vẫn memory-only.' : 'DRAFT và Skill Library lưu trong PostgreSQL. Phiên khai báo và review vẫn ở bộ nhớ tiến trình, mất khi server khởi động lại.'} Không có Recorder, Replay hoặc Publish. Video thứ N/playback chưa được hỗ trợ.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void perform(async () => {
      const payload = { deviceId, command, name, appAlias }; setCommand('');
      const created = await api<Session>('/api/teach-sessions', payload);
      setSession(created); setReview(undefined); setSelected(undefined); setConfirmed(false); setSaved(false); setSaveUncertain(false); setValue(''); setDescription('');
    }); }}>
      <label className="flex flex-col gap-1 text-sm">Thiết bị mẫu offline<select aria-label="Thiết bị mẫu offline" className={fieldClass} value={deviceId} disabled={pending || Boolean(session && !saved)} onChange={e => setDeviceId(e.target.value)}>
        {fixtures?.devices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select></label>
      <label className="flex flex-col gap-1 text-sm">Tên kỹ năng<input aria-label="Tên kỹ năng" className={fieldClass} value={name} maxLength={120} required disabled={pending || Boolean(session && !saved)} onChange={e => setName(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm">App alias<input aria-label="App alias" className={fieldClass} value={appAlias} required disabled={pending || Boolean(session && !saved)} onChange={e => setAppAlias(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm">Câu lệnh mẫu<input aria-label="Câu lệnh mẫu" className={fieldClass} value={command} maxLength={500} required disabled={pending || Boolean(session && !saved)} onChange={e => setCommand(e.target.value)} /></label>
      <button type="submit" className={buttonClass} disabled={pending || !deviceId || !command.trim() || !name.trim() || Boolean(session && !saved)}>Tạo phiên dạy</button>
    </form>
    {session && <>
      <p className="text-sm" aria-live="polite">Phiên: {session.status} — NOT_DISPATCHED</p>
      {session.status === 'CREATED' && <button className={buttonClass} disabled={pending} onClick={() => void perform(async () => setSession(await api<Session>(sessionUrl + '/start', { revision: session.revision })))}>Bắt đầu khai báo</button>}
      {recording && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void perform(async () => {
        const payload = { revision: session.revision, action: buildAction() }; setValue('');
        const updated = await api<Session>(sessionUrl + '/actions', payload);
        setSession(updated);
      }); }}>
        <p className="text-sm font-medium">ĐANG KHAI BÁO — không gửi thao tác đến Android</p>
        <fieldset disabled={pending} className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Operation<select aria-label="Operation" className={fieldClass} value={operation} onChange={e => setOperation(e.target.value as DeclaredAction['operation'])}>{SKILL_OPERATIONS.map(op => <option key={op}>{op}</option>)}</select></label>
          {operation === 'ACTIVATE_CONTROL' && <label className="flex flex-col gap-1 text-sm">Mục đích<select aria-label="Mục đích" className={fieldClass} value={purpose} onChange={e => setPurpose(e.target.value as typeof purpose)}><option>SEARCH</option><option>NAVIGATION</option></select></label>}
          {needsTarget && <>
            <label className="flex flex-col gap-1 text-sm">Nhãn target<input aria-label="Nhãn target" className={fieldClass} value={label} required maxLength={120} onChange={e => setLabel(e.target.value)} /></label>
            {operation !== 'INPUT_TEXT' && operation !== 'SCROLL_CONTAINER' && <>
              <label className="flex flex-col gap-1 text-sm">Vai trò target<select aria-label="Vai trò target" className={fieldClass} value={role} onChange={e => setRole(e.target.value as typeof role)}>{roles.map(r => <option key={r}>{r}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-sm">Container<select aria-label="Container" className={fieldClass} value={container} onChange={e => setContainer(e.target.value as typeof container)}>{containers.map(r => <option key={r}>{r}</option>)}</select></label>
            </>}
          </>}
          {(operation === 'INPUT_TEXT' || ['OBSERVE_UI', 'ASSERT_UI'].includes(operation)) && <label className="flex flex-col gap-1 text-sm">Giá trị mẫu<input aria-label="Giá trị mẫu" className={fieldClass} value={value} maxLength={500} autoComplete="off" onChange={e => setValue(e.target.value)} /></label>}
          {['OBSERVE_UI', 'ASSERT_UI'].includes(operation) && <>
            <label className="flex flex-col gap-1 text-sm">Predicate<select aria-label="Predicate" className={fieldClass} value={predicate} onChange={e => setPredicate(e.target.value as typeof predicate)}>{SKILL_VERIFIERS.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">Search scope<input aria-label="Search scope" className={fieldClass} value={scope} onChange={e => setScope(e.target.value)} /></label>
          </>}
          {operation === 'SCROLL_CONTAINER' && <>
            <label className="flex flex-col gap-1 text-sm">Hướng<select aria-label="Hướng" className={fieldClass} value={direction} onChange={e => setDirection(e.target.value as typeof direction)}>{['UP', 'DOWN', 'LEFT', 'RIGHT'].map(d => <option key={d}>{d}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">Số lần tối đa<input aria-label="Số lần tối đa" className={fieldClass} type="number" min={1} max={5} value={attempts} onChange={e => setAttempts(Number(e.target.value))} /></label>
          </>}
          {operation === 'BACK' && <label className="flex flex-col gap-1 text-sm">Lý do Back<select aria-label="Lý do Back" className={fieldClass} value={reason} onChange={e => setReason(e.target.value as typeof reason)}><option>SEARCH_RECOVERY</option><option>DISMISS_BENIGN</option></select></label>}
          <button type="submit" className={buttonClass} disabled={pending || session.actions.length >= 20}>Thêm bước khai báo</button>
        </fieldset>
        <button type="button" className={buttonClass} disabled={pending || !session.actions.length} onClick={() => void perform(async () => setSession(await api<Session>(sessionUrl + '/finish', { revision: session.revision })))}>Kết thúc khai báo</button>
      </form>}
      <ol aria-label="Timeline khai báo" className="divide-y text-sm">{session.actions.map(a => <li key={a.id} className="py-2">
        {a.order}. {a.operation} {a.target ? `— ${a.target.semanticRole}: ${a.target.label ?? ''}` : ''} — {a.declarationStatus} / {a.dispatchStatus}
        {a.input && <span> — Nội dung mẫu đã ẩn; sẽ tham số hóa khi compile.</span>}
      </li>)}</ol>
      {['REVIEWING', 'COMPILED'].includes(session.status) && <button className={buttonClass} disabled={pending} onClick={() => void perform(async () => {
        const result = await api<Review>(sessionUrl + '/compile', { revision: session.revision });
        setSession(result.session); setReview(result); setConfirmed(false);
        setParameterNames(Object.fromEntries(Object.keys(result.compilation.draft?.parameters ?? {}).map(key => [key, key])));
      })}>Compile</button>}
    </>}
    {review && <section aria-label="Review kỹ năng" className="rounded border border-indigo-200 p-3 space-y-2">
      <h2 className="font-semibold">Review — {review.compilation.status}</h2>
      {review.compilation.review.map(r => <p key={r.path} className="text-sm text-amber-800">AMBIGUOUS: {r.message} Cần khai báo đầy đủ trước khi lưu.</p>)}
      {review.compilation.status === 'AMBIGUOUS' && <button className={buttonClass} disabled={pending} onClick={() => {
        setSession(undefined); setReview(undefined); setConfirmed(false); setValue(''); setError('');
      }}>Khai báo lại bằng phiên mới</button>}
      {review.compilation.draft && <>
        <label className="flex flex-col text-sm">Tên DRAFT<input aria-label="Tên DRAFT" className={fieldClass} value={name} disabled={pending || saved} onChange={e => setName(e.target.value)} /></label>
        <label className="flex flex-col text-sm">Mô tả<input aria-label="Mô tả" className={fieldClass} value={description} disabled={pending || saved} maxLength={500} onChange={e => setDescription(e.target.value)} /></label>
        <p className="text-sm">App scope: {review.compilation.draft.appScope.alias}</p>
        {Object.keys(review.compilation.draft.parameters).map(key => <label key={key} className="flex flex-col text-sm">Tham số {key}<input aria-label={'Tham số ' + key} className={fieldClass} value={parameterNames[key] ?? key} disabled={pending || saved} onChange={e => setParameterNames(p => ({ ...p, [key]: e.target.value }))} /></label>)}
        <ol className="text-sm">{review.compilation.draft.steps.map(s => <li key={s.id}>{s.id}: {s.operation} — {s.verify.kind}</li>)}</ol>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Xác nhận bản nháp" checked={confirmed} disabled={pending || saved} onChange={e => setConfirmed(e.target.checked)} />Tôi xác nhận tên, app scope, bước semantic và tham số; chưa xác minh trên Android.</label>
        <button className={buttonClass} disabled={pending || !confirmed || !review.reference || saved || saveUncertain} onClick={() => void perform(async () => {
          let received = false;
          try {
            const result = await api<Version>(sessionUrl + '/save-draft', { reference: review.reference, confirmed: true, name, ...(description.trim() ? { description } : {}), parameterNames });
            received = true; setSelected(result); setSaved(true); setLibrary(await api<Library>('/api/skills'));
          } catch (cause) {
            const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
            if (!received && (!code || ['SAVE_OUTCOME_UNKNOWN', 'DATABASE_ERROR', 'NOT_FOUND'].includes(String(code)))) {
              setSaveUncertain(true); throw Error('Kết quả lưu chưa xác định. Kiểm tra Skill Library trước khi thử thao tác mới.');
            }
            throw cause;
          }
        })}>{saved ? 'Đã lưu DRAFT' : 'Lưu DRAFT'}</button>
        {saveUncertain && <p role="status" className="text-sm text-amber-800">Chưa xác định kết quả lưu; không tự thử lại. Hãy làm mới Skill Library để kiểm tra.</p>}
      </>}
    </section>}
    </>}
    {libraryOnly&&error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <section aria-label="Skill Library" className="space-y-2">
      <h2 className="font-semibold">Skill Library — DRAFT</h2>
      <button className={buttonClass} disabled={pending} onClick={() => void perform(async () => setLibrary(await api<Library>('/api/skills')))}>Làm mới thư viện</button>
      <ul className="divide-y text-sm">{library.skills.map(skill => <li key={skill.id} className="py-2 flex flex-wrap gap-2 items-center">
        <span>{skill.name} — {skill.appScope.alias} — v{skill.version} — {skill.status} — {skill.createdAt}</span>
        <button className={buttonClass} disabled={pending||replayBusy||externalBusy} onClick={() => void perform(async () => {setSelected(await api<Version>(`/api/skills/${skill.id}/versions/${skill.version}`));setVersionChoice(skill.version);})}>Xem chi tiết</button>
      </li>)}</ul>
      {!library.skills.length && <p className="text-sm text-slate-500">{storageMode === 'OFFLINE_TEST_STORAGE' ? 'Chưa có DRAFT trong bộ nhớ tiến trình này.' : 'Chưa có DRAFT trong storage đang chọn.'}</p>}
      {selected && <div aria-label="Chi tiết DRAFT" className="rounded border p-3 text-sm">
        <p>{selected.definition.name} — {selected.status} v{selected.version} — {selected.storageMode}</p>
        <p>Tham số: {Object.keys(selected.definition.parameters).join(', ') || 'Không có'}</p>
        <ol>{selected.definition.steps.map(s => <li key={s.id}>{s.operation} — {s.verify.kind}</li>)}</ol>
        {libraryOnly?<><label className="mr-2">Phiên bản kỹ năng <input aria-label="Phiên bản kỹ năng replay" type="number" min={1} max={1000} value={versionChoice} disabled={pending||replayBusy||externalBusy} className={fieldClass} onChange={e=>setVersionChoice(Number(e.target.value))}/></label>
        <button className={buttonClass} disabled={pending||replayBusy||externalBusy||!Number.isInteger(versionChoice)||versionChoice<1||versionChoice>1000} onClick={()=>void perform(async()=>setSelected(await api<Version>(`/api/skills/${selected.skillId}/versions/${versionChoice}`)))}>Đọc phiên bản</button>
        <SkillReplayConsole key={selected.skillId+':'+selected.version} skillId={selected.skillId} version={selected.version} definition={selected.definition} onBusy={reportReplayBusy} externalBusy={externalBusy||pending||versionChoice!==selected.version}/></>:
        <SkillReplayPreview key={selected.skillId+':'+selected.version} skillId={selected.skillId} version={selected.version} definition={selected.definition}/>}
      </div>}
    </section>
  </section>;
}
