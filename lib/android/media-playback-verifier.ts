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
}

export function readPlayingSession(output: string, packageName: string) {
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
  return { title, positionMs: Number(state[1]), updated: Number(state[3]) };
}

export function createMediaPlaybackVerifier(run: AdbRunner, serial: string) {
  let previous: ReturnType<typeof readPlayingSession>;
  let previousSnapshot: string | undefined;
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
    let output: string;
    try { output = (await run(['-s', serial, 'shell', 'dumpsys', 'media_session'], Math.max(1, Math.min(3000, remainingMs)))).stdout; }
    catch { checkCancellation(signal); previous = undefined; verifiedFrom = undefined; return false; }
    checkCancellation(signal);
    const current = readPlayingSession(output, after.foregroundPackage);
    if (!current || canonicalUiText(current.title) !== canonicalUiText(selection.title)) {
      previous = undefined;
      verifiedFrom = undefined;
      return false;
    }
    const advancing = previous && previousSnapshot !== after.snapshotId && previous.updated <= current.updated &&
      canonicalUiText(previous.title) === canonicalUiText(current.title) && current.positionMs > previous.positionMs;
    const previousPositionMs = previous?.positionMs ?? current.positionMs;
    if (previous && current.positionMs < previous.positionMs) verifiedFrom = undefined;
    if (advancing && verifiedFrom === undefined) verifiedFrom = previousPositionMs;
    previous = current;
    previousSnapshot = after.snapshotId;
    if (verifiedFrom === undefined || current.positionMs <= verifiedFrom) return false;
    after.playback = { source: 'ADB_MEDIA_SESSION', packageName: after.foregroundPackage,
      title: current.title, positionMs: current.positionMs, previousPositionMs: verifiedFrom };
    return true;
  };
}
