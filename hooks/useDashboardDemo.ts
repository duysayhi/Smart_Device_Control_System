'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionPlan, LogEntry, PlanStatus } from '@/types/command';
import { AndroidAdbDevice, Device } from '@/types/device';
import { ExecutionStepResult, ExecutionStreamEvent, TaskQueueItem } from '@/types/execution';
import { INITIAL_DEVICES, INITIAL_LOGS, INITIAL_TASKS, SAMPLE_COMMANDS } from '@/lib/mock-data';
import { ActionPlanSchema } from '@/lib/validators/action-plan.schema';

export function useDashboardDemo() {
  const [devices, setDevices] = useState<Device[]>(INITIAL_DEVICES);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>(['dev-001', 'dev-003']);
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
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [tasks] = useState<TaskQueueItem[]>(INITIAL_TASKS);
  const [searchQuery, setSearchQuery] = useState('');
  const analysisRequestIdRef = useRef(0);
  const selectedAndroidSerialRef = useRef('');
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
      const liveDevices: Device[] = payload.devices.map((device) => ({
        id: device.serial,
        serial: device.serial,
        name: device.model,
        platform: 'android',
        osVersion: device.osVersion || 'Không có dữ liệu',
        status: device.status === 'device'
          ? 'READY'
          : device.status === 'offline'
            ? 'OFFLINE'
            : device.status === 'unauthorized' ? 'UNAUTHORIZED' : 'ERROR',
        batteryLevel: device.batteryLevel,
        connectionType: device.connectionType,
        resolution: device.resolution || 'Không có dữ liệu',
        screenPreview: 'home',
        ipAddress: device.ipAddress,
        screenshotUrl: device.screenshotUrl,
        isLive: true,
        lastActive: 'Đang kết nối ADB',
      }));
      setDevices([...INITIAL_DEVICES, ...liveDevices]);

      const retained = payload.devices.find((device) =>
        device.serial === selectedAndroidSerialRef.current &&
        device.status === 'device' &&
        device.connectionType === 'USB'
      );
      const nextSerial = retained?.serial ?? payload.devices.find((device) =>
        device.status === 'device' && device.connectionType === 'USB'
      )?.serial ?? '';
      selectedAndroidSerialRef.current = nextSerial;
      setSelectedAndroidSerial(nextSerial);
      setSelectedDeviceIds(nextSerial ? [nextSerial] : []);
    } catch (error) {
      setAndroidDevices([]);
      selectedAndroidSerialRef.current = '';
      setSelectedAndroidSerial('');
      setDevices(INITIAL_DEVICES);
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
      const nextSerial = selectedAndroidSerialRef.current === deviceId ? '' : deviceId;
      selectedAndroidSerialRef.current = nextSerial;
      setSelectedAndroidSerial(nextSerial);
      setSelectedDeviceIds(nextSerial ? [nextSerial] : []);
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
    const liveDevice = devices.find((device) => device.isLive && deviceIds.includes(device.id));
    if (liveDevice) {
      selectedAndroidSerialRef.current = liveDevice.serial;
      setSelectedDeviceIds([liveDevice.id]);
      setSelectedAndroidSerial(liveDevice.serial);
      return;
    }
    selectedAndroidSerialRef.current = '';
    setSelectedAndroidSerial('');
    setSelectedDeviceIds(deviceIds);
  }, [devices]);

  const handleClearSelection = useCallback(() => {
    setSelectedDeviceIds([]);
    selectedAndroidSerialRef.current = '';
    setSelectedAndroidSerial('');
  }, []);

  const handleAndroidDeviceChange = useCallback((serial: string) => {
    selectedAndroidSerialRef.current = serial;
    setSelectedAndroidSerial(serial);
    setSelectedDeviceIds(serial ? [serial] : []);
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
            confirmedLogs.push({ id: `step-${Date.now()}-${step.index}`, timestamp: new Date().toTimeString().split(' ')[0],
              deviceId: targetDevice.serial, deviceName: targetDevice.model,
              message: `${step.action.type}: ${step.errorCode ?? step.exploration?.phase ?? step.phase ?? step.status}${step.waitingFor ? ` (${step.waitingFor})` : ''}${step.exploration ? ` - cuộn ${step.exploration.scrollCount}, snapshot ${step.exploration.snapshotCount}, mới ${step.exploration.newElements}, trùng ${step.exploration.duplicateElements}` : ''}${step.postcondition ? ` - ${step.postcondition}` : ''}`,
              status: step.status === 'FAILED' ? 'FAILED' : step.status === 'SUCCESS' ? 'SUCCESS' : step.status === 'SENT' ? 'INFO' : 'EXECUTING' });
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
        step.status === 'EXECUTING' ? { ...step, status: 'FAILED', phase: undefined, error: message,
          errorCode: cancelled ? 'CANCELLED' : step.errorCode,
          exploration: step.exploration ? { ...step.exploration, phase: 'NOT_FOUND', status: cancelled ? 'CANCELLED' : step.exploration.status, reason: message } : undefined } : step
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
