'use client';

import React from 'react';
import { 
  Eye, 
  Maximize2, 
  MoreVertical, 
  Battery, 
  Wifi, 
  Usb, 
  Monitor,
  Check
} from 'lucide-react';
import { Device } from '@/types/device';
import { DeviceScreen } from './DeviceScreen';
import { DeviceStatusBadge } from './DeviceStatusBadge';
import { cn } from '@/lib/utils';

interface DeviceCardProps {
  device: Device;
  isSelected: boolean;
  onSelectToggle: (deviceId: string) => void;
  onOpenDetail: (device: Device) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isSelected,
  onSelectToggle,
  onOpenDetail,
}) => {
  return (
    <div 
      className={cn(
        "bg-white rounded-xl border transition-all duration-200 shadow-xs hover:shadow-md flex flex-col overflow-hidden",
        isSelected 
          ? "border-indigo-600 ring-2 ring-indigo-500/15 bg-indigo-50/20" 
          : "border-slate-200 hover:border-slate-300"
      )}
    >
      {/* Header card: Checkbox + Tên + Badge */}
      <div className="p-3.5 pb-2 flex items-start justify-between gap-2 border-b border-slate-100">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Custom Checkbox */}
          <button
            type="button"
            onClick={() => onSelectToggle(device.id)}
            disabled={device.isLive && device.status !== 'READY'}
            aria-label={`Chọn thiết bị ${device.name}`}
            className={cn(
              "w-4 h-4 mt-0.5 rounded flex items-center justify-center border transition-all shrink-0",
              isSelected 
                ? "bg-indigo-600 border-indigo-600 text-white" 
                : "border-slate-300 bg-white hover:border-indigo-400"
            )}
          >
            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
          </button>

          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900 truncate leading-tight">
              {device.name}
            </h4>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
              <span className="font-mono text-slate-400">{device.serial}</span>
              <span>·</span>
              <span className="font-medium">{device.osVersion}</span>
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div className="shrink-0">
          <DeviceStatusBadge 
            status={device.status} 
            currentStep={device.currentStep} 
            totalSteps={device.totalSteps} 
          />
        </div>
      </div>

      {/* Phần A: Màn hình điện thoại hiển thị độc lập */}
      <div className="p-4 flex items-center justify-center bg-slate-50/40">
        <div className="w-full max-w-[170px]">
          <DeviceScreen 
            device={device} 
            interactive 
            onTap={() => onOpenDetail(device)} 
          />
        </div>
      </div>

      {/* Phần B: Thông số phần cứng & Kết nối */}
      <div className="px-4 py-2.5 bg-slate-50/80 border-t border-b border-slate-100 text-[11px] text-slate-600 grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1.5 truncate">
          <Battery className={cn(
            "w-3.5 h-3.5",
            device.batteryLevel !== undefined && device.batteryLevel < 20 ? "text-rose-500" : "text-slate-500"
          )} />
          <span>Pin: <strong className="text-slate-700">{device.batteryLevel === undefined ? 'Không có dữ liệu' : `${device.batteryLevel}%`}</strong></span>
        </div>

        <div className="flex items-center gap-1.5 truncate">
          {device.connectionType === 'USB' ? (
            <Usb className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <Wifi className="w-3.5 h-3.5 text-slate-500" />
          )}
          <span>Kết nối: <strong className="text-slate-700">{device.connectionType}</strong></span>
        </div>

        <div className="flex items-center gap-1.5 truncate col-span-2">
          <Monitor className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate">Độ phân giải: <strong className="text-slate-700">{device.resolution || 'Không có dữ liệu'}</strong></span>
        </div>
        <div className="flex items-center gap-1.5 truncate col-span-2">
          <Wifi className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate">IP: <strong className="text-slate-700">{device.ipAddress || 'Không có dữ liệu'}</strong></span>
        </div>
      </div>

      {/* Phần C: Thanh thao tác nhanh */}
      <div className="p-2.5 flex items-center justify-between gap-1 bg-white">
        <div className="flex items-center gap-1.5 flex-1">
          <button
            onClick={() => onOpenDetail(device)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
          >
            <Eye className="w-3.5 h-3.5 text-slate-500" />
            <span>Xem</span>
          </button>

          <button
            onClick={() => onOpenDetail(device)}
            title="Phóng to màn hình"
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          title="Tùy chọn khác"
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
