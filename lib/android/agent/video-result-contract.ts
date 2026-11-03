import { z } from 'zod';

// Application-specific semantics live in a capability descriptor, not in engine routing.
export const videoResultDescriptor = Object.freeze({ applications: ['youtube', 'com.google.android.youtube'] as readonly string[],
  packages: ['com.google.android.youtube'] as readonly string[], maxOrdinal: 3,
  // Observed on the real native ad surface; never an advertiser CTA.
  adSkipControlIds: ['skip_ad_button'] as readonly string[],
  recommendation: Object.freeze({ overlay: 'player_overlays', suggestion: 'touch_area', play: 'play_button', cancel: 'cancel_button' }) });
export const VideoResultSchema = z.object({ surface: z.literal('YOUTUBE_LONG_VIDEO'), query: z.string().min(1).max(1000),
  ordinal: z.number().int().min(1).max(99), play: z.literal(true) }).strict();
export type VideoResultRequest = z.infer<typeof VideoResultSchema>;
export function videoPlayOrdinal(clause: string): number | undefined {
  const text = clause.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
  const match = /^(?:(?:phat|mo) video (?:(?:thu|so) )?(\d{1,2}|dau tien|nhat|mot|hai|ba)|play (?:the )?(?:(first|second|third) video|video (\d{1,2})))$/.exec(text);
  if (!match) return;
  const value = match[1] ?? match[2] ?? match[3];
  const ordinal = ({ 'dau tien': 1, nhat: 1, mot: 1, first: 1, hai: 2, second: 2, ba: 3, third: 3 } as Record<string, number>)[value] ?? Number(value);
  // The admitted OPEN wording means playback and is deliberately first-only.
  return text.startsWith('mo ') && ordinal !== 1 ? undefined : ordinal;
}
export const videoWaitLimits = () => {
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = process.env[key] === undefined ? fallback : Number(process.env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw Error('Invalid bounded YouTube limit: ' + key);
    return value;
  };
  return { discoveryMs: bounded('AGENT_V2_VIDEO_DISCOVERY_MS', 60000, 1000, 90000), maxObservations: bounded('AGENT_V2_VIDEO_MAX_OBSERVATIONS', 12, 2, 24), waitMs: bounded('AGENT_V2_VIDEO_WAIT_MS', 45000, 1000, 60000),
    intervalMs: bounded('AGENT_V2_VIDEO_POLL_MS', 500, 100, 2000) };
};
