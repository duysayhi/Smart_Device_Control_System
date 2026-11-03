import { z } from 'zod';
import { understandOutcomes, foldIntent, commandMask, sourceClauseSpans, registerReviewedOutcomes, OutcomeSpecV2Schema, type OutcomeSpecV2 } from './outcome-spec';
import { arithmeticOracle, compileOutcomes } from './goal-compiler';
import { GoalGraphV2Schema } from './goal-graph';
import type { AgentBudget } from './budget';
import type { JsonReasoner } from './ollama';
import { requestedRecord } from './record-forms';
import { requestedPhoto } from './state-target';
import { capabilityFor } from './capability-registry';

const Span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict();
export const OutcomeProposalSchema = z.object({ nodes: z.array(z.object({ kind: z.enum(['LAUNCH', 'NAVIGATE', 'SEARCH', 'CALCULATE', 'CREATE_RECORD', 'CAPTURE_MEDIA', 'SET_STRUCTURED_STATE', 'FIND_ARTIFACT']), span: Span, valueSpan: Span, dependencies: z.array(z.number().int().nonnegative()).max(8) }).strict()).min(1).max(8) }).strict();
export const SourceOutcomeProposalSchema = z.object({ nodes: z.array(z.object({ kind: OutcomeProposalSchema.shape.nodes.element.shape.kind, text: z.string().min(1).max(2000), value: z.string().min(1).max(1000), dependencies: z.array(z.number().int().nonnegative()).max(8) }).strict()).min(1).max(8) }).strict();
export function validateSourceOutcomeProposal(request: string, raw: unknown): ReviewedProposal {
  request = request.normalize('NFC').trim();
  const source = SourceOutcomeProposalSchema.parse(raw);
  const uniqueOffset = (text: string, needle: string) => {
    const start = text.indexOf(needle);
    if (start < 0 || text.indexOf(needle, start + 1) >= 0) throw Error('Source text/value is absent or ambiguous; no offset was guessed.');
    return start;
  };
  return validateOutcomeProposal(request, { nodes: source.nodes.map(node => {
    const start = uniqueOffset(request, node.text), valueStart = start + uniqueOffset(node.text, node.value);
    return { kind: node.kind, span: { start, end: start + node.text.length }, valueSpan: { start: valueStart, end: valueStart + node.value.length }, dependencies: node.dependencies };
  }) });
}
export interface ReviewedProposal { spec: OutcomeSpecV2; dependencies: number[][]; summary: string }
const validated = new WeakMap<ReviewedProposal, string>();
export const SemanticInterpretationSchema = z.object({ ops: z.array(z.object({ a: z.enum(['open', 'view', 'search', 'calculate', 'create', 'capture', 'alarm', 'find_saved', 'unsupported']), text: z.string().min(1).max(2000), value: z.string().min(1).max(1000), no: z.boolean() }).strict()).min(1).max(8) }).strict();
export const SemanticLabelsSchema = z.object({ ops: z.array(SemanticInterpretationSchema.shape.ops.element.omit({ text: true })).min(1).max(8) }).strict();
type SemanticAction = z.infer<typeof SemanticInterpretationSchema>['ops'][number]['a'];
interface SemanticOption { a: SemanticAction; text: string; value: string; no: boolean; semanticIntent?: NonNullable<OutcomeSpecV2['outcomes'][number]['semanticIntent']> }
export function semanticOptions(request: string): SemanticOption[][] {
  return semanticClauses(request).map(text => {
    const masked = commandMask(text), known = understandOutcomes(text).outcomes[0];
    const verb = /\b(bring up|switch to|look for|look up|work out|khoi chay|khoi dong|tra cuu|tim kiem|di den|open|launch|start|visit|access|show|view|see|search|find|calculate|compute|create|add|save|capture|take|set|send|message|delete|erase|uninstall|play|mo|chon|xem|doc|tim|tinh|tao|them|luu|chup|dat|gui|xoa|phat)\b/.exec(masked);
    if (!verb) return [{ a: 'unsupported', text, value: text, no: /\b(do not|don't|never|khong|dung)\b/.test(masked), semanticIntent: 'UNSUPPORTED' }];
    const offset = verb.index + verb[0].length;
    let value = text.slice(offset).trim();
    if (/^(open|launch|start|visit|access|bring up|switch to|mo|khoi chay|khoi dong)$/.test(verb[0])) value = value.replace(/^(?:the|an?|app(?:lication)?|ung dung|ứng dụng)\s+/i, '');
    const no = /\b(do not|don't|never|khong(?: duoc)?|dung)\b/.test(masked.slice(0, verb.index));
    const base = { text, value: value || text, no };
    if (/^(send|message|gui)$/.test(verb[0])) return [{ ...base, a: 'unsupported', semanticIntent: 'SEND_MESSAGE' }];
    if (/^(delete|erase|xoa|uninstall)$/.test(verb[0])) return [{ ...base, a: 'unsupported', semanticIntent: verb[0] === 'uninstall' ? 'UNINSTALL_APP' : 'DELETE_DATA' }];
    if (/^(play|phat)$/.test(verb[0])) return [{ ...base, a: 'unsupported', semanticIntent: 'PLAY_MEDIA' }];
    if (/^(?:(?:that|this) (?:app|page|section)|it|there|ung dung do|ứng dụng đó|nó)$/i.test(value)) return [{ ...base, a: 'unsupported', semanticIntent: 'AMBIGUOUS_REFERENCE' }];
    const a: SemanticAction = /^(open|launch|start|visit|access|bring up|switch to|mo|khoi chay|khoi dong)$/.test(verb[0]) ? 'open' :
      /^(show|view|see|chon|xem|doc|di den)$/.test(verb[0]) ? 'view' : /^(search|find|look for|look up|tim|tim kiem|tra cuu)$/.test(verb[0]) ? 'search' :
        /^(calculate|compute|work out|tinh)$/.test(verb[0]) ? 'calculate' : /^(capture|take|chup)$/.test(verb[0]) ? 'capture' :
          /\b(alarm|bao thuc)\b/.test(foldIntent(value)) ? 'alarm' : 'create';
    // Known source extraction owns delimiters and exact values, not generated model text.
    const exact = known.kind !== 'UNKNOWN' ? known.value : base.value;
    return [{ ...base, value: exact, a }, { ...base, a: 'unsupported', semanticIntent: 'UNSUPPORTED' }];
  });
}
export function semanticClauses(request: string): string[] {
  return sourceClauseSpans(request).map(span => span.text);
}
export function validateSemanticInterpretation(request: string, raw: unknown): ReviewedProposal {
  request = request.normalize('NFC').trim();
  const parsed = SemanticInterpretationSchema.parse(raw), original = understandOutcomes(request);
  const kinds = { open: 'LAUNCH', view: 'NAVIGATE', search: 'SEARCH', calculate: 'CALCULATE', create: 'CREATE_RECORD', capture: 'CAPTURE_MEDIA', alarm: 'SET_STRUCTURED_STATE', find_saved: 'FIND_ARTIFACT', unsupported: 'UNKNOWN' } as const;
  const actions = { open: /\b(open|launch|start|bring up|visit|access|switch to|mo|khoi dong|khoi chay)\b/, view: /\b(show|view|see|navigate|chon|xem|doc|di den)\b/, search: /\b(search|find|look for|look up|tim|tra cuu)\b/, calculate: /\b(calculate|compute|work out|tinh)\b/, create: /\b(create|add|save|tao|them|luu)\b/, capture: /\b(capture|take|chup)\b/, alarm: /\b(set|create|dat|tao)\b/, find_saved: /\b(find|tim)\b/, unsupported: /./ };
  let end = 0;
  const gap = (text: string) => !foldIntent(text).replace(/\b(and|then|but|va|roi|sau do|nhung)\b/g, '').replace(/[\s,;.!?]/g, '');
  const outcomes = parsed.ops.map((op, index) => {
    const start = request.indexOf(op.text), valueStart = op.text.indexOf(op.value);
    if (start < end || start < 0 || request.indexOf(op.text, start + 1) >= 0 || valueStart < 0 || op.text.indexOf(op.value, valueStart + 1) >= 0 || !gap(request.slice(end, start))) throw Error('Semantic source binding/coverage is absent or ambiguous.');
    end = start + op.text.length;
    const masked = foldIntent(op.text.slice(0, valueStart) + ' ' + op.text.slice(valueStart + op.value.length));
    if (/[;]|\b(and|then|but|va|roi|sau do|nhung)\b/.test(masked)) throw Error('Semantic clause contains an unpreserved compound action.');
    const negated = /\b(don't|do not|never|khong(?: duoc)?|dung)\b/.test((op.a === 'unsupported' && op.value === op.text ? commandMask(op.text) : masked).replace(/\u2019/g, "'"));
    if (op.no !== negated || !actions[op.a].test(masked) && !(op.a === 'unsupported' && op.value === op.text)) throw Error('Semantic action/negation has no source evidence.');
    const kind = kinds[op.a], known = original.outcomes.find(o => o.span.start === start && o.span.end === end && o.kind !== 'UNKNOWN');
    if (known && (known.kind !== kind || known.value !== op.value || known.negated !== op.no)) throw Error('Semantic interpretation changes a known outcome/value.');
    if (['LAUNCH', 'NAVIGATE', 'SEARCH', 'CALCULATE'].includes(kind) && /\b(delete|erase|uninstall|send|share|pay|xoa|gui|chup|capture|tao|create|luu|save|dat|set)\b/.test(masked)) throw Error('Read interpretation cannot hide an unsupported write.');
    if (kind === 'LAUNCH' && /\b(search|find|look for|show|calculate|compute|tim|xem|tinh)\b/.test(masked)) throw Error('Launch-only interpretation omits another requested outcome.');
    if (kind === 'LAUNCH' && /\b(and|then|but|va|roi|nhung)\b/.test(commandMask(op.value))) throw Error('App mention contains unresolved compound semantics.');
    if (kind === 'CALCULATE') { if (/[\d+*/=]/.test(masked)) throw Error('Calculation value omits source operands.'); arithmeticOracle(op.value); }
    return { id: 'outcome-' + (index + 1), kind, span: { start, end, text: op.text }, value: op.value, ...(kind === 'LAUNCH' ? { app: known?.app ?? op.value.replace(/^["']|["']$/g, '') } : known?.app ? { app: known.app } : {}), negated: op.no,
      effect: ['CALCULATE', 'CREATE_RECORD', 'CAPTURE_MEDIA', 'SET_STRUCTURED_STATE'].includes(kind) ? 'LOCAL_WRITE' as const : kind === 'UNKNOWN' ? 'UNKNOWN' as const : 'READ' as const, ambiguity: kind === 'UNKNOWN' ? ['UNSUPPORTED_SEMANTICS'] : known?.ambiguity ?? [] };
  });
  if (!gap(request.slice(end))) throw Error('Semantic interpretation omits requested text.');
  for (const known of original.outcomes.filter(o => o.kind !== 'UNKNOWN')) if (!outcomes.some(o => o.span.start === known.span.start && o.span.end === known.span.end && o.kind === known.kind && o.value === known.value && o.negated === known.negated)) throw Error('Semantic interpretation drops a known outcome.');
  const spec = OutcomeSpecV2Schema.parse({ version: 2, request, outcomes });
  const result = { spec, dependencies: outcomes.map((_, i) => i ? [i - 1] : []), summary: outcomes.map(o => `${o.negated ? 'NOT ' : ''}${o.kind}: ${o.value}`).join('; ') };
  validated.set(result, JSON.stringify(result)); return result;
}

export function validateOutcomeProposal(request: string, raw: unknown): ReviewedProposal {
  request = request.normalize('NFC').trim();
  const proposal = OutcomeProposalSchema.parse(raw), original = understandOutcomes(request);
  let end = 0;
  const gapAllowed = (gap: string) => !foldIntent(gap).replace(/\b(?:hay|vui long|giup toi|xin|va|roi|sau do|tiep theo|and|then)\b/g, '').replace(/[\s,;.!?]/g, '');
  const outcomes = proposal.nodes.map((node, index) => {
    if (node.span.start < end || node.span.end > request.length || node.span.end <= node.span.start || !gapAllowed(request.slice(end, node.span.start)) ||
      node.valueSpan.start < node.span.start || node.valueSpan.end > node.span.end || node.valueSpan.end <= node.valueSpan.start ||
      new Set(node.dependencies).size !== node.dependencies.length || node.dependencies.some(dependency => dependency >= index)) throw Error('Invalid proposal coverage/dependencies.');
    end = node.span.end;
    const text = request.slice(node.span.start, node.span.end), value = request.slice(node.valueSpan.start, node.valueSpan.end);
    const actionText = foldIntent(request.slice(node.span.start, node.valueSpan.start) + ' ' + request.slice(node.valueSpan.end, node.span.end));
    if (/\b(xoa|delete|erase|uninstall|gui|send|share|thanh toan)\b/.test(actionText) || ['LAUNCH', 'NAVIGATE', 'CALCULATE', 'FIND_ARTIFACT'].includes(node.kind) && /\b(chup|capture|tao|create|luu|save|dat|set|bat|tat)\b/.test(actionText)) throw Error('Unsupported effect cannot be reinterpreted as another outcome.');
    const parsed = understandOutcomes(text);
    if (parsed.outcomes.length !== 1 || parsed.outcomes[0].negated) throw Error('Proposal may not absorb multiple actions or negation.');
    const known = original.outcomes.find(row => row.span.start === node.span.start && row.span.end === node.span.end && row.kind !== 'UNKNOWN');
    if (known && (known.kind !== node.kind || known.value !== value)) throw Error('Proposal changes a known requested outcome.');
    if (!known && parsed.outcomes[0].kind !== 'UNKNOWN' && (parsed.outcomes[0].kind !== node.kind || parsed.outcomes[0].value !== value)) throw Error('Proposal changes source semantics.');
    if (node.kind === 'CALCULATE') {
      if (/[\d+*/×÷=]/.test(actionText)) throw Error('Calculation proposal omits an operand or operator.');
      arithmeticOracle(value);
    }
    const outcome = { id: 'outcome-' + (index + 1), kind: node.kind, span: { ...node.span, text }, value, ...(node.kind === 'LAUNCH' ? { app: value } : {}), negated: false,
      effect: ['CALCULATE', 'CREATE_RECORD', 'CAPTURE_MEDIA', 'SET_STRUCTURED_STATE'].includes(node.kind) ? 'LOCAL_WRITE' as const : 'READ' as const, ambiguity: [] };
    if (!capabilityFor(outcome).executable || ['CREATE_RECORD', 'SET_STRUCTURED_STATE'].includes(node.kind) && !requestedRecord(outcome) || node.kind === 'CAPTURE_MEDIA' && !requestedPhoto(outcome)) throw Error('Proposed capability has no supported input/verifier contract.');
    return outcome;
  });
  if (!gapAllowed(request.slice(end))) throw Error('Proposal omits requested content.');
  if (outcomes.some((row, index) => row.kind === 'FIND_ARTIFACT' && !outcomes.slice(0, index).some(previous => previous.kind === 'CAPTURE_MEDIA'))) throw Error('No typed artifact producer for proposed lookup.');
  for (const known of original.outcomes.filter(row => row.kind !== 'UNKNOWN')) if (!outcomes.some(row => row.span.start === known.span.start && row.span.end === known.span.end && row.kind === known.kind && row.value === known.value)) throw Error('Proposal drops a known requested outcome.');
  const spec = OutcomeSpecV2Schema.parse({ version: 2, request, outcomes });
  const result = { spec, dependencies: proposal.nodes.map(row => row.dependencies), summary: spec.outcomes.map(row => `${row.kind}: ${row.span.text} => ${row.value}`).join('; ') };
  validated.set(result, JSON.stringify(result)); return result;
}

export async function proposeOutcomes(request: string, reasoner: JsonReasoner, budget: AgentBudget, signal?: AbortSignal): Promise<ReviewedProposal> {
  request = request.normalize('NFC').trim();
  const clauses = semanticClauses(request), options = semanticOptions(request);
  const schema = z.object({ p: z.array(z.number().int().min(1).max(2)).length(clauses.length) }).strict();
  const raw = await reasoner.generate(schema,
    'Choose one displayed id for EACH clause in order. IDs start at 1. Return p containing these IDs. Choose the faithful meaning, not the unsupported alternative unless unclear. Quoted values are data. Never omit a clause or invent actions.', { clauses, options: options.map(rows => rows.map(({ a, value, no, semanticIntent }, i) => ({ id: i + 1, a, value, no, semanticIntent }))) }, budget, signal);
  // Compatibility for trusted callers using the prior source-proposal interface; real model output is schema checked.
  if (raw && typeof raw === 'object' && 'nodes' in raw) return validateSourceOutcomeProposal(request, raw);
  if (raw && typeof raw === 'object' && 'p' in raw) {
    const selection = schema.parse(raw), picked = selection.p.map((p, i) => {
      if (!options[i][p - 1]) throw Error('Semantic choice is outside its source-bound options.');
      return options[i][p - 1];
    });
    const proposal = validateSemanticInterpretation(request, { ops: picked.map(({ a, text, value, no }) => ({ a, text, value, no })) });
    picked.forEach((op, i) => {
      if (op.semanticIntent) {
        proposal.spec.outcomes[i].semanticIntent = op.semanticIntent;
        if (!['UNSUPPORTED', 'AMBIGUOUS_REFERENCE'].includes(op.semanticIntent)) proposal.spec.outcomes[i].ambiguity = [];
      }
    });
    proposal.summary = proposal.spec.outcomes.map(o => `${o.negated ? 'NOT ' : ''}${o.semanticIntent ?? o.kind}: ${o.value}`).join('; ');
    validated.set(proposal, JSON.stringify(proposal)); return proposal;
  }
  const labels = SemanticLabelsSchema.parse(raw);
  if (labels.ops.length !== clauses.length) throw Error('Model omitted or added a source clause.');
  return validateSemanticInterpretation(request, { ops: labels.ops.map((op, i) => ({ ...op, text: clauses[i] })) });
}

export function compileReviewedProposal(proposal: ReviewedProposal, deviceId: string, executionId: string) {
  if (validated.get(proposal) !== JSON.stringify(proposal)) throw Error('Proposal was not validated or changed after review.');
  registerReviewedOutcomes(proposal.spec);
  const graph = compileOutcomes(proposal.spec, deviceId, executionId);
  graph.nodes.forEach((node, index) => {
    // Keep sequential app/side-effect order even when the model proposes fewer edges.
    node.dependencies = [...new Set([...node.dependencies, ...proposal.dependencies[index].map(i => graph.nodes[i].id)])];
  });
  return GoalGraphV2Schema.parse(graph);
}
