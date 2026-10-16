'use client';

import React from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatsOverview } from '@/components/dashboard/StatsOverview';
import { DeviceGrid } from '@/components/devices/DeviceGrid';
import { AICommandPanel } from '@/components/commands/AICommandPanel';
import { AgentTaskHistory } from '@/components/executions/AgentTaskHistory';
import { useDashboardDemo } from '@/hooks/useDashboardDemo';
import { useAgentRuntimes } from '@/hooks/useAgentRuntimes';
import { useDevicePreviews } from '@/hooks/useDevicePreviews';
import { latestDeviceTasks } from '@/lib/android/agent/runtime-schema';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = React.useState('dashboard');

  const {
    devices,
    selectedDeviceIds,
    handleSelectToggle,
    handleSelectAll,
    handleClearSelection,
    commandText,
    handleCommandChange,
    androidDevices,
    selectedAndroidSerial,
    handleAndroidDeviceChange,
    androidDevicesLoading,
    androidDevicesError,
    refreshAndroidDevices,
    planStatus,
    currentPlan,
    analysisError,
    logs,
    isExecuting,
    executionSteps,
    executionStatus,
    executionError,
    searchQuery,
    setSearchQuery,
    handleAnalyzeCommand,
    handleExecuteCommand,
    handleStopExecution,
    handleSimulateDeviceAction,
    clearLogs,
  } = useDashboardDemo();
  const runtime = useAgentRuntimes();
  const [detailSerial, setDetailSerial] = React.useState<string>();
  const [inspectedExecutionId, setInspectedExecutionId] = React.useState<string>();
  const focusDevice = (serial: string) => { setInspectedExecutionId(undefined); handleAndroidDeviceChange(serial); };
  const deviceTasks = latestDeviceTasks(runtime.tasks);
  const runtimeDevices = devices.map(device => {
    const task = deviceTasks.get(device.serial);
    return { ...device, status: task?.connectionState && task.connectionState !== 'device' ? 'OFFLINE' as const :
      task && !task.finishedAt ? 'EXECUTING' as const : device.status };
  });
  const liveDevices = useDevicePreviews(runtimeDevices, selectedDeviceIds, detailSerial);

  return (
    <DashboardLayout
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {/* 6. Statistics Cards – 4 Card tổng quan trạng thái */}
      <StatsOverview devices={liveDevices} />

      {/* Khu vực giữa: Live Device Grid (65-70%) & AI Command Panel (30-35%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 7. Live Device Grid - Chiếm 7-8/12 cột (khoảng 65-70%) */}
        <section className="lg:col-span-8 flex flex-col min-w-0">
          <DeviceGrid
            devices={liveDevices}
            runtime={runtime}
            onDetailChange={setDetailSerial}
            selectedDeviceIds={selectedDeviceIds}
            onSelectToggle={handleSelectToggle}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onSimulateDeviceAction={handleSimulateDeviceAction}
            searchFilter={searchQuery}
          />
        </section>

        {/* 8. AI Command Panel - Chiếm 4/12 cột (khoảng 30-35%) */}
        <aside className="lg:col-span-4 flex flex-col min-w-0">
          <AICommandPanel
            runtime={runtime}
            selectedDeviceIds={selectedDeviceIds}
            commandText={commandText}
            onCommandChange={handleCommandChange}
            androidDevices={androidDevices}
            selectedAndroidSerial={selectedAndroidSerial}
            onAndroidDeviceChange={focusDevice}
            inspectedExecutionId={inspectedExecutionId}
            androidDevicesLoading={androidDevicesLoading}
            androidDevicesError={androidDevicesError}
            onRefreshAndroidDevices={refreshAndroidDevices}
            planStatus={planStatus}
            currentPlan={currentPlan}
            analysisError={analysisError}
            logs={logs}
            isExecuting={isExecuting}
            executionSteps={executionSteps}
            executionStatus={executionStatus}
            executionError={executionError}
            onAnalyzeCommand={handleAnalyzeCommand}
            onExecuteCommand={handleExecuteCommand}
            onStopExecution={handleStopExecution}
            onClearLogs={clearLogs}
          />
        </aside>
      </div>

      {/* 9. Task Queue – Hàng đợi tác vụ & lịch sử thực thi bên dưới */}
      <section className="pt-2">
        <AgentTaskHistory runtime={runtime} onInspect={task => { setInspectedExecutionId(task.executionId); handleAndroidDeviceChange(task.deviceId); }} />
      </section>
    </DashboardLayout>
  );
}
