'use client';

import React from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppHeader } from '@/components/layout/AppHeader';

interface DashboardLayoutProps {
  children: React.ReactNode;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  searchQuery,
  onSearchChange,
  activeTab = 'dashboard',
  onTabChange,
}) => {
  return (
    <div className="min-h-screen flex bg-[#F8FAFC]">
      {/* A. Sidebar bên trái - Cố định chiều cao màn hình */}
      <AppSidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
      />

      {/* B. Main Content chiếm toàn bộ không gian còn lại */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header trên cùng */}
        <AppHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
        />

        {/* Nội dung Dashboard cuộn dọc */}
        <main className="flex-1 p-6 space-y-6 max-w-[1920px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
