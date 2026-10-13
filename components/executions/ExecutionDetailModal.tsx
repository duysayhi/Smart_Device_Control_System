'use client';

import React from 'react';
import { 
  X, 
  Terminal, 
  CheckCircle2, 
  AlertCircle, 
  PlayCircle, 
  Clock, 
  Layers, 
  Smartphone,
  RotateCw
} from 'lucide-react';
import { TaskQueueItem } from '@/types/execution';
import { cn } from '@/lib/utils';

interface ExecutionDetailModalProps {
  task: TaskQueueItem | null;
  isOpen: boolean;
  onClose: () => void;
  onRerun?: (task: TaskQueueItem) => void;
}

export const ExecutionDetailModal: React.FC<ExecutionDetailModalProps> = ({
  task,
  isOpen,
  onClose,
  onRerun,
}) => {
  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div 
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs px-2 py-1 bg-slate-200/80 rounded font-bold text-slate-700">
              #{task.taskNumber}
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Chi tiết tiến trình tác vụ
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Bắt đầu lúc {task.startTime} · {task.targetSummary}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Đóng chi tiết tác vụ"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Câu lệnh gốc */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Câu lệnh gốc
            </span>
            <p className="text-sm font-semibold text-slate-800">
              &quot;{task.command}&quot;
            </p>
          </div>

          {/* Tiến độ và kết quả */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-white border border-slate-200 rounded-xl">
              <span className="text-[10px] text-slate-400 font-medium block">Trạng thái</span>
              <span className={cn("text-xs font-bold mt-1 inline-block", getStatusColor(task.status))}>
                {task.status}
              </span>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl">
              <span className="text-[10px] text-slate-400 font-medium block">Tỷ lệ hoàn thành</span>
              <span className="text-xs font-bold text-slate-800 mt-1 inline-block">
                {task.completedCount} / {task.totalCount} máy ({task.progressPercent}%)
              </span>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl">
              <span className="text-[10px] text-slate-400 font-medium block">Thời gian kết thúc</span>
              <span className="text-xs font-semibold text-slate-800 mt-1 inline-block">
                {task.endTime || 'Đang thực thi'}
              </span>
            </div>
          </div>

          {/* Action Plan */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-indigo-600" />
              <span>Chuỗi hành động (Action Plan)</span>
            </h4>
            <div className="bg-slate-900 rounded-xl p-3 text-slate-200 font-mono text-xs max-h-40 overflow-y-auto">
              <ol className="list-decimal list-inside space-y-1 text-slate-300">
                {task.actionPlan?.actions.map((act, idx) => (
                  <li key={idx} className="text-[11px]">
                    <strong className="text-indigo-400 font-semibold">{act.type}</strong>
                    {act.app && <span className="text-emerald-400"> app=&quot;{act.app}&quot;</span>}
                    {act.target && <span className="text-amber-300"> target=&quot;{act.target}&quot;</span>}
                    {act.text && <span className="text-sky-300"> text=&quot;{act.text}&quot;</span>}
                    {act.description && <span className="text-slate-400 font-sans"> ({act.description})</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Thiết bị tham gia & Log từng thiết bị */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-indigo-600" />
              <span>Trạng thái từng thiết bị</span>
            </h4>
            <div className="space-y-2">
              {task.deviceProgress?.map((dp) => (
                <div key={dp.deviceId} className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{dp.deviceName}</span>
                    <span className={cn("text-[11px] font-semibold", getStatusColor(dp.status as any))}>
                      {dp.status} ({dp.currentStep}/{dp.totalSteps} bước)
                    </span>
                  </div>
                  {dp.error && (
                    <div className="mt-1 text-xs text-rose-600 font-medium bg-rose-50 p-1.5 rounded">
                      Lỗi: {dp.error}
                    </div>
                  )}
                  {dp.logs && dp.logs.length > 0 && (
                    <div className="mt-2 text-[10px] font-mono text-slate-500 bg-white p-2 rounded border border-slate-100">
                      {dp.logs.join(' -> ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <button
            onClick={() => {
              if (onRerun) onRerun(task);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Chạy lại tác vụ</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

function getStatusColor(status: string) {
  switch (status) {
    case 'SUCCESS':
      return 'text-emerald-600';
    case 'RUNNING':
      return 'text-indigo-600';
    case 'FAILED':
      return 'text-rose-600';
    case 'PARTIAL_SUCCESS':
      return 'text-amber-600';
    default:
      return 'text-slate-600';
  }
}
