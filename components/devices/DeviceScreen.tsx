'use client';

import React from 'react';
import { 
  Wifi, 
  Battery, 
  Search, 
  Heart, 
  MessageCircle, 
  Share2, 
  Compass, 
  Navigation, 
  Settings, 
  Play, 
  Bell,
  Volume2,
  Lock,
  WifiOff
} from 'lucide-react';
import { Device, ScreenAppType } from '@/types/device';
import { cn } from '@/lib/utils';

interface DeviceScreenProps {
  device: Device;
  interactive?: boolean;
  onTap?: () => void;
  className?: string;
}

export const DeviceScreen: React.FC<DeviceScreenProps> = ({
  device,
  interactive = false,
  onTap,
  className
}) => {
  const [screenshotFailed, setScreenshotFailed] = React.useState(false);
  const isOffline = device.status === 'OFFLINE' || device.status === 'UNAUTHORIZED';
  const isExecuting = device.status === 'EXECUTING';

  React.useEffect(() => {
    setScreenshotFailed(false);
  }, [device.screenshotUrl]);

  return (
    <div 
      onClick={onTap}
      className={cn(
        "relative w-full aspect-[9/19.5] bg-slate-950 rounded-[28px] p-2.5 shadow-inner border-4 border-slate-800 flex flex-col justify-between overflow-hidden select-none transition-all",
        interactive && "cursor-pointer hover:border-indigo-500/50",
        className
      )}
    >
      {/* 1. Màn hình điện thoại thực tế (Inner Screen) */}
      <div className="relative w-full h-full bg-slate-900 rounded-[20px] overflow-hidden flex flex-col text-white font-sans">
        
        {/* Hardware Notch / Dynamic Island / Punch Hole */}
        <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 z-30 ${device.screenshotUrl ? 'hidden' : ''}`}>
          {device.platform === 'ios' ? (
            // Dynamic Island
            <div className="w-20 h-4 bg-black rounded-full flex items-center justify-between px-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500/80"></span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
            </div>
          ) : (
            // Android Camera Punch Hole
            <div className="w-3.5 h-3.5 bg-black rounded-full border border-slate-800 shadow-sm" />
          )}
        </div>

        {/* Status Bar */}
        <div className={`h-6 px-3.5 pt-1 flex items-center justify-between text-[10px] text-slate-300 font-medium z-20 shrink-0 ${device.screenshotUrl ? 'hidden' : ''}`}>
          <span>{device.platform === 'ios' ? '9:41' : '10:24'}</span>
          <div className="flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-slate-300" />
            <div className="flex items-center gap-0.5">
              <span className="text-[9px]">{device.batteryLevel === undefined ? '—' : `${device.batteryLevel}%`}</span>
              <Battery className="w-3.5 h-3.5 text-slate-200" />
            </div>
          </div>
        </div>

        {/* Main Display Body (Simulating App UI) */}
        <div className="flex-1 relative overflow-hidden flex flex-col bg-slate-900">
          {device.screenshotUrl && !screenshotFailed ? (
            <img
              src={device.screenshotUrl}
              alt={`Màn hình thật của ${device.name}`}
              className="absolute inset-0 h-full w-full object-contain bg-black"
              onError={() => setScreenshotFailed(true)}
            />
          ) : device.isLive ? (
            <div className="flex flex-1 items-center justify-center p-3 text-center text-[10px] text-slate-400">
              Không đọc được ảnh màn hình ADB
            </div>
          ) : renderAppContent(device)}

          {/* Executing Overlay Indicator */}
          {isExecuting && (
            <div className="absolute inset-0 bg-indigo-950/40 backdrop-blur-[1px] flex flex-col items-center justify-center p-3 z-20 text-center animate-fade-in">
              <div className="w-10 h-10 rounded-full bg-indigo-600/90 border border-indigo-400 flex items-center justify-center text-white mb-2 shadow-lg animate-pulse">
                <Play className="w-5 h-5 ml-0.5 text-white fill-white" />
              </div>
              <span className="text-xs font-semibold text-white drop-shadow">
                AI Đang Điều Khiển
              </span>
              <span className="text-[10px] text-indigo-200 mt-0.5 max-w-[140px] truncate">
                {device.currentActionText || `Bước ${device.currentStep || 1}/${device.totalSteps || 5}`}
              </span>
              {/* Active Step Progress */}
              <div className="w-24 bg-indigo-900/80 rounded-full h-1 mt-2 overflow-hidden">
                <div 
                  className="bg-indigo-400 h-1 rounded-full transition-all duration-300"
                  style={{ width: `${((device.currentStep || 1) / (device.totalSteps || 5)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Offline Overlay */}
          {isOffline && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 z-20 text-center">
              <WifiOff className="w-8 h-8 text-slate-400 mb-2" />
              <span className="text-xs font-medium text-slate-300">
                Mất kết nối thiết bị
              </span>
              <span className="text-[10px] text-slate-500 mt-1">
                {device.status === 'UNAUTHORIZED'
                  ? 'Chấp thuận lời nhắc gỡ lỗi USB trên điện thoại'
                  : 'Kiểm tra cáp USB hoặc Wi-Fi'}
              </span>
            </div>
          )}
        </div>

        {/* Phone Gesture Navigation Bar */}
        <div className={`h-4 flex items-center justify-center shrink-0 ${device.screenshotUrl ? 'hidden' : ''}`}>
          <div className="w-16 h-1 bg-white/40 rounded-full"></div>
        </div>
      </div>
    </div>
  );
};

// Simulated Application UIs
function renderAppContent(device: Device) {
  switch (device.screenPreview) {
    case 'youtube':
      return (
        <div className="flex-1 flex flex-col bg-slate-900 text-white p-2">
          {/* Header */}
          <div className="flex items-center justify-between py-1 border-b border-slate-800">
            <div className="flex items-center gap-1">
              <span className="w-4 h-3 bg-red-600 rounded-sm flex items-center justify-center">
                <Play className="w-2 h-2 text-white fill-white" />
              </span>
              <span className="text-[11px] font-bold tracking-tight">YouTube</span>
            </div>
            <Search className="w-3.5 h-3.5 text-slate-400" />
          </div>

          {/* Video Thumbnail */}
          <div className="mt-2 relative rounded-lg overflow-hidden bg-slate-800 aspect-video flex items-center justify-center border border-slate-700/60">
            <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 to-indigo-950 opacity-90" />
            <div className="relative text-center p-2">
              <span className="text-[10px] font-bold text-indigo-400 block">OpenAI DevDay</span>
              <span className="text-[8px] text-slate-300">Keynote 2024 Showcase</span>
            </div>
            <span className="absolute bottom-1 right-1 text-[8px] px-1 bg-black/80 rounded text-slate-300 font-mono">14:20</span>
          </div>

          {/* Video Meta */}
          <div className="mt-2 flex gap-2">
            <div className="w-6 h-6 rounded-full bg-emerald-700 flex items-center justify-center text-[9px] font-bold shrink-0">
              AI
            </div>
            <div>
              <div className="text-[9px] font-semibold text-slate-200 line-clamp-1">
                Giới thiệu tính năng AI Agent tự động
              </div>
              <div className="text-[8px] text-slate-400">
                OpenAI · 2.4M lượt xem
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="mt-auto py-1 px-1 bg-slate-950/60 rounded-md flex justify-around text-[9px] text-slate-400">
            <span className="text-indigo-400 font-medium">Trang chủ</span>
            <span>Shorts</span>
            <span>Đăng ký</span>
          </div>
        </div>
      );

    case 'tiktok':
      return (
        <div className="flex-1 relative bg-gradient-to-b from-indigo-950 via-slate-900 to-black flex flex-col justify-between p-2">
          {/* Top Bar */}
          <div className="flex justify-center gap-3 text-[10px] font-semibold pt-1">
            <span className="text-slate-400">Đang Follow</span>
            <span className="text-white border-b-2 border-white pb-0.5">Dành cho bạn</span>
          </div>

          {/* Center Graphic */}
          <div className="text-center my-auto">
            <div className="w-12 h-12 mx-auto rounded-full bg-gradient-to-tr from-pink-500 to-cyan-400 p-0.5 flex items-center justify-center mb-1">
              <div className="w-full h-full bg-black rounded-full flex items-center justify-center">
                <Play className="w-5 h-5 text-white ml-0.5" />
              </div>
            </div>
            <span className="text-[10px] font-semibold text-slate-200 block">#TechTrends2025</span>
          </div>

          {/* Right Floating Controls */}
          <div className="absolute right-2 bottom-12 flex flex-col items-center gap-2.5 text-white">
            <div className="w-7 h-7 rounded-full bg-slate-800/80 flex items-center justify-center">
              <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            </div>
            <div className="w-7 h-7 rounded-full bg-slate-800/80 flex items-center justify-center">
              <MessageCircle className="w-3.5 h-3.5 text-slate-300" />
            </div>
            <div className="w-7 h-7 rounded-full bg-slate-800/80 flex items-center justify-center">
              <Share2 className="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>

          {/* Bottom Video Info */}
          <div className="pr-10 text-left">
            <span className="text-[10px] font-bold text-white block">@tech_commander</span>
            <span className="text-[8px] text-slate-300 line-clamp-1">Điều khiển thiết bị di động bằng AI tự động hoá</span>
          </div>
        </div>
      );

    case 'maps':
      return (
        <div className="flex-1 flex flex-col bg-slate-900 text-white relative">
          {/* Simulated Map View */}
          <div className="absolute inset-0 bg-[#1e293b] flex items-center justify-center opacity-80">
            <div className="w-full h-full relative overflow-hidden">
              {/* Map grid lines */}
              <div className="absolute inset-0 grid grid-cols-4 grid-rows-6 border border-slate-700/40 opacity-40" />
              {/* Route line */}
              <div className="absolute top-1/4 left-1/3 w-28 h-28 border-l-4 border-b-4 border-indigo-400 rounded-bl-3xl" />
              {/* Landmark Pin */}
              <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1">
                <div className="w-4 h-4 rounded-full bg-rose-500 border-2 border-white flex items-center justify-center shadow-lg animate-bounce" />
                <span className="text-[8px] font-bold bg-slate-900/90 px-1 py-0.5 rounded text-white border border-slate-700">
                  Landmark 81
                </span>
              </div>
            </div>
          </div>

          {/* Search Header */}
          <div className="relative p-2 z-10">
            <div className="bg-slate-800/90 backdrop-blur rounded-lg px-2 py-1.5 flex items-center gap-1.5 border border-slate-700 text-[9px]">
              <Search className="w-3 h-3 text-slate-400" />
              <span className="text-slate-200">Landmark 81 TP.HCM</span>
            </div>
          </div>

          {/* Navigation Card */}
          <div className="relative mt-auto p-2 z-10">
            <div className="bg-slate-800/95 rounded-xl p-2 border border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-400 block">18 phút (7.2 km)</span>
                <span className="text-[8px] text-slate-300">Tuyến đường nhanh nhất</span>
              </div>
              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center">
                <Navigation className="w-3 h-3 text-white" />
              </div>
            </div>
          </div>
        </div>
      );

    case 'settings':
      return (
        <div className="flex-1 bg-slate-900 p-2.5 text-white flex flex-col">
          <div className="text-[11px] font-bold pb-2 border-b border-slate-800 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            <span>Cài đặt hệ thống</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="bg-slate-800/80 p-1.5 rounded-lg flex items-center justify-between text-[9px]">
              <span className="text-slate-200">Wi-Fi</span>
              <span className="text-indigo-400 font-medium">Commander-5G</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded-lg flex items-center justify-between text-[9px]">
              <span className="text-slate-200">Gỡ lỗi USB (ADB)</span>
              <span className="text-rose-400 font-medium">Lỗi kết nối</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded-lg flex items-center justify-between text-[9px]">
              <span className="text-slate-200">Pin & Nguồn</span>
              <span className="text-slate-400">15% - Tiết kiệm pin</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded-lg flex items-center justify-between text-[9px]">
              <span className="text-slate-200">Thông tin thiết bị</span>
              <span className="text-slate-400">Android 14</span>
            </div>
          </div>
        </div>
      );

    case 'home':
    default:
      return (
        <div className="flex-1 bg-gradient-to-b from-slate-900 to-indigo-950 p-3 flex flex-col justify-between">
          <div className="text-center mt-4">
            <div className="text-2xl font-light text-white tracking-tight">10:24</div>
            <div className="text-[9px] text-indigo-300">Thứ Năm, 9 tháng 10</div>
          </div>

          {/* Grid of app icons */}
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-xl bg-red-500 flex items-center justify-center shadow-md">
                <Play className="w-4 h-4 text-white fill-white" />
              </div>
              <span className="text-[8px] text-slate-300">YouTube</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-xl bg-black border border-slate-700 flex items-center justify-center shadow-md">
                <Compass className="w-4 h-4 text-cyan-400" />
              </div>
              <span className="text-[8px] text-slate-300">TikTok</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shadow-md">
                <Navigation className="w-4 h-4 text-white" />
              </div>
              <span className="text-[8px] text-slate-300">Maps</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center shadow-md">
                <Settings className="w-4 h-4 text-slate-200" />
              </div>
              <span className="text-[8px] text-slate-300">Cài đặt</span>
            </div>
          </div>
        </div>
      );
  }
}
