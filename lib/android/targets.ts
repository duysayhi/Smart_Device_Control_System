import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface UiNode {
  resourceId: string;
  text: string;
  description: string;
  packageName: string;
  enabled: boolean;
  clickable: boolean;
  focused: boolean;
  className: string;
  bounds: [number, number, number, number];
  displayed?: boolean;
  parentIndex?: number;
  focusable?: boolean;
  scrollable?: boolean;
  selected?: boolean;
  checkable?: boolean;
  checked?: boolean;
  password?: boolean;
  showingHint?: boolean;
  hint?: string;
  observedAttributes?: string[];
}

export const ANDROID_TARGETS = [
  'search_button', 'video_list', 'video_card_1', 'video_card_2', 'video_card_3',
  'video_card_4', 'video_card_5', 'subscribe_button', 'like_button',
  'comment_button', 'play_button', 'back_button',
] as const;

export function isSupportedTarget(target: string): boolean {
  return ANDROID_TARGETS.some((name) => name === target) || /^(id|text|accessibility_id):\S.*$/.test(target);
}

export function parseUiHierarchy(xml: string): UiNode[] {
  if (XMLValidator.validate(xml) !== true) throw new Error('UIAutomator returned invalid XML.');
  const root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(xml);
  if (!Object.hasOwn(root, 'hierarchy')) throw new Error('UIAutomator hierarchy is missing.');
  const nodes: UiNode[] = [];
  function visit(value: Record<string, unknown>, parentIndex?: number, parentEnabled = true) {
    const match = String(value.bounds ?? '').match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    let currentIndex = parentIndex;
    if (match) {
      const [left, top, right, bottom] = match.slice(1).map(Number);
      if (right > left && bottom > top) {
        currentIndex = nodes.length;
        nodes.push({
        resourceId: String(value['resource-id'] ?? ''), text: String(value.text ?? ''),
        description: String(value['content-desc'] ?? ''), packageName: String(value.package ?? ''),
        enabled: parentEnabled && value.enabled !== 'false', clickable: value.clickable === 'true',
        focused: value.focused === 'true', className: String(value.class ?? ''),
        bounds: [left, top, right, bottom],
        displayed: value.displayed !== 'false', parentIndex,
        focusable: value.focusable === undefined ? undefined : value.focusable === 'true',
        scrollable: value.scrollable === undefined ? undefined : value.scrollable === 'true',
        selected: value.selected === undefined ? undefined : value.selected === 'true',
        checkable: value.checkable === undefined ? undefined : value.checkable === 'true',
        checked: value.checked === undefined ? undefined : value.checked === 'true',
        password: value.password === undefined ? undefined : value.password === 'true',
        showingHint: value['showing-hint'] === undefined ? undefined : value['showing-hint'] === 'true',
        hint: value['hint-text'] === undefined && value.hint === undefined ? undefined : String(value['hint-text'] ?? value.hint),
        observedAttributes: Object.keys(value).filter((key) => key !== 'node'),
      });
      }
    }
    // Appium tags may be class names; standalone uiautomator uses <node>.
    for (const child of Object.values(value)) {
      const children = Array.isArray(child) ? child : child && typeof child === 'object' ? [child] : [];
      for (const nested of children) {
        if (nested && typeof nested === 'object') visit(nested as Record<string, unknown>, currentIndex, parentEnabled && value.enabled !== 'false');
      }
    }
  }
  if (root.hierarchy && typeof root.hierarchy === 'object') visit(root.hierarchy);
  return nodes;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\u0111/g, 'd').trim();
const labels: Record<string, string[]> = {
  search_button: ['search', 'tim kiem'], subscribe_button: ['subscribe', 'dang ky'],
  like_button: ['like', 'thich'], comment_button: ['comments', 'comment', 'binh luan'],
  play_button: ['play', 'phat'], back_button: ['back', 'navigate up', 'quay lai'],
};
const ids: Record<string, string[]> = {
  search_button: ['menu_search', 'search', 'search_button'], subscribe_button: ['subscribe_button'],
  like_button: ['like_button'], comment_button: ['comments_entry_point_header', 'comment_button'],
  play_button: ['player_control_play_pause_replay_button'], back_button: ['up', 'back_button'],
};

export function findUiTarget(nodes: UiNode[], target: string): UiNode | undefined {
  const visible = nodes.filter((node) => node.enabled && node.displayed !== false);
  const explicit = target.match(/^(id|text|accessibility_id):(.+)$/);
  if (explicit) return visible.find((node) =>
    explicit[1] === 'id' ? node.resourceId === explicit[2] :
      explicit[1] === 'text' ? node.text === explicit[2] : node.description === explicit[2]);

  const youtube = visible.filter((node) => node.packageName === 'com.google.android.youtube');
  // New YouTube layouts expose video cards through accessibility descriptions without IDs.
  const labeledCards = youtube.filter((node) => node.clickable &&
    /\s-\s(?:phat video|play video)$/.test(normalize(node.description)));
  const describedCards = labeledCards.filter((node) =>
    !/(?:^|\s-\s)(?:quang cao|duoc tai tro|sponsored|ad|advertisement)(?:\s-\s|$)/.test(normalize(node.description)));
  const thumbnails = youtube.filter((node) => /:id\/(thumbnail|video_thumbnail)$/.test(node.resourceId));
  const cards = [...describedCards, ...thumbnails.filter((thumbnail) => !labeledCards.some((card) =>
    thumbnail.bounds[0] >= card.bounds[0] && thumbnail.bounds[1] >= card.bounds[1] &&
    thumbnail.bounds[2] <= card.bounds[2] && thumbnail.bounds[3] <= card.bounds[3]))]
    .filter((node, index, all) => all.findIndex((other) => other.bounds.join() === node.bounds.join()) === index)
    .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
  if (target === 'video_list') return cards[0] ?? findYouTubeVideoNodes(youtube)[0];
  const card = target.match(/^video_card_([1-5])$/);
  if (card) return cards[Number(card[1]) - 1];
  const candidates = youtube.filter((node) => node.clickable);
  const byLabel = candidates.find((node) => (labels[target] ?? []).some((label) =>
    [node.text, node.description].some((value) => {
      const normalized = normalize(value);
      return normalized === label || normalized.startsWith(`${label},`);
    })));
  return byLabel ?? candidates.find((node) => (ids[target] ?? []).some((id) => node.resourceId.endsWith(`:id/${id}`))) ??
    (target === 'search_button' ? youtube.find((node) => node.resourceId.endsWith(':id/search_query')) : undefined);
}

export function findYouTubeVideoNodes(nodes: UiNode[]): UiNode[] {
  return nodes.filter((node) => node.packageName === 'com.google.android.youtube' && node.enabled && node.displayed !== false &&
    ((node.clickable && /\s[-\u2013\u2014]\s(?:phat video(?: ngan)?|play video|play short)$/.test(normalize(node.description))) ||
      /:id\/(thumbnail|video_thumbnail)$/.test(node.resourceId)) &&
    !/(?:quang cao|duoc tai tro|sponsored|advertisement)/.test(normalize(node.description)));
}
