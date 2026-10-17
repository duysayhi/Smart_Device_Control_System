import type { Observation } from './state-observer';
import type { AdbRunner } from './executor';
import type { DiscoveredSelection } from './exploration/types';
import { canonicalUiText } from './ui-understanding';
import { checkCancellation } from './errors';

export interface MediaPlaybackEvidence {
  source: 'ADB_MEDIA_SESSION';
  packageName: string;
  title: string;
  positionMs: number;
  previousPositionMs: number;
  positionSource?: 'ANDROID_PLAYBACK_CLOCK';
}

export function readPlayingSession(output: string, packageName: string, elapsedRealtimeMs?: number) {
  const blocks = output.split(/(?=^[ \t]*package=)/m).filter(block =>
    block.match(/^[ \t]*package=(\S+)/m)?.[1] === packageName);
  if (blocks.length !== 1) return;
  const block = blocks[0];
  if (!/^[ \t]*active=true\s*$/m.test(block)) return;
  const state = block.match(/state=PlaybackState \{state=3, position=(\d+), buffered position=\d+, speed=([\d.]+), updated=(\d+)/);
  const description = block.match(/^[ \t]*metadata: size=\d+, description=(.+)$/m)?.[1].trim();
  if (!state || !description || Number(state[2]) <= 0) return;
  // Android's dump exposes MediaDescription as title, subtitle, description.
  // Require all three fields; unsupported/ambiguous formats fail closed.
  const fields = description.split(', ');
  if (fields.length < 3) return;
  const title = fields.slice(0, -2).join(', ').trim();
  if (!title) return;
  const reportedPositionMs = Number(state[1]), updated = Number(state[3]), speed = Number(state[2]);
  if (![reportedPositionMs, updated, speed].every(Number.isFinite)) return;
  // PlaybackState position is a baseline at `updated`, not a ticking counter.
  // Android's elapsed-realtime clock is needed when the app does not republish it.
  if (elapsedRealtimeMs !== undefined && (!Number.isFinite(elapsedRealtimeMs) || elapsedRealtimeMs < updated)) return;
  const positionMs = elapsedRealtimeMs === undefined ? reportedPositionMs :
    Math.floor(reportedPositionMs + (elapsedRealtimeMs - updated) * speed);
  return { title, positionMs, updated, reportedPositionMs };
}

export function createMediaPlaybackVerifier(run: AdbRunner, serial: string) {
  let previous: ReturnType<typeof readPlayingSession>;
  let previousSnapshot: string | undefined;
  let previousClockBased = false;
  let verifiedFrom: number | undefined;
  return async (selection: DiscoveredSelection, before: Observation, after: Observation,
    remainingMs: number, signal?: AbortSignal): Promise<boolean> => {
    checkCancellation(signal);
    if (selection.itemType !== 'video' || !selection.title || after.observationStatus !== 'OBSERVED' ||
      after.foregroundPackage !== before.foregroundPackage || after.screen !== 'VIDEO_PLAYER' ||
      before.screen === 'VIDEO_PLAYER' || after.deviceSerial !== serial || after.snapshotId === before.snapshotId) {
      previous = undefined;
      verifiedFrom = undefined;
      return false;
    }
    const commandStarted = performance.now();
    let output: string;
    try { output = (await run(['-s', serial, 'shell', 'dumpsys', 'media_session'], Math.max(1, Math.min(3000, remainingMs)))).stdout; }
    catch { checkCancellation(signal); previous = undefined; verifiedFrom = undefined; return false; }
    checkCancellation(signal);
    let current = readPlayingSession(output, after.foregroundPackage);
    if (!current || canonicalUiText(current.title) !== canonicalUiText(selection.title)) {
      previous = undefined;
      verifiedFrom = undefined;
      return false;
    }
    let clockBased = false;
    try {
      const clock = await run(['-s', serial, 'shell', 'cat', '/proc/uptime'],
        Math.max(1, Math.min(1000, remainingMs - (performance.now() - commandStarted))));
      const uptime = clock.stdout.trim().match(/^(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?$/);
      if (uptime) {
        current = readPlayingSession(output, after.foregroundPackage, Number(uptime[1]) * 1000);
        clockBased = true;
      }
    } catch { checkCancellation(signal); }
    checkCancellation(signal);
    if (!current) { previous = undefined; verifiedFrom = undefined; return false; }
    if (previousClockBased !== clockBased) { previous = undefined; verifiedFrom = undefined; }
    const advancing = previous && previousSnapshot !== after.snapshotId && previous.updated <= current.updated &&
      canonicalUiText(previous.title) === canonicalUiText(current.title) && current.positionMs > previous.positionMs;
    const previousPositionMs = previous?.positionMs ?? current.positionMs;
    if (previous && current.positionMs < previous.positionMs) verifiedFrom = undefined;
    if (advancing && verifiedFrom === undefined) verifiedFrom = previousPositionMs;
    previous = current;
    previousClockBased = clockBased;
    previousSnapshot = after.snapshotId;
    if (verifiedFrom === undefined || current.positionMs <= verifiedFrom) return false;
    after.playback = { source: 'ADB_MEDIA_SESSION', packageName: after.foregroundPackage,
      title: current.title, positionMs: current.positionMs, previousPositionMs: verifiedFrom,
      ...(clockBased ? { positionSource: 'ANDROID_PLAYBACK_CLOCK' as const } : {}) };
    return true;
  };
}
