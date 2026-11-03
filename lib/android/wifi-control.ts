import type { ManagedAppiumSession } from './appium/session-manager';
import type { StateObserver, Observation } from './state-observer';
import type { AdbRunner } from './executor';
import { AndroidExecutionError, checkCancellation } from './errors';
import { normalizeUiText } from './ui-understanding';
import { isNodeInteractable } from './screen-state';
import { isDescendant } from './exploration/scroll-regions';

export function wifiSwitch(snapshot: Observation) {
  if (snapshot.observationStatus !== 'OBSERVED' || snapshot.foregroundPackage !== 'com.android.settings' ||
    !snapshot.nodes.some(n => n.enabled && n.displayed !== false && /^wi fi$/.test(normalizeUiText(n.text || n.description)))) return;
  const switches = snapshot.nodes.filter(n => n.packageName === snapshot.foregroundPackage && n.enabled && n.displayed !== false && /(?:^|\.)Switch(?:Compat)?$/.test(n.className));
  if (switches.length !== 1) return;
  const node = switches[0];
  return isNodeInteractable({ ...node, clickable: true }, snapshot.nodes, snapshot.viewport, 'Wi-Fi switch', snapshot.nodes.indexOf(node)) ? node : undefined;
}

export function wifiActivation(snapshot: Observation) {
  const toggle = wifiSwitch(snapshot);
  if (!toggle) return;
  let owner = toggle;
  while (!owner.clickable && owner.parentIndex !== undefined) owner = snapshot.nodes[owner.parentIndex];
  if (!owner.clickable || !owner.enabled || owner.displayed === false || owner.packageName !== snapshot.foregroundPackage ||
    !/^wi fi(?:[ ,]|$)/.test(normalizeUiText(toggle.text || toggle.description || owner.description || owner.text)) ||
    !isNodeInteractable(owner, snapshot.nodes, snapshot.viewport, 'Wi-Fi activation', snapshot.nodes.indexOf(owner))) return;
  return { toggle, owner };
}

export async function waitForStableWifiActivation(observer: StateObserver, signal?: AbortSignal) {
  return observer.waitUntil(async (snapshot, remaining) => {
    const activation = wifiActivation(snapshot);
    if (!activation) return false;
    const index = snapshot.nodes.indexOf(activation.owner);
    const started = performance.now();
    const budget = () => Math.max(1, Math.min(10000, remaining - (performance.now() - started)));
    const found = await observer.locate(snapshot, `element:${snapshot.elements[index].elementId}`, true, budget(), signal);
    if (!found) return false;
    const fresh = await observer.revalidateInteraction(found, budget(), signal);
    if (!fresh || wifiActivation(fresh.snapshot)?.owner !== fresh.node) return false;
    return fresh;
  }, 'stable Wi-Fi page and revalidated activation owner (no click sent)', 20000, signal);
}

export async function openWifiSettings(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, signal?: AbortSignal) {
  checkCancellation(signal);
  await run(['-s', session.serial, 'shell', 'am', 'start', '-W', '-a', 'android.settings.WIFI_SETTINGS'], 15000);
  return observer.waitUntil(s => wifiSwitch(s) ? s : false, 'Wi-Fi settings page (no toggle)', 20000, signal);
}

export function disableWifi(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, signal?: AbortSignal) {
  return setWifiEnabled(session, observer, run, false, signal);
}

export async function setWifiEnabled(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, enabled: boolean, signal?: AbortSignal) {
  checkCancellation(signal);
  // Use Android's public settings intent, never a vendor-specific activity or guessed coordinates.
  await run(['-s', session.serial, 'shell', 'am', 'start', '-W', '-a', 'android.settings.WIFI_SETTINGS'], 15000);
  const fresh = await waitForStableWifiActivation(observer, signal);
  const toggle = wifiSwitch(fresh.snapshot)!;
  if (!isDescendant(fresh.snapshot.nodes, toggle, fresh.node)) throw new AndroidExecutionError('AMBIGUOUS', 'Wi-Fi switch does not belong to activation owner.');
  const stateElement = await observer.locate(fresh.snapshot, `element:${fresh.snapshot.elements[fresh.snapshot.nodes.indexOf(toggle)].elementId}`, false, 5000, signal);
  if (!stateElement) throw new AndroidExecutionError('UNKNOWN', 'Wi-Fi state element changed.');
  const path = session.path + `/element/${encodeURIComponent(fresh.id)}`;
  const checked = await session.client.request<string>('GET', session.path + `/element/${encodeURIComponent(stateElement.id)}/attribute/checked`, undefined, 5000, signal);
  if (!['true', 'false'].includes(checked)) throw new AndroidExecutionError('UNKNOWN', 'Wi-Fi checked state is unavailable.');
  const currentState = (await run(['-s', session.serial, 'shell', 'settings', 'get', 'global', 'wifi_on'], 3000)).stdout.trim();
  if (!['0', '1'].includes(currentState)) throw new AndroidExecutionError('UNKNOWN', 'Android Wi-Fi state is unavailable; no click sent.');
  checkCancellation(signal);
  const oppositeChecked = enabled ? 'false' : 'true';
  const oppositeState = enabled ? '0' : '1';
  if (checked === oppositeChecked && currentState === oppositeState) await session.client.request('POST', path + '/click', {}, 10000, signal);
  return observer.waitUntil(async (s, remaining) => {
    const toggle = wifiSwitch(s);
    if (!toggle) return false;
    const i = s.nodes.indexOf(toggle);
    const located = await observer.locate(s, `element:${s.elements[i].elementId}`, false, Math.min(5000, remaining), signal);
    if (!located) return false;
    const value = await session.client.request<string>('GET', session.path + `/element/${encodeURIComponent(located.id)}/attribute/checked`, undefined, Math.min(5000, remaining), signal);
    if (value !== String(enabled)) return false;
    const state = await run(['-s', session.serial, 'shell', 'settings', 'get', 'global', 'wifi_on'], Math.min(3000, remaining));
    checkCancellation(signal);
    return state.stdout.trim() === (enabled ? '1' : '0') ? s : false;
  }, `Wi-Fi switch ${enabled ? 'ON' : 'OFF'} and Android wifi_on=${enabled ? 1 : 0}`, 20000, signal);
}
