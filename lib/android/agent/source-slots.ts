import { commandMask, understandOutcomes, foldIntent } from './outcome-spec';
import { maximalValueSpan } from './source-value';
import { enterSearchBoundary, enterWords, trimValueSyntax } from './natural-phrasing';

export interface SourceSlot { id: number; clauseId: number; text: string; start: number; end: number; rawStart: number; rawEnd: number;
  kind: 'QUOTED' | 'NUMBER' | 'KNOWN_APP' | 'PACKAGE' | 'SOURCE'; ambiguous: boolean }
export interface PlanningApp { packageName: string; label?: string }
export interface SourcePlan { request: string; original: string; clauses: { id: number; text: string; start: number; end: number; slots: SourceSlot[] }[] }
export function sourcePrimitiveFamilies(text: string, protectedSpans: readonly { start: number; end: number }[] = []): string[] {
  const known = understandOutcomes(text).outcomes[0];
  const kinds: Record<string, string> = { LAUNCH: 'OPEN_APP', NAVIGATE: 'NAVIGATE_TO', SEARCH: 'SEARCH', SET_STATE: 'TOGGLE', CREATE_RECORD: 'CREATE_RECORD' };
  if (known.kind !== 'UNKNOWN' && kinds[known.kind]) return [kinds[known.kind]];
  let source = commandMask(text);
  for (const span of protectedSpans) source = source.slice(0, span.start) + ' '.repeat(span.end - span.start) + source.slice(span.end);
  const families: string[] = [];
  for (const [name, pattern] of [
    ['OPEN_APP', new RegExp('\\b(' + enterWords + ')\\b')],
    ['NAVIGATE_TO', /\b(di toi|di den|chuyen sang|chuyen den|xem|view|show|navigate|inspect|switch to)\b/],
    ['SEARCH', /\b(do|loc|tim|tim kiem|tra|tra cuu|search|find|look up|look for|lookup)\b/],
    ['SET_VALUE', /\b(nhap|dien|enter|type|fill)\b/],
    ['TOGGLE', /\b(bat|tat|enable|disable|toggle)\b/],
    ['CREATE_RECORD', /\b(tao|them|luu|create|add|save)\b/],
    ['READ_VALUE', /\b(doc|read|ra soat)\b/],
  ] as const) if (pattern.test(source)) families.push(name);
  return families;
}

export function sourceSlots(original: string, apps: readonly PlanningApp[] = []): SourcePlan {
  const map: { start: number; end: number }[] = []; let normalized = '';
  for (const segment of new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(original)) {
    const text = segment.segment.normalize('NFC'); normalized += text;
    for (let i = 0; i < text.length; i++) map.push({ start: segment.index, end: segment.index + segment.segment.length });
  }
  const leading = normalized.length - normalized.trimStart().length, request = normalized.trim();
  if (!request || request.length > 2000) throw Error('Invalid bounded source.');
  const mask = commandMask(request), clauses: SourcePlan['clauses'] = []; let start = 0;
  const add = (end: number) => {
    while (start < end && /\s/.test(request[start])) start++;
    while (end > start && /\s/.test(request[end - 1])) end--;
    while (end > start && /[.!?]/.test(mask[end - 1])) end--;
    while (end > start && /\s/.test(request[end - 1])) end--;
    if (end > start) {
      const compound = enterSearchBoundary(mask.slice(start, end));
      if (compound) {
        const split = start + compound.end;
        clauses.push({ id: clauses.length + 1, text: request.slice(start, split), start, end: split, slots: [] });
        start += compound.next;
      }
      clauses.push({ id: clauses.length + 1, text: request.slice(start, end), start, end, slots: [] });
    }
  };
  for (const boundary of mask.matchAll(/[,;]|\s+(?:and then|sau do|tiep theo|va|roi|nhung|and|then|but)\s+/g)) {
    add(boundary.index!); start = boundary.index! + boundary[0].length;
  }
  add(request.length);
  if (!clauses.length || clauses.length > 12) throw Error('Source clause budget exceeded.');
  if (clauses.length > 1 && clauses.some(c => sourcePrimitiveFamilies(c.text).some(f => ['SEARCH', 'SET_VALUE', 'CREATE_RECORD'].includes(f))) && clauses.some(c => !sourcePrimitiveFamilies(c.text).length)) throw Error('NEEDS_CLARIFICATION: ambiguous unquoted clause or connector; quote a value containing connectors.');
  let next = 1;
  for (const clause of clauses) {
    const slot = (a: number, b: number, kind: SourceSlot['kind'], ambiguous = false) => {
      if (a < clause.start || b > clause.end || a >= b) return;
      const existing = clause.slots.find(s => s.start === a && s.end === b);
      if (existing) { existing.ambiguous ||= ambiguous; if (kind === 'KNOWN_APP') existing.kind = kind; return; }
      clause.slots.push({ id: next++, clauseId: clause.id, text: request.slice(a, b), start: a, end: b,
        rawStart: map[a + leading].start, rawEnd: map[b - 1 + leading].end, kind, ambiguous });
    };
    for (const quoted of clause.text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\u201c[^\u201d]*\u201d/g)) slot(clause.start + quoted.index!, clause.start + quoted.index! + quoted[0].length, 'QUOTED');
    const unquoted = commandMask(clause.text);
    for (const number of unquoted.matchAll(/\b\d+(?:[.:]\d+)*\b/g)) slot(clause.start + number.index!, clause.start + number.index! + number[0].length, 'NUMBER');
    for (const app of apps) for (const name of [app.packageName, app.label].filter((s): s is string => Boolean(s))) {
      const escaped = foldIntent(name.normalize('NFC')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const m of foldIntent(clause.text).matchAll(new RegExp(`(?<![\\p{L}\\p{N}_.])${escaped}(?![\\p{L}\\p{N}_.])`, 'giu'))) {
        const matches = new Set(apps.filter(a => [a.packageName, a.label].some(n => n && foldIntent(n.normalize('NFC')) === m[0])).map(a => a.packageName));
        slot(clause.start + m.index!, clause.start + m.index! + m[0].length, 'KNOWN_APP', matches.size !== 1);
      }
    }
    for (const p of unquoted.matchAll(/\b[A-Za-z][\w]*(?:\.[\w]+)+\b/g)) slot(clause.start + p.index!, clause.start + p.index! + p[0].length, 'PACKAGE');
    const known = understandOutcomes(clause.text).outcomes[0];
    const families = sourcePrimitiveFamilies(clause.text, clause.slots.filter(s => ['KNOWN_APP', 'PACKAGE'].includes(s.kind)).map(s => ({ start: s.start - clause.start, end: s.end - clause.start }))), valueFamily = families.length === 1 && ['SEARCH', 'SET_VALUE', 'CREATE_RECORD'].includes(families[0]) ? families[0] : undefined;
    if (valueFamily && !clause.slots.some(s => s.kind === 'QUOTED')) {
      const value = maximalValueSpan(clause.text, unquoted, valueFamily)!;
      let a = value.start, b = value.end;
      const appSlots = clause.slots.filter(s => s.kind === 'KNOWN_APP' || s.kind === 'PACKAGE');
      const qualifiers = appSlots.filter(s => /\b(in|on|trong|tren)\s+$/.test(unquoted.slice(a, s.start - clause.start)));
      if (qualifiers.length > 1 || qualifiers.some(s => s.ambiguous)) throw Error('NEEDS_CLARIFICATION: ambiguous application qualifier.');
      if (qualifiers.length) {
        const app = qualifiers[0], before = unquoted.slice(a, app.start - clause.start);
        if (/^(?:in|on|trong|tren)\s+$/.test(before)) {
          a = app.end - clause.start;
          const separator = /^\s+(?:(?:for|ve|voi tu khoa|tu khoa|noi dung)\s+)?/.exec(unquoted.slice(a, b));
          if (!separator) throw Error('NEEDS_CLARIFICATION: missing query after app qualifier.');
          a += separator[0].length;
        } else if (app.end - clause.start === b) b = a + before.search(/\s+(?:in|on|trong|tren)\s+$/);
        else throw Error('NEEDS_CLARIFICATION: ambiguous value/application boundary.');
      } else if (/^(?:in|on|trong|tren)\s+/.test(unquoted.slice(a, b))) throw Error('NEEDS_CLARIFICATION: unknown application qualifier.');
      while (b > a && /\s/.test(clause.text[b - 1])) b--;
      ({ start: a, end: b } = trimValueSyntax(clause.text, unquoted, a, b, valueFamily === 'SEARCH'));
      if (a >= b) throw Error('NEEDS_CLARIFICATION: empty value.');
      clause.slots = clause.slots.filter(s => ['KNOWN_APP', 'PACKAGE'].includes(s.kind) && (s.end <= clause.start + a || s.start >= clause.start + b));
      slot(clause.start + a, clause.start + b, 'SOURCE');
      continue;
    }
    if (known.kind !== 'UNKNOWN') {
      const a = clause.text.indexOf(known.value);
      if (a >= 0 && clause.text.indexOf(known.value, a + 1) < 0) slot(clause.start + a, clause.start + a + known.value.length, 'SOURCE');
    }
    if (!clause.slots.some(s => ['QUOTED', 'PACKAGE', 'KNOWN_APP'].includes(s.kind))) {
      for (const word of [...clause.text.matchAll(/\S+/g)].slice(1, 7)) slot(clause.start + word.index!, clause.end, 'SOURCE');
    }
    if (!clause.slots.length || clause.slots.length > 16) throw Error('SOURCE_SLOT_UNAVAILABLE_OR_OVER_BUDGET');
  }
  return { original, request, clauses };
}
