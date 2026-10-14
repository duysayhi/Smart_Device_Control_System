import { z } from 'zod';
import type { LocatedElement } from '../state-observer';
import type { Observation } from '../state-observer';
import type { UiNode } from '../targets';
import { AndroidExecutionError } from '../errors';
import { videoOrdinal } from '../capabilities';

export const ExplorationConfigSchema = z.object({
  maxScrolls: z.number().int().min(0).max(30).default(24),
  timeoutMs: z.number().int().min(100).max(180000).default(120000),
  scrollPercent: z.number().min(.1).max(.5).default(.35),
  emptyVideoScrollPercent: z.number().min(.1).max(.9).default(.9),
  videoScrollPercent: z.number().min(.1).max(.6).default(.6),
  scrollSpeed: z.number().int().min(200).max(1500).default(700),
  maxUnchanged: z.number().int().min(1).max(3).default(2),
  settleTimeoutMs: z.number().int().min(100).max(10000).default(4000),
  maxElements: z.number().int().min(5).max(500).default(150),
});
export type ExplorationConfig = z.infer<typeof ExplorationConfigSchema>;
export function explorationConfig(): ExplorationConfig {
  const number = (key: string) => process.env[key] === undefined ? undefined : Number(process.env[key]);
  try {
    return ExplorationConfigSchema.parse({ maxScrolls: number('ANDROID_EXPLORATION_MAX_SCROLLS'),
      timeoutMs: number('ANDROID_EXPLORATION_TIMEOUT_MS'), scrollPercent: number('ANDROID_EXPLORATION_SCROLL_PERCENT'),
      emptyVideoScrollPercent: number('ANDROID_EXPLORATION_EMPTY_VIDEO_SCROLL_PERCENT'),
      videoScrollPercent: number('ANDROID_EXPLORATION_VIDEO_SCROLL_PERCENT'),
      scrollSpeed: number('ANDROID_EXPLORATION_SCROLL_SPEED'),
      maxUnchanged: number('ANDROID_EXPLORATION_MAX_UNCHANGED'), settleTimeoutMs: number('ANDROID_EXPLORATION_SETTLE_TIMEOUT_MS'), maxElements: number('ANDROID_EXPLORATION_MAX_ELEMENTS') });
  } catch (error) { throw new AndroidExecutionError('CONFIG_ERROR', 'Invalid Android exploration limits. Check ANDROID_EXPLORATION_* configuration.', { cause: error }); }
}
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export type ExplorationGoal = { kind: 'target'; target: string; direction: ScrollDirection } |
  { kind: 'ordinal'; target: string; itemType: 'video' | 'browser' | 'list'; ordinal: number; direction: ScrollDirection };
export function explorationGoal(target: string): ExplorationGoal {
  const video = videoOrdinal(target);
  const generic = target.match(/^(result|list_item)_([1-9]\d?)$/);
  if (video !== undefined) return { kind: 'ordinal', target, itemType: 'video', ordinal: video, direction: 'down' };
  if (target === 'first_result' || generic?.[1] === 'result') return { kind: 'ordinal', target, itemType: 'browser', ordinal: target === 'first_result' ? 1 : Number(generic![2]), direction: 'down' };
  if (generic) return { kind: 'ordinal', target, itemType: 'list', ordinal: Number(generic[2]), direction: 'down' };
  return { kind: 'target', target, direction: 'down' };
}
export type ExplorationStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SCROLL_LIMIT_REACHED' | 'TIMEOUT' | 'DEVICE_ERROR' | 'SESSION_ERROR' | 'CANCELLED' | 'UNKNOWN';
export type ExplorationPhase = 'SEARCHING' | 'CHECKING_LIST' | 'SCROLLING' | 'WAITING_DATA' | 'FOUND' | 'VERIFYING' | 'NOT_FOUND' | 'AMBIGUOUS';
export interface ExplorationMetrics {
  phase: ExplorationPhase; status?: ExplorationStatus; scrollCount: number; snapshotCount: number;
  newElements: number; duplicateElements: number; elapsedMs: number; aiCalls: number; aiElapsedMs: number; reason?: string;
}
export interface DiscoveredSelection { itemType: 'video' | 'browser' | 'list'; identity: string; title: string; url?: string; ordinal: number }
export interface ExplorationResult {
  status: ExplorationStatus; metrics: ExplorationMetrics; reason?: string; found?: LocatedElement; selection?: DiscoveredSelection;
  blockedTarget?: { snapshot: Observation; node: UiNode; selection: DiscoveredSelection; target: string };
}
