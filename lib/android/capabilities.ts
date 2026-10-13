import type { Action } from '../validators/action-plan.schema';
import { ANDROID_TARGETS, isSupportedTarget } from './targets';

export const APP_PACKAGE_ALIASES: Record<string, string> = {
  chrome: 'com.android.chrome', youtube: 'com.google.android.youtube', settings: 'com.android.settings',
};
export const ANDROID_ACTIONS = ['OPEN_APP', 'CLOSE_APP', 'WAIT_FOR', 'CLICK', 'INPUT_TEXT', 'PRESS_KEY', 'SWIPE'] as const;
export const ADB_KEYBOARD = 'com.android.adbkeyboard/.AdbIME';
export const needsAdbKeyboard = (text: string) => /[^\x20-\x7e]|%s/.test(text);

export function resolveAppPackage(app: string): string {
  const value = APP_PACKAGE_ALIASES[app.trim().toLowerCase()] ?? app.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value)) {
    throw new Error(`Unsupported app: ${app}. Use ${Object.keys(APP_PACKAGE_ALIASES).join(', ')} or a package name.`);
  }
  return value;
}

export function validateAndroidPlan(actions: Action[]): void {
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
        if (!isSupportedTarget(action.target)) throw new Error(`Unsupported target: ${action.target}.`);
        if (!action.target.includes(':') && app !== APP_PACKAGE_ALIASES.youtube) {
          throw new Error('Semantic targets require OPEN_APP youtube first. Other apps require id:, text: or accessibility_id: selectors.');
        }
        if (action.type === 'CLICK' && action.target === 'video_list') throw new Error('CLICK requires video_card_1..5, not video_list.');
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
