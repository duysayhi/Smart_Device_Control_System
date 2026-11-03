'use client';

import React from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatsOverview } from '@/components/dashboard/StatsOverview';
import { DeviceGrid } from '@/components/devices/DeviceGrid';
import { AICommandPanel } from '@/components/commands/AICommandPanel';
import { AgentTaskHistory } from '@/components/executions/AgentTaskHistory';
import { PostgresHistory } from '@/components/history/PostgresHistory';
import { useDashboardDemo } from '@/hooks/useDashboardDemo';
import { useAgentRuntimes } from '@/hooks/useAgentRuntimes';
import { useDevicePreviews } from '@/hooks/useDevicePreviews';
import { latestDeviceTasks } from '@/lib/android/agent/runtime-schema';
import { ConnectionManager } from '@/components/devices/ConnectionManager';
import { TeachWorkspace } from '@/components/skills/TeachWorkspace';

const subscribeToMount = () => () => undefined;
const getClientMounted = () => true;
const getServerMounted = () => false;

function ControlDashboard({controls}:{controls:(busy:boolean)=>React.ReactNode}) {
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
  const historyMounted = React.useSyncExternalStore(subscribeToMount, getClientMounted, getServerMounted);
  const activeTasks = runtime.tasks.filter(task => !task.finishedAt && ['QUEUED', 'RUNNING', 'WAITING_HUMAN'].includes(task.status));
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
      {controls(isExecuting||planStatus==='ANALYZING'||runtime.tasks.some(task=>!task.finishedAt))}
      {/* 6. Statistics Cards – 4 Card tổng quan trạng thái */}
      <StatsOverview devices={liveDevices} />
      <ConnectionManager devices={androidDevices} selectedSerial={selectedAndroidSerial} onSelect={focusDevice} onRefresh={refreshAndroidDevices} />

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
        {(!historyMounted || activeTasks.length > 0) && <AgentTaskHistory runtime={{ ...runtime, tasks: activeTasks }} onInspect={task => { setInspectedExecutionId(task.executionId); handleAndroidDeviceChange(task.deviceId); }} />}
        {historyMounted && <PostgresHistory projectionStatus={runtime.historyProjection}/>}
      </section>
    </DashboardLayout>
  );
}

export default function DashboardPage() {
  const [teach,setTeach]=React.useState(false),[busy,setBusy]=React.useState(false);
  const controls=(working:boolean)=><nav aria-label="Chế độ Dashboard" className="flex gap-2 rounded-lg border border-slate-200 bg-white p-2">
    <button type="button" aria-pressed={!teach} disabled={working} onClick={()=>setTeach(false)} className="rounded px-3 py-2 text-sm disabled:opacity-50">Điều khiển</button>
    <button type="button" aria-pressed={teach} disabled={working} onClick={()=>setTeach(true)} className="rounded px-3 py-2 text-sm disabled:opacity-50">Dạy kỹ năng</button>
  </nav>;
  if(!teach)return <ControlDashboard controls={controls}/>;
  return <DashboardLayout searchQuery="" onSearchChange={()=>undefined} activeTab="dashboard" onTabChange={()=>{if(!busy)setTeach(false);}}>{controls(busy)}<TeachWorkspace onBusy={setBusy}/></DashboardLayout>;
}
