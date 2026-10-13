import { ActionItem, ActionPlan } from './command';

export type ExecutionStepStatus = 'PENDING' | 'EXECUTING' | 'SUCCESS' | 'FAILED';

export interface ExecutionStepResult {
  index: number;
  action: ActionItem;
  status: ExecutionStepStatus;
  error?: string;
}

export type ExecutionStreamEvent =
  | { type: 'progress'; steps: ExecutionStepResult[] }
  | { type: 'complete'; success: boolean; steps: ExecutionStepResult[]; error?: string };

export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export interface DeviceTaskProgress {
  deviceId: string;
  deviceName: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  currentStep: number;
  totalSteps: number;
  error?: string;
  logs: string[];
}

export interface TaskQueueItem {
  id: string;
  taskNumber: number;
  command: string;
  targetSummary: string;
  targetDeviceIds: string[];
  startTime: string;
  endTime?: string;
  status: TaskStatus;
  progressPercent: number;
  completedCount: number;
  totalCount: number;
  actionPlan: ActionPlan;
  deviceProgress: DeviceTaskProgress[];
  logs: Array<{
    timestamp: string;
    deviceName: string;
    message: string;
    status: 'SUCCESS' | 'EXECUTING' | 'FAILED';
  }>;
}
