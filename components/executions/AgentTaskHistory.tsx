'use client';
import { Square, Eye } from 'lucide-react';
import { useState } from 'react';
import type { AgentRuntimeControl } from '@/hooks/useAgentRuntimes';
import type { DeviceTask } from '@/lib/android/agent/runtime-schema';
export function AgentTaskHistory({ runtime, onInspect }: { runtime: AgentRuntimeControl; onInspect: (task: DeviceTask) => void }) {
  const [error, setError] = useState<string>();
  return <section className="border-t border-slate-200 pt-4 min-w-0" aria-label="Lịch sử Agent">
    <h3 className="text-sm font-semibold mb-3">Tác vụ Android</h3>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {!runtime.tasks.length ? <p className="text-xs text-slate-500">Chưa có tác vụ.</p> : <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-xs text-left"><thead><tr className="border-b border-slate-200 text-slate-500">
        <th className="p-2">Thiết bị</th><th className="p-2">Mục tiêu</th><th className="p-2">Trạng thái</th><th className="p-2">Xác minh</th><th className="p-2">Thao tác</th>
      </tr></thead><tbody>{[...runtime.tasks].reverse().map(task => <tr key={task.executionId} className="border-b border-slate-100 align-top">
        <td className="p-2 font-mono whitespace-nowrap">{task.deviceId}</td><td className="p-2 min-w-40 max-w-lg break-words">{task.request}</td>
        <td className="p-2">{task.status}</td><td className="p-2 max-w-sm break-words">{task.latest?.verifiedSubgoals ?? 0}/{task.latest?.totalSubgoals ?? 0} · {task.latest?.reason}</td>
        <td className="p-2"><div className="flex gap-2"><button type="button" title="Xem tác vụ" aria-label={`Xem Agent ${task.deviceId}`} onClick={() => onInspect(task)} className="p-1.5 border rounded"><Eye size={13} /></button>
          {!task.finishedAt && <button type="button" title="Hủy tác vụ" aria-label={`Hủy tác vụ ${task.deviceId}`} disabled={task.cancelRequested}
            onClick={() => { void runtime.command({ type: 'CANCEL', executionId: task.executionId, deviceId: task.deviceId }).catch(error => setError(error.message)); }} className="p-1.5 border rounded"><Square size={13} /></button>}
        </div></td>
      </tr>)}</tbody></table>
    </div>}
  </section>;
}
