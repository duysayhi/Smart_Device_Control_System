import type { Observation } from '../state-observer';
import { normalizeUiText } from '../ui-understanding';
import { videoResultDescriptor } from './video-result-contract';
import type { ObservedAffordance } from './ui-affordances';
import { isDescendant } from '../exploration/scroll-regions';
import { videoSeconds } from '../video-metadata';
export { videoSeconds } from '../video-metadata';

export type YouTubeState = 'APP_NOT_OPEN' | 'YOUTUBE_HOME' | 'SEARCH_ENTRY' | 'SEARCH_SUGGESTIONS' | 'SEARCH_RESULTS' |
  'VIDEO_PLAYER' | 'VIDEO_PLAYER_PAUSED' | 'VIDEO_PLAYER_BUFFERING' | 'FULLSCREEN_PLAYER' | 'MINI_PLAYER' | 'SHORTS_PLAYER' |
  'POPUP_OR_DIALOG' | 'AD_OVERLAY' | 'NETWORK_ERROR' | 'UNKNOWN_SCREEN';
export function hasFullscreenVideoSurface(snapshot: Observation): boolean {
  return videoResultDescriptor.packages.includes(snapshot.foregroundPackage) && snapshot.nodes.some(n => n.displayed !== false && n.enabled &&
    /:id\/(?:watch_player|player_view|video_player)$/.test(n.resourceId) &&
    (n.bounds[2] - n.bounds[0]) * (n.bounds[3] - n.bounds[1]) >= snapshot.viewport.width * snapshot.viewport.height * .85);
}
export function observeYouTubeState(snapshot: Observation): { state: YouTubeState; searchAvailable: boolean; miniPlayer: boolean } {
  const nodes = snapshot.nodes.filter(n => n.displayed !== false && n.enabled);
  const label = (n: typeof nodes[number]) => normalizeUiText(n.description || n.text);
  const searchAvailable = nodes.some(n => n.clickable && /^(search|tim kiem)$/.test(label(n)));
  const miniPlayer = nodes.some(n => /:id\/.*miniplayer/.test(n.resourceId));
  const result = (state: YouTubeState) => ({ state, searchAvailable, miniPlayer });
  if (snapshot.observationStatus !== 'OBSERVED') return result('UNKNOWN_SCREEN');
  if (!videoResultDescriptor.packages.includes(snapshot.foregroundPackage)) return result('APP_NOT_OPEN');
  if (nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /Dialog|PopupWindow/.test(n.className))) return result('POPUP_OR_DIALOG');
  if (nodes.some(n => /^(?:you.re offline|no connection|no internet connection|check your connection|khong co ket noi|ban dang ngoai tuyen|kiem tra ket noi)/.test(label(n)))) return result('NETWORK_ERROR');
  const input = nodes.filter(n => /EditText/.test(n.className) && /search|query/.test(n.resourceId));
  if (input.length === 1) return result(input[0].text.trim() ? 'SEARCH_SUGGESTIONS' : 'SEARCH_ENTRY');
  if (nodes.some(n => n.resourceId.endsWith(':id/search_query') && n.text.trim()) && nodes.some(n => n.resourceId.endsWith(':id/results'))) return result('SEARCH_RESULTS');
  if (nodes.some(n => /:id\/(?:shorts_player|reel_watch_player|reel_player_page_container)$/.test(n.resourceId))) return result('SHORTS_PLAYER');
  if (nodes.some(n => /:id\/(?:ad_badge|ad_player|ad_overlay|player_ads|skip_ad|ad_skip_button)(?:$|_)/.test(n.resourceId))) return result('AD_OVERLAY');
  const players = nodes.filter(n => /:id\/(?:watch_player|player_view|video_player)$/.test(n.resourceId));
  if (players.length) {
    if (nodes.some(n => /ProgressBar/.test(n.className) || /:id\/(buffering|loading)/.test(n.resourceId))) return result('VIDEO_PLAYER_BUFFERING');
    if (nodes.some(n => n.clickable && /^(play|play video|phat|phat video)$/.test(label(n)))) return result('VIDEO_PLAYER_PAUSED');
    if (!searchAvailable && hasFullscreenVideoSurface(snapshot)) return result('FULLSCREEN_PLAYER');
    return result('VIDEO_PLAYER');
  }
  if (miniPlayer) return result('MINI_PLAYER');
  if (nodes.some(n => n.selected && /^(home|trang chu)$/.test(label(n)))) return result('YOUTUBE_HOME');
  return result('UNKNOWN_SCREEN');
}

export function observedVideoAdSkip(snapshot: Observation, rows: readonly ObservedAffordance[]): ObservedAffordance | undefined {
  if (observeYouTubeState(snapshot).state !== 'AD_OVERLAY') return;
  const targets = rows.filter(a => a.packageName === snapshot.foregroundPackage && a.enabled && a.roles.includes('clickable') && !a.sensitive && !a.destructive &&
    videoResultDescriptor.adSkipControlIds.some(id => a.resourceId === snapshot.foregroundPackage + ':id/' + id) &&
    (!a.label.trim() || /^(skip(?: ads?)?|bo qua(?: quang cao)?)$/.test(normalizeUiText(a.label))));
  return targets.length === 1 ? targets[0] : undefined;
}

export function videoRecommendationOverlay(snapshot: Observation): boolean {
  const d = videoResultDescriptor.recommendation;
  return snapshot.nodes.some(n => n.displayed !== false && n.packageName === snapshot.foregroundPackage && n.resourceId.endsWith(':id/' + d.suggestion) &&
    /^(video de xuat|suggested video|recommended video)\b/.test(normalizeUiText(n.description || n.text)));
}
export function observedVideoRecommendationDismiss(snapshot: Observation, rows: readonly ObservedAffordance[]): ObservedAffordance | undefined {
  if (!['VIDEO_PLAYER', 'VIDEO_PLAYER_PAUSED'].includes(observeYouTubeState(snapshot).state) || !videoRecommendationOverlay(snapshot)) return;
  const d = videoResultDescriptor.recommendation, overlays = snapshot.nodes.filter(n => n.enabled && n.displayed !== false && n.resourceId === snapshot.foregroundPackage + ':id/' + d.overlay);
  if (overlays.length !== 1) return;
  const clocks = snapshot.nodes.filter(n => n.enabled && n.displayed !== false && /SeekBar$/.test(n.className)).map(n => (n.description || n.text).split(/\s*\/\s*/).map(videoSeconds));
  if (clocks.length !== 1 || clocks[0].length !== 2 || !clocks[0][1] || clocks[0][0] !== clocks[0][1]) return;
  const inside = rows.filter(a => a.enabled && a.roles.includes('clickable') && !a.sensitive && !a.destructive && a.packageName === snapshot.foregroundPackage && isDescendant(snapshot.nodes, snapshot.nodes[a.index], overlays[0]));
  if (inside.filter(a => a.resourceId.endsWith(':id/' + d.play) && /^(phat ngay|play now)$/.test(normalizeUiText(a.label))).length !== 1) return;
  const cancel = inside.filter(a => a.resourceId.endsWith(':id/' + d.cancel) && /^(dong|close|cancel)$/.test(normalizeUiText(a.label)));
  return cancel.length === 1 ? cancel[0] : undefined;
}

