import { commandMask, foldIntent, understandOutcomes, type OutcomeV2 } from '../agent/outcome-spec';
import { matchIntentSource } from '../agent/intent-capabilities';
import { assertSafeSource } from '../safety-envelope';
import { browserResultDescriptor } from '../agent/browser-result-contract';
import type { IntentBinding } from '../agent/intent-schema';
import { arithmeticOracle } from '../agent/goal-compiler';
import { requestedPhoto } from '../agent/state-target';
import { requestedRecord } from '../agent/record-forms';
import { enterWords, politeWords, trimValueSyntax } from '../agent/natural-phrasing';

export type DemoStatus = 'ENABLED' | 'EXPERIMENTAL' | 'DISABLED';
const entry = (status: DemoStatus, label: string) => Object.freeze({ status, label,
  message: status === 'DISABLED' ? 'Chua ho tro trong danh muc demo: ' + label : status === 'EXPERIMENTAL' ? 'EXPERIMENTAL / UNVERIFIED: ' + label : label,
  evidence: status === 'EXPERIMENTAL' ? 'UNVERIFIED' as const : 'OFFLINE_TESTED' as const });

// P1_STATUS=PENDING. This is the sole availability catalog, not an execution grant.
export const demoCatalog = Object.freeze({
  OPEN_APP: Object.freeze({ ...entry('ENABLED', 'Mo ung dung'), applications: Object.freeze([
    'youtube', 'com.google.android.youtube', 'chrome', 'com.android.chrome',
    'drive', 'google drive', 'com.google.android.apps.docs',
    'my files', 'files', 'tep cua ban', 'file cua ban', 'com.sec.android.app.myfiles',
    'camera', 'may anh', 'com.sec.android.app.camera', 'com.android.camera',
    'clock', 'dong ho', 'com.sec.android.app.clockpackage', 'com.google.android.deskclock',
    'calculator', 'may tinh', 'com.sec.android.app.popupcalculator', 'com.android.calculator2',
    'notes', 'samsung notes', 'ghi chu', 'com.samsung.android.app.notes',
  ]) as readonly string[] }),
  OPEN_SETTINGS: entry('ENABLED', 'Mo trang Settings'),
  READ_STATE: Object.freeze({ ...entry('ENABLED', 'Doc pin/Wi-Fi/do sang'), states: ['battery', 'wifi', 'brightness'] as readonly string[] }),
  SET_STATE: Object.freeze({ ...entry('ENABLED', 'Doi cai dat co journal va khoi phuc'), states: ['wifi', 'brightness', 'dnd'] as readonly string[] }),
  CAMERA: entry('ENABLED', 'Chup anh'),
  DIAL_PREFILL: entry('ENABLED', 'Dien ban phim quay so, khong goi'),
  CALCULATE: entry('ENABLED', 'Tinh toan'),
  SEARCH: Object.freeze({ ...entry('ENABLED', 'Tim trong ung dung co bang chung'), applications: [
    'youtube', 'com.google.android.youtube', 'drive', 'google drive', 'com.google.android.apps.docs',
    'my files', 'files', 'tep cua ban', 'file cua ban', 'com.sec.android.app.myfiles',
  ] as readonly string[] }),
  ALARM_PERIOD: entry('ENABLED', 'Hoi lai sang/chieu'),
  BROWSER_FIRST: Object.freeze({ ...entry('EXPERIMENTAL', 'P1 Chrome: tim va mo bai organic dau tien'), applications: browserResultDescriptor.applications }),
  ALARM: entry('EXPERIMENTAL', 'Tao bao thuc'),
  TIMER: entry('EXPERIMENTAL', 'Chay hen gio'),
  WIFI_SSID: entry('DISABLED', 'Ket noi Wi-Fi theo SSID'),
  RECORD: entry('DISABLED', 'Ghi chu/tao record'),
  GALLERY: Object.freeze({ ...entry('DISABLED', 'Gallery/tim anh'), applications: /^(?:gallery|photos|google photos|thu vien|bo suu tap|com\.sec\.android\.gallery3d|com\.google\.android\.apps\.photos)$/ }),
  URL_MAPS: Object.freeze({ ...entry('DISABLED', 'Mo URL/Maps'), applications: /^(?:https?:\/\/|maps$|google maps$|ban do$|com\.google\.android\.apps\.maps$)/ }),
  OTHER_STATE: entry('DISABLED', 'Bluetooth/xoay/am luong/den pin/may bay hoac widget ngoai danh muc'),
  VIDEO_ORDINAL: entry('DISABLED', 'YouTube chon video thu N (P2 chua port)'),
  ORDINAL: entry('DISABLED', 'Ordinal lon hon 1'),
  UNSUPPORTED: entry('DISABLED', 'Yeu cau ngoai danh muc'),
});
export type DemoCapability = keyof typeof demoCatalog;
const ordinal = /\b(?:thu (?:[2-9]\d*|1\d+|hai|ba|tu|bon|nam|sau|bay|tam|chin|muoi)|(?:result|article|video) (?:[2-9]\d*|1\d+)|second|third|fourth)\b/;

function explicitPackage(name: string, binding: IntentBinding | undefined): boolean {
  // A source-bound reverse-DNS package is provisional; installed-app discovery
  // and the original executor still have to verify it on the selected device.
  return binding?.request.name === 'OPEN_APP' && binding.request.args.packageName === name &&
    /^(?:com|org|net|io|dev|edu)\.[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+$/.test(name) &&
    !/\.(?:com|org|net|io|dev|edu|gov|vn|uk|co|app|info|biz)$/.test(name);
}

function launchCapability(name: string, binding: IntentBinding | undefined): DemoCapability {
  if (demoCatalog.GALLERY.applications.test(name)) return 'GALLERY';
  if (demoCatalog.URL_MAPS.applications.test(name) || /\b(?:url|maps|ban do)\b|[:/\\@?#]/.test(name)) return 'URL_MAPS';
  if (/^(?:settings|cai dat|com\.android\.settings)$/.test(name)) return 'OPEN_SETTINGS';
  if (demoCatalog.OPEN_APP.applications.includes(name) || explicitPackage(name, binding)) return 'OPEN_APP';
  return name.includes('.') ? 'URL_MAPS' : 'UNSUPPORTED';
}

function launchName(outcome: OutcomeV2): string | undefined {
  if (outcome.kind === 'LAUNCH') return foldIntent(outcome.app ?? outcome.value).trim();
  if (outcome.kind !== 'UNKNOWN') return;
  const text = outcome.span.text, mask = commandMask(text);
  const prefix = new RegExp('^(?:(?:' + politeWords + ')\\s+)*(?:' + enterWords + ')\\s+').exec(mask);
  if (!prefix) return;
  const bounds = trimValueSyntax(text, mask, prefix[0].length, text.length, false);
  return foldIntent(text.slice(bounds.start, bounds.end)).replace(/^(?:app(?:lication)?|ung dung|the)\s+/, '').replace(/^["']|["']$/g, '').trim();
}

function identify(outcome: OutcomeV2, application: string, browserFirst: boolean, binding: IntentBinding | undefined, name: string | undefined): DemoCapability {
  const text = commandMask(outcome.span.text);
  if (binding) {
    const intent = binding.request;
    if (intent.name === 'READ_STATE') return demoCatalog.READ_STATE.states.includes(intent.args.state) ? 'READ_STATE' : 'OTHER_STATE';
    if (intent.name === 'SET_DEVICE_STATE') return demoCatalog.SET_STATE.states.includes(intent.args.state) ? 'SET_STATE' : 'OTHER_STATE';
    if (intent.name === 'OPEN_SETTINGS') return 'OPEN_SETTINGS';
    if (intent.name === 'OPEN_DIALER') return 'DIAL_PREFILL';
    if (intent.name === 'OPEN_URL') return 'URL_MAPS';
    if (intent.name === 'OPEN_APP') return launchCapability(foldIntent(intent.args.packageName), binding);
  }
  if (/^(?:ket noi|connect|join)\b.*\b(?:wifi|wi-fi|ssid)\b/.test(text)) return 'WIFI_SSID';
  if (outcome.kind !== 'SEARCH' && ordinal.test(text)) return 'ORDINAL';
  if (/^(?:mo|phat|chon|xem|open|play|select)\b.*\bvideo\b/.test(text) && outcome.kind !== 'SEARCH') return 'VIDEO_ORDINAL';
  if (outcome.kind === 'CREATE_RECORD') return 'RECORD';
  if (outcome.kind === 'FIND_ARTIFACT') return 'GALLERY';
  if (outcome.kind === 'OPEN_RESULT') return browserFirst && outcome.browserResult?.ordinal === 1 ? 'BROWSER_FIRST' : 'ORDINAL';
  if (outcome.kind === 'ALARM') return outcome.ambiguity.includes('AM_PM_REQUIRED') ? 'ALARM_PERIOD' : outcome.temporal?.kind === 'ALARM' ? 'ALARM' : 'UNSUPPORTED';
  if (outcome.kind === 'SET_STRUCTURED_STATE') return requestedRecord(outcome) ? 'ALARM' : 'UNSUPPORTED';
  if (outcome.kind === 'TIMER') return outcome.temporal?.kind === 'TIMER' ? 'TIMER' : 'UNSUPPORTED';
  if (outcome.kind === 'SET_STATE') return 'OTHER_STATE';
  if (outcome.kind === 'CAPTURE_MEDIA') return requestedPhoto(outcome) ? 'CAMERA' : 'UNSUPPORTED';
  if (outcome.kind === 'CALCULATE') {
    try { arithmeticOracle(outcome.value); return 'CALCULATE'; }
    catch { return 'UNSUPPORTED'; }
  }
  if (name !== undefined) return launchCapability(name, binding);
  if (outcome.kind === 'SEARCH') {
    const app = foldIntent(outcome.app ?? application);
    if (browserFirst && demoCatalog.BROWSER_FIRST.applications.includes(app)) return 'BROWSER_FIRST';
    return demoCatalog.SEARCH.applications.includes(app) ? 'SEARCH' : 'UNSUPPORTED';
  }
  return 'UNSUPPORTED';
}

export function requireDemoCapabilities(source: string) {
  assertSafeSource(source);
  const spec = understandOutcomes(source), ids: DemoCapability[] = [];
  // Diagnostic only: do not reinterpret a natural setting phrase as a record or a typed mutation.
  const naturalSetting = /^(?:dat|chinh|bat|tat)\s+(?:wi[ -]?fi|do sang(?: man hinh)?|brightness|dnd|khong lam phien|bluetooth|am luong(?: media|chuong|da phuong tien)?|media_volume|ring_volume|xoay(?: man hinh)?|rotation|den pin|flashlight|che do may bay|airplane)(?=\s|$)/;
  if (spec.outcomes.some(outcome => naturalSetting.test(commandMask(outcome.span.text)))) {
    throw Error('BLOCKED: UNSUPPORTED_PHRASING: Chưa hỗ trợ cách diễn đạt này. Hãy dùng: set wifi 0 / set brightness 80 / set dnd 0');
  }
  const browserFirst = spec.outcomes.some(o => o.browserResult?.ordinal === 1);
  let application = '';
  const rows = spec.outcomes.map(outcome => {
    const binding = matchIntentSource(spec.request, outcome.span.start, outcome.span.end), name = launchName(outcome);
    if (name !== undefined) application = name;
    const id = identify(outcome, application, browserFirst, binding, name);
    return { outcome, binding, name, id, capability: demoCatalog[id] };
  });
  if (rows.some(row => row.outcome.negated)) throw Error('BLOCKED: NEEDS_CLARIFICATION: negated outcomes are not executable.');
  // Preserve the concrete disabled capability even if an earlier clause also
  // lacks catalog coverage. No partial plan is admitted in either case.
  const disabled = rows.find(row => row.capability.status === 'DISABLED' && row.id !== 'UNSUPPORTED');
  if (disabled) throw Error('BLOCKED: CAPABILITY_DISABLED: ' + disabled.capability.message);
  for (const { outcome, binding, name, id, capability } of rows) {
    // A full-clause typed binding or known reviewed launch syntax can resolve
    // raw UNKNOWN. It cannot resolve other ambiguity or authorize any effect.
    const resolved = Boolean(binding || outcome.kind === 'UNKNOWN' && name !== undefined && ['OPEN_APP', 'OPEN_SETTINGS'].includes(id));
    const ambiguity = outcome.ambiguity.filter(a => a !== 'AM_PM_REQUIRED' && !(resolved && a === 'UNSUPPORTED_OUTCOME'));
    if (ambiguity.length) throw Error('BLOCKED: NEEDS_CLARIFICATION: ' + ambiguity.join(', '));
    if (id === 'UNSUPPORTED') throw Error('BLOCKED: UNSUPPORTED_OUTCOME: ' + capability.message);
    ids.push(id);
  }
  // P1's browser search is supported only with its bound first-result outcome.
  return [...new Set(ids)].map(id => ({ id, ...demoCatalog[id] }));
}
