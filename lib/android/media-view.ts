import type { ManagedAppiumSession } from './appium/session-manager';
import type { StateObserver, Observation } from './state-observer';
import { withSessionContextLock } from './appium/session-operation-lock';
import { quoteAndroidShell, type AdbRunner } from './executor';
import { readTransportIdentity } from './transport-identity';
import { consumeMediaViewGrant, type MediaViewGrant } from './agent/artifact-store';
import { visibleNode } from './agent/navigation-semantics';

export interface MediaViewReceipt { deviceId: string; executionId: string; nodeId: string; physicalId: string; packageName: string; uri: string; observedAt: number; snapshot: Observation; media: MediaViewGrant['media']; mode: 'EXACT_URI_VIEW' }
const receipts = new WeakSet<MediaViewReceipt>();
export const isMediaViewReceipt = (receipt: MediaViewReceipt) => receipts.has(receipt);
export function observedTopMediaIntent(output: string, packageName: string, uri: string): boolean {
  const activities = [...output.matchAll(/^ACTIVITY\s+([^\s/]+)\/[^\s]+.*$/gm)];
  if (activities.length !== 1 || activities[0][1] !== packageName) return false;
  const intents = [...output.slice(activities[0].index).matchAll(/^\s*mIntent=.*?\bdat=([^\s}]+).*$/gm)];
  return intents.length === 1 && intents[0][1] === uri;
}
export async function openMediaView(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, grant: MediaViewGrant, signal?: AbortSignal): Promise<MediaViewReceipt> {
  return withSessionContextLock(session, async () => {
    await session.ensureActive(signal);
    consumeMediaViewGrant(grant, session.serial, session.sessionId!);
    if ((await readTransportIdentity(run, session.serial, true, 5000, true))?.physicalId !== grant.physicalId || !/^content:\/\/media\/external\/images\/media\/\d{1,20}$/.test(grant.media.uri) || !/^image\/[a-z0-9.+-]+$/i.test(grant.media.mimeType)) throw Error('Media identity is not authorized for this physical device.');
    const intent = ['-a', 'android.intent.action.VIEW', '-d', grant.media.uri, '-t', grant.media.mimeType, '-p', grant.packageName];
    const resolved = await run(['-s', session.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', ...intent.map(quoteAndroidShell)], 5000);
    const components = resolved.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => /^[\w.$]+\/[\w.$]+$/.test(s));
    if (components.length !== 1 || components[0].split('/')[0] !== grant.packageName || /resolver|chooser/i.test(components[0])) throw Error('No unique permitted media viewer handles this URI.');
    signal?.throwIfAborted();
    if (Date.now() >= grant.expiresAt) throw Error('Media view evidence expired before dispatch.');
    const sent = await run(['-s', session.serial, 'shell', 'am', 'start', '-W', '--grant-read-uri-permission', ...intent.map(quoteAndroidShell)], 10000);
    if (!/^Status:\s*ok\s*$/m.test(sent.stdout)) throw Error('Media intent outcome uncertain; no replay.');
    const snapshot = await observer.waitUntil(s => s.foregroundPackage === grant.packageName && !s.nodes.some(n => /Dialog|ProgressBar/.test(n.className)) &&
      s.nodes.some(n => visibleNode(s, n) && /ImageView|TextureView|SurfaceView/.test(n.className) && (n.bounds[2] - n.bounds[0]) * (n.bounds[3] - n.bounds[1]) >= s.viewport.width * s.viewport.height * .2) ? s : false, 'Exact media URI viewer', 10000, signal);
    const activity = await run(['-s', session.serial, 'shell', 'dumpsys', 'activity', 'top'], 5000);
    await session.ensureActive(signal);
    if (!observedTopMediaIntent(activity.stdout, grant.packageName, grant.media.uri) || Date.now() - snapshot.timestamp > 5000) throw Error('Exact resumed media URI cannot be verified; do not infer identity from a thumbnail.');
    const receipt: MediaViewReceipt = Object.freeze({ deviceId: session.serial, executionId: grant.executionId, nodeId: grant.nodeId, physicalId: grant.physicalId,
      packageName: grant.packageName, uri: grant.media.uri, observedAt: Date.now(), snapshot, media: grant.media, mode: 'EXACT_URI_VIEW' });
    receipts.add(receipt); return receipt;
  });
}
