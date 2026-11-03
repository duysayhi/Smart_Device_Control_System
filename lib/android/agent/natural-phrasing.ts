// Reviewed syntax only. Matching uses the caller's quote-masked, offset-preserving view.
export const phrasingLexicon = Object.freeze({
  courtesy: Object.freeze(['giup minh', 'giup toi', 'giup em', 'gium minh', 'gium toi', 'gium', 'dum minh', 'dum toi', 'dum', 'cho minh', 'cho toi', 'nhe', 'nha', 'voi', 'please', 'for me']),
  politePrefix: Object.freeze(['nho ban', 'nho', 'vui long', 'lam on', 'xin', 'hay', 'could you', 'can you', 'would you']),
  enter: Object.freeze(['truy cap', 'khoi chay', 'khoi dong', 'bring up', 'go to', 'open', 'launch', 'visit', 'access', 'start', 'vao', 'ghe', 'mo']),
  search: Object.freeze(['tim kiem', 'tra cuu', 'look up', 'look for', 'search for', 'search', 'lookup', 'find', 'loc', 'tim', 'tra', 'do']),
  descriptor: Object.freeze(['tai lieu', 'tep tin', 'thu muc', 'buc anh', 'hinh anh', 'file', 'folder', 'document', 'image', 'photo', 'anh']),
  named: Object.freeze(['co ten la', 'co ten', 'ten la', 'ten', 'named', 'called', 'titled']),
});
const alternatives = (items: readonly string[]) => [...items].sort((a, b) => b.length - a.length).join('|');
export const courtesyWords = alternatives(phrasingLexicon.courtesy);
export const politeWords = alternatives([...phrasingLexicon.courtesy, ...phrasingLexicon.politePrefix]);
export const enterWords = alternatives(phrasingLexicon.enter);
export const searchWords = alternatives(phrasingLexicon.search);
export const courtesySuffix = new RegExp('\\s+(?:' + courtesyWords + ')\\s*$');
const leadingCourtesy = new RegExp('^(?:' + courtesyWords + ')(?:\\s|$)');
const trailingCourtesy = new RegExp('(?:' + courtesyWords + ')\\s*$');
const courtesySurfaces = new Set(['giúp mình', 'giúp tôi', 'giúp em', 'giùm mình', 'giùm tôi', 'giùm', 'dùm mình', 'dùm tôi', 'dùm', 'cho mình', 'cho tôi', 'nhé', 'nhá', 'nha', 'với', 'please', 'for me']);
const courtesySurface = (value: string) => {
  const s = value.trim().normalize('NFC').toLowerCase();
  return Array.from(s).every(char => char.charCodeAt(0) < 128) || courtesySurfaces.has(s);
};
const descriptor = new RegExp('^(?:(?:a|an|the|mot)\\s+)?(?:' + alternatives(phrasingLexicon.descriptor) + ')\\s+(?:' + alternatives(phrasingLexicon.named) + ')\\s');

export function trimValueSyntax(text: string, mask: string, start: number, end: number, descriptors = true) {
  for (;;) {
    const previous = start + ':' + end;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /[\s.!?]/.test(text[end - 1]) && mask[end - 1] === text[end - 1]) end--;
    const prefix = leadingCourtesy.exec(mask.slice(start, end));
    if (prefix && courtesySurface(text.slice(start, start + prefix[0].length))) start += prefix[0].length;
    const suffix = trailingCourtesy.exec(mask.slice(start, end));
    if (suffix && suffix.index > 0 && courtesySurface(text.slice(start + suffix.index, end)) && /\s/.test(text[start + suffix.index - 1])) {
      end = start + suffix.index;
      while (end > start && /\s/.test(text[end - 1])) end--;
    }
    if (descriptors) { const intro = descriptor.exec(mask.slice(start, end)); if (intro) start += intro[0].length; }
    if (previous === start + ':' + end) return { start, end };
  }
}

export function enterSearchBoundary(mask: string): { end: number; next: number } | undefined {
  const prefix = new RegExp('^(?:(?:' + politeWords + ')\\s+)*(?:(?:do not|never|khong(?: duoc)?|dung)\\s+)?(?:' + enterWords + ')\\s+').exec(mask);
  if (!prefix) return;
  const rest = mask.slice(prefix[0].length);
  const boundaryWords = alternatives(phrasingLexicon.search.filter(word => word !== 'do'));
  const boundary = new RegExp('\\s+(?:(?:roi|de|to|and then|and|then)\\s+)?(?=(?:' + boundaryWords + ')\\s+)').exec(rest);
  if (!boundary || !rest.slice(0, boundary.index).trim()) return;
  return { end: prefix[0].length + boundary.index, next: prefix[0].length + boundary.index + boundary[0].length };
}
