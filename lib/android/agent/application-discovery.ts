import type { AdbRunner } from '../executor';
import { APP_PACKAGE_ALIASES } from '../capabilities';
import { checkCancellation } from '../errors';
import { normalizeUiText } from '../ui-understanding';
import type { AgentGoal } from './schema';

export interface DiscoveredApplication { serial: string; requestedName: string; packageName: string; component: string; launchIntent?: 'android.media.action.STILL_IMAGE_CAMERA' }
const verified = new WeakSet<DiscoveredApplication>();
const grants = new WeakMap<AgentGoal, DiscoveredApplication>();
const packagePattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const componentPattern = /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/;
const categoryIntents: Record<string, string[]> = {
  camera: ['-a', 'android.media.action.STILL_IMAGE_CAMERA'],
  'may anh': ['-a', 'android.media.action.STILL_IMAGE_CAMERA'],
  cam: ['-a', 'android.media.action.STILL_IMAGE_CAMERA'],
  calendar: ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_CALENDAR'],
  lich: ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_CALENDAR'],
  calculator: ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_CALCULATOR'],
  'may tinh': ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_CALCULATOR'],
  gallery: ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_GALLERY'],
  'thu vien': ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_GALLERY'],
};
export const hasCategoryIntent = (name: string) => Boolean(categoryIntents[normalizeUiText(name)]);

// PackageManager reads only: discovery neither launches an app nor accepts permissions.
export async function discoverApplication(serial: string, requestedName: string, run: AdbRunner, signal?: AbortSignal): Promise<DiscoveredApplication> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(serial)) throw new Error('Invalid discovery serial.');
  const requested = requestedName.trim(), normalized = normalizeUiText(requested);
  if (!requested || requested.length > 150 || !/^[\p{L}\p{N} ._-]+$/u.test(requested)) throw new Error('Invalid application name.');
  const read = async (args: string[]) => {
    checkCancellation(signal);
    const result = await run(['-s', serial, 'shell', 'cmd', 'package', ...args], 10000);
    checkCancellation(signal); return result.stdout;
  };
  const launcher = ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER'];
  let cameraComponent: string | undefined;
  let packageName = APP_PACKAGE_ALIASES[normalized] ?? (normalized === 'cai dat' ? APP_PACKAGE_ALIASES.settings : packagePattern.test(requested) ? requested : undefined);
  if (!packageName && categoryIntents[normalized]) {
    const output = await read(['resolve-activity', '--brief', ...categoryIntents[normalized]]);
    const matches = output.split(/\r?\n/).map(s => s.trim()).filter(s => componentPattern.test(s));
    if (matches.length !== 1 || /resolver|chooser/i.test(matches[0])) throw new Error('Android has no unambiguous default for this app category. Specify an installed package name.');
    packageName = matches[0].split('/')[0];
    if (categoryIntents[normalized].includes('android.media.action.STILL_IMAGE_CAMERA')) {
      cameraComponent = matches[0];
    }
  }
  if (!packageName) {
    const output = await read(['query-activities', '--brief', '--components', ...launcher]);
    const packages = [...new Set(output.split(/\r?\n/).map(s => s.trim()).filter(s => componentPattern.test(s)).map(s => s.split('/')[0]))];
    const words = normalized.split(/\s+/);
    const matches = packages.filter(pkg => words.every(word => pkg.toLowerCase().split(/[._]/).includes(word)));
    if (matches.length !== 1) throw new Error('Application name is missing or ambiguous on this device. Specify its exact package name; no app was guessed.');
    packageName = matches[0];
  }
  if (!packagePattern.test(packageName)) throw new Error('Invalid resolved package.');
  const output = await read(['resolve-activity', '--brief', ...launcher, packageName]);
  const components = output.split(/\r?\n/).map(s => s.trim()).filter(s => componentPattern.test(s) && s.split('/')[0] === packageName);
  if (components.length !== 1) throw new Error('The requested app has no unique enabled launcher on this device.');
  const result: DiscoveredApplication = Object.freeze({ serial, requestedName: requested, packageName, component: cameraComponent ?? components[0], ...(cameraComponent ? { launchIntent: 'android.media.action.STILL_IMAGE_CAMERA' as const } : {}) });
  verified.add(result); return result;
}
export function bindDiscoveredApplication(goal: AgentGoal, app: DiscoveredApplication): void {
  if (!verified.has(app) || app.packageName !== goal.packageName) throw new Error('Application evidence was not discovered by this process.');
  grants.set(goal, app);
}
export function discoveredApplication(goal: AgentGoal): DiscoveredApplication | undefined { return grants.get(goal); }
export function isVerifiedApplication(app: DiscoveredApplication): boolean { return verified.has(app); }
