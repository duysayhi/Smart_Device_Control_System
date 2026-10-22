import type { ManagedAppiumSession } from '../appium/session-manager';
import { withSessionContextLock } from '../appium/session-operation-lock';
import { selectorForNode, type StateObserver, type Observation } from '../state-observer';
import type { AdbRunner } from '../executor';
import { isDescendant } from '../exploration/scroll-regions';
import { observedAffordances } from './ui-affordances';
import { deviceReadiness } from './device-readiness';
import type { TemporalRequest } from './temporal-contract';
import { alarmRows, freshTemporalUi, pickerRole, pickerValue, temporalTab, sealTemporalUiInventory, type AlarmUiRow } from './temporal-ui';

// Read-only navigation uses native scroll termination, not an assumed row count.
export async function readTemporalUiInventory(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, packageName: string, request: TemporalRequest, signal?: AbortSignal, accounting?: { beforeScroll?: () => void; beforeNavigation?: () => void }) {
  return withSessionContextLock(session, async () => {
    const guard = async () => {
      signal?.throwIfAborted(); await session.ensureActive(signal); await session.assertPhysicalIdentity(signal);
      if (deviceReadiness((await run(['-s', session.serial, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout) !== 'READY') throw Error('DEVICE_LOCKED: no inventory navigation.');
    };
    const read = async () => {
      await guard(); const s = await observer.readNativeSnapshot(15000, signal);
      if (!freshTemporalUi(s) || s.foregroundPackage !== packageName) throw Error('UI_INVENTORY_FOREIGN_OR_STALE'); return s;
    };
    let s = await read();
    const tabs = observedAffordances(s, '', session.sessionId!).filter(a => temporalTab(a, request.kind));
    if (tabs.length !== 1) throw Error('TEMPORAL_TAB_AMBIGUOUS');
    if (!tabs[0].selected) {
      const node = s.nodes[tabs[0].index], selector = selectorForNode(node, s.nodes);
      const elements = await session.client.request<Record<string, string>[]>('POST', session.path + '/elements', selector, 5000, signal);
      if (!elements || elements.length !== 1) throw Error('TEMPORAL_TAB_NOT_UNIQUE');
      await guard();
      if (Date.now() - s.timestamp > 5000) throw Error('STALE_TEMPORAL_TAB');
      const id = elements[0]['element-6066-11e4-a52e-4f735466cecf'] ?? elements[0].ELEMENT;
      if (!id) throw Error('TEMPORAL_TAB_NOT_LOCATABLE');
      accounting?.beforeNavigation?.();
      await session.client.request('POST', session.path + '/element/' + encodeURIComponent(id) + '/click', {}, 5000, signal);
      s = await observer.waitUntil(view => {
        const selected = observedAffordances(view, '', session.sessionId!).filter(a => temporalTab(a, request.kind) && a.selected);
        return freshTemporalUi(view) && selected.length === 1 ? view : false;
      }, 'temporal collection tab', 10000, signal);
    }
    const rawZone = (await run(['-s', session.serial, 'shell', 'getprop', 'persist.sys.timezone'], 5000)).stdout.trim();
    if (!rawZone) throw Error('DEVICE_TIMEZONE_UNAVAILABLE');
    const zone = new Intl.DateTimeFormat('en', { timeZone: rawZone }).resolvedOptions().timeZone;
    if (request.kind === 'TIMER') {
      const roles = s.nodes.map((_, i) => pickerRole(s, i)).filter(Boolean);
      const starts = observedAffordances(s, '', session.sessionId!).filter(a => a.roles.includes('clickable') && /^(start|bat dau)$/.test(a.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase()));
      if (roles.length !== 3 || new Set(roles).size !== 3 || starts.length !== 1 || s.nodes.some(n => /^(pause|resume|tam dung|tiep tuc)$/i.test(n.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')))) throw Error('TIMER_CONFLICT_OR_FORM_UNREADABLE: running/paused timer is never modified.');
      if (s.nodes.some((n, i) => pickerRole(s, i) && pickerValue(n.text) === undefined)) throw Error('TIMER_FIELDS_UNREADABLE');
      return sealTemporalUiInventory({ deviceId: session.serial, packageName, sessionId: session.sessionId!, kind: request.kind, zone, observedAt: s.timestamp, monotonicMs: performance.now(), snapshots: [s.snapshotId], rows: [] });
    }
    const collection = (view: Observation) => {
      const lists = view.nodes.filter(n => /RecyclerView|ListView/.test(n.className) && view.nodes.some(child => /Switch|CheckBox|ToggleButton/.test(child.className) && isDescendant(view.nodes, child, n)));
      if (lists.length !== 1) throw Error('UI_LIST_EXHAUSTION_UNPROVEN: no unique collection.'); return lists[0];
    };
    const scroll = async (direction: 'up' | 'down') => {
      await guard(); s = await read(); const list = collection(s), [left, top, right, bottom] = list.bounds;
      if (left < 0 || top < 0 || right > s.viewport.width || bottom > s.viewport.height || right <= left || bottom <= top) throw Error('UI_LIST_BOUNDS_UNPROVEN');
      if (Date.now() - s.timestamp > 5000) throw Error('STALE_UI_LIST_SCROLL');
      if (s.nodes.some(n => n.displayed !== false && n.packageName !== packageName && n.clickable && n.bounds[0] < right && n.bounds[2] > left && n.bounds[1] < bottom && n.bounds[3] > top)) throw Error('UI_LIST_OCCLUDED: no gesture sent.');
      accounting?.beforeScroll?.();
      const more = await session.client.request('POST', session.path + '/execute/sync', { script: 'mobile: scrollGesture', args: [{ left, top, width: right - left, height: bottom - top, direction, percent: .35 }] }, 5000, signal);
      if (typeof more !== 'boolean') throw Error('UI_LIST_EXHAUSTION_UNPROVEN: native termination missing.');
      s = await read(); return more;
    };
    let top = false;
    for (let i = 0; i < 8; i++) if (!await scroll('up')) { top = true; break; }
    if (!top) throw Error('UI_LIST_TOP_BUDGET');
    const started = Date.now(), rows: AlarmUiRow[] = [], snapshots: string[] = [];
    let bottom = false, previousKeys: string[] = [];
    for (let page = 0; page < 16; page++) {
      const local = alarmRows(s); snapshots.push(s.snapshotId);
      const times = local.map(r => r.hour + ':' + r.minute);
      if (new Set(times).size !== times.length) throw Error('UI_LIST_IDENTITY_AMBIGUOUS: duplicate times.');
      if (page && !times.some(key => previousKeys.includes(key))) throw Error('UI_LIST_CONTINUITY_UNPROVEN');
      if (page && !bottom && times.every(key => rows.some(r => r.hour + ':' + r.minute === key))) throw Error('UI_LIST_PROGRESS_UNPROVEN');
      for (const row of local) {
        const old = rows.find(r => r.hour === row.hour && r.minute === row.minute);
        if (old && JSON.stringify(old) !== JSON.stringify(row)) throw Error('UI_LIST_CHANGED_DURING_SCAN');
        if (!old) rows.push(row);
      }
      if (bottom) break;
      previousKeys = times;
      bottom = !await scroll('down');
    }
    if (!bottom || Date.now() - started > 5000) throw Error('UI_LIST_EXHAUSTION_OR_FRESHNESS_UNPROVEN');
    rows.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
    return sealTemporalUiInventory({ deviceId: session.serial, packageName, sessionId: session.sessionId!, kind: request.kind, zone, observedAt: started, monotonicMs: performance.now(), rows, snapshots });
  });
}
