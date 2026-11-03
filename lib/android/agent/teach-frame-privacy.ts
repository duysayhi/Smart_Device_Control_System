/** Parse only the explicitly focused window's complete mAttrs flags block. */
export function focusedWindowPrivacy(source: string, packageName: string): 'SAFE_WINDOW' | 'SECURE_WINDOW' | 'UNKNOWN' {
  const focus = /mCurrentFocus=Window\{([a-fA-F0-9]+)\s+[^\r\n}]*\s([^\s}]+)\}/.exec(source);
  if (!focus || !focus[2].startsWith(packageName + '/')) return 'UNKNOWN';
  const blocks = source.split(/(?=\bWindow #\d+ Window\{)/).filter(b => new RegExp('^Window #\\d+ Window\\{' + focus[1] + '\\s').test(b.trim()));
  if (blocks.length !== 1) return 'UNKNOWN';
  const attrs = /mAttrs=\{([\s\S]*?)\}/.exec(blocks[0])?.[1];
  if (!attrs) return 'UNKNOWN';
  const flags = /(?:^|\s)fl=([^}]*?)(?=\s+[a-zA-Z_][\w]*=|$)/.exec(attrs)?.[1]?.trim();
  if (!flags) return 'UNKNOWN';
  if (/^0x[0-9a-f]+$/i.test(flags)) return (parseInt(flags.slice(2), 16) & 0x2000) !== 0 ? 'SECURE_WINDOW' : 'SAFE_WINDOW';
  if (flags === '0') return 'SAFE_WINDOW';
  if (!/^[A-Z_0-9|\s]+$/.test(flags) || !/[A-Z_]/.test(flags)) return 'UNKNOWN';
  return /(?:^|[\s|])(?:FLAG_)?SECURE(?:$|[\s|])/.test(flags) ? 'SECURE_WINDOW' : 'SAFE_WINDOW';
}
