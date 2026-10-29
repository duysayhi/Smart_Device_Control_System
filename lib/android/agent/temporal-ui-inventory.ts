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
export async function readTemporalUiInventory(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, packageName: string, request: TemporalRequest, signal?: AbortSignal, accounting?: { beforeScroll?: () => void; beforeNavigation?: () => void }, options?: { scrollTarget?: 'NATIVE_ELEMENT' }) {
  return withSessionContextLock(session, async () => {
    const guard = async () => {
      signal?.throwIfAborted(); await session.ensureActive(signal); await session.assertPhysicalIdentity(signal);
      if (deviceReadiness((await run(['-s', session.serial, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout) !== 'READY') throw Error('DEVICE_LOCKED: no inventory navigation.');
    };
    const read = async () => {
      await guard(); const s = await observer.readNativeSnapshot(15000, signal);
      if (!freshTemporalUi(s) || s.deviceSerial !== session.serial || s.foregroundPackage !== packageName) throw Error('UI_INVENTORY_FOREIGN_OR_STALE'); return s;
    };
    const assertTab = (view: Observation) => {
      const selected = observedAffordances(view, '', session.sessionId!).filter(a => temporalTab(a, request.kind) && a.selected);
      if (selected.length !== 1) throw Error('UI_INVENTORY_TAB_CHANGED: collection no longer belongs to the requested temporal tab.');
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
        return freshTemporalUi(view) && view.deviceSerial === session.serial && view.foregroundPackage === packageName && selected.length === 1 ? view : false;
      }, 'temporal collection tab', 10000, signal);
    }
    assertTab(s);
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
      const lists = view.nodes.filter(n => n.displayed !== false && n.packageName === packageName && /RecyclerView|ListView/.test(n.className) && view.nodes.some(child => /Switch|CheckBox|ToggleButton/.test(child.className) && isDescendant(view.nodes, child, n)));
      if (lists.length !== 1) throw Error('UI_LIST_EXHAUSTION_UNPROVEN: no unique collection.'); return lists[0];
    };
    const scroll = async (direction: 'up' | 'down') => {
      s = await read(); assertTab(s); const list = collection(s), [left, top, right, bottom] = list.bounds;
      if (left < 0 || top < 0 || right > s.viewport.width || bottom > s.viewport.height || right <= left || bottom <= top) throw Error('UI_LIST_BOUNDS_UNPROVEN');
      if (s.nodes.some(n => n.displayed !== false && n.packageName !== packageName && n.clickable && n.bounds[0] < right && n.bounds[2] > left && n.bounds[1] < bottom && n.bounds[3] > top)) throw Error('UI_LIST_OCCLUDED: no gesture sent.');
      let area: { left: number; top: number; width: number; height: number } | { elementId: string } = { left, top, width: right - left, height: bottom - top };
      if (options?.scrollTarget === 'NATIVE_ELEMENT') {
        const elements = await session.client.request<Record<string, string>[]>('POST', session.path + '/elements', selectorForNode(list, s.nodes), 5000, signal);
        if (!Array.isArray(elements) || elements.length !== 1) throw Error('UI_LIST_NATIVE_TARGET_NOT_UNIQUE: no gesture sent.');
        const elementId = elements[0]['element-6066-11e4-a52e-4f735466cecf'] ?? elements[0].ELEMENT;
        if (typeof elementId !== 'string' || !elementId.trim()) throw Error('UI_LIST_NATIVE_TARGET_NOT_LOCATABLE: no gesture sent.');
        const rect = await session.client.request<{ x: number; y: number; width: number; height: number }>('GET', session.path + '/element/' + encodeURIComponent(elementId) + '/rect', undefined, 5000, signal);
        if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x !== left || rect.y !== top || rect.width !== right - left || rect.height !== bottom - top) throw Error('UI_LIST_NATIVE_BOUNDS_CHANGED: no gesture sent.');
        area = { elementId };
      }
      await guard();
      if (!freshTemporalUi(s)) throw Error('STALE_UI_LIST_SCROLL');
      accounting?.beforeScroll?.();
      // Production callers can opt into native targeting; never fall back after a native lookup failure.
      const more = await session.client.request('POST', session.path + '/execute/sync', { script: 'mobile: scrollGesture', args: [{ ...area, direction, percent: .35 }] }, 5000, signal);
      if (typeof more !== 'boolean') throw Error('UI_LIST_EXHAUSTION_UNPROVEN: native termination missing.');
      s = await read(); assertTab(s); return more;
    };
    let top = false;
    for (let i = 0; i < 8; i++) if (!await scroll('up')) { top = true; break; }
    if (!top) throw Error('UI_LIST_TOP_BUDGET');
    const started = s.timestamp, rows: AlarmUiRow[] = [], snapshots: string[] = [];
    let bottom = false, previousKeys: string[] = [];
    for (let page = 0; page < 16; page++) {
      const local = alarmRows(s); snapshots.push(s.snapshotId);
      const times = local.map(r => r.hour + ':' + r.minute);
      if (new Set(times).size !== times.length) throw Error('UI_LIST_IDENTITY_AMBIGUOUS: duplicate times.');
      if (page && !times.some(key => previousKeys.includes(key))) throw Error('UI_LIST_CONTINUITY_UNPROVEN: page=' + page + ' previousRows=' + previousKeys.length + ' currentRows=' + times.length);
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
    if (!bottom) throw Error('UI_LIST_EXHAUSTION_OR_FRESHNESS_UNPROVEN');
    rows.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
    let observedAt = started, proofSnapshots = snapshots;
    if (Date.now() - started > 5000) {
      const finalRows = alarmRows(s).sort((a, b) => a.hour - b.hour || a.minute - b.minute), list = collection(s);
      const contains = (outer: readonly number[], inner: readonly number[]) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3] && inner[2] > inner[0] && inner[3] > inner[1];
      const toggles = s.nodes.filter(n => n.displayed !== false && /(?:Switch|CheckBox|ToggleButton)$/.test(n.className) && n.bounds[2] > n.bounds[0] && n.bounds[3] > n.bounds[1]);
      const fullView = toggles.length === finalRows.length && toggles.every(toggle => {
        const parent = toggle.parentIndex === undefined ? undefined : s.nodes[toggle.parentIndex];
        return parent && isDescendant(s.nodes, parent, list) && contains(list.bounds, parent.bounds) &&
          s.nodes.filter(n => n.displayed !== false && (n === toggle || isDescendant(s.nodes, n, parent)) && n.bounds[2] > n.bounds[0] && n.bounds[3] > n.bounds[1]).every(n => contains(parent.bounds, n.bounds));
      });
      if (!freshTemporalUi(s) || !contains([0, 0, s.viewport.width, s.viewport.height], list.bounds) || !fullView || JSON.stringify(finalRows) !== JSON.stringify(rows)) throw Error('UI_LIST_EXHAUSTION_OR_FRESHNESS_UNPROVEN');
      // Rebase only evidence wholly present in this final view; never renew offscreen rows.
      observedAt = s.timestamp; proofSnapshots = [s.snapshotId];
    }
    return sealTemporalUiInventory({ deviceId: session.serial, packageName, sessionId: session.sessionId!, kind: request.kind, zone, observedAt, monotonicMs: performance.now(), rows, snapshots: proofSnapshots });
  });
}
