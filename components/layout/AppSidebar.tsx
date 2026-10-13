'use client';

import React from 'react';
import { 
  Smartphone, 
  LayoutDashboard, 
  Sparkles, 
  Workflow, 
  ListOrdered, 
  History, 
  Settings,
  CircleDot
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  active?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard, active: true },
  { id: 'devices', label: 'Thiết bị', icon: Smartphone, badge: '6' },
  { id: 'ai-commands', label: 'Lệnh AI', icon: Sparkles },
  { id: 'workflows', label: 'Kịch bản', icon: Workflow },
  { id: 'task-queue', label: 'Hàng đợi', icon: ListOrdered },
  { id: 'history', label: 'Lịch sử', icon: History },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

interface AppSidebarProps {
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  activeTab = 'dashboard',
  onTabChange,
  className
}) => {
  return (
    <aside className={cn(
      "w-[240px] shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between h-screen sticky top-0 select-none z-30 transition-all",
      className
    )}>
      {/* 4.1. Logo & Brand */}
      <div>
        <div className="h-[72px] px-5 flex items-center gap-3 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shadow-indigo-200 shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-slate-900 text-base leading-tight tracking-tight flex items-center gap-1.5">
              <span>Phone</span>
              <span className="text-indigo-600">Commander</span>
            </h1>
            <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5 font-medium">
              Điều khiển nhiều máy bằng AI
            </p>
          </div>
        </div>

        {/* 4.2. Navigation Menu */}
        <nav className="p-3 space-y-1">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Điều hướng chính
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id || (!activeTab && item.active);

            return (
              <button
                key={item.id}
                onClick={() => onTabChange && onTabChange(item.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group text-left",
                  isActive
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn(
                    "w-4 h-4 transition-colors",
                    isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"
                  )} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-md font-semibold",
                    isActive ? "bg-indigo-200/60 text-indigo-800" : "bg-slate-100 text-slate-500"
                  )}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 4.3. Footer Sidebar */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50 m-2 rounded-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700">Phone Commander</span>
          <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 bg-slate-200/70 text-slate-600 rounded">
            v1.0.0
          </span>
        </div>
        
        <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span>ADB / Appium: Sẵn sàng</span>
        </div>
        <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
          <CircleDot className="w-3 h-3 text-slate-400" />
          <span>Socket.IO: Giả lập kết nối</span>
        </div>
      </div>
    </aside>
  );
};
