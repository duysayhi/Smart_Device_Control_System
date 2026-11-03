'use client';

import React from 'react';
import { Sparkles, Play, Square, Bot, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { PlanStatus } from '@/types/command';
import { AndroidAdbDevice } from '@/types/device';
import { SAMPLE_COMMANDS } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

interface CommandInputProps {
  commandText: string;
  onCommandChange: (val: string) => void;
  androidDevices: AndroidAdbDevice[];
  selectedAndroidSerial: string;
  onAndroidDeviceChange: (serial: string) => void;
  androidDevicesLoading: boolean;
  androidDevicesError: string | null;
  onRefreshAndroidDevices: () => void;
  targetCount: number;
  planStatus: PlanStatus;
  isExecuting: boolean;
  onAnalyzeCommand: () => void;
  onExecuteCommand: () => void;
  onStopExecution: () => void;
}

export const CommandInput: React.FC<CommandInputProps> = ({
  commandText,
  onCommandChange,
  androidDevices,
  selectedAndroidSerial,
  onAndroidDeviceChange,
  androidDevicesLoading,
  androidDevicesError,
  onRefreshAndroidDevices,
  targetCount,
  planStatus,
  isExecuting,
  onAnalyzeCommand,
  onExecuteCommand,
  onStopExecution,
}) => {
  const isAnalyzeDisabled = isExecuting || planStatus === 'ANALYZING' || !commandText.trim();
  const isExecuteDisabled = isExecuting || planStatus !== 'SUCCESS' || targetCount === 0;

  return (
    <div className="space-y-3.5">
      {/* Header Panel */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 leading-none">
              Điều khiển bằng câu lệnh
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">
              Chuyển ngôn ngữ tự nhiên thành chuỗi hành động
            </span>
          </div>
        </div>

        {/* Quick Sample Selector */}
        <div className="relative group">
          <button
            type="button"
            className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium bg-indigo-50/70 hover:bg-indigo-100/70 px-2 py-1 rounded-md flex items-center gap-1 transition"
          >
            <span>Mẫu gợi ý</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 hidden group-hover:block z-30 animate-fade-in">
            <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1">
              Chọn lệnh mẫu thử nghiệm:
            </div>
            {SAMPLE_COMMANDS.map((sample, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onCommandChange(sample.prompt)}
                className="w-full text-left text-xs p-2 hover:bg-slate-50 rounded-lg text-slate-700 hover:text-indigo-600 transition"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Textarea nhập câu lệnh tiếng Việt */}
      <div className="relative">
        <textarea
          rows={3}
          value={commandText}
          onChange={(e) => onCommandChange(e.target.value)}
          disabled={isExecuting}
          placeholder="Nhập yêu cầu của bạn, ví dụ: Mở YouTube, tìm OpenAI và phát video đầu tiên..."
          className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white resize-none transition leading-relaxed"
        />
      </div>

      {/* Chọn thiết bị Android ADB đích */}
      <div className="flex items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
        <div className="flex-1 min-w-0">
          <label htmlFor="android-device-target" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
            Thiết bị Android qua ADB
          </label>
          <select
            id="android-device-target"
            value={selectedAndroidSerial}
            onChange={(e) => onAndroidDeviceChange(e.target.value)}
            disabled={isExecuting}
            className="w-full bg-white border border-slate-200 text-xs font-semibold text-slate-800 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Chọn thiết bị đã kết nối</option>
            {androidDevices.map((device) => (
              <option
                key={device.serial}
                value={device.serial}
                disabled={device.status !== 'device' || device.connectionType === 'Wi-Fi' && !device.identityVerified}
              >
                {device.model} · {device.serial} · {device.status}
              </option>
            ))}
          </select>
          {androidDevicesError && (
            <p role="alert" className="text-[10px] text-rose-600 mt-1">{androidDevicesError}</p>
          )}
          {!androidDevicesError && androidDevices.length === 0 && !androidDevicesLoading && (
            <p className="text-[10px] text-slate-500 mt-1">Chưa phát hiện thiết bị ADB nào.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefreshAndroidDevices}
          disabled={androidDevicesLoading || isExecuting}
          aria-label="Làm mới danh sách thiết bị Android"
          title="Làm mới danh sách thiết bị Android"
          className="p-2 text-slate-600 hover:text-indigo-700 hover:bg-white rounded-lg disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${androidDevicesLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Nút thao tác: Phân tích lệnh / Thực thi / Dừng */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <button
          type="button"
          onClick={onAnalyzeCommand}
          disabled={isAnalyzeDisabled}
          className={cn(
            "col-span-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border transition",
            planStatus === 'ANALYZING'
              ? "bg-slate-100 text-slate-400 border-slate-200"
              : isAnalyzeDisabled
                ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400 shadow-xs"
          )}
        >
          {planStatus === 'ANALYZING' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
              <span>Phân tích...</span>
            </>
          ) : (
            <>
              <Bot className="w-3.5 h-3.5 text-indigo-600" />
              <span>Phân tích</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onExecuteCommand}
          disabled={isExecuteDisabled}
          className={cn(
            "col-span-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-white shadow-xs transition",
            isExecuteDisabled
              ? "bg-indigo-300 cursor-not-allowed text-indigo-100"
              : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
          )}
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>Thực thi</span>
        </button>

        <button
          type="button"
          onClick={onStopExecution}
          disabled={!isExecuting}
          className={cn(
            "col-span-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition",
            isExecuting
              ? "bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100 shadow-xs cursor-pointer"
              : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
          )}
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Dừng</span>
        </button>
      </div>
    </div>
  );
};
