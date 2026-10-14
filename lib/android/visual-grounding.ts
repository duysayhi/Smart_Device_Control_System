import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { ManagedAppiumSession } from './appium/session-manager';
import { withSessionContextLock } from './appium/session-operation-lock';
import type { Observation, StateObserver } from './state-observer';
import type { UiNode } from './targets';
import type { DiscoveredSelection } from './exploration/types';
import type { ActionPlan } from '../validators/action-plan.schema';
import { assertPlanPolicy, assertObservedControlSafe } from './security-policy';
import { resolveInteractionTarget } from './interaction-target-resolver';
import { clippedBounds, isDescendant } from './exploration/scroll-regions';
import { AndroidExecutionError, checkCancellation } from './errors';

type Bounds = UiNode['bounds'];
const Rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() });
const Bars = z.record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative(), visible: z.boolean() }));
export interface DisplayGeometry { orientation: 'PORTRAIT' | 'LANDSCAPE'; densityDpi: number; viewport: z.infer<typeof Rect>; bars: z.infer<typeof Bars> }
export interface VisualSummary {
  id: string; status: 'HUMAN_REQUIRED' | 'BLOCKED'; reason: string; mode: 'GEOMETRY_ONLY'; visionAvailable: false;
  createdAt: number; expiresAt: number; capturedSpanMs: number; app: string; geometry: DisplayGeometry;
  image: { width: number; height: number; crop: Bounds; dataUrl: string };
  candidates: { index: number; bounds: Bounds; resourceId: string; className: string; reason: string }[];
  selectedTitle: string; ordinal: number; ordinalVerified: boolean; coherent: boolean;
}
export interface HumanTapChoice { evidenceId: string; x: number; y: number; confirmed: true }
// Future providers propose evidence, never authorization. No provider is wired
// here and the text-only planner never receives screenshots.
export interface VisionGroundingProvider {
  ground(input: Readonly<VisualSummary>, signal?: AbortSignal): Promise<{ status: 'AMBIGUOUS' } |
    { status: 'PROPOSED'; activationBounds: Bounds; evidence: string[] }>;
}
interface Pending { summary: VisualSummary; snapshot: Observation; node: UiNode; selection: DiscoveredSelection; target: string; fingerprint: string; pixels: string }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function geometryFingerprint(s: Observation): string {
  return hash(JSON.stringify([s.deviceSerial, s.foregroundPackage, s.activity, s.observationStatus, s.viewport,
    s.nodes.map(n => [n.resourceId, n.className, n.packageName, n.text, n.description, n.bounds, n.parentIndex, n.enabled, n.displayed, n.clickable, n.focused, n.selected])]));
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function validBounds(b: Bounds): boolean { return b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1]; }
const inside = (x: number, y: number, b: Bounds, margin = 0) => x >= b[0] + margin && y >= b[1] + margin && x < b[2] - margin && y < b[3] - margin;
export function validateGroundedPoint(s: Observation, target: UiNode, g: DisplayGeometry, x: number, y: number): void {
  if (![x, y].every(Number.isFinite) || !s.nodes.includes(target) || !validBounds(target.bounds) || !target.enabled || target.displayed === false ||
    target.packageName !== s.foregroundPackage || s.observationStatus !== 'OBSERVED') throw new AndroidExecutionError('AMBIGUOUS', 'Target or point is not observed and enabled.');
  if (!inside(x, y, clippedBounds(s, target), 4)) throw new AndroidExecutionError('AMBIGUOUS', 'Point is outside the safe, ancestor-clipped target region.');
  const v = g.viewport;
  if (!inside(x, y, [v.x, v.y, v.x + v.width, v.y + v.height], 4) || Object.values(g.bars).some(b => b.visible && inside(x, y, [b.x, b.y, b.x + b.width, b.y + b.height]))) {
    throw new AndroidExecutionError('AMBIGUOUS', 'Point intersects screen edge or a system inset.');
  }
  if (s.nodes.some(n => n !== target && n.displayed !== false && n.clickable && inside(x, y, n.bounds) && !isDescendant(s.nodes, target, n))) {
    throw new AndroidExecutionError('AMBIGUOUS', 'Another observed clickable control competes at the selected point.');
  }
  assertObservedControlSafe(target);
}
export class VisualGroundingEngine {
  private pending?: Pending;
  private captures = 0;
  constructor(private readonly session: ManagedAppiumSession, private readonly observer: Pick<StateObserver, 'readNativeSnapshot'>) {}
  dispose(): void { this.pending = undefined; }
  private async geometry(timeout: number, signal?: AbortSignal): Promise<DisplayGeometry> {
    const c = this.session.client, p = this.session.path;
    const orientation = z.enum(['PORTRAIT', 'LANDSCAPE']).parse(await c.request('GET', p + '/orientation', undefined, timeout, signal));
    const densityDpi = z.number().positive().max(2000).parse(await c.request('POST', p + '/execute/sync', { script: 'mobile: getDisplayDensity', args: [] }, timeout, signal));
    const bars = Bars.parse(await c.request('POST', p + '/execute/sync', { script: 'mobile: getSystemBars', args: [] }, timeout, signal));
    const viewport = Rect.parse(await c.request('GET', p + '/window/rect', undefined, timeout, signal));
    return { orientation, densityDpi, bars, viewport };
  }
  private async screenshot(g: DisplayGeometry, timeout: number, signal?: AbortSignal) {
    if (++this.captures > 6) throw new AndroidExecutionError('CONFIG_ERROR', 'Visual screenshot budget exhausted (6 per execution).');
    checkCancellation(signal);
    const encoded = await this.session.client.request<string>('GET', this.session.path + '/screenshot', undefined, timeout, signal);
    if (typeof encoded !== 'string' || encoded.length > 16_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new AndroidExecutionError('UNKNOWN', 'Screenshot payload is invalid or oversized.');
    const image = Buffer.from(encoded, 'base64');
    const meta = await sharp(image, { limitInputPixels: 8_000_000 }).metadata();
    if (meta.format !== 'png' || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || g.viewport.x !== 0 || g.viewport.y !== 0 ||
      meta.width !== g.viewport.width || meta.height !== g.viewport.height || (g.orientation === 'PORTRAIT' ? meta.height < meta.width : meta.width < meta.height)) {
      throw new AndroidExecutionError('AMBIGUOUS', 'Screenshot/device coordinate mapping or orientation cannot be proven 1:1.');
    }
    // Compare decoded pixels, excluding only measured system bars. Never mask
    // arbitrary animation to manufacture an unchanged screen.
    const visible = Object.values(g.bars).filter(b => b.visible && b.width >= meta.width! * .9);
    const top = Math.max(0, ...visible.filter(b => b.y === 0).map(b => b.y + b.height));
    const bottom = Math.min(meta.height, ...visible.filter(b => b.y > meta.height! / 2).map(b => b.y));
    if (bottom <= top) throw new AndroidExecutionError('UNKNOWN', 'System insets leave no comparable screen region.');
    const pixels = await sharp(image, { limitInputPixels: 8_000_000 }).extract({ left: 0, top: Math.ceil(top), width: meta.width, height: Math.floor(bottom) - Math.ceil(top) }).removeAlpha().raw().toBuffer();
    return { image, width: meta.width, height: meta.height, pixels: hash(pixels) };
  }
  async collect(blocked: { snapshot: Observation; node: UiNode; selection: DiscoveredSelection; target?: string }, reason: string, signal?: AbortSignal): Promise<VisualSummary> {
    return withSessionContextLock(this.session, async () => {
      this.pending = undefined;
      const started = performance.now();
      const bounded = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
      const before = await this.observer.readNativeSnapshot(15000, bounded);
      if (!['com.google.android.youtube', 'com.android.chrome', 'com.android.settings'].includes(before.foregroundPackage) ||
        before.nodes.some(n => n.focused && /EditText|AutoCompleteTextView/.test(n.className)) || before.nodes.some(n => /password|credit.?card|payment|login/i.test(n.resourceId))) {
        throw new AndroidExecutionError('CONFIG_ERROR', 'Visual capture is not permitted on this app/input/sensitive screen.');
      }
      const sourceMatches = geometryFingerprint(before) === geometryFingerprint(blocked.snapshot);
      const index = blocked.snapshot.nodes.indexOf(blocked.node);
      const diagnostic = before.nodes.filter(n => n.className === blocked.node.className && n.resourceId === blocked.node.resourceId &&
        [n.text, n.description].some(value => value.normalize('NFC').includes(blocked.selection.title.normalize('NFC'))));
      const node = sourceMatches ? before.nodes[index] : diagnostic.length === 1 ? diagnostic[0] : undefined;
      if (!node) throw new AndroidExecutionError('AMBIGUOUS', 'Screen changed before visual evidence collection; no unique fresh diagnostic target remains.');
      if (!node || !validBounds(node.bounds)) throw new AndroidExecutionError('AMBIGUOUS', 'Selected target has invalid bounds.');
      const content = [node.text, node.description].join(' ').normalize('NFC');
      const title = blocked.selection.title.trim().normalize('NFC');
      if (!title || !content.includes(title) || before.nodes.filter(n => n.className === node.className && n.resourceId === node.resourceId &&
        n.text === node.text && n.description === node.description && n.enabled && n.displayed !== false).length !== 1) {
        throw new AndroidExecutionError('AMBIGUOUS', 'Selected content is missing or has competing identical candidates.');
      }
      assertObservedControlSafe(node);
      const g = await this.geometry(5000, bounded), shot = await this.screenshot(g, 7000, bounded);
      const after = await this.observer.readNativeSnapshot(15000, bounded);
      const g2 = await this.geometry(5000, bounded), second = await this.screenshot(g2, 7000, bounded);
      const coherent = equal(g, g2) && geometryFingerprint(before) === geometryFingerprint(after) && shot.pixels === second.pixels;
      const clip = clippedBounds(before, node);
      if (!validBounds(clip)) throw new AndroidExecutionError('AMBIGUOUS', 'Target is outside the screenshot viewport.');
      const crop: Bounds = [Math.max(0, Math.floor(clip[0])), Math.max(0, Math.floor(clip[1])), Math.min(shot.width, Math.ceil(clip[2])), Math.min(shot.height, Math.ceil(clip[3]))];
      if (!validBounds(crop)) throw new AndroidExecutionError('AMBIGUOUS', 'Target crop is invalid.');
      const cropped = await sharp(shot.image).extract({ left: crop[0], top: crop[1], width: crop[2] - crop[0], height: crop[3] - crop[1] }).png().toBuffer();
      const stats = await sharp(cropped).stats();
      const hasVisualContent = stats.channels.slice(0, 3).some(channel => channel.max - channel.min >= 8);
      const candidates = before.nodes.flatMap((n, i) => n === node || isDescendant(before.nodes, n, node) ? [{ index: i, bounds: [...n.bounds] as Bounds,
        resourceId: n.resourceId, className: n.className, reason: n === node ? reason : (() => { const r = resolveInteractionTarget(before, n); return r.status === 'RESOLVED' ? 'Native geometry alone does not prove that this auxiliary control activates the selected content.' : r.reason; })() }] : []).slice(0, 30);
      const createdAt = Date.now();
      checkCancellation(bounded);
      const summary: VisualSummary = { id: randomUUID(), status: sourceMatches && coherent && hasVisualContent ? 'HUMAN_REQUIRED' : 'BLOCKED', coherent,
        reason: !sourceMatches ? 'Source screen changed before capture. This fresh target image is diagnostic only; the previous ordinal/selection is not authorized for tapping.' : !hasVisualContent ? 'Screenshot crop is blank/uniform; an activation region cannot be confirmed.' : coherent ? reason + ' No Vision model is configured; a target box does not prove an activation region.' : 'Screenshot and hierarchy are not proven to represent the same unchanged screen.',
        mode: 'GEOMETRY_ONLY', visionAvailable: false, createdAt, expiresAt: createdAt + 120000, capturedSpanMs: Math.round(performance.now() - started),
        app: before.foregroundPackage, geometry: g, image: { width: shot.width, height: shot.height, crop, dataUrl: `data:image/png;base64,${cropped.toString('base64')}` },
        candidates, selectedTitle: blocked.selection.title, ordinal: blocked.selection.ordinal, ordinalVerified: sourceMatches };
      if (sourceMatches && coherent && hasVisualContent) this.pending = { summary, snapshot: before, node, selection: blocked.selection,
        target: blocked.target ?? (blocked.selection.itemType === 'video' ? `video_card_${blocked.selection.ordinal}` : `result_${blocked.selection.ordinal}`),
        fingerprint: geometryFingerprint(before), pixels: shot.pixels };
      return summary;
    });
  }
  async tap(choice: HumanTapChoice, plan: ActionPlan, signal?: AbortSignal): Promise<{ before: Observation; selection: DiscoveredSelection; point: { x: number; y: number }; decision: 'HUMAN_CONFIRMED' }> {
    return withSessionContextLock(this.session, async () => {
      checkCancellation(signal);
      const pending = this.pending;
      this.pending = undefined;
      assertPlanPolicy(plan);
      const last = plan.actions.at(-1);
      if (!pending || choice.confirmed !== true || choice.evidenceId !== pending.summary.id || Date.now() > pending.summary.expiresAt ||
        last?.type !== 'CLICK' || last.target !== pending.target) {
        throw new AndroidExecutionError('AMBIGUOUS', 'Confirmation is expired, replayed or unrelated to the pending target.');
      }
      const bounded = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
      await this.session.ensureActive(bounded);
      const s = await this.observer.readNativeSnapshot(15000, bounded), g = await this.geometry(5000, bounded);
      const shot = await this.screenshot(g, 7000, bounded);
      const after = await this.observer.readNativeSnapshot(15000, bounded);
      const g2 = await this.geometry(5000, bounded), shot2 = await this.screenshot(g2, 7000, bounded);
      if (Date.now() > pending.summary.expiresAt || !equal(g, pending.summary.geometry) || !equal(g, g2) ||
        geometryFingerprint(s) !== pending.fingerprint || geometryFingerprint(after) !== pending.fingerprint || shot.pixels !== pending.pixels || shot2.pixels !== pending.pixels) {
        throw new AndroidExecutionError('AMBIGUOUS', 'Screen, image, orientation or target changed after confirmation. No tap was sent.');
      }
      const node = s.nodes[pending.snapshot.nodes.indexOf(pending.node)];
      const point = { x: Math.round(choice.x), y: Math.round(choice.y) };
      validateGroundedPoint(s, node, g, point.x, point.y);
      checkCancellation(bounded);
      await this.session.client.request('POST', this.session.path + '/execute/sync', { script: 'mobile: clickGesture', args: [point] }, 7000, bounded);
      return { before: s, selection: pending.selection, point, decision: 'HUMAN_CONFIRMED' };
    });
  }
}
