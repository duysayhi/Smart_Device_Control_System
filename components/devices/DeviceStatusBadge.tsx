import React from 'react';
import { DeviceStatus } from '@/types/device';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface DeviceStatusBadgeProps {
  status: DeviceStatus;
  currentStep?: number;
  totalSteps?: number;
  className?: string;
}

export const DeviceStatusBadge: React.FC<DeviceStatusBadgeProps> = ({
  status,
  currentStep,
  totalSteps,
  className
}) => {
  switch (status) {
    case 'READY':
      return (
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60",
          className
        )}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          READY
        </span>
      );

    case 'EXECUTING':
    case 'BUSY':
      return (
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60 shadow-xs",
          className
        )}>
          <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
          EXECUTING {currentStep && totalSteps ? `(${currentStep}/${totalSteps})` : ''}
        </span>
      );

    case 'DETECTED':
    case 'CONNECTING':
      return (
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60",
          className
        )}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
          CONNECTING
        </span>
      );

    case 'ERROR':
    case 'FAILED':
    case 'UNAUTHORIZED':
      return (
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60",
          className
        )}>
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {status}
        </span>
      );

    case 'OFFLINE':
    default:
      return (
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200",
          className
        )}>
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          OFFLINE
        </span>
      );
  }
};
