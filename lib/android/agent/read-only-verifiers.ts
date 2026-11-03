import { z } from 'zod';
import type { Observation } from '../state-observer';
import { visibleNode } from './navigation-semantics';
import { foldIntent } from './outcome-spec';
import { isDescendant } from '../exploration/scroll-regions';

export const NativeFactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ELEMENT_TEXT_PRESENT'), text: z.string().min(1), resourceId: z.string().optional() }).strict(),
  z.object({ kind: z.literal('WIDGET_STATE'), label: z.string().min(1), property: z.enum(['checked', 'selected', 'value']), expected: z.union([z.boolean(), z.string()]) }).strict(),
  z.object({ kind: z.literal('LIST_NONEMPTY_CORRELATED_WITH_VALUE'), query: z.string().min(1), fieldResourceId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('EXPLICIT_EMPTY_RESULT'), query: z.string().min(1), fieldResourceId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED'), scopeId: z.string().min(1) }).strict(),
]);
export interface EvidenceAssessment {
  evidenceClass: 'EXACT_NATIVE_READBACK' | 'CORRELATED_RESULT_STATE' | 'EXPLICIT_EMPTY_STATE' | 'ACKNOWLEDGED_SUBMIT' | 'LIVE_QUERY_STATE' | 'PROVIDER_READBACK' | 'ARTIFACT_IDENTITY' | 'PLAYBACK_PROGRESS' | 'KEYBOARD_READBACK';
  confidence: 'DIRECT' | 'CORRELATED'; why: string;
}
export const emptyResultText = (text: string) => /^(?:no results(?: found)?|no matches(?: found)?|khong (?:co ket qua|tim thay ket qua))(?:[ .!:]|$)/.test(foldIntent(text));
export function resultSurface(snapshot: Observation, query?: string) {
  const visible = snapshot.nodes.filter(n => visibleNode(snapshot, n));
  const containers = visible.filter(n => /ListView|RecyclerView|GridView/.test(n.className) &&
    (/(?:^|[_:/.-])(?:results|search_results|result_list)(?:[_:/.-]|$)/.test(n.resourceId) || visible.some(child => child !== n &&
      /^(\d+)\s+(?:results?|items?|matches|ket qua|muc)$/.test(foldIntent(child.text || child.description).trim()) && isDescendant(snapshot.nodes, child, n)) ||
      Boolean(query && !visible.some(other => /recent|history|suggest|autocomplete/.test(other.resourceId) && (other === n || isDescendant(snapshot.nodes, n, other))) &&
        visible.filter(child => child !== n && !child.clickable && !/EditText|AutoCompleteTextView/.test(child.className) && child.text === query && isDescendant(snapshot.nodes, child, n) &&
          visible.some(owner => owner !== n && owner.clickable && isDescendant(snapshot.nodes, owner, n) && isDescendant(snapshot.nodes, child, owner))).length === 1)));
  return { visible, containers, items: containers.flatMap(parent => visible.filter(n => n !== parent && isDescendant(snapshot.nodes, n, parent) && n.clickable)),
    empty: visible.filter(n => !n.clickable && emptyResultText(n.text || n.description)),
    suggestions: visible.some(n => /suggest|autocomplete/.test(n.resourceId) && /ListView|RecyclerView/.test(n.className)) };
}
export function exactQuerySummary(text: string, query: string) {
  return text.endsWith(query) && /^(?:(?:search )?results for|no results for|ket qua (?:tim kiem )?cho)[:\s]+$/.test(foldIntent(text.slice(0, -query.length)));
}
export function verifyNativeFact(predicate: z.infer<typeof NativeFactSchema>, snapshot: Observation): EvidenceAssessment | undefined {
  const surface = resultSurface(snapshot, 'query' in predicate ? predicate.query : undefined), visible = surface.visible;
  if (predicate.kind === 'ELEMENT_TEXT_PRESENT') {
    if (visible.filter(n => n.text === predicate.text && (!predicate.resourceId || n.resourceId === predicate.resourceId)).length === 1)
      return { evidenceClass: 'EXACT_NATIVE_READBACK', confidence: 'DIRECT', why: 'Unique exact visible native text.' };
  } else if (predicate.kind === 'WIDGET_STATE') {
    const matches = visible.filter(n => (n.description || n.hint || n.text) === predicate.label);
    if (matches.length !== 1) return;
    const n = matches[0], value = predicate.property === 'value' ? /EditText|AutoCompleteTextView/.test(n.className) ? n.text : undefined : n[predicate.property];
    if (value !== undefined && value === predicate.expected && (predicate.property !== 'checked' || n.checkable))
      return { evidenceClass: 'EXACT_NATIVE_READBACK', confidence: 'DIRECT', why: 'Unique typed widget property equals the requested value.' };
  } else if (predicate.kind === 'LIST_NONEMPTY_CORRELATED_WITH_VALUE' || predicate.kind === 'EXPLICIT_EMPTY_RESULT') {
    const fields = visible.filter(n => n.resourceId === predicate.fieldResourceId && /EditText|AutoCompleteTextView/.test(n.className));
    if (surface.suggestions || fields.length !== 1 || fields[0].text !== predicate.query) return;
    if (predicate.kind === 'LIST_NONEMPTY_CORRELATED_WITH_VALUE' && surface.containers.length === 1 && surface.items.length &&
      visible.filter(n => exactQuerySummary(n.text, predicate.query)).length === 1)
      return { evidenceClass: 'CORRELATED_RESULT_STATE', confidence: 'CORRELATED', why: 'Exact query field plus independent query summary and nonempty result collection; causality not asserted.' };
    if (predicate.kind === 'EXPLICIT_EMPTY_RESULT' && surface.empty.length === 1 && !surface.items.length)
      return { evidenceClass: 'EXPLICIT_EMPTY_STATE', confidence: 'DIRECT', why: 'Exact field and one visible empty-result widget; application of the query requires a separate commit/correlation contract.' };
  }
}
