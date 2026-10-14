import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Action } from '../validators/action-plan.schema';
import { ADB_KEYBOARD, needsAdbKeyboard, resolveAppPackage, validateAndroidPlan } from './capabilities';
import { findUiTarget, parseUiHierarchy } from './targets';

export type AdbRunner = (args: string[], timeoutMs?: number) => Promise<{ stdout: string; stderr: string }>;

// adb shell joins arguments on the remote shell, so host-side execFile alone is not sufficient.
export const quoteAndroidShell = (value: string) => `'${value.split("'").join(["'", '"', "'", '"', "'"].join(''))}'`;

class UiNotReadyError extends Error {}

export function createAndroidExecutor(run: AdbRunner) {
  const shell = async (serial: string, args: string[], timeoutMs?: number) =>
    (await run(['-s', serial, 'shell', ...args.map(quoteAndroidShell)], timeoutMs)).stdout.trim();

  async function readUi(serial: string, timeoutMs = 20000) {
    const path = `/data/local/tmp/phone-commander-${randomUUID()}.xml`;
    const deadline = Date.now() + timeoutMs;
    try {
      const output = await shell(serial, ['uiautomator', 'dump', path], Math.max(1, deadline - Date.now()));
      if (/could not get idle state|null root node/i.test(output)) throw new UiNotReadyError('UI hierarchy is not ready.');
      return parseUiHierarchy(await shell(serial, ['cat', path], Math.max(1, deadline - Date.now())));
    } finally {
      await shell(serial, ['rm', '-f', path], 1000).catch(() => undefined);
    }
  }

  async function waitFor(serial: string, target: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    do {
      let node;
      try {
        node = findUiTarget(await readUi(serial, Math.max(1, deadline - Date.now())), target);
      } catch (error) {
        if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${target}.`, { cause: error });
        if (!(error instanceof UiNotReadyError)) throw error;
      }
      if (node && Date.now() <= deadline) return node;
      if (Date.now() < deadline) await delay(Math.min(350, deadline - Date.now()));
    } while (Date.now() < deadline);
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${target}.`);
  }

  async function verifyInput(serial: string, text: string) {
    const deadline = Date.now() + 5000;
    do {
      const nodes = await readUi(serial, Math.max(1, deadline - Date.now()));
      if (nodes.some((node) => node.focused && /EditText|AutoCompleteTextView/.test(node.className) && node.text.includes(text))) return;
      if (Date.now() < deadline) await delay(Math.min(150, deadline - Date.now()));
    } while (Date.now() < deadline);
    throw new Error('The focused field did not contain the requested text after input.');
  }

  async function preflight(serial: string, actions: Action[], requiresAdbKeyboard = true, dynamicUi = false) {
    validateAndroidPlan(actions, dynamicUi);
    const packages = new Set(actions.flatMap((action) =>
      action.type === 'OPEN_APP' || action.type === 'CLOSE_APP' ? [resolveAppPackage(action.app)] : []));
    for (const app of packages) {
      const output = await shell(serial, ['pm', 'path', app]);
      if (!output.startsWith('package:')) throw new Error(`App is not installed: ${app}.`);
    }
    if (requiresAdbKeyboard && actions.some((action) => action.type === 'INPUT_TEXT' && needsAdbKeyboard(action.text))) {
      const keyboards = await shell(serial, ['ime', 'list', '-s']);
      if (!keyboards.split(/\r?\n/).includes(ADB_KEYBOARD)) {
        throw new Error('Vietnamese/Unicode input requires installed and enabled ADB Keyboard (com.android.adbkeyboard/.AdbIME). No actions were executed.');
      }
    }
  }

  async function execute(serial: string, action: Action) {
    switch (action.type) {
      case 'OPEN_APP': {
        const output = await shell(serial, ['monkey', '-p', resolveAppPackage(action.app), '-c', 'android.intent.category.LAUNCHER', '1']);
        if (/monkey aborted|no activities found|error:/i.test(output)) throw new Error(output);
        return;
      }
      case 'CLOSE_APP':
        await shell(serial, ['am', 'force-stop', resolveAppPackage(action.app)]);
        return;
      case 'WAIT_FOR':
        await waitFor(serial, action.target, action.timeoutMs);
        return;
      case 'CLICK': {
        const node = await waitFor(serial, action.target, 20000);
        const [left, top, right, bottom] = node.bounds;
        await shell(serial, ['input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2))]);
        return;
      }
      case 'INPUT_TEXT': {
        const nodes = await readUi(serial);
        if (!nodes.some((node) => node.enabled && node.focused && /EditText|AutoCompleteTextView/.test(node.className))) {
          throw new Error('INPUT_TEXT requires a focused editable field. CLICK the input field first.');
        }
        if (!needsAdbKeyboard(action.text)) {
          await shell(serial, ['input', 'text', action.text.replace(/ /g, '%s')]);
          await verifyInput(serial, action.text);
          return;
        }
        const previous = await shell(serial, ['settings', 'get', 'secure', 'default_input_method']);
        if (!previous || previous === 'null') throw new Error('Cannot determine the current keyboard for restoration.');
        try {
          await shell(serial, ['ime', 'set', ADB_KEYBOARD]);
          const deadline = Date.now() + 3000;
          while (true) {
            const status = await shell(serial, ['dumpsys', 'input_method']);
            if (status.includes(ADB_KEYBOARD) && /(?:mInputShown|inputShown)=true/.test(status)) break;
            if (Date.now() >= deadline) throw new Error('ADB Keyboard did not become ready.');
            await delay(150);
          }
          await shell(serial, ['am', 'broadcast', '-a', 'ADB_INPUT_B64', '-p', 'com.android.adbkeyboard', '--es', 'msg', Buffer.from(action.text, 'utf8').toString('base64')]);
          await verifyInput(serial, action.text);
        } finally {
          await shell(serial, ['ime', 'set', previous]);
        }
        return;
      }
      case 'PRESS_KEY': {
        const keys = { HOME: '3', BACK: '4', ENTER: '66', VOLUME_UP: '24', VOLUME_DOWN: '25' };
        await shell(serial, ['input', 'keyevent', keys[action.key]]);
        return;
      }
      case 'SWIPE': {
        const size = await shell(serial, ['wm', 'size']);
        const match = [...size.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)].pop();
        if (!match) throw new Error('Cannot read screen dimensions.');
        const width = Number(match[1]), height = Number(match[2]);
        const coordinates = {
          up: [width * .5, height * .8, width * .5, height * .2],
          down: [width * .5, height * .2, width * .5, height * .8],
          left: [width * .8, height * .5, width * .2, height * .5],
          right: [width * .2, height * .5, width * .8, height * .5],
        };
        await shell(serial, ['input', 'swipe', ...coordinates[action.direction].map((value) => String(Math.round(value))), '350']);
        return;
      }
      case 'SCREENSHOT':
        throw new Error('SCREENSHOT must be handled by the screenshot endpoint.');
    }
  }
  return { execute, preflight };
}
