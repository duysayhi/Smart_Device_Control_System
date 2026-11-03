import type { ManagedAppiumSession } from './appium/session-manager';
import type { StateObserver, Observation, ObserverProgress } from './state-observer';
import type { AdbRunner } from './executor';
import type { UIExplorer } from './exploration/ui-explorer';
import { isDescendant } from './exploration/scroll-regions';
import { wifiSwitch, setWifiEnabled, openWifiSettings } from './wifi-control';
import { assertObservedControlSafe } from './security-policy';
import { AndroidExecutionError, checkCancellation } from './errors';

export function connectedToWifi(output: string, ssid: string): boolean {
  const connected = output.match(/^Wifi is connected to "(.*)"\s*$/m)?.[1];
  return connected === ssid && /^WifiInfo:.*\bSupplicant state: COMPLETED(?:,|$)/m.test(output);
}

export function networkLabel(snapshot: Observation, ssid: string) {
  if (!wifiSwitch(snapshot)) return;
  const matches = snapshot.nodes.filter(n => n.packageName === snapshot.foregroundPackage && n.enabled && n.displayed !== false &&
    !/EditText/.test(n.className) && [n.text, n.description].some(text => text.normalize('NFC') === ssid.normalize('NFC')));
  if (matches.length > 1) throw new AndroidExecutionError('AMBIGUOUS', 'Multiple visible network labels match the requested SSID; no network selected.');
  return matches[0];
}

export async function connectWifiNetwork(session: ManagedAppiumSession, observer: StateObserver, explorer: UIExplorer,
  run: AdbRunner, ssid: string, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<Observation> {
  checkCancellation(signal);
  const state = (await run(['-s', session.serial, 'shell', 'settings', 'get', 'global', 'wifi_on'], 3000)).stdout.trim();
  if (!['0', '1'].includes(state)) throw new AndroidExecutionError('UNKNOWN', 'Android Wi-Fi state is unavailable.');
  const page = state === '0' ? await setWifiEnabled(session, observer, run, true, signal) : await openWifiSettings(session, observer, run, signal);
  const status = await run(['-s', session.serial, 'shell', 'cmd', 'wifi', 'status'], 3000);
  if (connectedToWifi(status.stdout, ssid)) return page;
  const result = await explorer.find(`text:${ssid}`, 30000, true, signal, onProgress);
  if (result.status !== 'FOUND' || !result.found) throw new AndroidExecutionError(result.status === 'FOUND' ? 'UNKNOWN' : result.status, 'Requested Wi-Fi network was not uniquely located. No network selected.');
  const fresh = await observer.revalidateInteraction(result.found, 10000, signal);
  if (!fresh) throw new AndroidExecutionError('AMBIGUOUS', 'Network row changed; no network selected.');
  const label = networkLabel(fresh.snapshot, ssid);
  if (!label || !isDescendant(fresh.snapshot.nodes, label, fresh.node)) throw new AndroidExecutionError('AMBIGUOUS', 'Activation does not belong to the requested SSID.');
  assertObservedControlSafe(fresh.node);
  if (fresh.owner) assertObservedControlSafe(fresh.owner);
  checkCancellation(signal);
  if (fresh.interaction?.method === 'LABEL_GESTURE') {
    if (!fresh.interaction.point) throw new AndroidExecutionError('AMBIGUOUS', 'No verified network activation point.');
    await session.client.request('POST', session.path + '/execute/sync', { script: 'mobile: clickGesture', args: [fresh.interaction.point] }, 10000, signal);
  } else await session.client.request('POST', session.path + `/element/${encodeURIComponent(fresh.id)}/click`, {}, 10000, signal);
  try {
    return await observer.waitUntil(async (snapshot, remaining) => {
      if (snapshot.foregroundPackage !== 'com.android.settings') throw new AndroidExecutionError('UNKNOWN', 'Foreground changed during Wi-Fi connection; no further interactions sent.');
      const current = await run(['-s', session.serial, 'shell', 'cmd', 'wifi', 'status'], Math.min(3000, remaining));
      checkCancellation(signal);
      return snapshot.observationStatus === 'OBSERVED' && connectedToWifi(current.stdout, ssid) ? snapshot : false;
    }, `Kết nối Wi-Fi ${ssid}: nếu có hộp thoại, nhập mật khẩu và bấm Kết nối trực tiếp trên điện thoại (tối đa 2 phút)`, 120000, signal, onProgress);
  } catch (error) {
    if (error instanceof AndroidExecutionError) error.interactionSent = true;
    throw error;
  }
}
