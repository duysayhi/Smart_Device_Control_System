import { ActionItem, ActionPlan } from './command';
import type { ExplorationMetrics } from '../lib/android/exploration/types';
import type { VisualSummary } from '../lib/android/visual-grounding';

export type ExecutionStepStatus = 'PENDING' | 'EXECUTING' | 'SUCCESS' | 'FAILED' | 'SENT';
export type ExecutionErrorCode = 'TIMEOUT' | 'DEVICE_ERROR' | 'SESSION_ERROR' | 'UNKNOWN' | 'BACKEND_ERROR' | 'CONFIG_ERROR' | 'CANCELLED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SCROLL_LIMIT_REACHED';

export interface ExecutionStepResult {
  index: number;
  action: ActionItem;
  status: ExecutionStepStatus;
  error?: string;
  errorCode?: ExecutionErrorCode;
  phase?: 'EXECUTING' | 'WAITING';
  waitingFor?: string;
  elapsedMs?: number;
  exploration?: ExplorationMetrics;
  visual?: VisualSummary;
  visualFailure?: string;
  verification?: 'VERIFIED' | 'DISPATCHED';
  postcondition?: string;
  preconditions?: string[];
  deviceId?: string;
  evidence?: {
    observedAt: string; source: 'APPIUM' | 'ADB'; foregroundPackage?: string; screen?: string;
    snapshotId?: string; observationStatus?: string; nodeCount?: number; deviceSerial?: string;
    webStatus?: string; webContext?: string; webReason?: string; domSource?: 'WEB_CONTEXT';
  };
}

export type ExecutionStreamEvent =
  | { type: 'progress'; steps: ExecutionStepResult[] }
  | { type: 'complete'; success: boolean; steps: ExecutionStepResult[]; error?: string; errorCode?: ExecutionErrorCode; status?: 'SUCCESS' | 'FAILED' | 'SENT' };

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
