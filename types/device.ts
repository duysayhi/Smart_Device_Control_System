export type DevicePlatform = 'android' | 'ios';

export type DeviceStatus = 
  | 'OFFLINE'
  | 'UNAUTHORIZED'
  | 'DETECTED'
  | 'CONNECTING'
  | 'READY'
  | 'BUSY'
  | 'EXECUTING'
  | 'FAILED'
  | 'ERROR';

export type ConnectionType = 'USB' | 'Wi-Fi';

export type ScreenAppType = 'home' | 'youtube' | 'tiktok' | 'maps' | 'settings' | 'browser';

export interface Device {
  physicalId?: string;
  id: string;
  serial: string;
  name: string;
  platform: DevicePlatform;
  osVersion: string;
  status: DeviceStatus;
  batteryLevel?: number;
  connectionType: ConnectionType;
  resolution: string;
  screenPreview: ScreenAppType;
  currentStep?: number;
  totalSteps?: number;
  currentActionText?: string;
  ipAddress?: string;
  lastActive?: string;
  screenshotUrl?: string;
  isLive?: boolean;
}

export type AndroidAdbStatus = 'device' | 'offline' | 'unauthorized' | 'unknown';

export interface AndroidAdbDevice {
  physicalId?: string;
  identityVerified?: boolean;
  busy?: boolean;
  currentSessionId?: string;
  currentExecutionId?: string;
  serial: string;
  model: string;
  status: AndroidAdbStatus;
  connectionType: ConnectionType;
  osVersion?: string;
  batteryLevel?: number;
  resolution?: string;
  ipAddress?: string;
  screenshotUrl?: string;
}
