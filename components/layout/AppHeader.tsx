'use client';

import React from 'react';
import { Search, Bell, ChevronDown, ShieldCheck } from 'lucide-react';

interface AppHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  unreadAlertCount?: number;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  searchQuery,
  onSearchChange,
  unreadAlertCount = 2,
}) => {
  return (
    <header className="min-h-[72px] px-2 md:px-6 py-2 gap-2 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-20 shrink-0">
      {/* Bên trái: Tiêu đề lớn và dòng mô tả */}
      <div className="min-w-0">
        <h2 className="text-sm md:text-xl font-bold text-slate-800 leading-tight">
          Hệ thống điều khiển nhiều điện thoại
        </h2>
        <p className="hidden md:block text-xs text-slate-500 font-medium mt-1">
          Điều phối thiết bị Android / iOS bằng câu lệnh tự nhiên
        </p>
      </div>

      {/* Bên phải: Tìm kiếm, thông báo, user profile */}
      <div className="flex shrink-0 items-center gap-1 md:gap-4">
        {/* Search Input */}
        <div className="hidden xl:block relative w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm kiếm thiết bị, lệnh, lịch sử..."
            className="w-full pl-9 pr-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
          />
        </div>

        {/* Notification Bell */}
        <button
          title="Thông báo hệ thống"
          className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
        >
          <Bell className="w-5 h-5" />
          {unreadAlertCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
          )}
        </button>

        {/* User Dropdown Profile */}
        <div className="hidden md:flex items-center gap-2.5 pl-3 border-l border-slate-200 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700 font-semibold text-xs shadow-sm">
            PK
          </div>
          <div className="hidden md:block text-left">
            <div className="text-xs font-semibold text-slate-800 leading-tight group-hover:text-indigo-600 transition">
              Quản trị viên
            </div>
            <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-500 inline" />
              <span>Root Admin</span>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition" />
        </div>
      </div>
    </header>
  );
};
