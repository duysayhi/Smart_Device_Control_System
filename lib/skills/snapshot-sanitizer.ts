import type { UiNode } from '../android/targets';
import { z } from 'zod';
import type { ObservedAffordance } from '../android/agent/ui-affordances';
import { sensitiveAffordance } from '../android/agent/ui-affordances';
import { structuralRoles } from '../android/agent/widget-semantics';
import { foldSkillText, inspectJson, sensitiveMetadata, sensitiveValue } from './skill-safety';

export type LiveTeachNode = Partial<UiNode> & Partial<Pick<ObservedAffordance, 'sensitive' | 'roles' | 'elementId'>> & {
  secure?: boolean; fieldType?: 'SEARCH' | 'TEXT' | 'PASSWORD' | 'OTP' | 'PAYMENT' | 'SECURITY' | 'UNKNOWN'; value?: string;
};
export type RedactionStatus = 'REDACTED' | 'CAPTURE_SAFETY_UNKNOWN' | 'SENSITIVE_CONTENT_OMITTED';
export type RedactionReason = 'METADATA_ONLY' | 'INVALID_INPUT' | 'PRIVACY_FLAGS_UNPROVEN' | 'FIELD_TYPE_UNPROVEN' |
  'SENSITIVE_FIELD' | 'SENSITIVE_TEXT_OR_URL' | 'SENSITIVE_ANCESTOR' | 'ANCESTRY_UNPROVEN';
export interface SanitizedTeachNode {
  role: 'search_field' | 'search_action' | 'navigation' | 'collection' | 'dialog' | 'control' | 'status' | 'sensitive' | 'unknown';
  labelClass: 'SEARCH_FIELD' | 'SEARCH_ACTION' | 'BACK_ACTION' | 'NAVIGATION_CONTROL' | 'COLLECTION' | 'STRUCTURAL_ONLY' | 'OMITTED';
  enabled: boolean; displayed: boolean; editable: boolean;
  redactionStatus: RedactionStatus; reasons: RedactionReason[];
}
export interface SanitizedTeachSnapshot {
  nodes: SanitizedTeachNode[]; redactionStatus: RedactionStatus; reasons: RedactionReason[]; captureAllowed: false;
}
export const SanitizedTeachSnapshotSchema = z.object({
  nodes: z.array(z.object({
    role: z.enum(['search_field', 'search_action', 'navigation', 'collection', 'dialog', 'control', 'status', 'sensitive', 'unknown']),
    labelClass: z.enum(['SEARCH_FIELD', 'SEARCH_ACTION', 'BACK_ACTION', 'NAVIGATION_CONTROL', 'COLLECTION', 'STRUCTURAL_ONLY', 'OMITTED']),
    enabled: z.boolean(), displayed: z.boolean(), editable: z.boolean(),
    redactionStatus: z.enum(['REDACTED', 'CAPTURE_SAFETY_UNKNOWN', 'SENSITIVE_CONTENT_OMITTED']),
    reasons: z.array(z.enum(['METADATA_ONLY', 'INVALID_INPUT', 'PRIVACY_FLAGS_UNPROVEN', 'FIELD_TYPE_UNPROVEN', 'SENSITIVE_FIELD', 'SENSITIVE_TEXT_OR_URL', 'SENSITIVE_ANCESTOR', 'ANCESTRY_UNPROVEN'])).max(8),
  }).strict()).max(1000),
  redactionStatus: z.enum(['REDACTED', 'CAPTURE_SAFETY_UNKNOWN', 'SENSITIVE_CONTENT_OMITTED']),
  reasons: z.array(z.enum(['METADATA_ONLY', 'INVALID_INPUT', 'PRIVACY_FLAGS_UNPROVEN', 'FIELD_TYPE_UNPROVEN', 'SENSITIVE_FIELD', 'SENSITIVE_TEXT_OR_URL', 'SENSITIVE_ANCESTOR', 'ANCESTRY_UNPROVEN'])).max(8),
  captureAllowed: z.literal(false),
}).strict();
type RecordNode = Record<string, unknown>;
const string = (node: RecordNode, key: string) => typeof node[key] === 'string' ? node[key] as string : '';
function privacy(node: RecordNode): { status: RedactionStatus; reason: RedactionReason } {
  const field = string(node, 'fieldType').toUpperCase();
  if (node.password === true || node.secure === true || node.sensitive === true || ['PASSWORD', 'OTP', 'PAYMENT', 'SECURITY'].includes(field)) return { status: 'SENSITIVE_CONTENT_OMITTED', reason: 'SENSITIVE_FIELD' };
  const metadata = ['hint', 'description', 'resourceId', 'fieldType'].map(key => string(node, key)).join(' ');
  const values = ['text', 'hint', 'description', 'value', 'resourceId', 'className'].map(key => string(node, key));
  if (sensitiveMetadata(metadata) || sensitiveAffordance(metadata) || values.some(sensitiveValue)) return { status: 'SENSITIVE_CONTENT_OMITTED', reason: 'SENSITIVE_TEXT_OR_URL' };
  if (node.password !== false || node.secure !== false || node.sensitive !== false) return { status: 'CAPTURE_SAFETY_UNKNOWN', reason: 'PRIVACY_FLAGS_UNPROVEN' };
  const editable = /EditText|AutoCompleteTextView/.test(string(node, 'className')) || Array.isArray(node.roles) && node.roles.includes('editable');
  if (editable && !['SEARCH', 'TEXT'].includes(field)) return { status: 'CAPTURE_SAFETY_UNKNOWN', reason: 'FIELD_TYPE_UNPROVEN' };
  return { status: 'REDACTED', reason: 'METADATA_ONLY' };
}
function withAncestors(nodes: RecordNode[], index: number) {
  let state = privacy(nodes[index]), parent = nodes[index].parentIndex;
  const seen = new Set<number>([index]);
  while (parent !== undefined) {
    if (typeof parent !== 'number' || !Number.isInteger(parent) || parent < 0 || parent >= nodes.length || seen.has(parent) || seen.size > 40) {
      if (state.status !== 'SENSITIVE_CONTENT_OMITTED') state = { status: 'CAPTURE_SAFETY_UNKNOWN', reason: 'ANCESTRY_UNPROVEN' };
      break;
    }
    seen.add(parent); const ancestor = privacy(nodes[parent]);
    if (ancestor.status === 'SENSITIVE_CONTENT_OMITTED') { state = { status: 'SENSITIVE_CONTENT_OMITTED', reason: 'SENSITIVE_ANCESTOR' }; break; }
    if (ancestor.status === 'CAPTURE_SAFETY_UNKNOWN' && state.status === 'REDACTED') state = ancestor;
    parent = nodes[parent].parentIndex;
  }
  return state;
}
function nodeList(input: unknown): RecordNode[] | undefined {
  if (inspectJson(input, false).errors.length || !Array.isArray(input) || input.length > 1000 || input.some(node => !node || typeof node !== 'object' || Array.isArray(node))) return;
  return input as RecordNode[];
}

/** No user text, hint, value, XML, screenshot, identifier or geometry is persisted. */
export function sanitizeSnapshot(input: readonly LiveTeachNode[] | unknown): SanitizedTeachSnapshot {
  const live = nodeList(input);
  if (!live) return { nodes: [], redactionStatus: 'CAPTURE_SAFETY_UNKNOWN', reasons: ['INVALID_INPUT'], captureAllowed: false };
  const nodes: SanitizedTeachNode[] = live.map((node, index) => {
    const state = withAncestors(live, index), allowed = state.status === 'REDACTED';
    const structural = structuralRoles({ className: string(node, 'className'), checkable: node.checkable === true, scrollable: node.scrollable === true });
    const editable = structural.includes('editable') || Array.isArray(node.roles) && node.roles.includes('editable');
    const label = foldSkillText(string(node, 'description') || string(node, 'text')).trim();
    let role: SanitizedTeachNode['role'] = 'unknown', labelClass: SanitizedTeachNode['labelClass'] = 'OMITTED';
    if (allowed) {
      if (editable && string(node, 'fieldType').toUpperCase() === 'SEARCH') { role = 'search_field'; labelClass = 'SEARCH_FIELD'; }
      else if (/^(search|tim kiem|find|tra cuu)$/.test(label)) { role = 'search_action'; labelClass = 'SEARCH_ACTION'; }
      else if (/^(back|navigate up|quay lai|tro ve)$/.test(label)) { role = 'navigation'; labelClass = 'BACK_ACTION'; }
      else if (structural.includes('navigation')) { role = 'navigation'; labelClass = 'NAVIGATION_CONTROL'; }
      else if (structural.includes('collection')) { role = 'collection'; labelClass = 'COLLECTION'; }
      else { role = structural.includes('dialog') ? 'dialog' : structural.includes('action') ? 'control' : editable ? 'unknown' : 'status'; labelClass = 'STRUCTURAL_ONLY'; }
    } else if (state.status === 'SENSITIVE_CONTENT_OMITTED') role = 'sensitive';
    return { role, labelClass, enabled: allowed && node.enabled === true, displayed: allowed && node.displayed === true,
      editable: allowed && editable, redactionStatus: state.status, reasons: [state.reason] };
  });
  const redactionStatus: RedactionStatus = nodes.some(node => node.redactionStatus === 'SENSITIVE_CONTENT_OMITTED') ? 'SENSITIVE_CONTENT_OMITTED'
    : !nodes.length || nodes.some(node => node.redactionStatus === 'CAPTURE_SAFETY_UNKNOWN') ? 'CAPTURE_SAFETY_UNKNOWN' : 'REDACTED';
  return { nodes, redactionStatus, reasons: [...new Set(nodes.flatMap(node => node.reasons))].sort(), captureAllowed: false };
}

interface DiagnosticEntry { nodeIndex: number; bounds?: [number, number, number, number]; elementId?: string }
/** Deliberately separate from the persistable snapshot. Serialization/inspection omit payload. */
export class EphemeralTeachDiagnostics {
  #entries: DiagnosticEntry[];
  constructor(entries: DiagnosticEntry[]) { this.#entries = entries.map(entry => ({ ...entry, ...(entry.bounds ? { bounds: [...entry.bounds] as [number, number, number, number] } : {}) })); }
  toJSON() { return { ephemeral: true, persistable: false } as const; }
  [Symbol.for('nodejs.util.inspect.custom')]() { return 'EphemeralTeachDiagnostics { ephemeral: true, persistable: false }'; }
  readForLocalInspection(): DiagnosticEntry[] { return this.#entries.map(entry => ({ ...entry, ...(entry.bounds ? { bounds: [...entry.bounds] as [number, number, number, number] } : {}) })); }
}
export function createEphemeralDiagnostics(input: readonly LiveTeachNode[] | unknown): EphemeralTeachDiagnostics {
  const nodes = nodeList(input), snapshot = sanitizeSnapshot(input), entries: DiagnosticEntry[] = [];
  if (nodes) for (const [index, node] of nodes.entries()) {
    if (snapshot.nodes[index].redactionStatus !== 'REDACTED') continue;
    const entry: DiagnosticEntry = { nodeIndex: index }, bounds = node.bounds;
    if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000) && bounds[2] > bounds[0] && bounds[3] > bounds[1]) entry.bounds = [...bounds] as [number, number, number, number];
    const id = string(node, 'elementId');
    if (/^[A-Za-z0-9_.:-]{1,128}$/.test(id) && !sensitiveValue(id) && !sensitiveMetadata(id)) entry.elementId = id;
    entries.push(entry);
  }
  return new EphemeralTeachDiagnostics(entries);
}
