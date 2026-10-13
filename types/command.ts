export type TargetSelectionMode =
  | 'ALL_READY'
  | 'SELECTED'
  | 'ONLY_ANDROID'
  | 'ONLY_IOS'
  | 'CUSTOM_GROUP';

export interface ActionItem {
  id?: string;
  type: 'OPEN_APP' | 'CLOSE_APP' | 'CLICK' | 'INPUT_TEXT' | 'SCROLL' | 'WAIT' | 'WAIT_FOR' | 'PRESS_KEY' | 'KEY_EVENT' | 'SWIPE' | 'SCREENSHOT';
  app?: string;
  target?: string;
  text?: string;
  direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'up' | 'down' | 'left' | 'right';
  durationMs?: number;
  timeoutMs?: number;
  key?: string;
  description?: string;
}

export interface ActionPlan {
  commandPrompt: string;
  targetCount: number;
  actions: ActionItem[];
  estimatedDurationSec?: number;
  intent?: string;
  isSensitive?: boolean;
}

export type PlanStatus = 'IDLE' | 'ANALYZING' | 'SUCCESS' | 'FAILED';

export interface LogEntry {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceName: string;
  message: string;
  status: 'SUCCESS' | 'EXECUTING' | 'FAILED' | 'INFO' | 'WARNING';
}
