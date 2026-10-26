'use client';
import type { KeyboardEvent } from 'react';
import type { EngineId } from '@/lib/android/unified-agent/contracts';

interface Props { value: EngineId | ''; disabled: boolean; onChange(value: EngineId | ''): void }
export function CommandEngineControl({ value, disabled, onChange }: Props) {
  const actionPlan = value === 'ACTION_PLAN';
  function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || disabled) return;
    event.preventDefault();
    const next = event.key === 'Home' ? true : event.key === 'End' ? false : !actionPlan;
    if (next !== actionPlan) onChange(next ? 'ACTION_PLAN' : '');
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(next ? '#command-tab-plan' : '#command-tab-goal')?.focus();
  }
  return <div className="space-y-3">
    <div role="tablist" aria-label="Chế độ điều khiển" className="flex gap-5 border-b border-slate-200 text-xs">
      <button id="command-tab-plan" type="button" role="tab" aria-selected={actionPlan} aria-controls="unified-command-surface" tabIndex={actionPlan ? 0 : -1}
        disabled={disabled} onKeyDown={moveTab} onClick={() => { if (!actionPlan) onChange('ACTION_PLAN'); }}
        className={`border-b-2 py-2 font-medium disabled:opacity-50 ${actionPlan ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Action Plan</button>
      <button id="command-tab-goal" type="button" role="tab" aria-selected={!actionPlan} aria-controls="unified-command-surface" tabIndex={actionPlan ? -1 : 0}
        disabled={disabled} onKeyDown={moveTab} onClick={() => { if (actionPlan) onChange(''); }}
        className={`border-b-2 py-2 font-medium disabled:opacity-50 ${!actionPlan ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Goal Agent</button>
    </div>
    {!actionPlan && <fieldset disabled={disabled} aria-label="Engine Goal Agent" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
      {([['', 'Tự động'], ['V1', 'Agent V1'], ['V2', 'Agent V2']] as const).map(([engine, label]) => <label key={engine} className="flex items-center gap-1.5">
        <input type="radio" name="unified-agent-engine" value={engine} checked={value === engine} onChange={() => onChange(engine)} className="accent-indigo-600" />{label}
      </label>)}
    </fieldset>}
  </div>;
}
