import { z } from 'zod';
import { parseChromeRequest } from '../capabilities';

export const BrowserResultSchema = z.object({ surface: z.literal('BROWSER_ORGANIC'), ordinal: z.number().int().min(1).max(99), query: z.string().min(1).max(1000) }).strict();
export type BrowserResultRequest = z.infer<typeof BrowserResultSchema>;
export const browserResultDescriptor = Object.freeze({
  applications: Object.freeze(['chrome', 'com.android.chrome']), packages: Object.freeze(['com.android.chrome']),
  addressFields: /^(?:url_bar|address_bar|omnibox)$/, ordinal: 1,
});
export function browserResultRequest(source: string): BrowserResultRequest | undefined {
  const application = /^mở\s+(?:ứng dụng\s+)?([^\s,]+)/i.exec(source.normalize('NFC').trim())?.[1].toLowerCase();
  if (!application || !browserResultDescriptor.applications.includes(application)) return;
  const parsed = parseChromeRequest(source);
  return parsed?.query && parsed.ordinal ? { surface: 'BROWSER_ORGANIC', ordinal: parsed.ordinal, query: parsed.query } : undefined;
}
