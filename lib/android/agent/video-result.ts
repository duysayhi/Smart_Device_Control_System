import { randomUUID } from 'node:crypto';
import type { Observation } from '../state-observer';
import type { AdbRunner } from '../executor';
import { createMediaPlaybackVerifier, readPlayingSession } from '../media-playback-verifier';
import { discoveryCandidates, videoChannelEvidence } from '../exploration/element-memory';
import { detectScrollRegion, isDescendant } from '../exploration/scroll-regions';
import { explorationGoal } from '../exploration/types';
import type { UIExplorer } from '../exploration/ui-explorer';
import { canonicalUiText, normalizeUiText } from '../ui-understanding';
import type { GoalNodeV2 } from './goal-graph';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import type { VerifiedEvidence } from './evidence-predicates';
import { isVerifiedEvidence, searchEvidenceScope } from './verification-registry';
import { observedAffordances } from './ui-affordances';
import { videoResultDescriptor } from './video-result-contract';
import { observeYouTubeState, observedVideoAdSkip, videoSeconds } from './youtube-state';

export type VideoDiscoveryMemory = ReturnType<UIExplorer['memorySummary']>;
export interface VideoResultScope {
  readonly id: string; readonly deviceId: string; readonly executionId: string; readonly nodeId: string; readonly sessionId: string;
  readonly packageName: string; readonly query: string; readonly ordinal: number; readonly identity: string; readonly title: string;
  readonly channel?: string; readonly searchEvidenceId: string; readonly before: Observation;
  readonly durationSeconds?: number;
}
const scopes = new WeakMap<VideoResultScope, { signature: string; attempted: boolean; acknowledged: boolean; rows: string[]; playAttempted?: boolean; playAcknowledged?: boolean;
  pausedIdentity?: { at: number; currentSeconds: number; durationSeconds: number }; skipAttempted?: boolean; skipAcknowledged?: boolean }>();
const candidates = new WeakMap<GroundedCandidateV2, VideoResultScope>();
const visible = (s: Observation) => s.nodes.filter(n => n.displayed !== false && n.enabled);
function fresh(s: Observation, deviceId: string, packageName: string) {
  return s.deviceSerial === deviceId && s.foregroundPackage === packageName && s.observationStatus === 'OBSERVED' &&
    Date.now() >= s.timestamp && Date.now() - s.timestamp <= 5000 && !visible(s).some(n => /Dialog|ProgressBar/.test(n.className) ||
      /permissioncontroller|packageinstaller/.test(n.packageName) || /keyguard|bouncer/.test(n.resourceId));
}
function rows(s: Observation, ordinal: number) {
  const goal = explorationGoal('video_card_' + ordinal), region = detectScrollRegion(s, goal, 'down');
  if (region.status !== 'FOUND') return;
  const result = discoveryCandidates(s, region.region, goal);
  return result.status === 'OBSERVED' ? result.candidates : undefined;
}
function exactQuery(s: Observation, query: string) {
  const fields = visible(s).filter(n => n.packageName === s.foregroundPackage && n.resourceId.endsWith(':id/search_query'));
  return fields.length === 1 && fields[0].text.normalize('NFC').trim() === query.normalize('NFC').trim();
}
function active(scope: VideoResultScope) {
  const state = scopes.get(scope);
  return state && state.signature === JSON.stringify(scope) && Date.now() - scope.before.timestamp <= 120000 ? state : undefined;
}
export function beginVideoResult(node: GoalNodeV2, snapshot: Observation, search: VerifiedEvidence, sessionId: string, memory: VideoDiscoveryMemory): VideoResultScope {
  const request = node.outcome.videoResult, prior = searchEvidenceScope(search);
  if (node.capability !== 'SELECT_RESULT' || !request || request.ordinal > videoResultDescriptor.maxOrdinal || !sessionId ||
    !node.packageName || !videoResultDescriptor.packages.includes(node.packageName) || !isVerifiedEvidence(search) ||
    prior?.sessionId !== sessionId || prior.packageName !== node.packageName || search.predicate.kind !== 'SEARCH_OUTCOME_MATCHES' ||
    search.predicate.query !== request.query || search.search?.status !== 'RESULTS' || !node.dependencies.includes(search.nodeId) ||
    search.observedAt > snapshot.timestamp || Date.now() - search.observedAt > 120000 || !fresh(snapshot, search.deviceId, node.packageName) ||
    !exactQuery(snapshot, request.query)) throw Error('VIDEO_SEARCH_PROVENANCE_UNPROVEN');
  const remembered = memory.items.filter(r => r.ordinal === request.ordinal && r.itemType === 'video');
  const current = rows(snapshot, request.ordinal), selected = current?.filter(r => r.identity === remembered[0]?.identity && !r.partial);
  if (!memory.anchored || remembered.length !== 1 || selected?.length !== 1 ||
    memory.items.some((r, i) => r.ordinal !== i + 1 || r.itemType !== 'video') || new Set(memory.items.map(r => r.identity)).size !== memory.items.length ||
    current!.some(r => !memory.items.some(m => m.identity === r.identity))) throw Error('VIDEO_ORDINAL_CONTINUITY_UNPROVEN');
  const row = selected[0], channelEvidence = videoChannelEvidence(row.node.description);
  if (channelEvidence.ambiguous) throw Error('VIDEO_CHANNEL_IDENTITY_AMBIGUOUS');
  const channel = channelEvidence.channel;
  const durationSeconds = row.node.description.split(/\s[-–—]\s/).map(videoSeconds).find(n => n !== undefined);
  const scope: VideoResultScope = Object.freeze({ id: randomUUID(), deviceId: search.deviceId, executionId: search.executionId, nodeId: node.id, sessionId,
    packageName: node.packageName, query: request.query, ordinal: request.ordinal, identity: row.identity, title: row.title,
    ...(channel ? { channel } : {}), ...(durationSeconds ? { durationSeconds } : {}), searchEvidenceId: search.id, before: structuredClone(snapshot) });
  scopes.set(scope, { signature: JSON.stringify(scope), attempted: false, acknowledged: false, rows: current!.map(r => r.identity) });
  return scope;
}
export function videoResultTarget(scope: VideoResultScope, snapshot: Observation) {
  const state = active(scope), current = rows(snapshot, scope.ordinal);
  if (!state || state.attempted || !fresh(snapshot, scope.deviceId, scope.packageName) || !exactQuery(snapshot, scope.query) ||
    !current || JSON.stringify(current.map(r => r.identity)) !== JSON.stringify(state.rows)) return;
  const selected = current.filter(r => r.identity === scope.identity && r.title === scope.title && !r.partial);
  if (selected.length !== 1) return;
  const index = snapshot.nodes.indexOf(selected[0].node);
  return observedAffordances(snapshot, scope.executionId, scope.sessionId).find(a => a.index === index && a.roles.includes('clickable') && !a.sensitive && !a.destructive);
}
export function bindVideoResultCandidate(candidate: GroundedCandidateV2, scope: VideoResultScope) { candidates.set(candidate, scope); }
export function videoAdSkipTarget(scope: VideoResultScope, snapshot: Observation) {
  const state = active(scope);
  if (!state?.acknowledged || state.skipAttempted || !fresh(snapshot, scope.deviceId, scope.packageName)) return;
  return observedVideoAdSkip(snapshot, observedAffordances(snapshot, scope.executionId, scope.sessionId));
}
export function videoPlayTarget(scope: VideoResultScope, snapshot: Observation) {
  const state = active(scope);
  const ui = videoUiIdentity(scope, snapshot), paused = state?.pausedIdentity;
  const independentPaused = ui?.tier === 'UI_CHANNEL_DURATION_PROGRESS' && paused && Date.now() >= paused.at && Date.now() - paused.at <= 5000 &&
    paused.currentSeconds === ui.currentSeconds && paused.durationSeconds === ui.durationSeconds;
  if (!state?.acknowledged || state.playAttempted || !ui || ui.tier !== 'UI_TITLE_CHANNEL' && !independentPaused || observeYouTubeState(snapshot).state !== 'VIDEO_PLAYER_PAUSED') return;
  const players = snapshot.nodes.filter(n => /:id\/(watch_player|video_player|player_view)$/.test(n.resourceId));
  const targets = observedAffordances(snapshot, scope.executionId, scope.sessionId).filter(a => a.roles.includes('clickable') && !a.sensitive && !a.destructive &&
    /^(play|play video|phat|phat video)$/.test(normalizeUiText(a.label)) && players.some(p => isDescendant(snapshot.nodes, snapshot.nodes[a.index], p)));
  return targets.length === 1 ? targets[0] : undefined;
}
// Admission evidence for one Play action, never a completion receipt. A paused
// native clock/channel/duration must agree with a fresh, unique MediaSession's
// exact title/channel and paused position. Dispatch independently checks the UI
// again; a changed clock, expired observation or UNKNOWN Play cannot reuse it.
export function createPausedVideoIdentityReader(run: AdbRunner, deviceId: string) {
  return async (scope: VideoResultScope, snapshot: Observation, remainingMs: number, signal?: AbortSignal): Promise<boolean> => {
    const state = active(scope); if (state) delete state.pausedIdentity;
    signal?.throwIfAborted();
    const ui = videoUiIdentity(scope, snapshot);
    if (scope.deviceId !== deviceId || !state?.acknowledged || state.playAttempted || !scope.channel || ui?.tier !== 'UI_CHANNEL_DURATION_PROGRESS' ||
      observeYouTubeState(snapshot).state !== 'VIDEO_PLAYER_PAUSED') return false;
    let output: string;
    try { output = (await run(['-s', deviceId, 'shell', 'dumpsys', 'media_session'], Math.max(1, Math.min(3000, remainingMs)), { signal })).stdout; }
    catch { signal?.throwIfAborted(); return false; }
    signal?.throwIfAborted();
    const blocks = output.split(/(?=^[ \t]*package=)/m).filter(b => /^[ \t]*package=(\S+)/m.exec(b)?.[1] === scope.packageName);
    if (blocks.length !== 1 || !/^[ \t]*active=true\s*$/m.test(blocks[0])) return false;
    const position = /state=PlaybackState \{state=2, position=(\d+),/.exec(blocks[0]);
    const fields = /^[ \t]*metadata: size=\d+, description=(.+)$/m.exec(blocks[0])?.[1].trim().split(', ');
    if (!position || !fields || fields.length < 3 || canonicalUiText(fields.slice(0, -2).join(', ')) !== canonicalUiText(scope.title) ||
      canonicalUiText(fields.at(-2)!) !== canonicalUiText(scope.channel) || Math.abs(Number(position[1]) - ui.currentSeconds * 1000) > 1000 ||
      !videoUiIdentity(scope, snapshot) || Date.now() - snapshot.timestamp > 5000) return false;
    state.pausedIdentity = { at: Date.now(), currentSeconds: ui.currentSeconds, durationSeconds: ui.durationSeconds };
    return true;
  };
}
export function videoResultCandidateAllowed(candidate: GroundedCandidateV2, node?: GoalNodeV2) {
  const scope = candidates.get(candidate), state = scope && active(scope);
  const play = candidate.videoResult?.phase === 'PLAY', skip = candidate.videoResult?.phase === 'SKIP_AD';
  const nodeId = scope && (play || skip && candidate.nodeId === scope.nodeId + ':playback' ? scope.nodeId + ':playback' : scope.nodeId);
  return Boolean(scope && state && (skip ? state.acknowledged && !state.skipAttempted : play ? state.acknowledged && !state.playAttempted : !state.attempted) && candidate.videoResult?.scopeId === scope.id && candidate.action === 'CLICK' && candidate.effect === 'READ' &&
    candidate.deviceId === scope.deviceId && candidate.executionId === scope.executionId && candidate.sessionId === scope.sessionId && candidate.nodeId === nodeId &&
    (!node || node.id === nodeId && node.capability === (nodeId === scope.nodeId ? 'SELECT_RESULT' : 'VERIFY_PLAYBACK') && node.packageName === scope.packageName &&
      node.outcome.videoResult?.ordinal === scope.ordinal && node.outcome.videoResult.query === scope.query));
}
export function freshVideoResultTarget(candidate: GroundedCandidateV2, snapshot: Observation) {
  const scope = candidates.get(candidate); return scope && (candidate.videoResult?.phase === 'SKIP_AD' ? videoAdSkipTarget(scope, snapshot) : candidate.videoResult?.phase === 'PLAY' ? videoPlayTarget(scope, snapshot) : videoResultTarget(scope, snapshot));
}
export function beforeVideoResultDispatch(candidate: GroundedCandidateV2, snapshot: Observation) {
  const scope = candidates.get(candidate), state = scope && active(scope);
  if (!scope || !state || !videoResultCandidateAllowed(candidate) || !freshVideoResultTarget(candidate, snapshot)) throw Error('VIDEO_RESULT_STALE_OR_REPLAYED');
  if (candidate.videoResult?.phase === 'SKIP_AD') state.skipAttempted = true;
  else if (candidate.videoResult?.phase === 'PLAY') state.playAttempted = true;
  else state.attempted = true;
}
export function acknowledgeVideoResult(candidate: GroundedCandidateV2) {
  const scope = candidates.get(candidate), state = scope && active(scope);
  if (candidate.videoResult?.phase === 'SKIP_AD') {
    if (!state?.skipAttempted || state.skipAcknowledged) throw Error('VIDEO_AD_SKIP_DISPATCH_UNPROVEN');
    state.skipAcknowledged = true; return;
  }
  if (candidate.videoResult?.phase === 'PLAY') {
    if (!state?.playAttempted || state.playAcknowledged) throw Error('VIDEO_PLAY_DISPATCH_UNPROVEN');
    state.playAcknowledged = true; return;
  }
  if (!state?.attempted || state.acknowledged) throw Error('VIDEO_DISPATCH_UNPROVEN');
  state.acknowledged = true;
}
export function videoUiIdentity(scope: VideoResultScope, snapshot: Observation) {
  const state = active(scope);
  if (!state?.acknowledged || !fresh(snapshot, scope.deviceId, scope.packageName) || snapshot.snapshotId === scope.before.snapshotId ||
    snapshot.timestamp < scope.before.timestamp || snapshot.screen !== 'VIDEO_PLAYER') return;
  const nodes = visible(snapshot);
  // A player must have its own scoped metadata; recommendations/title elsewhere
  // on the screen are not evidence for the selected destination.
  const titles = nodes.filter(n => /:id\/(?:video_title|modern_title|player_title)$/.test(n.resourceId));
  const channels = nodes.filter(n => /:id\/(?:channel_name|owner_name|player_channel)$/.test(n.resourceId));
  const allPlayers = nodes.filter(n => /:id\/(?:watch_player|player_view|video_player)$/.test(n.resourceId));
  const players = allPlayers.filter(n => !allPlayers.some(p => p !== n && isDescendant(snapshot.nodes, n, p)));
  if (players.length !== 1 || titles.length > 1 || titles.length === 1 && canonicalUiText(titles[0].text || titles[0].description) !== canonicalUiText(scope.title) ||
    nodes.some(n => /(?:^|[_:/])(?:ad_badge|ad_player|ad_overlay|player_ads|skip_ad|shorts_player)(?:$|[_/])/.test(n.resourceId) ||
      /:id\/(?:buffering|loading|error_message)$/.test(n.resourceId) ||
      /^(?:ad|advertisement|sponsored|quang cao|video unavailable|this video is unavailable|video khong kha dung|buffering|loading)$/.test(normalizeUiText(n.text || n.description)))) return;
  if (titles.length === 1) {
    if (scope.channel && (channels.length !== 1 || canonicalUiText(channels[0].text || channels[0].description) !== canonicalUiText(scope.channel))) return;
    return { tier: 'UI_TITLE_CHANNEL' as const };
  }
  // New native watch UI may omit the title from accessibility. This branch is
  // intentionally stronger than a MediaSession-only fallback: metadata channel,
  // result duration, native SeekBar and later synchronized UI/media progression.
  const metadata = nodes.filter(n => n.resourceId.endsWith(':id/video_metadata_layout'));
  if (!scope.channel || !scope.durationSeconds || metadata.length !== 1) return;
  const header = nodes.filter(n => isDescendant(snapshot.nodes, n, metadata[0]) && /\s[\d.,]+(?:\s*(?:[KMBN]|Tr|nghìn|triệu))?\s+(?:người đăng ký|subscribers)$/i.test(canonicalUiText(n.description || n.text)));
  const channel = header[0] && canonicalUiText(header[0].description || header[0].text).replace(/\s[\d.,]+(?:\s*(?:[KMBN]|Tr|nghìn|triệu))?\s+(?:người đăng ký|subscribers)$/i, '');
  const clocks = nodes.filter(n => /SeekBar$/.test(n.className) && (isDescendant(snapshot.nodes, n, players[0]) ||
    nodes.some(p => p.resourceId.endsWith(':id/watch_while_time_bar_view') && isDescendant(snapshot.nodes, n, p))));
  if (header.length !== 1 || channel !== canonicalUiText(scope.channel) || clocks.length !== 1) return;
  const parts = (clocks[0].description || clocks[0].text).split(/\s*\/\s*/);
  const current = parts.length === 2 ? videoSeconds(parts[0]) : undefined, total = parts.length === 2 ? videoSeconds(parts[1]) : undefined;
  if (current === undefined || total === undefined || current >= total || Math.abs(total - scope.durationSeconds) > 1) return;
  return { tier: 'UI_CHANNEL_DURATION_PROGRESS' as const, currentSeconds: current, durationSeconds: total };
}
export function videoSelectionReadback(scope: VideoResultScope, snapshot: Observation) {
  const ui = videoUiIdentity(scope, snapshot); if (!ui) return;
  return Object.freeze({ query: scope.query, ordinal: scope.ordinal, identity: scope.identity, title: scope.title, channel: scope.channel, searchEvidenceId: scope.searchEvidenceId, identityTier: ui.tier });
}
export type VideoPlaybackStatus = 'CORRECT_VIDEO_PLAYING' | 'CORRECT_VIDEO_PAUSED' | 'CORRECT_VIDEO_BUFFERING' | 'WRONG_VIDEO_OPENED' | 'AD_PLAYING' | 'PLAYBACK_IDENTITY_UNVERIFIED' | 'PLAYBACK_PROGRESS_UNVERIFIED' | 'PLAYER_UNAVAILABLE';
export function videoPlaybackStatus(scope: VideoResultScope, snapshot: Observation): VideoPlaybackStatus {
  const screen = observeYouTubeState(snapshot).state;
  if (screen === 'AD_OVERLAY') return 'AD_PLAYING';
  if (screen === 'VIDEO_PLAYER_BUFFERING') {
    const titles = snapshot.nodes.filter(n => n.displayed !== false && /:id\/(video_title|modern_title|player_title)$/.test(n.resourceId));
    const channels = snapshot.nodes.filter(n => n.displayed !== false && /:id\/(channel_name|owner_name|player_channel)$/.test(n.resourceId));
    return titles.length === 1 && canonicalUiText(titles[0].text || titles[0].description) === canonicalUiText(scope.title) &&
      (!scope.channel || channels.length === 1 && canonicalUiText(channels[0].text || channels[0].description) === canonicalUiText(scope.channel)) ? 'CORRECT_VIDEO_BUFFERING' : 'PLAYBACK_IDENTITY_UNVERIFIED';
  }
  if (snapshot.nodes.some(n => /unavailable|private|age.restricted|khong kha dung/.test(normalizeUiText(n.text || n.description)))) return 'PLAYER_UNAVAILABLE';
  if (!videoUiIdentity(scope, snapshot)) return snapshot.nodes.some(n => /:id\/(video_title|modern_title|player_title)$/.test(n.resourceId) && (n.text || n.description)) ? 'WRONG_VIDEO_OPENED' : 'PLAYBACK_IDENTITY_UNVERIFIED';
  return screen === 'VIDEO_PLAYER_PAUSED' ? 'CORRECT_VIDEO_PAUSED' : 'PLAYBACK_PROGRESS_UNVERIFIED';
}
export interface VideoPlaybackReceipt {
  scopeId: string; sessionId: string; snapshot: Observation; positionMs: number; previousPositionMs: number;
}
const receipts = new WeakMap<VideoPlaybackReceipt, { scope: VideoResultScope; signature: string }>();
export const videoPlaybackReceiptMatches = (receipt: VideoPlaybackReceipt, scope: VideoResultScope) => receipts.get(receipt)?.scope === scope && receipts.get(receipt)?.signature === JSON.stringify(receipt) &&
  receipt.scopeId === scope.id && receipt.sessionId === scope.sessionId && Boolean(videoSelectionReadback(scope, receipt.snapshot));
// Uses the existing independent MediaSession reader. No click or retry is
// performed here. A receipt cannot be manufactured from an arbitrary UI payload.
export function createVideoPlaybackReader(run: AdbRunner, deviceId: string) {
  let expectedChannel: string | undefined;
  const scopedRun: AdbRunner = async (args, timeoutMs) => {
    const result = await run(args, timeoutMs);
    if (args.includes('dumpsys') && expectedChannel && canonicalUiText(readPlayingSession(result.stdout, videoResultDescriptor.packages[0])?.channel ?? '') !== canonicalUiText(expectedChannel)) return { ...result, stdout: '' };
    return result;
  };
  let verify = createMediaPlaybackVerifier(scopedRun, deviceId);
  let previousUi: { scopeId: string; snapshotId: string; current: number } | undefined;
  return async (scope: VideoResultScope, snapshot: Observation, remainingMs: number, signal?: AbortSignal): Promise<VideoPlaybackReceipt | undefined> => {
    signal?.throwIfAborted();
    const ui = videoUiIdentity(scope, snapshot);
    if (scope.deviceId !== deviceId || !ui || observeYouTubeState(snapshot).state === 'VIDEO_PLAYER_PAUSED') { previousUi = undefined; verify = createMediaPlaybackVerifier(scopedRun, deviceId); return; }
    const uiAdvance = ui.tier === 'UI_TITLE_CHANNEL' || previousUi?.scopeId === scope.id && previousUi.snapshotId !== snapshot.snapshotId && ui.currentSeconds > previousUi.current;
    if (ui.tier === 'UI_CHANNEL_DURATION_PROGRESS') previousUi = { scopeId: scope.id, snapshotId: snapshot.snapshotId, current: ui.currentSeconds };
    expectedChannel = scope.channel;
    const after = structuredClone(snapshot); // The independent reader clears any carried playback before reading.
    if (!await verify({ itemType: 'video', ordinal: scope.ordinal, identity: scope.identity, title: scope.title }, scope.before, after, remainingMs, signal) || !uiAdvance ||
      ui.tier === 'UI_CHANNEL_DURATION_PROGRESS' && Math.abs(after.playback!.positionMs / 1000 - ui.currentSeconds) > 3 ||
      !videoSelectionReadback(scope, after) || !after.playback) return;
    const receipt = Object.freeze({ scopeId: scope.id, sessionId: scope.sessionId, snapshot: after,
      positionMs: after.playback.positionMs, previousPositionMs: after.playback.previousPositionMs });
    receipts.set(receipt, { scope, signature: JSON.stringify(receipt) }); return receipt;
  };
}
