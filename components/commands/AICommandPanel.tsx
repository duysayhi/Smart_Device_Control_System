'use client';

import React from 'react';
import { CommandInput } from './CommandInput';
import { ActionPlanPreview } from './ActionPlanPreview';
import { ExecutionLogs } from './ExecutionLogs';
import { PlanStatus, ActionPlan, LogEntry } from '@/types/command';
import { AndroidAdbDevice } from '@/types/device';
import { ExecutionStepResult } from '@/types/execution';

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
  executionStatus: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  executionError: string | null;
  onAnalyzeCommand: () => void;
  onExecuteCommand: () => void;
  onStopExecution: () => void;
  onClearLogs?: () => void;
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
}) => {
  const selectedDevice = androidDevices.find((device) => device.serial === selectedAndroidSerial);
  const targetCount = selectedDevice?.status === 'device' && selectedDevice.connectionType === 'USB' ? 1 : 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col gap-4">
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
            <h4 className="text-xs font-semibold text-slate-800">Tiến trình thực thi ADB</h4>
            <span className={`text-[10px] font-bold ${executionStatus === 'FAILED' ? 'text-rose-600' : executionStatus === 'SUCCESS' ? 'text-emerald-600' : 'text-indigo-600'}`}>
              {executionStatus}
            </span>
          </div>
          <ol className="p-2 space-y-1.5">
            {executionSteps.map((step) => (
              <li key={step.index} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-slate-700">{step.index + 1}. {step.action.type}</span>
                <span className="text-right">
                  <span className={`font-semibold ${step.status === 'FAILED' ? 'text-rose-600' : step.status === 'SUCCESS' ? 'text-emerald-600' : step.status === 'EXECUTING' ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {step.status}
                  </span>
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
    </div>
  );
};
