'use client';

import React from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatsOverview } from '@/components/dashboard/StatsOverview';
import { DeviceGrid } from '@/components/devices/DeviceGrid';
import { AICommandPanel } from '@/components/commands/AICommandPanel';
import { TaskQueue } from '@/components/executions/TaskQueue';
import { useDashboardDemo } from '@/hooks/useDashboardDemo';

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
    tasks,
    searchQuery,
    setSearchQuery,
    handleAnalyzeCommand,
    handleExecuteCommand,
    handleStopExecution,
    handleSimulateDeviceAction,
    handleRerunTask,
    clearLogs,
  } = useDashboardDemo();

  return (
    <DashboardLayout
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {/* 6. Statistics Cards – 4 Card tổng quan trạng thái */}
      <StatsOverview devices={devices} />

      {/* Khu vực giữa: Live Device Grid (65-70%) & AI Command Panel (30-35%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 7. Live Device Grid - Chiếm 7-8/12 cột (khoảng 65-70%) */}
        <section className="lg:col-span-8 flex flex-col">
          <DeviceGrid
            devices={devices}
            selectedDeviceIds={selectedDeviceIds}
            onSelectToggle={handleSelectToggle}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onSimulateDeviceAction={handleSimulateDeviceAction}
            searchFilter={searchQuery}
          />
        </section>

        {/* 8. AI Command Panel - Chiếm 4/12 cột (khoảng 30-35%) */}
        <aside className="lg:col-span-4 flex flex-col">
          <AICommandPanel
            commandText={commandText}
            onCommandChange={handleCommandChange}
            androidDevices={androidDevices}
            selectedAndroidSerial={selectedAndroidSerial}
            onAndroidDeviceChange={handleAndroidDeviceChange}
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
        <TaskQueue
          tasks={tasks}
          onRerunTask={handleRerunTask}
          onStopTask={() => handleStopExecution()}
        />
      </section>
    </DashboardLayout>
  );
}
