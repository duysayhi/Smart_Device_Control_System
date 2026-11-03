import type { Action, ActionPlan } from '../validators/action-plan.schema';
import { ANDROID_TARGETS, isSupportedTarget } from './targets';

export const APP_PACKAGE_ALIASES: Record<string, string> = {
  chrome: 'com.android.chrome', youtube: 'com.google.android.youtube', settings: 'com.android.settings',
};
export const ANDROID_ACTIONS = ['OPEN_APP', 'CLOSE_APP', 'WAIT_FOR', 'CLICK', 'INPUT_TEXT', 'PRESS_KEY', 'SWIPE'] as const;
export const ADB_KEYBOARD = 'com.android.adbkeyboard/.AdbIME';
export const needsAdbKeyboard = (text: string) => /[^\x20-\x7e]|%s/.test(text);

export function parseChromeRequest(request: string): { query?: string; ordinal?: number } | undefined {
  const input = request.normalize('NFC').trim();
  const ordinalPattern = '(đầu tiên|thứ (?:hai|ba|tư|bốn|năm|sáu|bảy|tám|chín|mười|\\d+)|\\d+)';
  const noun = '(?:bài(?: viết| hướng dẫn)?|kết quả(?: tìm kiếm)?)';
  const number = (value: string) => {
    const word = value.toLowerCase().replace(/^thứ\s+/, '');
    const n = ({ 'đầu tiên': 1, hai: 2, ba: 3, tư: 4, bốn: 4, năm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10 } as Record<string, number>)[word] ?? Number(word);
    if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('Browser result ordinal must be 1..99.');
    return n;
  };
  const opened = input.match(/^mở\s+(?:ứng dụng\s+)?chrome\s*(?:,|và)?\s*(?:tìm(?:\s+kiếm)?|tra cứu)\s+(.+?)\.?$/i);
  const implicit = opened ? null : input.match(/^tìm(?:\s+kiếm)?\s+(.+)$/i);
  const rest = opened?.[1] ?? implicit?.[1];
  if (rest) {
    const selected = rest.match(new RegExp(`^(.+?)\\s*(?:,\\s*)?(?:\\s+và|\\s+rồi|\\s+sau đó)\\s+(?:mở|chọn|xem|đọc)\\s+${noun}\\s+${ordinalPattern}\\.?$`, 'i'));
    if (selected) return { query: selected[1].trim(), ordinal: number(selected[2]) };
    if (!opened || /(?:,\s*|\s+(?:và|rồi|sau đó)\s+)(?:mở|chọn|xem|đọc|gửi|xóa|đăng|tải|đóng|tắt|bật)\s/i.test(rest)) return;
    return { query: rest.trim() };
  }
  const selection = input.match(new RegExp(`^(?:mở\\s+chrome\\s*(?:,|và)\\s*)?(?:mở|chọn|xem|đọc)\\s+${noun}\\s+${ordinalPattern}(?:\\s+(?:trong|ở)\\s+(?:danh sách|kết quả)(?:\\s+hiện tại)?)?\\.?$`, 'i'));
  if (selection) return { ordinal: number(selection[1]) };
}

export function planChromeCommand(request: string): ActionPlan | undefined {
  const parsed = parseChromeRequest(request);
  if (!parsed) return;
  const actions: Action[] = [{ type: 'OPEN_APP', app: 'chrome' }];
  if (parsed.query) actions.push({ type: 'WAIT_FOR', target: 'address_bar', timeoutMs: 20000 }, { type: 'CLICK', target: 'address_bar' },
    { type: 'INPUT_TEXT', text: parsed.query }, { type: 'PRESS_KEY', key: 'ENTER' });
  // ENTER verifies rendered search results; ordinal click performs its own fresh
  // DOM/native discovery. A YouTube video_list wait is never a browser condition.
  if (parsed.ordinal) actions.push({ type: 'CLICK', target: parsed.ordinal === 1 ? 'first_result' : `result_${parsed.ordinal}` });
  return { intent: parsed.ordinal ? 'chrome_open_search_result' : 'chrome_search', isSensitive: false, actions };
}
export function videoOrdinal(target: string): number | undefined {
  const match = target.match(/^video_card_([1-9]\d?)$/);
  return match ? Number(match[1]) : undefined;
}

export function resolveAppPackage(app: string): string {
  const value = APP_PACKAGE_ALIASES[app.trim().toLowerCase()] ?? app.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value)) {
    throw new Error(`LEGACY_APP_DISCOVERY_REQUIRED: Unsupported app: ${app}. Use the Goal Agent tab for installed-app discovery; Action Plan requires a supported alias or an exact installed package name.`);
  }
  return value;
}

export function validateAndroidPlan(actions: Action[], dynamicUi = false): void {
  let app: string | undefined;
  let inputControlSelected = false;
  actions.forEach((action, index) => {
    try {
      if (!ANDROID_ACTIONS.some((type) => type === action.type)) throw new Error('Unsupported action.');
      if (action.type === 'OPEN_APP' || action.type === 'CLOSE_APP') {
        const packageName = resolveAppPackage(action.app);
        inputControlSelected = false;
        if (action.type === 'OPEN_APP') app = packageName;
        else if (app === packageName) app = undefined;
      }
      if (action.type === 'CLICK' || action.type === 'WAIT_FOR') {
        if (dynamicUi && app === APP_PACKAGE_ALIASES.chrome && action.target === 'video_list') throw new Error('video_list is a YouTube target, not a Chrome search-result condition.');
        if (dynamicUi && (action.target === 'first_result' || action.target.startsWith('result_'))) {
          if (action.target !== 'first_result' && !/^result_[1-9]\d?$/.test(action.target)) throw new Error('Browser result ordinal must be 1..99.');
          if (app !== APP_PACKAGE_ALIASES.chrome) throw new Error('Browser ordinals require OPEN_APP chrome first.');
        }
        if (action.type === 'CLICK' && app === APP_PACKAGE_ALIASES.chrome) {
          inputControlSelected = action.target === 'address_bar' || /^(id|text|accessibility_id|observed):/.test(action.target);
        }
        if (dynamicUi && action.target.startsWith('video_card_')) {
          if (videoOrdinal(action.target) === undefined) throw new Error('Video ordinal must be 1..99.');
          if (app !== APP_PACKAGE_ALIASES.youtube) throw new Error('Video ordinals require OPEN_APP youtube first.');
        }
        if (!dynamicUi && !isSupportedTarget(action.target)) throw new Error(`Unsupported target: ${action.target}.`);
        if (!dynamicUi && !action.target.includes(':') && app !== APP_PACKAGE_ALIASES.youtube) {
          throw new Error('Semantic targets require OPEN_APP youtube first. Other apps require id:, text: or accessibility_id: selectors.');
        }
        if (action.type === 'CLICK' && action.target === 'video_list') throw new Error(`CLICK requires video_card_1..${dynamicUi ? 99 : 5}, not video_list.`);
      }
      if (dynamicUi && app === APP_PACKAGE_ALIASES.chrome && action.type === 'INPUT_TEXT' && !inputControlSelected) {
        throw new Error('Chrome INPUT_TEXT requires CLICK address_bar (or an observed input selector) first.');
      }
      if (action.type === 'PRESS_KEY') inputControlSelected = false;
    } catch (error) {
      throw new Error(`Step ${index + 1} (${action.type}): ${(error as Error).message}`);
    }
  });
}

export const ANDROID_CAPABILITY_PROMPT = `Android executor capabilities:
Actions: ${ANDROID_ACTIONS.join(', ')}.
App aliases: ${Object.keys(APP_PACKAGE_ALIASES).join(', ')}.
Semantic targets (YouTube only): ${ANDROID_TARGETS.join(', ')}.
Other apps: only OPEN_APP, CLOSE_APP, PRESS_KEY, SWIPE unless an exact id:, text: or accessibility_id: selector is provided by the user.
SCREENSHOT is available through the separate screenshot endpoint, not an executable plan action.
video_card_N means the Nth visible video thumbnail, not the Nth result across scrolling. Never CLICK video_list.
Use timeoutMs 20000 for WAIT_FOR after app launch or search submission; UIAutomator dumps can take more than 8 seconds. Never exceed 30000.
Do not invent selectors. Unsupported requests must not be presented as executable actions.`;

export function androidCapabilityPrompt(dynamicUi: boolean): string {
  if (!dynamicUi) return ANDROID_CAPABILITY_PROMPT;
  return `${ANDROID_CAPABILITY_PROMPT}
Appium Chrome overrides the other-app restriction above: address_bar, first_result and result_1..99 are supported in Chrome.
Chrome search sequence: OPEN_APP chrome, WAIT_FOR address_bar, CLICK address_bar, INPUT_TEXT the exact query, PRESS_KEY ENTER.
ENTER independently verifies the query and rendered organic browser results. Do not use video_list for Chrome.
For a requested second article append CLICK result_2; preserve every requested browser ordinal and do not omit selection.
Standalone result_N acts only on the currently observed search-result list; never invent a new search query.
Appium State Observer overrides the visible-thumbnail limit above: video_card_1..99 are supported for YouTube.
video_card_N means the Nth ordinary video result across the list, excluding ads and Shorts. The executor discovers it through bounded, verified scrolling.
Preserve the requested ordinal exactly. Never replace an unsupported ordinal with another video or claim that discovery is guaranteed.`;
}
