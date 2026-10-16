'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceTask, RuntimeCommandValue } from '@/lib/android/agent/runtime-schema';
export interface AgentRuntimeControl {
  tasks: DeviceTask[]; error?: string; reasoning?: { running: number; waiting: number };
  command(command: RuntimeCommandValue): Promise<void>;
}
export function useAgentRuntimes(): AgentRuntimeControl {
  const [tasks, setTasks] = useState<DeviceTask[]>([]), [error, setError] = useState<string>();
  const [reasoning, setReasoning] = useState<AgentRuntimeControl['reasoning']>();
  const requested = useRef(0), applied = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requested.current;
    const reply = await fetch('/api/agent/runtime', { cache: 'no-store', signal });
    const body = await reply.json(); if (!reply.ok) throw new Error(body.error ?? 'Runtime unavailable.');
    if (sequence >= applied.current) {
      applied.current = sequence; setTasks(body.tasks); setReasoning(body.reasoning); setError(undefined);
    }
    return body.tasks as DeviceTask[];
  }, []);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const cancel = new AbortController();
    const poll = async () => {
      let delay = 5000;
      try { const current = await refresh(cancel.signal); if (current.some(task => !task.finishedAt)) delay = 2000; }
      catch (error) { if (active) setError(error instanceof Error ? error.message : 'Runtime unavailable.'); }
      if (active) timer = setTimeout(poll, document.hidden ? 15000 : delay);
    };
    void poll(); return () => { active = false; cancel.abort(); clearTimeout(timer); };
  }, [refresh]);
  const command = useCallback(async (command: RuntimeCommandValue) => {
    const reply = await fetch('/api/agent/runtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    const body = await reply.json();
    if (!reply.ok || body.accepted === false) throw new Error(body.error ?? 'Tác vụ đã kết thúc hoặc xác nhận không còn hợp lệ.');
    await refresh();
  }, [refresh]);
  return { tasks, error, reasoning, command };
}
