'use client';

import React from 'react';
import { Device, DevicePlatform, DeviceStatus } from '@/types/device';
import { DeviceCard } from './DeviceCard';
import { DeviceFilters } from './DeviceFilters';
import { DeviceDetailModal } from './DeviceDetailModal';
import { Smartphone, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DeviceGridProps {
  devices: Device[];
  selectedDeviceIds: string[];
  onSelectToggle: (deviceId: string) => void;
  onSelectAll: (deviceIds: string[]) => void;
  onClearSelection: () => void;
  onSimulateDeviceAction?: (deviceId: string, actionName: string) => void;
  searchFilter?: string;
}

export const DeviceGrid: React.FC<DeviceGridProps> = ({
  devices,
  selectedDeviceIds,
  onSelectToggle,
  onSelectAll,
  onClearSelection,
  onSimulateDeviceAction,
  searchFilter = '',
}) => {
  const [platformFilter, setPlatformFilter] = React.useState<'all' | DevicePlatform>('all');
  const [statusFilter, setStatusFilter] = React.useState<'all' | DeviceStatus>('all');
  const [columnCount, setColumnCount] = React.useState<number>(3);
  const [activeDetailDevice, setActiveDetailDevice] = React.useState<Device | null>(null);

  // Lọc thiết bị theo platform, status và search query
  const filteredDevices = devices.filter((device) => {
    if (platformFilter !== 'all' && device.platform !== platformFilter) {
      return false;
    }
    if (statusFilter !== 'all' && device.status !== statusFilter) {
      return false;
    }
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const matchName = device.name.toLowerCase().includes(q);
      const matchSerial = device.serial.toLowerCase().includes(q);
      const matchOs = device.osVersion.toLowerCase().includes(q);
      if (!matchName && !matchSerial && !matchOs) return false;
    }
    return true;
  });

  const isAllSelected = 
    filteredDevices.length > 0 && 
    filteredDevices.every((d) => selectedDeviceIds.includes(d.id));

  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      onClearSelection();
    } else {
      onSelectAll(filteredDevices.map((d) => d.id));
    }
  };

  const handleSelectAllReady = () => {
    const readyIds = devices.filter((d) => d.status === 'READY').map((d) => d.id);
    onSelectAll(readyIds);
  };

  const gridColsClass = 
    columnCount === 2 
      ? "grid-cols-1 md:grid-cols-2" 
      : columnCount === 4 
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" 
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col h-full">
      {/* 7.1. Header & Filters của Device Grid */}
      <DeviceFilters
        platformFilter={platformFilter}
        onPlatformFilterChange={setPlatformFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        columnCount={columnCount}
        onColumnCountChange={setColumnCount}
        isAllSelected={isAllSelected}
        onSelectAllToggle={handleSelectAllToggle}
        onSelectAllReady={handleSelectAllReady}
        totalDevicesCount={filteredDevices.length}
        selectedCount={selectedDeviceIds.length}
      />

      {/* 7.2. Lưới thiết bị */}
      {filteredDevices.length === 0 ? (
        // Empty State khi không tìm thấy thiết bị khớp
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-200 rounded-xl my-4">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
            <Smartphone className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-slate-700">
            {devices.length === 0 ? 'Chưa phát hiện thiết bị qua ADB' : 'Không tìm thấy thiết bị phù hợp'}
          </h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">
            {devices.length === 0
              ? 'Kết nối điện thoại Android qua USB và làm mới danh sách thiết bị.'
              : 'Vui lòng thử bỏ bộ lọc nền tảng hoặc trạng thái để hiển thị danh sách thiết bị đầy đủ.'}
          </p>
          <button
            onClick={() => {
              setPlatformFilter('all');
              setStatusFilter('all');
            }}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-semibold transition"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            <span>Đặt lại bộ lọc</span>
          </button>
        </div>
      ) : (
        <div className={cn("grid gap-4 flex-1 items-start", gridColsClass)}>
          {filteredDevices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              isSelected={selectedDeviceIds.includes(device.id)}
              onSelectToggle={onSelectToggle}
              onOpenDetail={(dev) => setActiveDetailDevice(dev)}
            />
          ))}
        </div>
      )}

      {/* Modal chi tiết điều khiển thiết bị */}
      <DeviceDetailModal
        device={activeDetailDevice}
        isOpen={Boolean(activeDetailDevice)}
        onClose={() => setActiveDetailDevice(null)}
        onSimulateAction={onSimulateDeviceAction}
      />
    </div>
  );
};
