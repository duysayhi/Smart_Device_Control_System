'use client';

import React from 'react';
import { CommandInput } from './CommandInput';
import { ActionPlanPreview } from './ActionPlanPreview';
import { ExecutionLogs } from './ExecutionLogs';
import { PlanStatus, ActionPlan, LogEntry } from '@/types/command';
import { AndroidAdbDevice } from '@/types/device';
import { ExecutionStepResult } from '@/types/execution';
import { AgentGoalPanel } from './AgentGoalPanel';
import type { AgentRuntimeControl } from '@/hooks/useAgentRuntimes';

const explorationLabels = {
  SEARCHING: 'Đang tìm phần tử', CHECKING_LIST: 'Đang kiểm tra danh sách', SCROLLING: 'Đang cuộn',
  WAITING_DATA: 'Đang chờ dữ liệu mới', FOUND: 'Đã phát hiện mục tiêu', VERIFYING: 'Đang xác minh phần tử',
  NOT_FOUND: 'Không tìm thấy', AMBIGUOUS: 'Không thể phân giải phần tử',
};

interface AICommandPanelProps {
  commandText: string;
  onCommandChange: (val: string) => void;
  androidDevices: AndroidAdbDevice[];
  selectedAndroidSerial: string;
  onAndroidDeviceChange: (serial: string) => void;
  androidDevicesLoading: boolean;
  androidDevicesError: string | null;
  onRefreshAndroidDevices: () => void;
  planStatus: PlanStatus;
  currentPlan: ActionPlan | null;
  analysisError: string | null;
  logs: LogEntry[];
  isExecuting: boolean;
  executionSteps: ExecutionStepResult[];
  executionStatus: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SENT';
  executionError: string | null;
  onAnalyzeCommand: () => void;
  onExecuteCommand: () => void;
  onStopExecution: () => void;
  onClearLogs?: () => void;
  runtime: AgentRuntimeControl;
  selectedDeviceIds: string[];
  inspectedExecutionId?: string;
}

export const AICommandPanel: React.FC<AICommandPanelProps> = ({
  commandText,
  onCommandChange,
  androidDevices,
  selectedAndroidSerial,
  onAndroidDeviceChange,
  androidDevicesLoading,
  androidDevicesError,
  onRefreshAndroidDevices,
  planStatus,
  currentPlan,
  analysisError,
  logs,
  isExecuting,
  executionSteps,
  executionStatus,
  executionError,
  onAnalyzeCommand,
  onExecuteCommand,
  onStopExecution,
  onClearLogs,
  runtime,
  selectedDeviceIds,
  inspectedExecutionId,
}) => {
  const [mode, setMode] = React.useState<'plan' | 'agent'>('agent');
  const selectedDevice = androidDevices.find((device) => device.serial === selectedAndroidSerial);
  const targetCount = selectedDevice?.status === 'device' && selectedDevice.connectionType === 'USB' ? 1 : 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col gap-4">
      <div role="tablist" aria-label="Chế độ thực thi" className="flex border-b border-slate-200 gap-4 text-xs">
        {(['plan', 'agent'] as const).map(value => <button type="button" role="tab" aria-selected={mode === value} disabled={isExecuting || planStatus === 'ANALYZING'} key={value}
          onClick={() => setMode(value)} className={`py-2 border-b-2 ${mode === value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>{value === 'plan' ? 'Action Plan' : 'Goal Agent'}</button>)}
      </div>
      {mode === 'agent' ? <AgentGoalPanel text={commandText} onText={onCommandChange} devices={androidDevices} serial={selectedAndroidSerial}
        onSerial={onAndroidDeviceChange} onRefresh={onRefreshAndroidDevices} runtime={runtime} selectedDeviceIds={selectedDeviceIds} inspectedExecutionId={inspectedExecutionId} /> : <>
      {/* 8.1. Command Input Section */}
      <CommandInput
        commandText={commandText}
        onCommandChange={onCommandChange}
        androidDevices={androidDevices}
        selectedAndroidSerial={selectedAndroidSerial}
        onAndroidDeviceChange={onAndroidDeviceChange}
        androidDevicesLoading={androidDevicesLoading}
        androidDevicesError={androidDevicesError}
        onRefreshAndroidDevices={onRefreshAndroidDevices}
        targetCount={targetCount}
        planStatus={planStatus}
        isExecuting={isExecuting}
        onAnalyzeCommand={onAnalyzeCommand}
        onExecuteCommand={onExecuteCommand}
        onStopExecution={onStopExecution}
      />

      {/* 8.2. Action Plan Preview */}
      <ActionPlanPreview
        plan={currentPlan}
        status={planStatus}
        errorMessage={analysisError}
      />

      {executionSteps.length > 0 && (
        <section aria-live="polite" className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-800">Tiến trình thực thi Android</h4>
            <span className={`text-[10px] font-bold ${executionStatus === 'FAILED' ? 'text-rose-600' : executionStatus === 'SUCCESS' ? 'text-emerald-600' : 'text-indigo-600'}`}>
              {executionStatus}
            </span>
          </div>
          <ol className="p-2 space-y-1.5">
            {executionSteps.map((step) => (
              <li key={step.index} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-slate-700 min-w-0 break-words">
                  {step.index + 1}. {step.action.type}
                  {step.deviceId && <span className="block text-[10px] text-slate-400">{step.deviceId}</span>}
                  {step.evidence?.foregroundPackage && <span className="block text-[10px] text-slate-500">{step.evidence.foregroundPackage}</span>}
                </span>
                <span className="text-right min-w-0 max-w-[65%] break-words">
                  <span className={`font-semibold ${step.status === 'FAILED' ? 'text-rose-600' : step.status === 'SUCCESS' ? 'text-emerald-600' : step.status === 'EXECUTING' ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {step.errorCode ?? step.phase ?? step.status}
                  </span>
                  {step.waitingFor && <span className="block text-slate-500 break-words">{step.waitingFor}</span>}
                  {step.elapsedMs !== undefined && <span className="block text-slate-500">{(step.elapsedMs / 1000).toFixed(2)} s</span>}
                  {step.evidence?.observationStatus && <span className="block text-slate-500">{step.evidence.observationStatus} · {step.evidence.source}</span>}
                  {step.postcondition && <span className="block text-slate-500 break-words">{step.postcondition}</span>}
                  {step.exploration && <span className="block text-slate-500 break-words">
                    {explorationLabels[step.exploration.phase]} · {step.exploration.scrollCount} lần cuộn · {step.exploration.snapshotCount} snapshot
                    <span className="block">{step.exploration.newElements} mới · {step.exploration.duplicateElements} trùng</span>
                  </span>}
                  {step.error && <span className="block text-rose-600">{step.error}</span>}
                </span>
              </li>
            ))}
          </ol>
          {executionError && <p role="alert" className="px-3 pb-2 text-[11px] text-rose-600">{executionError}</p>}
        </section>
      )}

      {/* 8.3. Execution Logs */}
      <ExecutionLogs
        logs={logs}
        onClearLogs={onClearLogs}
      />
      </>}
    </div>
  );
};
