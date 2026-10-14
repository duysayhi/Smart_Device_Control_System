import type { ManagedAppiumSession } from '../appium/session-manager';
import { AndroidExecutionError, checkCancellation } from '../errors';
import type { Observation, StateObserver } from '../state-observer';
import type { ScrollRegion } from './scroll-regions';
import type { ScrollDirection } from './types';
import { withSessionContextLock } from '../appium/session-operation-lock';

export class ScrollController {
  constructor(private readonly session: ManagedAppiumSession, private readonly observer: StateObserver, private readonly beforeScroll?: () => void) {}
  async scroll(snapshot: Observation, region: ScrollRegion, direction: ScrollDirection, percent: number, timeoutMs: number, signal?: AbortSignal, speed = 700): Promise<boolean> {
    return withSessionContextLock(this.session, () => this.scrollNative(snapshot, region, direction, percent, timeoutMs, signal, speed));
  }
  private async scrollNative(snapshot: Observation, region: ScrollRegion, direction: ScrollDirection, percent: number, timeoutMs: number, signal: AbortSignal | undefined, speed: number): Promise<boolean> {
    checkCancellation(signal);
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - performance.now());
    const element = snapshot.elements[region.index];
    if (!element) throw new AndroidExecutionError('UNKNOWN', 'Scroll region is no longer in the current snapshot.');
    const found = await this.observer.locate(snapshot, `element:${element.elementId}`, false, remaining(), signal);
    if (!found) throw new AndroidExecutionError('UNKNOWN', 'Scroll region failed fresh native validation.');
    if (await this.session.client.request<string>('GET', this.session.path + `/element/${encodeURIComponent(found.id)}/attribute/scrollable`, undefined, remaining(), signal) !== 'true') {
      throw new AndroidExecutionError('UNKNOWN', 'Native region is no longer scrollable.');
    }
    const rect = await this.session.client.request<{ x: number; y: number; width: number; height: number }>('GET',
      this.session.path + `/element/${encodeURIComponent(found.id)}/rect`, undefined, remaining(), signal);
    const left = Math.max(rect.x, region.bounds[0]) + 8, top = Math.max(rect.y, region.bounds[1]) + 8;
    const right = Math.min(rect.x + rect.width, region.bounds[2]) - 8, bottom = Math.min(rect.y + rect.height, region.bounds[3]) - 8;
    if (right - left < 80 || bottom - top < 80) throw new AndroidExecutionError('UNKNOWN', 'Native scroll area is too small or outside viewport.');
    const nativeBounds = [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
    const fullRegion = nativeBounds.every((value, index) => Math.abs(value - region.bounds[index]) <= 1);
    const area = fullRegion ? { elementId: found.id } : { left, top, width: right - left, height: bottom - top };
    checkCancellation(signal);
    this.beforeScroll?.();
    const more = await this.session.client.request<unknown>('POST', this.session.path + '/execute/sync', {
      script: 'mobile: scrollGesture', args: [{ ...area, direction, percent, speed }],
    }, remaining(), signal);
    if (typeof more !== 'boolean') throw new AndroidExecutionError('BACKEND_ERROR', 'scrollGesture did not return a verified canScrollMore boolean.');
    return more;
  }
}
