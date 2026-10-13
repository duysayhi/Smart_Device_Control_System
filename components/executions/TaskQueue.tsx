'use client';

import React from 'react';
import { 
  ListOrdered, 
  Play, 
  RotateCw, 
  Square, 
  Eye, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Loader2 
} from 'lucide-react';
import { TaskQueueItem, TaskStatus } from '@/types/execution';
import { ExecutionDetailModal } from './ExecutionDetailModal';
import { cn } from '@/lib/utils';

interface TaskQueueProps {
  tasks: TaskQueueItem[];
  onRerunTask?: (task: TaskQueueItem) => void;
  onStopTask?: (taskId: string) => void;
}

export const TaskQueue: React.FC<TaskQueueProps> = ({
  tasks,
  onRerunTask,
  onStopTask,
}) => {
  const [filterTab, setFilterTab] = React.useState<'ALL' | 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED'>('ALL');
  const [selectedTask, setSelectedTask] = React.useState<TaskQueueItem | null>(null);

  const filteredTasks = tasks.filter((t) => {
    if (filterTab === 'ALL') return true;
    if (filterTab === 'RUNNING') return t.status === 'RUNNING';
    if (filterTab === 'SUCCESS') return t.status === 'SUCCESS' || t.status === 'PARTIAL_SUCCESS';
    if (filterTab === 'FAILED') return t.status === 'FAILED' || t.status === 'CANCELLED';
    if (filterTab === 'PENDING') return t.status === 'PENDING';
    return true;
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col">
      {/* 9.1. Container Header & Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <ListOrdered className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight leading-none">
              Hàng đợi tác vụ (Task Queue)
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Lịch sử phân bổ và điều phối tác vụ tới các điện thoại
            </p>
          </div>
        </div>

        {/* Filter Tabs: Đang chờ, Đang chạy, Đã hoàn thành, Đã thất bại */}
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setFilterTab('ALL')}
            className={cn(
              "px-3 py-1.5 rounded-md transition",
              filterTab === 'ALL'
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Tất cả ({tasks.length})
          </button>
          <button
            onClick={() => setFilterTab('RUNNING')}
            className={cn(
              "px-3 py-1.5 rounded-md transition",
              filterTab === 'RUNNING'
                ? "bg-white text-indigo-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Đang chạy ({tasks.filter((t) => t.status === 'RUNNING').length})
          </button>
          <button
            onClick={() => setFilterTab('SUCCESS')}
            className={cn(
              "px-3 py-1.5 rounded-md transition",
              filterTab === 'SUCCESS'
                ? "bg-white text-emerald-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Đã hoàn thành ({tasks.filter((t) => t.status === 'SUCCESS' || t.status === 'PARTIAL_SUCCESS').length})
          </button>
          <button
            onClick={() => setFilterTab('FAILED')}
            className={cn(
              "px-3 py-1.5 rounded-md transition",
              filterTab === 'FAILED'
                ? "bg-white text-rose-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Đã thất bại ({tasks.filter((t) => t.status === 'FAILED').length})
          </button>
        </div>
      </div>

      {/* 9.2. Bảng tác vụ */}
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50/50">
              <th className="py-3 px-3">#</th>
              <th className="py-3 px-3">Câu lệnh</th>
              <th className="py-3 px-3">Thiết bị đích</th>
              <th className="py-3 px-3">Bắt đầu</th>
              <th className="py-3 px-3">Trạng thái</th>
              <th className="py-3 px-3">Tiến độ / Kết quả</th>
              <th className="py-3 px-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-400">
                  Không có tác vụ nào trong danh mục này.
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="hover:bg-slate-50/80 cursor-pointer transition group"
                >
                  {/* STT */}
                  <td className="py-3.5 px-3 font-mono font-bold text-slate-600">
                    #{task.taskNumber}
                  </td>

                  {/* Câu lệnh */}
                  <td className="py-3.5 px-3 font-medium text-slate-800 max-w-xs truncate">
                    <span className="font-semibold text-slate-900 block truncate group-hover:text-indigo-600 transition">
                      {task.command}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {task.actionPlan?.actions?.length || 0} thao tác chuỗi
                    </span>
                  </td>

                  {/* Thiết bị đích */}
                  <td className="py-3.5 px-3 text-slate-600 font-medium">
                    {task.targetSummary}
                  </td>

                  {/* Thời gian bắt đầu */}
                  <td className="py-3.5 px-3 font-mono text-slate-500">
                    {task.startTime}
                  </td>

                  {/* Trạng thái */}
                  <td className="py-3.5 px-3">
                    <TaskStatusBadge status={task.status} />
                  </td>

                  {/* Kết quả / Progress */}
                  <td className="py-3.5 px-3">
                    {task.status === 'RUNNING' ? (
                      <div className="w-32 space-y-1">
                        <div className="flex justify-between text-[10px] font-semibold text-slate-600">
                          <span>{task.progressPercent}%</span>
                          <span>Đang chạy</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${task.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="font-semibold text-slate-700">
                        {task.completedCount} / {task.totalCount} máy
                      </span>
                    )}
                  </td>

                  {/* Thao tác */}
                  <td className="py-3.5 px-3 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setSelectedTask(task)}
                      title="Xem chi tiết"
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    {task.status === 'RUNNING' && onStopTask ? (
                      <button
                        onClick={() => onStopTask(task.id)}
                        title="Dừng tác vụ"
                        className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                      >
                        <Square className="w-4 h-4 fill-current" />
                      </button>
                    ) : onRerunTask ? (
                      <button
                        onClick={() => onRerunTask(task)}
                        title="Chạy lại"
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Chi tiết Task Modal */}
      <ExecutionDetailModal
        task={selectedTask}
        isOpen={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        onRerun={onRerunTask}
      />
    </div>
  );
};

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'SUCCESS':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          SUCCESS
        </span>
      );
    case 'RUNNING':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Loader2 className="w-3 h-3 animate-spin" />
          RUNNING
        </span>
      );
    case 'PARTIAL_SUCCESS':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
          <AlertCircle className="w-3 h-3" />
          PARTIAL
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
          <AlertCircle className="w-3 h-3" />
          FAILED
        </span>
      );
    case 'PENDING':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
          <Clock className="w-3 h-3" />
          PENDING
        </span>
      );
  }
}
