import { setTimeout as delay } from 'node:timers/promises';
import { AppiumClient, type AppiumSelector, type AppiumElement } from './appium/client';
import { ManagedAppiumSession, assertDeviceConnected } from './appium/session-manager';
import { AndroidExecutionError, checkCancellation } from './errors';
import { classifyScreen, isNodeInteractable, type AndroidScreenState, type Viewport } from './screen-state';
import { parseUiHierarchy, type UiNode } from './targets';
import type { AdbRunner } from './executor';
import { randomUUID } from 'node:crypto';
import { navigationLayers } from './browser-navigation';
import { ScreenSnapshotSchema, type ScreenSnapshot } from './snapshot';
import { matchUiTarget, canonicalUiText } from './ui-understanding';
import { isDescendant } from './exploration/scroll-regions';
import type { ExplorationMetrics } from './exploration/types';
import { resolveInteractionTarget } from './interaction-target-resolver';
import { HybridContextObserver, withSessionContextLock, matchesNativeAddress, type HybridObservation } from './hybrid-context-observer';
import type { MediaPlaybackEvidence } from './media-playback-verifier';
import { exclusiveActivationPoint } from './activation-point';
import { readKeyboardVisibility } from './agent/keyboard-visibility';

export interface Observation extends ScreenSnapshot {
  observedAt: string;
  source: 'APPIUM';
  foregroundPackage: string;
  screen: AndroidScreenState;
  nodes: UiNode[];
  viewport: Viewport;
  web?: HybridObservation;
  playback?: MediaPlaybackEvidence;
}
export interface ObservationEvidence {
  observedAt: string; source: 'APPIUM' | 'ADB'; foregroundPackage?: string;
  screen?: AndroidScreenState; nodeCount?: number;
  snapshotId?: string; observationStatus?: ScreenSnapshot['observationStatus']; deviceSerial?: string;
  webStatus?: HybridObservation['status']; webContext?: string; webReason?: string; domSource?: 'WEB_CONTEXT';
  playback?: MediaPlaybackEvidence;
}
export const observationEvidence = (snapshot: Observation): ObservationEvidence => ({
  observedAt: snapshot.observedAt, source: snapshot.source, foregroundPackage: snapshot.foregroundPackage,
  screen: snapshot.screen, nodeCount: snapshot.nodes.length,
  snapshotId: snapshot.snapshotId, observationStatus: snapshot.observationStatus, deviceSerial: snapshot.deviceSerial,
  ...(snapshot.playback ? { playback: snapshot.playback } : {}),
  ...(snapshot.web ? { webStatus: snapshot.web.status, ...(snapshot.web.status === 'DOM_AVAILABLE'
    ? { webContext: snapshot.web.context, domSource: 'WEB_CONTEXT' as const } : { webReason: snapshot.web.reason }) } : {}),
});
export interface ObserverProgress { waitingFor: string; elapsedMs: number; evidence?: ObservationEvidence; exploration?: ExplorationMetrics }
export interface LocatedElement {
  id: string; node: UiNode; snapshot: Observation;
  owner?: UiNode;
  interaction?: { method: 'ELEMENT_CLICK' | 'LABEL_GESTURE' | 'EXCLUSIVE_POINT'; ownerId?: string; point?: { x: number; y: number }; evidence: string[] };
}

export function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(',"\'",')})`;
}
export function selectorForNode(node: UiNode, nodes: UiNode[]): AppiumSelector {
  if (node.description && nodes.filter((candidate) => candidate.description === node.description).length === 1) {
    return { using: 'accessibility id', value: node.description };
  }
  if (/^[A-Za-z0-9_.]+:id\//.test(node.resourceId) && nodes.filter((candidate) => candidate.resourceId === node.resourceId).length === 1) {
    return { using: 'id', value: node.resourceId };
  }
  const [left, top, right, bottom] = node.bounds;
  const bounds = `[${left},${top}][${right},${bottom}]`;
  return { using: 'xpath', value: `//*[@package=${xpathLiteral(node.packageName)} and @class=${xpathLiteral(node.className)} and @bounds=${xpathLiteral(bounds)} and @clickable=${xpathLiteral(String(node.clickable))}${node.description ? ` and @content-desc=${xpathLiteral(node.description)}` : ''}${node.text ? ` and @text=${xpathLiteral(node.text)}` : ''}${node.resourceId ? ` and @resource-id=${xpathLiteral(node.resourceId)}` : ''}]` };
}

export async function waitForObservation<T>(read: (remainingMs: number) => Promise<Observation>, condition: (snapshot: Observation, remainingMs: number) => Promise<T | false> | T | false,
  target: string, timeoutMs: number, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<T> {
  const started = performance.now();
  let last: Observation | undefined;
  const remaining = () => Math.max(1, timeoutMs - (performance.now() - started));
  do {
    checkCancellation(signal);
    try {
      last = await read(remaining());
      checkCancellation(signal);
      onProgress?.({ waitingFor: target, elapsedMs: Math.round(performance.now() - started), evidence: observationEvidence(last) });
      const result = await condition(last, remaining());
      if (result && performance.now() - started <= timeoutMs) return result;
    } catch (error) {
      if (!(error instanceof AndroidExecutionError && error.code === 'TIMEOUT')) throw error;
      break;
    }
    if (performance.now() - started < timeoutMs) await delay(Math.min(150, remaining()), undefined, { signal }).catch(() => checkCancellation(signal));
  } while (performance.now() - started < timeoutMs);
  checkCancellation(signal);
  throw new AndroidExecutionError(last?.screen === 'UNKNOWN' ? 'UNKNOWN' : 'TIMEOUT', `${last?.screen === 'UNKNOWN' ? 'Unknown screen while waiting' : 'Timed out waiting'} for ${target} after ${Math.round(performance.now() - started)}ms.`);
}

export class StateObserver {
  readonly hybrid: HybridContextObserver;
  constructor(private readonly session: ManagedAppiumSession, private readonly run: AdbRunner,
    private readonly accounting?: { beforeSnapshot?: (source?: string) => void; beforeScroll?: () => void; onObservation?: (ms: number) => void; onParse?: (ms: number) => void }) { this.hybrid = new HybridContextObserver(session, accounting); }
  private get client(): AppiumClient { return this.session.client; }
  async read(timeoutMs = 15000, signal?: AbortSignal): Promise<Observation> {
    return withSessionContextLock(this.session, () => this.readNative(timeoutMs, signal));
  }
  async readNativeSnapshot(timeoutMs = 15000, signal?: AbortSignal): Promise<Observation> {
    return withSessionContextLock(this.session, () => this.readNative(timeoutMs, signal, true));
  }
  private async readNative(timeoutMs: number, signal?: AbortSignal, nativeOnly = false): Promise<Observation> {
    this.accounting?.beforeSnapshot?.('NATIVE');
    const started = performance.now();
    try { return await this.readNativeAccounted(timeoutMs, signal, nativeOnly); }
    finally { this.accounting?.onObservation?.(Math.round(performance.now() - started)); }
  }
  private async readNativeAccounted(timeoutMs: number, signal?: AbortSignal, nativeOnly = false): Promise<Observation> {
    checkCancellation(signal);
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - performance.now());
    await assertDeviceConnected(this.run, this.session.serial, remaining());
    await this.session.assertPhysicalIdentity?.(signal, remaining());
    await this.hybrid.ensureNative(remaining(), signal);
    checkCancellation(signal);
    const foregroundPackage = await this.client.request<string>('GET', this.session.path + '/appium/device/current_package', undefined, remaining(), signal);
    const xml = await this.client.request<string>('GET', this.session.path + '/source', undefined, remaining(), signal);
    const timestamp = Date.now();
    const viewport = await this.client.request<Viewport>('GET', this.session.path + '/window/rect', undefined, remaining(), signal);
    let activity: string | undefined;
    try { activity = await this.client.request<string>('GET', this.session.path + '/appium/device/current_activity', undefined, remaining(), signal); }
    catch (error) {
      if (!(error instanceof AndroidExecutionError && error.code === 'BACKEND_ERROR' && /unknown command/.test(error.message))) throw error;
    }
    let nodes: UiNode[];
    const parseStarted = performance.now();
    try { nodes = parseUiHierarchy(xml); }
    catch (error) { throw new AndroidExecutionError('BACKEND_ERROR', 'Appium returned an invalid UI hierarchy.', { cause: error }); }
    finally { try { this.accounting?.onParse?.(performance.now() - parseStarted); } catch { /* Diagnostics do not invalidate a successful observation. */ } }
    const confirmedPackage = await this.client.request<string>('GET', this.session.path + '/appium/device/current_package', undefined, remaining(), signal);
    const screen = confirmedPackage === foregroundPackage ? classifyScreen(foregroundPackage, nodes) : 'UNKNOWN';
    const snapshotId = randomUUID();
    const attributes = (node: UiNode, key: string, value: boolean | undefined) => node.observedAttributes?.includes(key) ? value : undefined;
    const structured = ScreenSnapshotSchema.parse({
      deviceSerial: this.session.serial, snapshotId, timestamp, foregroundPackage, activity,
      evidenceSource: 'APPIUM', observationStatus: screen === 'UNKNOWN' ? 'UNKNOWN' : 'OBSERVED',
      elements: nodes.map((node, index) => ({
        elementId: `${snapshotId}:${index}`, text: node.text, resourceId: node.resourceId, contentDescription: node.description,
        className: node.className, packageName: node.packageName, bounds: node.bounds,
        clickable: attributes(node, 'clickable', node.clickable), enabled: attributes(node, 'enabled', node.enabled),
        focused: attributes(node, 'focused', node.focused), visible: attributes(node, 'displayed', node.displayed),
        focusable: node.focusable, scrollable: node.scrollable, selected: node.selected,
        checkable: attributes(node, 'checkable', node.checkable), checked: attributes(node, 'checked', node.checked),
        parentElementId: node.parentIndex === undefined ? undefined : `${snapshotId}:${node.parentIndex}`,
      })),
    });
    const nativeOverlay = navigationLayers({ foregroundPackage, observationStatus: structured.observationStatus, nodes }).length > 0;
    let web: HybridObservation | undefined = nativeOverlay ? { status: 'WEB_UNAVAILABLE', source: 'NATIVE_ONLY', contexts: [],
      reason: 'Observed native browser navigation overlay; do not attach a web driver that may activate another tab.' } : !nativeOnly && confirmedPackage === foregroundPackage && !nodes.some(node => node.focused && /EditText|AutoCompleteTextView/.test(node.className)) &&
      (foregroundPackage === 'com.android.chrome' || nodes.some(node => /WebView/.test(node.className))) && remaining() > 100
      ? await this.hybrid.readInsideSessionLock(foregroundPackage, Math.min(remaining(), 5000), signal) : undefined;
    if (web?.status === 'DOM_AVAILABLE' && foregroundPackage === 'com.android.chrome') {
      const address = nodes.find(node => node.resourceId.endsWith(':id/url_bar'))?.text;
      if (!address || !matchesNativeAddress(address, web.document.url)) web = { status: 'AMBIGUOUS_CONTEXT', source: 'NATIVE_ONLY', contexts: web.contexts,
        reason: 'DOM URL does not match the observed native address; another tab or a changed page cannot be selected safely.' };
    }
    const finalPackage = web ? await this.client.request<string>('GET', this.session.path + '/appium/device/current_package', undefined, remaining(), signal) : confirmedPackage;
    const consistent = finalPackage === foregroundPackage;
    await this.session.assertPhysicalIdentity?.(signal, remaining());
    return { ...structured, observationStatus: consistent ? structured.observationStatus : 'UNKNOWN', observedAt: new Date(structured.timestamp).toISOString(),
      source: 'APPIUM', screen: consistent ? screen : 'UNKNOWN', nodes, viewport, ...(web && consistent ? { web } : {}) };
  }
  async locate(snapshot: Observation, target: string, forClick: boolean, timeoutMs: number, signal?: AbortSignal): Promise<LocatedElement | false> {
    return withSessionContextLock(this.session, () => this.locateNative(snapshot, target, forClick, timeoutMs, signal));
  }
  keyboardVisibility(signal?: AbortSignal) { return readKeyboardVisibility(this.session.serial, this.run, signal); }
  async locateSearchActivation(snapshot: Observation, target: string, timeoutMs: number, signal?: AbortSignal): Promise<LocatedElement | false> {
    return withSessionContextLock(this.session, async () => {
      const found = await this.locateNative(snapshot, target, false, timeoutMs, signal);
      if (!found) return false;
      const path = this.session.path + '/element/' + encodeURIComponent(found.id);
      if (await this.client.request('GET', path + '/attribute/clickable', undefined, timeoutMs, signal) !== 'true') return false;
      const rect = await this.client.request<Viewport>('GET', path + '/rect', undefined, timeoutMs, signal);
      if ([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height].join() !== found.node.bounds.join()) return false;
      const point = exclusiveActivationPoint(snapshot, found.node);
      return point ? { ...found, interaction: { method: 'EXCLUSIVE_POINT', point, evidence: ['fresh native hierarchy', 'unique displayed enabled native target', 'independent native rect equality', 'no other clickable control at point'] } } : false;
    });
  }
  private async locateNative(snapshot: Observation, target: string, forClick: boolean, timeoutMs: number, signal?: AbortSignal): Promise<LocatedElement | false> {
    if (snapshot.deviceSerial !== this.session.serial || Date.now() - snapshot.timestamp > 5000) throw new AndroidExecutionError('UNKNOWN', 'Snapshot is stale or belongs to another device. Observe again.');
    if (snapshot.observationStatus !== 'OBSERVED') return false;
    const matched = matchUiTarget(snapshot, target, false);
    if (matched.status === 'AMBIGUOUS') throw new AndroidExecutionError('UNKNOWN', matched.reason!);
    let node = matched.node;
    if (!node || matched.status !== 'MATCH') return false;
    if (forClick) {
      const resolution = resolveInteractionTarget(snapshot, node);
      if (resolution.status !== 'RESOLVED') return false;
      if (resolution.target.method === 'LABEL_GESTURE') return this.locateDelegatedLabel(snapshot, node, resolution.target.owner, timeoutMs, signal);
      node = resolution.target.node;
    }
    const selector = selectorForNode(node, snapshot.nodes);
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - performance.now());
    const rows = await this.client.request<AppiumElement[]>('POST', this.session.path + '/elements', selector, remaining(), signal);
    // Ambiguous selectors must never choose the first matching element silently.
    if (rows.length !== 1) return false;
    const id = rows[0]['element-6066-11e4-a52e-4f735466cecf'];
    const path = this.session.path + `/element/${encodeURIComponent(id)}`;
    try {
      if (!(await this.client.request<boolean>('GET', path + '/displayed', undefined, remaining(), signal)) ||
        !(await this.client.request<boolean>('GET', path + '/enabled', undefined, remaining(), signal))) return false;
      if (forClick) {
        const clickable = await this.client.request<string>('GET', path + '/attribute/clickable', undefined, remaining(), signal);
        if (clickable !== 'true') return false;
        const rect = await this.client.request<Viewport>('GET', path + '/rect', undefined, remaining(), signal);
        if (!isNodeInteractable({ ...node, bounds: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] }, snapshot.nodes, snapshot.viewport, target, snapshot.nodes.indexOf(node))) return false;
      }
    } catch (error) {
      if (error instanceof AndroidExecutionError && error.code === 'BACKEND_ERROR' && /stale element reference/.test(error.message)) return false;
      throw error;
    }
    return { id, node, snapshot, ...(forClick ? { interaction: { method: 'ELEMENT_CLICK' as const, evidence: ['unique native element', 'native geometry verified'] } } : {}) };
  }
  async locateDelegatedLabel(snapshot: Observation, label: UiNode, owner: UiNode, timeoutMs: number, signal?: AbortSignal): Promise<LocatedElement | false> {
    return withSessionContextLock(this.session, () => this.locateLabelNative(snapshot, label, owner, timeoutMs, signal));
  }
  private async locateLabelNative(snapshot: Observation, label: UiNode, owner: UiNode, timeoutMs: number, signal?: AbortSignal): Promise<LocatedElement | false> {
    if (!isDescendant(snapshot.nodes, label, owner) || label === owner || !owner.clickable) return false;
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - performance.now());
    const labelIndex = snapshot.nodes.indexOf(label), ownerIndex = snapshot.nodes.indexOf(owner);
    const parent = await this.locate(snapshot, `element:${snapshot.elements[ownerIndex].elementId}`, false, remaining(), signal);
    const found = await this.locate(snapshot, `element:${snapshot.elements[labelIndex].elementId}`, false, remaining(), signal);
    if (!parent || !found) return false;
    const parentPath = this.session.path + `/element/${encodeURIComponent(parent.id)}`;
    const path = this.session.path + `/element/${encodeURIComponent(found.id)}`;
    if (await this.client.request<string>('GET', parentPath + '/attribute/clickable', undefined, remaining(), signal) !== 'true') return false;
    const content = await this.client.request<string>('GET', path + (label.text ? '/text' : '/attribute/content-desc'), undefined, remaining(), signal);
    if (typeof content !== 'string' || canonicalUiText(content) !== canonicalUiText(label.text || label.description)) return false;
    const rect = await this.client.request<Viewport>('GET', path + '/rect', undefined, remaining(), signal);
    const ownerRect = await this.client.request<Viewport>('GET', parentPath + '/rect', undefined, remaining(), signal);
    if (![ownerRect.x, ownerRect.y, ownerRect.width, ownerRect.height].every(Number.isFinite) || ownerRect.width <= 0 || ownerRect.height <= 0) return false;
    if (rect.x < ownerRect.x || rect.y < ownerRect.y || rect.x + rect.width > ownerRect.x + ownerRect.width || rect.y + rect.height > ownerRect.y + ownerRect.height) return false;
    const nativeNode = { ...label, clickable: true, bounds: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] as UiNode['bounds'] };
    if (!isNodeInteractable(nativeNode, snapshot.nodes, snapshot.viewport, 'delegated label', labelIndex)) return false;
    return { ...found, node: label, owner, interaction: { method: 'LABEL_GESTURE', ownerId: parent.id,
      point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, evidence: ['native label content', 'native clickable owner', 'native containment', 'uncovered label bounds'] } };
  }
  async revalidateInteraction(found: LocatedElement, timeoutMs = 15000, signal?: AbortSignal): Promise<LocatedElement | false> {
    return withSessionContextLock(this.session, () => this.revalidateNative(found, timeoutMs, signal));
  }
  private async revalidateNative(found: LocatedElement, timeoutMs: number, signal?: AbortSignal): Promise<LocatedElement | false> {
    const started = performance.now();
    const fresh = await this.read(timeoutMs, signal);
    if (fresh.foregroundPackage !== found.snapshot.foregroundPackage || fresh.activity !== found.snapshot.activity) return false;
    const candidates = fresh.nodes.filter(node => node.packageName === found.node.packageName && node.className === found.node.className &&
      node.resourceId === found.node.resourceId && canonicalUiText(node.text) === canonicalUiText(found.node.text) &&
      canonicalUiText(node.description) === canonicalUiText(found.node.description) && node.bounds.every((value, index) => Math.abs(value - found.node.bounds[index]) <= 1));
    if (candidates.length !== 1) return false;
    const index = fresh.nodes.indexOf(candidates[0]);
    return this.locate(fresh, `element:${fresh.elements[index].elementId}`, true, Math.max(1, timeoutMs - (performance.now() - started)), signal);
  }
  waitUntil<T>(condition: (snapshot: Observation, remainingMs: number) => T | false | Promise<T | false>, target: string, timeoutMs: number, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<T> {
    return waitForObservation((remaining) => this.read(remaining, signal), condition, target, timeoutMs, signal, onProgress);
  }
  waitFor(target: string, timeoutMs: number, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void, forClick = false): Promise<LocatedElement> {
    return waitForObservation((remaining) => this.read(remaining, signal), (snapshot, remaining) => this.locate(snapshot, target, forClick, remaining, signal), target, timeoutMs, signal, onProgress);
  }
}
