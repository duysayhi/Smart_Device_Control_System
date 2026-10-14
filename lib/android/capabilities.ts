import type { Action } from '../validators/action-plan.schema';
import { ANDROID_TARGETS, isSupportedTarget } from './targets';

export const APP_PACKAGE_ALIASES: Record<string, string> = {
  chrome: 'com.android.chrome', youtube: 'com.google.android.youtube', settings: 'com.android.settings',
};
export const ANDROID_ACTIONS = ['OPEN_APP', 'CLOSE_APP', 'WAIT_FOR', 'CLICK', 'INPUT_TEXT', 'PRESS_KEY', 'SWIPE'] as const;
export const ADB_KEYBOARD = 'com.android.adbkeyboard/.AdbIME';
export const needsAdbKeyboard = (text: string) => /[^\x20-\x7e]|%s/.test(text);
export function videoOrdinal(target: string): number | undefined {
  const match = target.match(/^video_card_([1-9]\d?)$/);
  return match ? Number(match[1]) : undefined;
}

export function resolveAppPackage(app: string): string {
  const value = APP_PACKAGE_ALIASES[app.trim().toLowerCase()] ?? app.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value)) {
    throw new Error(`Unsupported app: ${app}. Use ${Object.keys(APP_PACKAGE_ALIASES).join(', ')} or a package name.`);
  }
  return value;
}

export function validateAndroidPlan(actions: Action[], dynamicUi = false): void {
  let app: string | undefined;
  actions.forEach((action, index) => {
    try {
      if (!ANDROID_ACTIONS.some((type) => type === action.type)) throw new Error('Unsupported action.');
      if (action.type === 'OPEN_APP' || action.type === 'CLOSE_APP') {
        const packageName = resolveAppPackage(action.app);
        if (action.type === 'OPEN_APP') app = packageName;
        else if (app === packageName) app = undefined;
      }
      if (action.type === 'CLICK' || action.type === 'WAIT_FOR') {
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
Appium State Observer overrides the visible-thumbnail limit above: video_card_1..99 are supported for YouTube.
video_card_N means the Nth ordinary video result across the list, excluding ads and Shorts. The executor discovers it through bounded, verified scrolling.
Preserve the requested ordinal exactly. Never replace an unsupported ordinal with another video or claim that discovery is guaranteed.`;
}
