import type { ActionPlan } from '../validators/action-plan.schema';
import { normalizeUiText } from './ui-understanding';

export function wifiNetworkTarget(target: string): string | undefined {
  if (!target.startsWith('wifi_connect:')) return;
  const ssid = target.slice('wifi_connect:'.length);
  return ssid.trim() && !/[\u0000-\u001f\u007f]/.test(ssid) && new TextEncoder().encode(ssid).length <= 32 ? ssid : undefined;
}

export function wifiNetworkForPlan(plan: ActionPlan): string | undefined {
  if (plan.intent !== 'connect_wifi' || !plan.isSensitive || plan.actions.length !== 2 ||
    plan.actions[0].type !== 'OPEN_APP' || plan.actions[0].app !== 'settings' || plan.actions[1].type !== 'CLICK') return;
  return wifiNetworkTarget(plan.actions[1].target);
}

export function planWifiConnection(prompt: string): ActionPlan | undefined {
  const match = prompt.trim().normalize('NFC').match(/^(?:kết nối|ket noi) (?:vào |vao )?(?:mạng |mang )?wi[ -]?fi (?:với tên mạng là |voi ten mang la |tên |ten )?(.+)$/iu);
  if (!match) return;
  const raw = match[1].trim();
  const ssid = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  const target = `wifi_connect:${ssid}`;
  if (wifiNetworkTarget(target) === undefined) return;
  return { intent: 'connect_wifi', isSensitive: true, actions: [
    { type: 'OPEN_APP', app: 'settings' }, { type: 'CLICK', target },
  ] };
}

export function planWifiNavigation(prompt: string): ActionPlan | undefined {
  if (!/^mo (?:trang |cai dat )?wi ?fi[.!]?$/.test(normalizeUiText(prompt))) return;
  return { intent: 'open_wifi_settings', isSensitive: false, actions: [
    { type: 'OPEN_APP', app: 'settings' }, { type: 'CLICK', target: 'wifi_settings' },
  ] };
}

export function isWifiOffPlan(plan: ActionPlan): boolean {
  return plan.intent === 'disable_wifi' && plan.isSensitive && plan.actions.length === 2 &&
    plan.actions[0].type === 'OPEN_APP' && plan.actions[0].app === 'settings' &&
    plan.actions[1].type === 'CLICK' && plan.actions[1].target === 'wifi_off';
}

export function isWifiOnPlan(plan: ActionPlan): boolean {
  return plan.intent === 'enable_wifi' && plan.isSensitive && plan.actions.length === 2 &&
    plan.actions[0].type === 'OPEN_APP' && plan.actions[0].app === 'settings' &&
    plan.actions[1].type === 'CLICK' && plan.actions[1].target === 'wifi_on';
}

export function planWifiOn(prompt: string): ActionPlan | undefined {
  if (!/^(?:bat wi ?fi|mo (?:cai dat )?wi ?fi va bat(?: wi ?fi)?)[.!]?$/.test(normalizeUiText(prompt))) return;
  return { intent: 'enable_wifi', isSensitive: true, actions: [
    { type: 'OPEN_APP', app: 'settings' }, { type: 'CLICK', target: 'wifi_on' },
  ] };
}

export function planWifiOff(prompt: string): ActionPlan | undefined {
  const text = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  if (!/^(?:mo (?:cai dat )?wi[ -]?fi va )?tat wi[ -]?fi[.!]?$/.test(text)) return;
  return { intent: 'disable_wifi', isSensitive: true, actions: [
    { type: 'OPEN_APP', app: 'settings' }, { type: 'CLICK', target: 'wifi_off' },
  ] };
}
