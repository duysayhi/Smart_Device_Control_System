export interface ValueSpan { start: number; end: number }
import { politeWords, searchWords, trimValueSyntax } from './natural-phrasing';
export { courtesySuffix } from './natural-phrasing';
// The caller supplies a length-preserving, quoted-data-masked command view.
export function maximalValueSpan(text: string, mask: string, family: string): ValueSpan | undefined {
  const verbs: Record<string, string> = {
    SEARCH: searchWords,
    SET_VALUE: 'nhap|dien|enter|type|fill', CREATE_RECORD: 'tao|them|luu|dat|create|add|save',
  };
  if (!verbs[family]) return;
  const prefix = new RegExp('^(?:(?:' + politeWords + ')\\s+)*(?:(?:khong(?: duoc)?|dung|do not|don\'t|never)\\s+)?(?:' + verbs[family] + ')\\s');
  const verb = prefix.exec(mask);
  if (!verb) throw Error('NEEDS_CLARIFICATION: value-taking action has no unambiguous prefix.');
  const { start, end } = trimValueSyntax(text, mask, verb[0].length, text.length, family === 'SEARCH');
  if (/\b(and|then|but|va|roi|nhung|sau do)\s*$/.test(mask.slice(start, end))) throw Error('NEEDS_CLARIFICATION: trailing connector in unquoted value.');
  if (start >= end) throw Error('NEEDS_CLARIFICATION: missing full value.');
  return { start, end };
}
