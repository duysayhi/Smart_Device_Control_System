'use client';

import React from 'react';
import { ScrollText, CheckCircle2, AlertCircle, PlayCircle, Info } from 'lucide-react';
import { LogEntry } from '@/types/command';
import { cn } from '@/lib/utils';

interface ExecutionLogsProps {
  logs: LogEntry[];
  onClearLogs?: () => void;
}

export const ExecutionLogs: React.FC<ExecutionLogsProps> = ({
  logs,
  onClearLogs,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-slate-500" />
          <h4 className="text-xs font-bold text-slate-800">
            Nhật ký thực thi (Live Logs)
          </h4>
        </div>

        {onClearLogs && (
          <button
            onClick={onClearLogs}
            className="text-[10px] text-slate-400 hover:text-slate-600 transition"
          >
            Xóa nhật ký
          </button>
        )}
      </div>

      {/* Logs Scrollable Stream */}
      <div className="p-2 space-y-1.5 max-h-[190px] min-h-[130px] overflow-y-auto text-xs font-sans">
        {logs.length === 0 ? (
          <div className="h-full min-h-[110px] flex items-center justify-center text-slate-400 text-xs">
            Chưa có sự kiện thực thi nào được ghi nhận
          </div>
        ) : (
          logs.map((log) => {
            const statusConfig = getLogStatusConfig(log.status);
            const StatusIcon = statusConfig.icon;

            return (
              <div
                key={log.id}
                className="p-1.5 rounded-lg bg-slate-50/70 hover:bg-slate-100/70 border border-slate-100 flex items-start gap-2 transition"
              >
                {/* Status Indicator Icon */}
                <StatusIcon className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", statusConfig.color)} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-slate-800 text-[11px] truncate">
                      {log.deviceName}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {log.timestamp}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-snug break-words">
                    {log.message}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

function getLogStatusConfig(status: LogEntry['status']) {
  switch (status) {
    case 'SUCCESS':
      return { icon: CheckCircle2, color: 'text-emerald-500' };
    case 'EXECUTING':
      return { icon: PlayCircle, color: 'text-indigo-600 animate-pulse' };
    case 'FAILED':
      return { icon: AlertCircle, color: 'text-rose-500' };
    case 'WARNING':
      return { icon: AlertCircle, color: 'text-amber-500' };
    case 'INFO':
    default:
      return { icon: Info, color: 'text-slate-400' };
  }
}
