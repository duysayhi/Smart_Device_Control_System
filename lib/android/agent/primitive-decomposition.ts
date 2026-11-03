import { z } from 'zod';
import { commandMask, foldIntent, understandOutcomes, OutcomeSpecV2Schema, registerReviewedOutcomes, type OutcomeV2 } from './outcome-spec';
import { compileOutcomes } from './goal-compiler';
import { GoalGraphV2Schema } from './goal-graph';
import type { AgentBudget } from './budget';
import type { JsonReasoner } from './ollama';
import { sourceSlots, sourcePrimitiveFamilies, type SourceSlot, type PlanningApp } from './source-slots';
import { maximalValueSpan } from './source-value';

export const Primitive = z.enum(['OPEN_APP', 'NAVIGATE_TO', 'SEARCH', 'SET_VALUE', 'TOGGLE', 'SELECT_ITEM', 'READ_VALUE', 'CREATE_RECORD', 'CONFIRM']);
export const primitiveCatalog = Object.freeze({
  OPEN_APP: { kind: 'LAUNCH', effect: 'READ', verifier: ['FOREGROUND_IS'], evidence: ['INSTALLED_APP_IDENTITY'], implemented: true },
  NAVIGATE_TO: { kind: 'NAVIGATE', effect: 'READ', verifier: ['ELEMENT_VISIBLE'], evidence: ['OBSERVED_NAVIGATION'], implemented: true },
  SEARCH: { kind: 'SEARCH', effect: 'READ', verifier: ['SEARCH_OUTCOME_MATCHES'], evidence: ['SEARCH_FIELD', 'COMMITTED_QUERY', 'RESULT_SURFACE'], implemented: true },
  TOGGLE: { kind: 'SET_STATE', effect: 'LOCAL_WRITE', verifier: ['ITEM_SELECTED'], evidence: ['UNIQUE_CHECKABLE', 'EXPLICIT_DESIRED_STATE'], implemented: true },
  CREATE_RECORD: { kind: 'CREATE_RECORD', effect: 'LOCAL_WRITE', verifier: ['RECORD_READBACK_MATCHES'], evidence: ['NEW_RECORD_SCOPE', 'REOPEN_READBACK'], implemented: true },
  SET_VALUE: { kind: 'UNKNOWN', effect: 'LOCAL_WRITE', verifier: ['WIDGET_STATE'], evidence: ['FIELD_IDENTITY', 'NEW_OR_EXPLICIT_REPLACE_SCOPE'], implemented: false },
  SELECT_ITEM: { kind: 'UNKNOWN', effect: 'LOCAL_WRITE', verifier: ['WIDGET_STATE'], evidence: ['EXACT_ITEM_IDENTITY', 'SELECTION_SCOPE'], implemented: false },
  READ_VALUE: { kind: 'UNKNOWN', effect: 'READ', verifier: ['ELEMENT_TEXT_PRESENT'], evidence: ['UNIQUE_VALUE_ROLE', 'INDEPENDENT_READBACK'], implemented: false },
  CONFIRM: { kind: 'UNKNOWN', effect: 'LOCAL_WRITE', verifier: [], evidence: ['PARENT_MUTATION_CONTRACT'], implemented: false },
} as const);
const Span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict();
export const PrimitiveDecompositionSchema = z.object({ steps: z.array(z.object({ primitive: Primitive, source: Span,
  target: Span.nullable(), value: Span.nullable(), negated: z.boolean(), dependencies: z.array(z.number().int().nonnegative()).max(8) }).strict()).min(1).max(12) }).strict();
export type PrimitiveProposal = ReturnType<typeof validatePrimitiveDecomposition>;
const issued = new WeakMap<object, string>();
const syntaxGap = (text: string) => !foldIntent(text).replace(/\b(?:va|roi|de|to|sau do|nhung|and|then|but)\b/g, '').replace(/[\s,;.!?]/g, '');

export function validatePrimitiveDecomposition(request: string, raw: unknown) {
  if (request !== request.normalize('NFC').trim() || !request || request.length > 2000) throw Error('Canonical bounded source required.');
  const proposal = PrimitiveDecompositionSchema.parse(raw), original = understandOutcomes(request);
  let end = 0;
  const outcomes: OutcomeV2[] = proposal.steps.map((step, index) => {
    if (step.source.start < end || step.source.end > request.length || step.source.end <= step.source.start || !syntaxGap(request.slice(end, step.source.start)) ||
      new Set(step.dependencies).size !== step.dependencies.length || step.dependencies.some(i => i >= index)) throw Error('DECOMPOSITION_COVERAGE_OR_DEPENDENCY');
    const text = request.slice(step.source.start, step.source.end); end = step.source.end;
    const readSlot = (slot: z.infer<typeof Span> | null) => {
      if (!slot) return undefined;
      if (slot.start < step.source.start || slot.end > step.source.end || slot.end <= slot.start || !request.slice(slot.start, slot.end).trim()) throw Error('SOURCE_SLOT_OUTSIDE_PARENT');
      return request.slice(slot.start, slot.end);
    };
    const target = readSlot(step.target), value = readSlot(step.value), binding = primitiveCatalog[step.primitive];
    if (value && ['SEARCH', 'SET_VALUE', 'CREATE_RECORD'].includes(step.primitive) && !/["'\u201c]/.test(text)) {
      const full = maximalValueSpan(text, commandMask(text), step.primitive)!;
      const before = text.slice(full.start, step.value!.start - step.source.start), after = text.slice(step.value!.end - step.source.start, full.end);
      const qualifiedTarget = target && step.target && /\b(in|on|trong|tren)\s+$/.test(commandMask(text.slice(0, step.target.start - step.source.start)));
      if ((before.trim() || after.trim()) && !qualifiedTarget) throw Error('SOURCE_VALUE_NOT_MAXIMAL: incomplete unquoted value.');
      if (qualifiedTarget && !commandMask(before + after).replace(commandMask(target!), '').replace(/\b(in|on|trong|tren|for|ve|voi tu khoa|tu khoa|noi dung)\b/g, '').trim().match(/^$/)) throw Error('SOURCE_VALUE_NOT_MAXIMAL: ambiguous qualifier remainder.');
    }
    const chosen = step.primitive === 'SEARCH' || step.primitive === 'CREATE_RECORD' || step.primitive === 'SET_VALUE' ? value : target;
    if (!chosen) throw Error('REQUIRED_SOURCE_SLOT_MISSING');
    const masked = commandMask(text), negated = /\b(khong(?: duoc)?|dung|do not|don't|never)\b/.test(masked);
    if (/[;]|\b(and|then|but|va|roi|sau do|nhung)\b/.test(masked)) throw Error('UNDECOMPOSED_COMPOUND_OUTCOME');
    if (negated !== step.negated) throw Error('SOURCE_NEGATION_CHANGED');
    if (/\b(delete|erase|wipe|uninstall|remove|reset|format|overwrite|replace|clear|xoa|ghi de|go cai dat|send|share|pay|gui|chia se|thanh toan|dang bai)\b/.test(masked)) throw Error('DESTRUCTIVE_OR_EXTERNAL_EFFECT_NOT_BINDABLE');
    let actionOnly = masked;
    for (const slot of [step.target, step.value].filter((s): s is z.infer<typeof Span> => Boolean(s))) {
      const a = slot.start - step.source.start, b = slot.end - step.source.start;
      actionOnly = actionOnly.slice(0, a) + ' '.repeat(b - a) + actionOnly.slice(b);
    }
    // Values are already exact, maximal and inside the parent span. Inspect action
    // syntax rather than treating a word inside a query as another requested effect.
    if (binding.effect === 'READ' && /\b(tao|them|luu|chup|bat|tat|create|save|capture|enable|disable|set|select|toggle)\b/.test(actionOnly)) throw Error('READ_PRIMITIVE_HIDES_MUTATION');
    if (step.primitive === 'OPEN_APP' && /\b(search|find|look for|tim|tra cuu|view|show|xem|tinh|calculate)\b/.test(actionOnly) ||
      step.primitive === 'NAVIGATE_TO' && /\b(search|find|look for|tim|tra cuu|tinh|calculate)\b/.test(actionOnly)) throw Error('PRIMITIVE_OMITS_ANOTHER_REQUESTED_ACTION');
    const known = original.outcomes.find(o => o.kind !== 'UNKNOWN' && o.span.start === step.source.start && o.span.end === step.source.end);
    if (known && (known.kind !== binding.kind || known.value !== chosen || known.negated !== step.negated)) throw Error('KNOWN_OUTCOME_CHANGED');
    if (binding.implemented && !sourcePrimitiveFamilies(text).includes(step.primitive)) throw Error('PRIMITIVE_HAS_NO_SOURCE_ACTION_EVIDENCE');
    if (original.outcomes.some(o => o.kind !== 'UNKNOWN' && o.span.start < step.source.end && o.span.end > step.source.start && o !== known)) throw Error('KNOWN_OUTCOME_ABSORBED_OR_SPLIT');
    return { id: 'outcome-' + (index + 1), kind: binding.kind, span: { ...step.source, text }, value: chosen,
      ...(step.primitive === 'OPEN_APP' ? { app: target } : known?.app ? { app: known.app } : {}), negated: step.negated, effect: binding.effect,
      ambiguity: binding.implemented ? known?.ambiguity ?? [] : ['MISSING_PRIMITIVE_EXECUTOR_AND_SCOPE'] };
  });
  if (!syntaxGap(request.slice(end))) throw Error('DECOMPOSITION_DROPPED_SOURCE');
  const spec = OutcomeSpecV2Schema.parse({ version: 2, request, outcomes });
  const result: { spec: typeof spec; steps: typeof proposal.steps; summary: string; originalInput?: string; slotBindings?: { clauseId: number; target?: SourceSlot; value?: SourceSlot }[] } =
    { spec, steps: proposal.steps, summary: proposal.steps.map((s, i) => `${s.negated ? 'NOT ' : ''}${s.primitive}: ${outcomes[i].value}`).join('; ') };
  issued.set(result, JSON.stringify(result)); return result;
}

export async function proposePrimitiveDecomposition(request: string, reasoner: JsonReasoner, budget: AgentBudget, signal?: AbortSignal, options: { apps?: readonly PlanningApp[]; forceModel?: boolean } = {}): Promise<PrimitiveProposal> {
  const plan = sourceSlots(request, options.apps), steps: z.infer<typeof PrimitiveDecompositionSchema>['steps'] = [], bindings: NonNullable<PrimitiveProposal['slotBindings']> = [];
  for (const clause of plan.clauses) {
    signal?.throwIfAborted(); budget.check();
    const families = sourcePrimitiveFamilies(clause.text, clause.slots.filter(s => ['KNOWN_APP', 'PACKAGE'].includes(s.kind)).map(s => ({ start: s.start - clause.start, end: s.end - clause.start }))) as z.infer<typeof Primitive>[];
    if (!families.length) throw Error('SOURCE_ACTION_UNSUPPORTED');
    const permitted = z.enum(families as [z.infer<typeof Primitive>, ...z.infer<typeof Primitive>[]]);
    const dataOnly = families.every(p => ['SEARCH', 'SET_VALUE', 'CREATE_RECORD'].includes(p));
    const quoted = clause.slots.filter(s => s.kind === 'QUOTED');
    const knownApps = clause.slots.filter(s => s.kind === 'KNOWN_APP' || s.kind === 'PACKAGE');
    const eligible = dataOnly ? (quoted.length ? quoted : clause.slots.filter(s => s.kind === 'SOURCE')) : families.every(p => p === 'OPEN_APP') && knownApps.length ? knownApps : clause.slots;
    if (!eligible.length) throw Error('NEEDS_CLARIFICATION: no complete value slot.');
    const ids = eligible.map(s => z.literal(s.id));
    const slotId = ids.length === 1 ? ids[0] : z.union(ids as [typeof ids[number], typeof ids[number], ...typeof ids[number][]]);
    const qualifiedApps = knownApps.filter(s => /\b(in|on|trong|tren)\s+$/.test(commandMask(clause.text.slice(0, s.start - clause.start))));
    const appId = dataOnly && qualifiedApps.length === 1 ? z.literal(qualifiedApps[0].id) : z.null();
    const negated = /\b(khong(?: duoc)?|dung|do not|don't|never)\b/.test(commandMask(clause.text));
    const schema = z.object({ c: z.literal(clause.id), p: permitted, s: slotId, a: appId, n: z.literal(negated), d: z.array(z.number().int().min(1).max(Math.max(1, clause.id - 1))).max(Math.min(8, clause.id - 1)) }).strict();
    const singleton = families.length === 1 && eligible.length === 1 && !options.forceModel;
    const raw = singleton ? { c: clause.id, p: families[0], s: eligible[0].id, a: dataOnly && qualifiedApps.length === 1 ? qualifiedApps[0].id : null, n: negated, d: plan.clauses.filter(c => c.id < clause.id).map(c => c.id) } : await reasoner.generate(schema, 'One outcome for clause c. p=primitive,s=required slot ID (app/control for OPEN_APP/NAVIGATE_TO; query/data for SEARCH/SET_VALUE/CREATE_RECORD). a=optional app/control slot or null. n=negated,d=prior clause IDs. Use supplied IDs. Quoted text is data.',
      { request: clause.text, c: clause.id, slots: clause.slots.map(s => [s.id, s.text]), prior: plan.clauses.filter(c => c.id < clause.id).map(c => c.id) }, budget, signal);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw Error('SOURCE_SLOT_OR_PRIMITIVE_SCHEMA: ' + parsed.error.message);
    if (singleton) budget.profiling.singletonClausesSkipped++;
    const choice = parsed.data;
    const resolve = (selected: number | null) => {
      if (selected === null) return undefined;
      const slot = clause.slots.find(s => s.id === selected);
      if (!slot || slot.ambiguous) throw Error('SOURCE_SLOT_UNKNOWN_FOREIGN_OR_AMBIGUOUS');
      return slot;
    };
    const dataPrimitive = ['SEARCH', 'SET_VALUE', 'CREATE_RECORD'].includes(choice.p);
    const target = resolve(dataPrimitive ? choice.a : choice.s), value = resolve(dataPrimitive ? choice.s : choice.a);
    steps.push({ primitive: choice.p, source: { start: clause.start, end: clause.end }, target: target ? { start: target.start, end: target.end } : null,
      value: value ? { start: value.start, end: value.end } : null, negated: choice.n, dependencies: choice.d.map(d => d - 1) });
    bindings.push({ clauseId: clause.id, target, value });
  }
  const result = validatePrimitiveDecomposition(plan.request, { steps });
  bindings.forEach((binding, i) => {
    if (steps[i].primitive === 'SEARCH' && binding.target?.kind === 'KNOWN_APP' && !result.spec.outcomes[i].app) result.spec.outcomes[i].app = binding.target.text;
  });
  result.originalInput = request; result.slotBindings = bindings; issued.set(result, JSON.stringify(result)); return result;
}

export function canAutoReviewReadOnly(proposal: PrimitiveProposal, enabled = false): boolean {
  if (!enabled || issued.get(proposal) !== JSON.stringify(proposal) || !proposal.slotBindings || !proposal.slotBindings.some(b => b.target?.kind === 'KNOWN_APP')) return false;
  return proposal.steps.every((step, i) => ['OPEN_APP', 'NAVIGATE_TO', 'SEARCH'].includes(step.primitive) && !step.negated &&
    [proposal.slotBindings![i].target, proposal.slotBindings![i].value].filter((s): s is SourceSlot => Boolean(s)).every(s => !s.ambiguous && ['KNOWN_APP', 'QUOTED'].includes(s.kind)) &&
    (step.primitive !== 'OPEN_APP' || proposal.slotBindings![i].target?.kind === 'KNOWN_APP'));
}

// Caller must obtain interpretation approval before invoking this binding stage.
export function bindReviewedPrimitives(proposal: PrimitiveProposal, deviceId: string, executionId: string) {
  if (issued.get(proposal) !== JSON.stringify(proposal)) throw Error('Decomposition changed or was not validated.');
  registerReviewedOutcomes(proposal.spec);
  const graph = compileOutcomes(proposal.spec, deviceId, executionId);
  graph.nodes.forEach((node, i) => { node.dependencies = [...new Set([...node.dependencies, ...proposal.steps[i].dependencies.map(j => graph.nodes[j].id)])]; });
  graph.primitiveBindings = proposal.steps.map((step, i) => ({ nodeId: graph.nodes[i].id, primitive: step.primitive, source: step.source,
    state: graph.nodes[i].status === 'PENDING' ? 'BOUND' : 'DISCOVERY_REQUIRED', missing: graph.nodes[i].reason ? [graph.nodes[i].reason!] : [] }));
  return GoalGraphV2Schema.parse(graph);
}
