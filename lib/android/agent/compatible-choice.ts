import { z } from 'zod';
import { commandMask, foldIntent } from './outcome-spec';
import type { AgentBudget } from './budget';
import type { JsonReasoner } from './ollama';

export interface ChoiceCandidate {
  id: string; action: string; actions?: string[]; role?: string; label?: string; effect?: string; ordinal?: number;
  sensitive?: boolean; destructive?: boolean; enabled?: boolean; editable?: boolean; sponsored?: boolean;
}
export interface ChoiceContext { kind: 'PLAN' | 'NEXT'; source: string; phase?: 'ACTIVATE' | 'ENTER' | 'CLEAR' | 'SUBMIT'; ambiguous?: boolean; stale?: boolean; foreign?: boolean; occluded?: boolean; consent?: boolean }
const unsafe = /\b(delete|erase|wipe|uninstall|remove|reset|format|overwrite|replace|empty|discard|send|call|purchase|pay|install|permission|consent|allow|xoa|go cai dat|gui|thanh toan|khoi phuc|ghi de)\b/;
const op = /\b(open|launch|start|mo|khoi chay|search|find|tim kiem|tim|tra cuu|loc|read|doc|select|chon|navigate)\b/g;
const actions = (text: string) => text.split('>').map(a => a.trim().split(/[ :]/)[0]).map(a => ({ READ: 'READ_VALUE', SELECT: 'SELECT_ITEM', ENTER: 'SET_VALUE' })[a] ?? a);
export function rankCompatible(context: ChoiceContext, candidates: readonly ChoiceCandidate[]) {
  const source = commandMask(context.source), original = context.source;
  const abstain = candidates.find(c => c.action === 'ABSTAIN')?.id ?? 'ABSTAIN';
  if (context.ambiguous || context.stale || context.foreign || context.occluded || context.consent || unsafe.test(source)) return { ids: [] as string[], abstain };
  const requested: string[] = [];
  for (const m of source.matchAll(op)) {
    if (/\b(do not|don't|never|without|khong(?: duoc)?|no)\s+$/.test(source.slice(0, m.index))) continue;
    requested.push(/open|launch|start|mo|khoi chay/.test(m[1]) ? 'OPEN_APP' : /search|find|tim|tra cuu|loc/.test(m[1]) ? 'SEARCH' : /read|doc/.test(m[1]) ? 'READ_VALUE' : /select|chon/.test(m[1]) ? 'SELECT_ITEM' : 'NAVIGATE_TO');
  }
  const ordinal = /\b(second|thu hai|thu 2)\b/.test(source) ? 2 : /\b(first|dau tien|thu 1)\b/.test(source) ? 1 : undefined;
  const desired = context.kind === 'NEXT' && ordinal !== undefined && /\b(open|mo|select|chon)\b/.test(source) ? 'SELECT_ITEM' : requested.at(-1);
  const scored = candidates.flatMap(c => {
    if (c.action === 'ABSTAIN' || c.sensitive || c.destructive || c.enabled === false || c.sponsored || c.effect === 'EXTERNAL' || unsafe.test(foldIntent(c.label ?? '').replace(/_/g, ' '))) return [];
    const seq = c.actions ?? actions(c.action);
    if (seq.some(a => !['OPEN_APP', 'NAVIGATE_TO', 'SEARCH', 'READ_VALUE', 'SELECT_ITEM', 'CLICK', 'SET_VALUE', 'IME_SEARCH', 'CLEAR', 'BACK', 'SCROLL'].includes(a))) return [];
    if (context.kind === 'PLAN') return requested.length && JSON.stringify(seq) === JSON.stringify(requested) ? [{ id: c.id, score: 10 }] : [];
    if (seq.length !== 1) return [];
    const a = seq[0], role = (c.role ?? '').toUpperCase();
    if (desired === 'READ_VALUE') return a === 'READ_VALUE' && c.effect !== 'LOCAL_WRITE' ? [{ id: c.id, score: 10 }] : [];
    if (desired === 'SELECT_ITEM') return a === 'SELECT_ITEM' && ordinal !== undefined && c.ordinal === ordinal ? [{ id: c.id, score: 10 }] : [];
    if (desired === 'SEARCH') {
      if (c.effect === 'LOCAL_WRITE') return [];
      const phase = context.phase ?? 'ACTIVATE';
      const expected = { ACTIVATE: 'CLICK', ENTER: 'SET_VALUE', CLEAR: 'CLEAR', SUBMIT: 'IME_SEARCH' }[phase];
      if (a !== expected) return [];
      return /SEARCH|ENTER|CLEAR|SUBMIT|ACTIVATE/.test(role) ? [{ id: c.id, score: 10 }] : [];
    }
    // Exact source-bound labels can rank navigation controls locally; labels are
    // never elevated to selectors, grants or independent outcome evidence.
    const label = foldIntent(c.label ?? '').trim();
    const target = foldIntent(original).replace(/^(?:xem|show|view|navigate(?: to)?|open|mo)\s+/, '').trim();
    return label && label.length <= 100 && (foldIntent(original).includes(label) || target.length >= 3 && label.startsWith(target)) && ['CLICK', 'BACK'].includes(a) && c.effect === 'READ' ? [{ id: c.id, score: 5 }] : [];
  });
  const top = Math.max(0, ...scored.map(c => c.score));
  return { ids: scored.filter(c => c.score === top).map(c => c.id), abstain };
}
export async function chooseCompatible<T>(schema: z.ZodType<T>, system: string, input: Record<string, unknown> & { candidates: ChoiceCandidate[] },
  context: ChoiceContext, reasoner: JsonReasoner, budget: AgentBudget, signal?: AbortSignal) {
  signal?.throwIfAborted(); budget.check();
  const ranked = rankCompatible(context, input.candidates), make = (id: string) => schema.parse({ choice: id, reason: 'Backend compatibility decision.' });
  // Schemas without a reason field remain strict; no extra field is forwarded.
  const decision = (id: string) => {
    const bare = schema.safeParse({ choice: id }); return bare.success ? bare.data : make(id);
  };
  if (!ranked.ids.length) return { decision: decision(ranked.abstain), skipped: true, abstained: true, rejected: false };
  if (ranked.ids.length === 1) { budget.profiling.singletonCandidatesSkipped++; return { decision: decision(ranked.ids[0]), skipped: true, abstained: false, rejected: false }; }
  const reduced = input.candidates.filter(c => ranked.ids.includes(c.id) || c.id === ranked.abstain);
  // Keep the caller's full schema validation; the provider cannot widen the set.
  let raw: T;
  try { raw = await reasoner.generate(schema, system, { request: context.source, commandRef: input.commandRef,
    candidates: reduced.map(c => ({ id: c.id, action: c.action, role: c.role, effect: c.effect, label: c.label?.slice(0, 100) })) }, budget, signal); }
  catch { signal?.throwIfAborted(); budget.check(); return { decision: decision(ranked.abstain), skipped: false, abstained: true, rejected: true }; }
  signal?.throwIfAborted(); budget.check();
  const parsed = schema.parse(raw), id = (parsed as { choice?: unknown }).choice;
  const fresh = rankCompatible(context, input.candidates);
  const unresolvedReadIdentity = context.kind === 'NEXT' && /\b(read|doc)\b/.test(commandMask(context.source)) && fresh.ids.length > 1;
  const accepted = !unresolvedReadIdentity && typeof id === 'string' && fresh.ids.includes(id);
  return { decision: accepted ? parsed : decision(fresh.abstain), skipped: false, abstained: !accepted, rejected: !accepted,
    rawChoice: typeof id === 'string' && (input.candidates.some(c => c.id === id) || id === ranked.abstain) ? id : undefined };
}
export function compatibleReasoner(context: ChoiceContext, reasoner: JsonReasoner): JsonReasoner {
  return { async generate(schema, system, input, budget, signal) {
    if (!input || typeof input !== 'object' || !('candidates' in input) || !Array.isArray(input.candidates)) throw Error('Missing backend candidate context.');
    return (await chooseCompatible(schema, system, input as Record<string, unknown> & { candidates: ChoiceCandidate[] }, context, reasoner, budget, signal)).decision;
  } };
}
