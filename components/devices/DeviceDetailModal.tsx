'use client';

import React from 'react';
import { 
  X, 
  Home, 
  ArrowLeft, 
  ChevronUp, 
  ChevronDown, 
  Camera, 
  Type, 
  RotateCw, 
  Power,
  Volume2,
  VolumeX,
  Battery,
  Wifi,
  Usb,
  Smartphone
} from 'lucide-react';
import { Device } from '@/types/device';
import { DeviceScreen } from './DeviceScreen';
import { DeviceStatusBadge } from './DeviceStatusBadge';

interface DeviceDetailModalProps {
  device: Device | null;
  isOpen: boolean;
  onClose: () => void;
  onSimulateAction?: (deviceId: string, actionName: string) => void;
}

export const DeviceDetailModal: React.FC<DeviceDetailModalProps> = ({
  device,
  isOpen,
  onClose,
  onSimulateAction,
}) => {
  const [inputText, setInputText] = React.useState('');
  const [feedbackMessage, setFeedbackMessage] = React.useState<string | null>(null);

  if (!isOpen || !device) return null;

  const triggerControl = (actionName: string) => {
    setFeedbackMessage(`Đã gửi lệnh thủ công: ${actionName}`);
    if (onSimulateAction) {
      onSimulateAction(device.id, actionName);
    }
    setTimeout(() => {
      setFeedbackMessage(null);
    }, 2500);
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    triggerControl(`Nhập văn bản: "${inputText}"`);
    setInputText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div 
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  {device.name}
                </h3>
                <DeviceStatusBadge status={device.status} />
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Serial: <span className="font-mono text-slate-600">{device.serial}</span> · IP: <span className="font-mono text-slate-600">{device.ipAddress || 'Không có dữ liệu'}</span> · {device.osVersion}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Đóng chi tiết thiết bị"
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Left Phone View + Right Manual Controls */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          
          {/* Left: Phone Screen View Enlarged */}
          <div className="md:col-span-5 flex flex-col items-center justify-center">
            <div className="w-full max-w-[260px] drop-shadow-xl">
              <DeviceScreen device={device} interactive={false} />
            </div>
            <span className="text-[11px] text-slate-400 mt-3 font-medium">
              {device.isLive ? 'Ảnh chụp màn hình qua ADB' : 'Màn hình mô phỏng'}
            </span>
          </div>

          {/* Right: Manual Control Toolbar & Device Diagnostics */}
          <div className="md:col-span-7 flex flex-col gap-5">
            {feedbackMessage && (
              <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-semibold text-indigo-700 animate-fade-in flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                <span>{feedbackMessage}</span>
              </div>
            )}

            {/* Hardware Controls */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                Thao tác phím điều hướng hệ thống
              </h4>
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  onClick={() => triggerControl('Phím Back (Quay lại)')}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 border border-slate-200 rounded-lg text-slate-700 text-xs font-medium transition shadow-xs"
                >
                  <ArrowLeft className="w-4 h-4 mb-1" />
                  <span>Quay lại (Back)</span>
                </button>
                <button
                  onClick={() => triggerControl('Phím Home (Màn hình chính)')}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 border border-slate-200 rounded-lg text-slate-700 text-xs font-medium transition shadow-xs"
                >
                  <Home className="w-4 h-4 mb-1" />
                  <span>Trang chủ (Home)</span>
                </button>
                <button
                  onClick={() => triggerControl('Chụp màn hình (Screenshot)')}
                  className="flex flex-col items-center justify-center p-2.5 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 border border-slate-200 rounded-lg text-slate-700 text-xs font-medium transition shadow-xs"
                >
                  <Camera className="w-4 h-4 mb-1" />
                  <span>Chụp màn hình</span>
                </button>
              </div>

              {/* Touch Gestures: Vuốt lên / Vuốt xuống */}
              <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                <button
                  onClick={() => triggerControl('Vuốt lên (Swipe Up)')}
                  className="flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 border border-slate-200 rounded-lg text-slate-700 text-xs font-medium transition shadow-xs"
                >
                  <ChevronUp className="w-4 h-4" />
                  <span>Vuốt lên (Scroll Up)</span>
                </button>
                <button
                  onClick={() => triggerControl('Vuốt xuống (Swipe Down)')}
                  className="flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 border border-slate-200 rounded-lg text-slate-700 text-xs font-medium transition shadow-xs"
                >
                  <ChevronDown className="w-4 h-4" />
                  <span>Vuốt xuống (Scroll Down)</span>
                </button>
              </div>
            </div>

            {/* Text Input Simulation */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Type className="w-4 h-4 text-indigo-600" />
                <span>Nhập văn bản từ xa (Remote Text Input)</span>
              </h4>
              <form onSubmit={handleSendText} className="flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Gõ văn bản muốn truyền vào thiết bị..."
                  className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition shrink-0"
                >
                  Gửi vào máy
                </button>
              </form>
            </div>

            {/* Device Diagnostic Details */}
            <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Thông số kỹ thuật & Cổng kết nối
              </h4>
              <div className="grid grid-cols-2 gap-y-2 text-xs text-slate-600">
                <div>Pin & Nguồn: <strong className="text-slate-800">{device.batteryLevel === undefined ? 'Không có dữ liệu' : `${device.batteryLevel}%`}</strong></div>
                <div>Kiểu kết nối: <strong className="text-slate-800">{device.connectionType}</strong></div>
                <div>Độ phân giải: <strong className="text-slate-800">{device.resolution}</strong></div>
                <div>Hệ điều hành: <strong className="text-slate-800">{device.osVersion}</strong></div>
                <div>Địa chỉ IP: <strong className="text-slate-800 font-mono">{device.ipAddress || 'Không có dữ liệu'}</strong></div>
                <div>Hoạt động gần nhất: <strong className="text-slate-800">{device.lastActive || 'Không có dữ liệu'}</strong></div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Sẵn sàng tích hợp luồng H.264/WebRTC khi cắm thiết bị thật.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition"
          >
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  );
};
