import { findUiTarget, findYouTubeVideoNodes, type UiNode } from './targets';

export type AndroidScreenState = 'YOUTUBE_BROWSE' | 'SEARCH_INPUT' | 'SEARCH_RESULTS' | 'VIDEO_PLAYER' | 'LOADING' | 'OBSERVED' | 'INPUT' | 'UNKNOWN';
export interface Viewport { x: number; y: number; width: number; height: number }

export function classifyScreen(packageName: string, nodes: UiNode[]): AndroidScreenState {
  const visible = nodes.filter((node) => node.enabled && node.displayed !== false);
  if (!packageName || !visible.length || !visible.some((node) => node.text || node.description || node.clickable || node.focusable)) return 'UNKNOWN';
  if (packageName !== 'com.google.android.youtube') return visible.some((node) => node.focused && /EditText|AutoCompleteTextView/.test(node.className)) ? 'INPUT' : 'OBSERVED';
  if (visible.some((node) => node.resourceId.endsWith(':id/search_edit_text') && /EditText/.test(node.className))) return 'SEARCH_INPUT';
  const hasQuery = visible.some((node) => node.resourceId.endsWith(':id/search_query') && node.text.trim());
  const results = visible.find(node => node.resourceId.endsWith(':id/results') && /RecyclerView|ListView/.test(node.className));
  const renderedResults = results && visible.some(node => {
    if (!(node.text.trim() || node.description.trim()) || node === results) return false;
    let parent = node.parentIndex;
    const visited = new Set<number>();
    while (parent !== undefined && !visited.has(parent)) {
      visited.add(parent);
      if (nodes[parent] === results) return true;
      parent = nodes[parent]?.parentIndex;
    }
    return false;
  });
  // Ads, channel cards and empty-result messages are search results too. Video
  // discovery is a separate condition and may require scrolling below them.
  if (hasQuery && (renderedResults || findYouTubeVideoNodes(visible).length)) return 'SEARCH_RESULTS';
  const watchMetadata = visible.filter(node => node.resourceId.endsWith(':id/video_metadata_layout'));
  // Some watch pages expose empty metadata. This classifies the destination only;
  // the selected title still needs independent UI or Media Session verification.
  const watchPlayers = visible.filter(node => node.resourceId.endsWith(':id/watch_player'));
  if (!hasQuery && watchPlayers.length === 1 && watchMetadata.length === 1 &&
    watchPlayers[0].bounds[3] > watchPlayers[0].bounds[1] &&
    watchMetadata[0].bounds[1] >= watchPlayers[0].bounds[3] &&
    watchMetadata[0].bounds[3] > watchMetadata[0].bounds[1]) return 'VIDEO_PLAYER';
  if (!hasQuery && visible.some(node => node.resourceId.endsWith(':id/watch_player')) && watchMetadata.length === 1 && visible.some(node => {
    if (!(node.text.trim() || node.description.trim())) return false;
    if (node === watchMetadata[0]) return true;
    let parent = node.parentIndex;
    const seen = new Set<number>();
    while (parent !== undefined && !seen.has(parent)) {
      seen.add(parent);
      if (nodes[parent] === watchMetadata[0]) return true;
      parent = nodes[parent]?.parentIndex;
    }
    return false;
  })) return 'VIDEO_PLAYER';
  if (!hasQuery && visible.some(node => node.resourceId.endsWith(':id/watch_player')) &&
    visible.some(node => node.resourceId.endsWith(':id/video_metadata_layout')) &&
    visible.some(node => node.resourceId.endsWith(':id/modern_title') && (node.text || node.description))) return 'VIDEO_PLAYER';
  if (!hasQuery && visible.some((node) => node.resourceId.endsWith(':id/player_view')) &&
    visible.some((node) => /subscribe|subscribed|đăng ký|Đăng ký/i.test(node.description + ' ' + node.text))) return 'VIDEO_PLAYER';
  if (visible.some((node) => node.resourceId.endsWith(':id/load_progress'))) return 'LOADING';
  if (findUiTarget(visible, 'search_button')) return 'YOUTUBE_BROWSE';
  return 'OBSERVED';
}

export function isNodeInteractable(node: UiNode, nodes: UiNode[], viewport: Viewport, target: string, nodeIndex = nodes.indexOf(node)): boolean {
  if (!node.bounds.every(Number.isFinite) || ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) return false;
  if (!node.enabled || !node.clickable || node.displayed === false) return false;
  const [left, top, right, bottom] = node.bounds;
  const width = right - left, height = bottom - top;
  if (width < 24 || height < (/^video_card_/.test(target) ? 96 : 24)) return false;
  let clip = [viewport.x, viewport.y, viewport.x + viewport.width, viewport.y + viewport.height];
  let parentIndex = node.parentIndex;
  while (parentIndex !== undefined) {
    const parent = nodes[parentIndex];
    if (!parent || !parent.enabled || parent.displayed === false) return false;
    clip = [Math.max(clip[0], parent.bounds[0]), Math.max(clip[1], parent.bounds[1]), Math.min(clip[2], parent.bounds[2]), Math.min(clip[3], parent.bounds[3])];
    parentIndex = parent.parentIndex;
  }
  const area = Math.max(0, Math.min(right, clip[2]) - Math.max(left, clip[0])) * Math.max(0, Math.min(bottom, clip[3]) - Math.max(top, clip[1]));
  if (area / (width * height) < .9) return false;
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const ancestorOfTarget = (index: number) => {
    let parent = node.parentIndex;
    while (parent !== undefined) { if (parent === index) return true; parent = nodes[parent]?.parentIndex; }
    return false;
  };
  // Android element.click taps the center. A nested/sibling control at that point
  // can perform a different action (for example opening a video's product panel).
  return !nodes.some((other, index) => index !== nodeIndex && other.enabled && other.clickable && other.displayed !== false &&
    !ancestorOfTarget(index) && other.bounds[0] <= centerX && other.bounds[2] > centerX && other.bounds[1] <= centerY && other.bounds[3] > centerY);
}
