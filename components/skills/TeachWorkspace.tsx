'use client';
import React, { useState } from 'react';
import { LiveTeachRecorder } from './LiveTeachRecorder';
import { TeachModePanel } from './TeachModePanel';
export function TeachWorkspace({onBusy}:{onBusy:(busy:boolean)=>void}) {
  const [mode,setMode]=useState<'LIVE'|'DECLARATION'>('LIVE'),[busy,setBusy]=useState(false),[replayBusy,setReplayBusy]=useState(false),[generation,setGeneration]=useState(0);
  const reportBusy=React.useCallback((value:boolean)=>{setBusy(value);onBusy(value||replayBusy);},[onBusy,replayBusy]);
  const reportReplayBusy=React.useCallback((value:boolean)=>{setReplayBusy(value);onBusy(value||busy);},[onBusy,busy]);
  return <div className="space-y-4">
    <nav aria-label="Chế độ dạy kỹ năng" className="flex flex-wrap gap-2">
      <button className="rounded border px-3 py-2 text-sm disabled:opacity-50" aria-pressed={mode==='LIVE'} disabled={busy||replayBusy} onClick={()=>setMode('LIVE')}>Ghi thao tác từ Android</button>
      <button className="rounded border px-3 py-2 text-sm disabled:opacity-50" aria-pressed={mode==='DECLARATION'} disabled={busy||replayBusy} onClick={()=>setMode('DECLARATION')}>Khai báo bằng form — chưa dispatch</button>
    </nav>
    {mode==='LIVE'?<><fieldset disabled={replayBusy}><LiveTeachRecorder onBusy={reportBusy} onSaved={()=>setGeneration(n=>n+1)}/></fieldset><TeachModePanel key={generation} libraryOnly onReplayBusy={reportReplayBusy} externalBusy={busy}/></>:<TeachModePanel onReplayBusy={reportReplayBusy}/>}
  </div>;
}
