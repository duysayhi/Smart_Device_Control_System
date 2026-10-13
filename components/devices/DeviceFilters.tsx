'use client';

import React from 'react';
import { 
  Columns3, 
  Maximize2, 
  CheckSquare, 
  Square,
  Sparkles,
  LayoutGrid
} from 'lucide-react';
import { DevicePlatform, DeviceStatus } from '@/types/device';
import { cn } from '@/lib/utils';

interface DeviceFiltersProps {
  platformFilter: 'all' | DevicePlatform;
  onPlatformFilterChange: (platform: 'all' | DevicePlatform) => void;
  statusFilter: 'all' | DeviceStatus;
  onStatusFilterChange: (status: 'all' | DeviceStatus) => void;
  columnCount: number;
  onColumnCountChange: (cols: number) => void;
  isAllSelected: boolean;
  onSelectAllToggle: () => void;
  onSelectAllReady: () => void;
  totalDevicesCount: number;
  selectedCount: number;
}

export const DeviceFilters: React.FC<DeviceFiltersProps> = ({
  platformFilter,
  onPlatformFilterChange,
  statusFilter,
  onStatusFilterChange,
  columnCount,
  onColumnCountChange,
  isAllSelected,
  onSelectAllToggle,
  onSelectAllReady,
  totalDevicesCount,
  selectedCount,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
      {/* Tiêu đề & Đếm */}
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-indigo-600" />
          <span>Màn hình trực tiếp</span>
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium border border-slate-200">
          Đang hiển thị {totalDevicesCount} máy
        </span>
        {selectedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
            Đã chọn {selectedCount}
          </span>
        )}
      </div>

      {/* Control Buttons & Dropdowns */}
      <div className="flex flex-wrap items-center gap-2.5">
        
        {/* Nền tảng: Tất cả / Android / iOS */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium">
          <button
            onClick={() => onPlatformFilterChange('all')}
            className={cn(
              "px-2.5 py-1 rounded-md transition",
              platformFilter === 'all'
                ? "bg-white text-slate-900 shadow-xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Tất cả
          </button>
          <button
            onClick={() => onPlatformFilterChange('android')}
            className={cn(
              "px-2.5 py-1 rounded-md transition",
              platformFilter === 'android'
                ? "bg-white text-indigo-700 shadow-xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Android
          </button>
          <button
            onClick={() => onPlatformFilterChange('ios')}
            className={cn(
              "px-2.5 py-1 rounded-md transition",
              platformFilter === 'ios'
                ? "bg-white text-indigo-700 shadow-xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            iOS
          </button>
        </div>

        {/* Trạng thái Filter Dropdown */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as 'all' | DeviceStatus)}
          className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="READY">Sẵn sàng (READY)</option>
          <option value="EXECUTING">Đang chạy (EXECUTING)</option>
          <option value="OFFLINE">Mất kết nối (OFFLINE)</option>
          <option value="UNAUTHORIZED">Chưa cấp quyền USB (UNAUTHORIZED)</option>
          <option value="ERROR">Gặp lỗi (ERROR)</option>
        </select>

        {/* Chọn số cột hiển thị (2, 3, 4) */}
        <div className="flex items-center gap-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white">
          <Columns3 className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={columnCount}
            onChange={(e) => onColumnCountChange(Number(e.target.value))}
            className="bg-transparent font-medium text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value={2}>2 cột</option>
            <option value={3}>3 cột</option>
            <option value={4}>4 cột</option>
          </select>
        </div>

        {/* Nút Chọn tất cả thiết bị READY */}
        <button
          onClick={onSelectAllReady}
          title="Chọn tất cả máy sẵn sàng nhận lệnh"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>Chọn READY</span>
        </button>

        {/* Nút Chọn / Bỏ chọn tất cả */}
        <button
          onClick={onSelectAllToggle}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
        >
          {isAllSelected ? (
            <>
              <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
              <span>Bỏ chọn</span>
            </>
          ) : (
            <>
              <Square className="w-3.5 h-3.5 text-slate-400" />
              <span>Chọn tất cả</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
