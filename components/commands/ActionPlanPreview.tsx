'use client';

import React from 'react';
import { FileJson, Copy, Check, Terminal, AlertTriangle, Cpu } from 'lucide-react';
import { ActionPlan, PlanStatus } from '@/types/command';
import { cn } from '@/lib/utils';

interface ActionPlanPreviewProps {
  plan: ActionPlan | null;
  status: PlanStatus;
  errorMessage: string | null;
}

export const ActionPlanPreview: React.FC<ActionPlanPreviewProps> = ({
  plan,
  status,
  errorMessage,
}) => {
  const [copied, setCopied] = React.useState(false);

  const jsonString = plan
    ? JSON.stringify({
      ...(plan.intent ? { intent: plan.intent } : {}),
      ...(plan.isSensitive !== undefined ? { isSensitive: plan.isSensitive } : {}),
      actions: plan.actions,
    }, null, 2)
    : '';

  const handleCopy = () => {
    if (!jsonString) return;
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden text-slate-200">
      {/* Header bar: Title + Status + Copy */}
      <div className="px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-200">
            Action Plan (AI phân tích)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {status === 'SUCCESS' && plan && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
              {plan.actions.length} bước
            </span>
          )}

          {status === 'SUCCESS' && (
            <button
              onClick={handleCopy}
              title="Sao chép JSON"
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition flex items-center gap-1 text-[10px]"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Đã chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="p-3 font-mono text-[11px] leading-relaxed max-h-[175px] min-h-[140px] overflow-y-auto">
        {status === 'IDLE' && (
          <div className="h-full min-h-[110px] flex flex-col items-center justify-center text-center text-slate-500">
            <Cpu className="w-6 h-6 mb-1.5 opacity-40" />
            <p className="text-xs font-medium">Chưa có Action Plan</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              Nhập câu lệnh và nhấn &quot;Phân tích&quot; để sinh kịch bản thực thi.
            </p>
          </div>
        )}

        {status === 'ANALYZING' && (
          <div className="h-full min-h-[110px] flex flex-col items-center justify-center text-center text-indigo-400">
            <span className="inline-block w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-xs font-medium text-slate-300">Đang phân tích cấu trúc lệnh...</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Mô hình AI đang bóc tách intent & UI element</p>
          </div>
        )}

        {status === 'FAILED' && (
          <div className="h-full min-h-[110px] flex flex-col items-center justify-center text-center text-rose-400">
            <AlertTriangle className="w-6 h-6 mb-1 text-rose-500" />
            <p className="text-xs font-semibold">Phân tích thất bại</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{errorMessage || 'Không thể phân tích câu lệnh.'}</p>
          </div>
        )}

        {status === 'SUCCESS' && plan && (
          <pre className="text-emerald-400 font-mono whitespace-pre-wrap selection:bg-indigo-700 selection:text-white">
            <code>
              {highlightJson(jsonString)}
            </code>
          </pre>
        )}
      </div>

      {/* Footer Info */}
      {status === 'SUCCESS' && plan && (
        <div className="px-3 py-1.5 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
          {plan.estimatedDurationSec !== undefined && (
            <span>Ước tính: ~{plan.estimatedDurationSec}s</span>
          )}
          <span className="text-indigo-400 font-medium">Sẵn sàng thực thi</span>
        </div>
      )}
    </div>
  );
};

// Simple syntax highlighting representation for clean rendering
function highlightJson(json: string): React.ReactNode {
  return json;
}
