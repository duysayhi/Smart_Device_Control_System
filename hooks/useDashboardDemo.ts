'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionPlan, LogEntry, PlanStatus } from '@/types/command';
import { AndroidAdbDevice, Device } from '@/types/device';
import { ExecutionStepResult, ExecutionStreamEvent, TaskQueueItem } from '@/types/execution';
import { SAMPLE_COMMANDS } from '@/lib/mock-data';
import { resolveLiveDeviceSelection } from '@/lib/android/device-selection';
import { ActionPlanSchema } from '@/lib/validators/action-plan.schema';

export function useDashboardDemo() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [androidDevices, setAndroidDevices] = useState<AndroidAdbDevice[]>([]);
  const [selectedAndroidSerial, setSelectedAndroidSerial] = useState('');
  const [androidDevicesLoading, setAndroidDevicesLoading] = useState(false);
  const [androidDevicesError, setAndroidDevicesError] = useState<string | null>(null);
  const [commandText, setCommandText] = useState(SAMPLE_COMMANDS[0].prompt);
  const [planStatus, setPlanStatus] = useState<PlanStatus>('IDLE');
  const [currentPlan, setCurrentPlan] = useState<ActionPlan | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepResult[]>([]);
  const [executionStatus, setExecutionStatus] = useState<'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SENT'>('IDLE');
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [tasks] = useState<TaskQueueItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const analysisRequestIdRef = useRef(0);
  const selectedAndroidSerialRef = useRef('');
  const selectedIdsRef = useRef<string[] | undefined>(undefined);
  const executionAbortControllerRef = useRef<AbortController | null>(null);

  const refreshAndroidDevices = useCallback(async () => {
    setAndroidDevicesLoading(true);
    setAndroidDevicesError(null);
    try {
      const response = await fetch('/api/devices', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        devices?: AndroidAdbDevice[];
        error?: string;
      } | null;
      if (!response.ok || payload?.success !== true || !Array.isArray(payload.devices)) {
        throw new Error(payload?.error || 'Không thể tải danh sách thiết bị Android.');
      }

      setAndroidDevices(payload.devices);
      const liveSelection = resolveLiveDeviceSelection(payload.devices, selectedAndroidSerialRef.current, selectedIdsRef.current);
      setDevices(liveSelection.devices);
      selectedAndroidSerialRef.current = liveSelection.selectedAndroidSerial;
      setSelectedAndroidSerial(liveSelection.selectedAndroidSerial);
      setSelectedDeviceIds(liveSelection.selectedDeviceIds);
      selectedIdsRef.current = liveSelection.selectedDeviceIds;
    } catch (error) {
      setAndroidDevices([]);
      selectedAndroidSerialRef.current = '';
      setSelectedAndroidSerial('');
      setDevices([]);
      setSelectedDeviceIds([]);
      setAndroidDevicesError(error instanceof Error ? error.message : 'Không thể tải danh sách thiết bị Android.');
    } finally {
      setAndroidDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refreshAndroidDevices(); });
    return () => { active = false; };
  }, [refreshAndroidDevices]);

  const handleCommandChange = useCallback((value: string) => {
    analysisRequestIdRef.current += 1;
    setCommandText(value);
    setCurrentPlan(null);
    setPlanStatus('IDLE');
    setAnalysisError(null);
  }, []);

  const handleSelectToggle = useCallback((deviceId: string) => {
    const liveDevice = devices.find((device) => device.id === deviceId && device.isLive);
    if (liveDevice) {
      const previous = selectedIdsRef.current ?? [];
      const selected = previous.includes(deviceId) ? previous.filter(id => id !== deviceId) : [...previous, deviceId];
      selectedIdsRef.current = selected;
      const nextSerial = selected.includes(deviceId) ? deviceId : selected[0] ?? '';
      selectedAndroidSerialRef.current = nextSerial;
      setSelectedAndroidSerial(nextSerial);
      setSelectedDeviceIds(selected);
      return;
    }

    selectedAndroidSerialRef.current = '';
    setSelectedAndroidSerial('');
    setSelectedDeviceIds((previous) =>
      previous.includes(deviceId)
        ? previous.filter((id) => id !== deviceId)
        : [...previous, deviceId]
    );
  }, [devices]);

  const handleSelectAll = useCallback((deviceIds: string[]) => {
    const liveDevice = devices.find((device) => device.isLive && device.status === 'READY' && device.connectionType === 'USB' && deviceIds.includes(device.id));
    if (liveDevice) {
      selectedAndroidSerialRef.current = liveDevice.serial;
      const selected = devices.filter(device => device.isLive && device.status === 'READY' && device.connectionType === 'USB' && deviceIds.includes(device.id)).map(device => device.id);
      selectedIdsRef.current = selected;
      setSelectedDeviceIds(selected);
      setSelectedAndroidSerial(liveDevice.serial);
      return;
    }
    selectedAndroidSerialRef.current = '';
    setSelectedAndroidSerial('');
    selectedIdsRef.current = [];
    setSelectedDeviceIds([]);
  }, [devices]);

  const handleClearSelection = useCallback(() => {
    selectedIdsRef.current = [];
    setSelectedDeviceIds([]);
    selectedAndroidSerialRef.current = '';
    setSelectedAndroidSerial('');
  }, []);

  const handleAndroidDeviceChange = useCallback((serial: string) => {
    selectedAndroidSerialRef.current = serial;
    setSelectedAndroidSerial(serial);
  }, []);

  const handleAnalyzeCommand = useCallback(async () => {
    if (!commandText.trim() || planStatus === 'ANALYZING') return;

    const requestId = ++analysisRequestIdRef.current;
    setPlanStatus('ANALYZING');
    setCurrentPlan(null);
    setAnalysisError(null);

    try {
      const response = await fetch('/api/commands/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: commandText }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        error?: string;
        actionPlan?: unknown;
      } | null;
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || 'Không thể phân tích lệnh.');
      }

      const parsedPlan = ActionPlanSchema.safeParse(payload.actionPlan);
      if (!parsedPlan.success) throw new Error('Action Plan trả về từ API không hợp lệ.');
      if (requestId !== analysisRequestIdRef.current) return;

      setCurrentPlan({
        ...parsedPlan.data,
        commandPrompt: commandText,
        targetCount: androidDevices.some((device) =>
          device.serial === selectedAndroidSerial && device.status === 'device' && device.connectionType === 'USB'
        ) ? 1 : 0,
      });
      setPlanStatus('SUCCESS');
      const timestamp = new Date().toTimeString().split(' ')[0];
      setLogs((previous) => [{
        id: `analysis-${Date.now()}`,
        timestamp,
        deviceId: 'system',
        deviceName: 'AI Planner',
        message: `Phân tích thành công câu lệnh: "${commandText}"`,
        status: 'SUCCESS',
      }, ...previous]);
    } catch (error) {
      if (requestId !== analysisRequestIdRef.current) return;
      setAnalysisError(error instanceof Error ? error.message : 'Không thể phân tích lệnh.');
      setPlanStatus('FAILED');
    }
  }, [androidDevices, commandText, planStatus, selectedAndroidSerial]);

  const handleExecuteCommand = useCallback(async () => {
    const targetDevice = androidDevices.find((device) => device.serial === selectedAndroidSerial);
    if (
      !currentPlan ||
      targetDevice?.status !== 'device' ||
      targetDevice.connectionType !== 'USB' ||
      isExecuting ||
      executionAbortControllerRef.current
    ) return;

    const validatedPlan = ActionPlanSchema.safeParse({
      intent: currentPlan.intent || 'execute_action_plan',
      isSensitive: currentPlan.isSensitive ?? false,
      actions: currentPlan.actions,
    });
    if (!validatedPlan.success) {
      setExecutionError('Action Plan không vượt qua kiểm tra an toàn. Hãy phân tích lại câu lệnh.');
      setExecutionStatus('FAILED');
      return;
    }

    const controller = new AbortController();
    executionAbortControllerRef.current = controller;
    setIsExecuting(true);
    setExecutionStatus('RUNNING');
    setExecutionError(null);
    setExecutionSteps(validatedPlan.data.actions.map((action, index) => ({
      index,
      action,
      status: 'PENDING',
    })));

    try {
      const response = await fetch('/api/executions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: targetDevice.serial, actionPlan: validatedPlan.data }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || 'Không thể bắt đầu thực thi trên thiết bị.');
      }
      if (!response.body) throw new Error('Máy chủ không trả về tiến trình thực thi.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      const loggedStates = new Map<number, string>();
      const applyEvent = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as ExecutionStreamEvent;
        setExecutionSteps(event.steps);
        if (event.type === 'progress') {
          const confirmedLogs: LogEntry[] = [];
          for (const step of event.steps) {
            const key = `${step.status}:${step.phase}:${step.waitingFor}:${step.errorCode}:${step.exploration?.phase}:${step.exploration?.scrollCount}:${step.exploration?.status}`;
            if (step.status === 'PENDING' || loggedStates.get(step.index) === key) continue;
            loggedStates.set(step.index, key);
            confirmedLogs.push({
              id: `step-${Date.now()}-${step.index}`, timestamp: new Date().toTimeString().split(' ')[0],
              deviceId: targetDevice.serial, deviceName: targetDevice.model,
              message: `${step.action.type}: ${step.errorCode ?? step.exploration?.phase ?? step.phase ?? step.status}${step.waitingFor ? ` (${step.waitingFor})` : ''}${step.exploration ? ` - cuộn ${step.exploration.scrollCount}, snapshot ${step.exploration.snapshotCount}, mới ${step.exploration.newElements}, trùng ${step.exploration.duplicateElements}` : ''}${step.postcondition ? ` - ${step.postcondition}` : ''}`,
              status: step.status === 'FAILED' ? 'FAILED' : step.status === 'SUCCESS' ? 'SUCCESS' : step.status === 'SENT' ? 'INFO' : 'EXECUTING'
            });
          }
          if (confirmedLogs.length) setLogs((previous) => [...confirmedLogs.reverse(), ...previous].slice(0, 500));
        }
        if (event.type === 'complete') {
          completed = true;
          setExecutionStatus(event.status ?? (event.success ? 'SUCCESS' : 'FAILED'));
          setExecutionError(event.error ?? null);
          const timestamp = new Date().toTimeString().split(' ')[0];
          setLogs((previous) => [{
            id: `execution-${Date.now()}`,
            timestamp,
            deviceId: targetDevice.serial,
            deviceName: targetDevice.model,
            message: event.success ? 'Thực thi và xác minh Action Plan hoàn tất.' : event.status === 'SENT' ? 'Đã gửi thao tác; mục tiêu giao diện chưa được xác minh đầy đủ.' : event.error || 'Thực thi Action Plan thất bại.',
            status: event.success ? 'SUCCESS' : event.status === 'SENT' ? 'INFO' : 'FAILED',
          }, ...previous]);
          if (event.success) void refreshAndroidDevices();
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(applyEvent);
        if (done) break;
      }
      if (buffer.trim()) applyEvent(buffer);
      if (!completed) throw new Error('Luồng thực thi kết thúc trước khi có kết quả cuối.');
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof Error && error.name === 'AbortError';
      const message = cancelled
        ? 'Đã dừng thực thi theo yêu cầu.'
        : error instanceof Error ? error.message : 'Thực thi Action Plan thất bại.';
      setExecutionError(message);
      setExecutionStatus('FAILED');
      setExecutionSteps((previous) => previous.map((step) =>
        step.status === 'EXECUTING' ? {
          ...step, status: 'FAILED', phase: undefined, error: message,
          errorCode: cancelled ? 'CANCELLED' : step.errorCode,
          exploration: step.exploration ? { ...step.exploration, phase: 'NOT_FOUND', status: cancelled ? 'CANCELLED' : step.exploration.status, reason: message } : undefined
        } : step
      ));
      const timestamp = new Date().toTimeString().split(' ')[0];
      setLogs((previous) => [{
        id: `execution-${Date.now()}`,
        timestamp,
        deviceId: targetDevice.serial,
        deviceName: targetDevice.model,
        message,
        status: 'FAILED',
      }, ...previous]);
    } finally {
      if (executionAbortControllerRef.current === controller) executionAbortControllerRef.current = null;
      setIsExecuting(false);
    }
  }, [androidDevices, currentPlan, isExecuting, refreshAndroidDevices, selectedAndroidSerial]);

  const handleStopExecution = useCallback(() => {
    executionAbortControllerRef.current?.abort();
  }, []);

  const handleSimulateDeviceAction = useCallback((deviceId: string, actionName: string) => {
    const targetDevice = devices.find((device) => device.id === deviceId);
    const timestamp = new Date().toTimeString().split(' ')[0];
    setLogs((previous) => [{
      id: `demo-${Date.now()}`,
      timestamp,
      deviceId,
      deviceName: targetDevice?.name || deviceId,
      message: `Thao tác thủ công mô phỏng: ${actionName}`,
      status: 'INFO',
    }, ...previous]);
  }, [devices]);

  const handleRerunTask = useCallback((task: TaskQueueItem) => {
    handleCommandChange(task.command);
  }, [handleCommandChange]);

  useEffect(() => () => executionAbortControllerRef.current?.abort(), []);

  return {
    devices,
    selectedDeviceIds,
    androidDevices,
    selectedAndroidSerial,
    handleAndroidDeviceChange,
    androidDevicesLoading,
    androidDevicesError,
    refreshAndroidDevices,
    handleSelectToggle,
    handleSelectAll,
    handleClearSelection,
    commandText,
    handleCommandChange,
    planStatus,
    currentPlan,
    analysisError,
    executionSteps,
    executionStatus,
    executionError,
    logs,
    isExecuting,
    tasks,
    searchQuery,
    setSearchQuery,
    handleAnalyzeCommand,
    handleExecuteCommand,
    handleStopExecution,
    handleSimulateDeviceAction,
    handleRerunTask,
    clearLogs: () => setLogs([]),
  };
}
