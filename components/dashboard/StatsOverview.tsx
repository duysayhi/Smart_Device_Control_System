'use client';

import React from 'react';
import { Smartphone, CheckCircle2, PlayCircle, AlertCircle } from 'lucide-react';
import { StatsCard } from './StatsCard';
import { Device } from '@/types/device';

interface StatsOverviewProps {
  devices: Device[];
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ devices }) => {
  // Tính toán số lượng từ dynamic device list
  const totalCount = devices.length;
  const readyCount = devices.filter((d) => d.status === 'READY').length;
  const executingCount = devices.filter((d) => d.status === 'EXECUTING' || d.status === 'BUSY').length;
  const errorCount = devices.filter((d) => d.status === 'ERROR' || d.status === 'FAILED' || d.status === 'UNAUTHORIZED' || d.status === 'OFFLINE').length;
  const androidCount = devices.filter((device) => device.platform === 'android').length;
  const iosCount = devices.filter((device) => device.platform === 'ios').length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <StatsCard
        title="Tổng thiết bị"
        value={totalCount}
        subtitle={`${androidCount} Android · ${iosCount} iOS`}
        icon={Smartphone}
        iconColor="text-indigo-600"
        iconBg="bg-indigo-50"
        trendText={`${devices.filter((device) => device.status === 'READY').length} thiết bị sẵn sàng`}
        chartType="bar"
        badgeColor="bg-indigo-50 text-indigo-700"
      />
      <StatsCard
        title="Sẵn sàng"
        value={readyCount}
        subtitle="Khả dụng nhận lệnh"
        icon={CheckCircle2}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-50"
        trendText={`${Math.round(((readyCount + executingCount) / (totalCount || 1)) * 100)}% online`}
        chartType="circle"
        badgeColor="bg-emerald-50 text-emerald-700"
      />
      <StatsCard
        title="Đang thực thi"
        value={executingCount}
        subtitle="Chạy tác vụ AI"
        icon={PlayCircle}
        iconColor="text-blue-600"
        iconBg="bg-blue-50"
        trendText="Đang điều phối"
        chartType="pulse"
        badgeColor="bg-blue-50 text-blue-700"
      />
      <StatsCard
        title="Gặp lỗi / Ngắt kết nối"
        value={errorCount}
        subtitle="Cần can thiệp"
        icon={AlertCircle}
        iconColor="text-rose-600"
        iconBg="bg-rose-50"
        trendText={errorCount > 0 ? "Cảnh báo" : "Ổn định"}
        badgeColor="bg-rose-50 text-rose-700"
      />
    </div>
  );
};
