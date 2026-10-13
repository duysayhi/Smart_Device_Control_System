import React from 'react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  trendText?: string;
  chartType?: 'bar' | 'circle' | 'pulse';
  badgeColor?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor,
  iconBg,
  trendText,
  chartType = 'bar',
  badgeColor,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
      <div className="flex items-center gap-3.5">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", iconBg)}>
          <Icon className={cn("w-6 h-6", iconColor)} />
        </div>
        <div>
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block">
            {title}
          </span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-bold text-slate-900 tracking-tight">
              {value}
            </span>
            {trendText && (
              <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded", badgeColor || "bg-slate-100 text-slate-600")}>
                {trendText}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Mini Visual Chart Element */}
      <div className="shrink-0 flex items-end gap-1 h-9 px-2">
        {chartType === 'bar' && (
          <div className="flex items-end gap-1 h-8">
            <span className="w-1.5 bg-slate-200 rounded-t h-3"></span>
            <span className="w-1.5 bg-indigo-300 rounded-t h-5"></span>
            <span className="w-1.5 bg-indigo-400 rounded-t h-4"></span>
            <span className="w-1.5 bg-indigo-500 rounded-t h-7"></span>
            <span className="w-1.5 bg-indigo-600 rounded-t h-8"></span>
          </div>
        )}
        {chartType === 'circle' && (
          <div className="w-8 h-8 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin-slow flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
        )}
        {chartType === 'pulse' && (
          <div className="flex items-center gap-1.5 py-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse delay-100"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-300 animate-pulse delay-200"></span>
          </div>
        )}
      </div>
    </div>
  );
};
