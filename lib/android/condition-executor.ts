import type { Action, ActionPlan } from '../validators/action-plan.schema';
import { AppiumClient } from './appium/client';
import { ManagedAppiumSession, acquireDeviceLock, assertDeviceConnected } from './appium/session-manager';
import { createAndroidExecutor, quoteAndroidShell, type AdbRunner } from './executor';
import { resolveAppPackage } from './capabilities';
import { StateObserver, observationEvidence, type Observation, type ObservationEvidence, type ObserverProgress } from './state-observer';
import { AndroidExecutionError, checkCancellation } from './errors';
import { uiFingerprint, verifyClickTransition, verifyBrowserSearch, verifyDiscoveredSelection } from './action-verifier';
import { UIExplorer } from './exploration/ui-explorer';
import { ScrollController } from './exploration/scroll-controller';
import { detectScrollRegion } from './exploration/scroll-regions';
import { explorationConfig, explorationGoal, type ExplorationMetrics } from './exploration/types';
import { assertPlanPolicy, assertActionNotSensitive, assertObservedControlSafe, unsafeBrowserInput } from './security-policy';
import { withSessionContextLock } from './appium/session-operation-lock';
import { VisualGroundingEngine, type HumanTapChoice } from './visual-grounding';
import { createMediaPlaybackVerifier } from './media-playback-verifier';
import { disableWifi, setWifiEnabled, openWifiSettings } from './wifi-control';
import { connectWifiNetwork } from './wifi-network';
import { wifiNetworkTarget } from './wifi-plan';
import { developmentPolicyEnabled } from './policy-mode';

export interface ActionOutcome {
  selection?: import('./exploration/types').DiscoveredSelection;
  verification: 'VERIFIED' | 'DISPATCHED';
  elapsedMs: number;
  evidence?: ObservationEvidence;
  postcondition?: string;
  preconditions?: string[];
  exploration?: ExplorationMetrics;
  interaction?: { method: string; resourceId: string; className: string; bounds: number[]; evidence: string[] };
}
export interface ExecutionAccounting {
  executionId?: string;
  wifiOffConfirmed?: boolean;
  wifiOnConfirmed?: boolean;
  wifiNetworkConfirmed?: string;
  beforeSnapshot?: (source?: string) => void; beforeScroll?: () => void;
  onWebVerification?: (value: { phase: string; urlMatches?: boolean; titleMatches?: boolean; ready?: boolean; pageError?: boolean; changed?: boolean }) => void;
  onObservation?: (ms: number) => void; onVerification?: (ms: number) => void;
  onVerifiedSnapshot?: (snapshot: Observation) => void;
  beforeKey?: (action: Extract<Action, { type: 'PRESS_KEY' }>, snapshot: Observation) => void;
  verifyNavigation?: (before: Observation, after: Observation) => boolean;
  beforeAction?: (action: Action, snapshot: Observation) => void;
  verifyAction?: (action: Action, before: Observation, after: Observation) => boolean | undefined;
  allowedPackage?: (packageName: string) => boolean;
}

export function assertNonSensitivePlan(plan: ActionPlan): void {
  assertPlanPolicy(plan);
}

export class ConditionExecutor {
  private readonly observer: StateObserver;
  private readonly legacy: ReturnType<typeof createAndroidExecutor>;
  private query?: string;
  private expectedPackage?: string;
  private readonly explorer: UIExplorer;
  private readonly scrollController: ScrollController;
  private readonly visual: VisualGroundingEngine;
  private playbackCheck?: (snapshot: Observation, signal?: AbortSignal) => Promise<boolean>;
  constructor(private readonly session: ManagedAppiumSession, private readonly run: AdbRunner, private readonly accounting?: ExecutionAccounting) {
    this.observer = new StateObserver(session, run, accounting);
    this.visual = new VisualGroundingEngine(session, this.observer);
    this.legacy = createAndroidExecutor(run);
    this.scrollController = new ScrollController(session, this.observer, accounting?.beforeScroll);
    this.explorer = new UIExplorer(this.observer, this.scrollController);
  }
  async observe(signal?: AbortSignal): Promise<Observation> {
    const snapshot = await this.observer.read(15000, signal);
    await this.playbackCheck?.(snapshot, signal);
    return snapshot;
  }
  discoveryMemory() { return this.explorer.memorySummary(); }
  dispose(): void { this.playbackCheck = undefined; this.visual.dispose(); this.explorer.reset(); this.query = undefined; this.expectedPackage = undefined; }
  async confirmVisualTap(choice: HumanTapChoice, plan: ActionPlan, signal?: AbortSignal): Promise<ActionOutcome> {
    return withSessionContextLock(this.session, async () => {
      const started = performance.now();
      const result = await this.visual.tap(choice, plan, signal);
      if (verifyDiscoveredSelection(result.selection, result.before, result.before) === undefined) {
        const after = await this.observer.read(15000, signal);
        return { verification: 'DISPATCHED', elapsedMs: Math.round(performance.now() - started), evidence: observationEvidence(after),
          postcondition: 'Human-confirmed grounded tap sent; no trusted destination verifier for this target' };
      }
      const mediaVerify = createMediaPlaybackVerifier(this.run, this.session.serial);
      const after = await this.observer.waitUntil(async (s, remaining) =>
        verifyDiscoveredSelection(result.selection, result.before, s) || await mediaVerify(result.selection, result.before, s, remaining, signal) ? s : false,
        'human-confirmed selected destination', 30000, signal);
      this.accounting?.onVerifiedSnapshot?.(after);
      if (after.playback) this.playbackCheck = (s, cancel) => mediaVerify(result.selection, result.before, s, 3000, cancel);
      this.explorer.reset();
      return { selection: result.selection, verification: 'VERIFIED', elapsedMs: Math.round(performance.now() - started), evidence: observationEvidence(after),
        postcondition: 'Human-confirmed grounded tap and selected destination verified',
        preconditions: ['independent policy ALLOW', 'single-use confirmation', 'same native hierarchy and screen pixels', 'uncovered measured point'],
        interaction: { method: 'HUMAN_CONFIRMED_GROUNDED_TAP', resourceId: '', className: '', bounds: [result.point.x, result.point.y], evidence: [choice.evidenceId, result.decision] } };
    });
  }
  async execute(action: Action, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<ActionOutcome> {
    return withSessionContextLock(this.session, () => this.executeWithinContextLock(action, signal, onProgress));
  }
  private async executeWithinContextLock(action: Action, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<ActionOutcome> {
    assertActionNotSensitive(action);
    checkCancellation(signal);
    this.playbackCheck = undefined;
    await this.session.ensureActive(signal);
    const start = performance.now();
    let snapshot: Observation | undefined;
    let verification: ActionOutcome['verification'] = 'VERIFIED';
    let postcondition = 'UI condition verified';
    const preconditions = ['device connected', 'session active', 'selected serial confirmed'];
    let exploration: ExplorationMetrics | undefined;
    let interaction: ActionOutcome['interaction'];
    let selection: ActionOutcome['selection'];
    const discover = async (target: string, timeout: number, forClick: boolean, allowLate = false) => {
      const started = performance.now();
      const result = await this.explorer.find(target, timeout, forClick, signal, onProgress);
      exploration = result.metrics;
      if (result.status === 'FOUND' && result.found) return result;
      if (allowLate && result.status === 'NOT_FOUND' && !result.metrics.scrollCount && performance.now() - started < timeout) {
        const observedIds = new Set<string>();
        const metrics = { ...result.metrics, phase: 'WAITING_DATA' as ExplorationMetrics['phase'], status: undefined, reason: undefined };
        try {
          const found = await this.observer.waitFor(target, timeout - (performance.now() - started), signal, progress => {
            if (progress.evidence?.snapshotId) observedIds.add(progress.evidence.snapshotId);
            metrics.snapshotCount = result.metrics.snapshotCount + observedIds.size;
            metrics.elapsedMs = Math.round(performance.now() - started);
            onProgress?.({ ...progress, elapsedMs: metrics.elapsedMs, exploration: { ...metrics } });
          }, forClick);
          Object.assign(metrics, { phase: 'FOUND', status: 'FOUND', newElements: 1, elapsedMs: Math.round(performance.now() - started) });
          exploration = metrics;
          onProgress?.({ waitingFor: target, elapsedMs: metrics.elapsedMs, evidence: observationEvidence(found.snapshot), exploration: { ...metrics } });
          return { ...result, metrics, status: 'FOUND' as const, found };
        } catch (error) {
          if (error instanceof AndroidExecutionError) {
            error.exploration = { ...metrics, phase: 'NOT_FOUND', status: error.code as ExplorationMetrics['status'], elapsedMs: Math.round(performance.now() - started) };
          }
          throw error;
        }
      }
      const failure = new AndroidExecutionError(result.status === 'FOUND' ? 'UNKNOWN' : result.status, result.reason ?? 'UI exploration did not locate the target.');
      failure.exploration = result.metrics;
      if (forClick && result.status === 'AMBIGUOUS' && result.blockedTarget) {
        try { failure.visual = await this.visual.collect(result.blockedTarget, failure.message, signal); }
        catch (error) {
          if (error instanceof AndroidExecutionError && ['CANCELLED', 'DEVICE_ERROR', 'SESSION_ERROR', 'TIMEOUT'].includes(error.code)) throw error;
          failure.visualFailure = error instanceof AndroidExecutionError ? error.message : 'Visual evidence could not be validated.';
        }
      }
      throw failure;
    };
    const wait = async <T>(condition: (snapshot: Observation) => T | false, label: string, timeout = 20000) => {
      const started = performance.now();
      try { return await this.observer.waitUntil(condition, label, timeout, signal, onProgress); }
      finally { this.accounting?.onVerification?.(Math.round(performance.now() - started)); }
    };
    switch (action.type) {
      case 'OPEN_APP': {
        this.visual.dispose();
        const app = resolveAppPackage(action.app);
        this.expectedPackage = app;
        this.query = undefined;
        this.explorer.reset();
        const current = await this.observer.read(15000, signal);
        if (current.foregroundPackage === app) { snapshot = current; postcondition = 'Foreground already verified'; break; }
        const { stdout } = await this.run(['-s', this.session.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', app]);
        const component = stdout.trim().split(/\r?\n/).find((line) => line.startsWith(`${app}/`));
        if (!component || !/^[A-Za-z0-9_.$/]+$/.test(component)) throw new AndroidExecutionError('CONFIG_ERROR', 'Android could not resolve a launcher activity for this app.');
        checkCancellation(signal);
        await this.run(['-s', this.session.serial, 'shell', 'am', 'start', '-W', '-n', quoteAndroidShell(component)]);
        snapshot = await wait((state) => state.foregroundPackage === app ? state : false, `foreground:${app}`);
        postcondition = `Foreground verified: ${app}`;
        this.query = undefined;
        break;
      }
      case 'WAIT_FOR': {
        const videoList = action.target === 'video_list';
        const timeout = videoList ? Math.max(action.timeoutMs, explorationConfig().timeoutMs) : action.timeoutMs;
        const { found } = await discover(videoList ? 'video_card_1' : action.target, timeout, false, !videoList);
        if (!found) throw new AndroidExecutionError('UNKNOWN', 'WAIT_FOR did not provide a validated element.');
        snapshot = found.snapshot;
        postcondition = 'Target visible and enabled';
        break;
      }
      case 'CLICK': {
        if (action.target.startsWith('wifi_connect:')) {
          const ssid = wifiNetworkTarget(action.target);
          if (ssid === undefined || (!developmentPolicyEnabled() && this.accounting?.wifiNetworkConfirmed !== ssid)) throw new AndroidExecutionError('CONFIG_ERROR', 'Wi-Fi connection requires confirmation for this exact SSID and device.');
          snapshot = await connectWifiNetwork(this.session, this.observer, this.explorer, this.run, ssid, signal, onProgress);
          postcondition = `Android confirms connection to Wi-Fi ${ssid}; Internet access not verified`;
          break;
        }
        if (action.target === 'wifi_on') {
          if (!developmentPolicyEnabled() && !this.accounting?.wifiOnConfirmed) throw new AndroidExecutionError('CONFIG_ERROR', 'Wi-Fi on requires explicit device-bound confirmation.');
          snapshot = await setWifiEnabled(this.session, this.observer, this.run, true, signal);
          postcondition = 'Wi-Fi ON verified by native switch and Android wifi_on=1';
          break;
        }
        if (action.target === 'wifi_settings') {
          snapshot = await openWifiSettings(this.session, this.observer, this.run, signal);
          postcondition = 'Wi-Fi settings page verified; no switch clicked';
          break;
        }
        if (action.target === 'wifi_off') {
          if (!developmentPolicyEnabled() && !this.accounting?.wifiOffConfirmed) throw new AndroidExecutionError('CONFIG_ERROR', 'Wi-Fi off requires explicit device-bound confirmation.');
          snapshot = await disableWifi(this.session, this.observer, this.run, signal);
          postcondition = 'Wi-Fi OFF verified by native switch and Android wifi_on=0';
          break;
        }
        if (/^(first_result|result_[1-9]\d?)$/.test(action.target)) {
          const before = await this.observer.read(20000, signal);
          if (this.expectedPackage && before.foregroundPackage !== this.expectedPackage) throw new AndroidExecutionError('UNKNOWN', 'Foreground app changed before web navigation.');
          if (before.web?.status === 'DOM_AVAILABLE') {
            const url = new URL(before.web.document.url);
            const query = this.query ?? url.searchParams.get('q') ?? url.searchParams.get('query');
            if (!query || !verifyBrowserSearch(before, query)) throw new AndroidExecutionError('UNKNOWN', 'A verified current browser search-result list is required; no article was clicked.');
            const ordinal = action.target === 'first_result' ? 1 : Number(action.target.slice(7));
            const result = await this.observer.hybrid.clickOrdinal(before.web, ordinal, Math.min(explorationConfig().timeoutMs, 30000), signal);
            snapshot = await this.observer.read(20000, signal);
            if (snapshot.foregroundPackage !== before.foregroundPackage) throw new AndroidExecutionError('UNKNOWN', 'Foreground app changed after Web Context interaction.');
            this.accounting?.onVerifiedSnapshot?.(snapshot);
            return { verification: 'VERIFIED', elapsedMs: Math.round(performance.now() - start), evidence: observationEvidence(snapshot),
              selection: { itemType: 'browser', ordinal, identity: result.url, title: result.selectedTitle ?? result.title, url: result.url },
              postcondition: `Web Context result ${ordinal} destination URL and loaded document verified`, preconditions: [...preconditions, 'unique observed DOM heading link', 'same query and ordinal after scroll', 'uncovered visible DOM anchor', `destination:${result.url}`] };
          }
        }
        const result = await discover(action.target, explorationConfig().timeoutMs, true);
        let found = result.found!;
        selection = result.selection;
        if (this.expectedPackage && found.snapshot.foregroundPackage !== this.expectedPackage && !this.accounting?.allowedPackage?.(found.snapshot.foregroundPackage)) throw new AndroidExecutionError('UNKNOWN', 'Foreground app changed before interaction.');
        assertObservedControlSafe(found.node);
        if (found.owner) assertObservedControlSafe(found.owner);
        preconditions.push('unique native element', 'visible and enabled', 'clickable element or validated clickable owner', 'activation point within viewport and not covered by another control');
        checkCancellation(signal);
        if (this.observer.revalidateInteraction) {
          const fresh = await this.observer.revalidateInteraction(found, 15000, signal);
          if (!fresh) throw new AndroidExecutionError('AMBIGUOUS', 'Interaction target changed or became covered before click. No click was sent.');
          found = fresh;
          assertObservedControlSafe(found.node);
          if (found.owner) assertObservedControlSafe(found.owner);
        }
        this.accounting?.beforeAction?.(action, found.snapshot);
        if (found.interaction?.method === 'LABEL_GESTURE') {
          if (!found.interaction.point) throw new AndroidExecutionError('AMBIGUOUS', 'Native label bounds did not provide an activation point.');
          await this.session.client.request('POST', this.session.path + '/execute/sync', { script: 'mobile: clickGesture', args: [found.interaction.point] }, 15000, signal);
        } else await this.session.client.request('POST', this.session.path + `/element/${encodeURIComponent(found.id)}/click`, {}, 15000, signal);
        interaction = { method: found.interaction?.method ?? 'ELEMENT_CLICK', resourceId: found.node.resourceId, className: found.node.className,
          bounds: [...found.node.bounds], evidence: found.interaction?.evidence ?? ['unique observed native element'] };
        let policyVerification: boolean | undefined;
        const verify = (state: Observation) => (policyVerification = this.accounting?.verifyAction?.(action, found.snapshot, state)) ??
          (result.selection ? verifyDiscoveredSelection(result.selection, found.snapshot, state) : verifyClickTransition(found.snapshot, state, action.target));
        if (verify(found.snapshot) !== undefined) {
          const verifyStarted = performance.now() - start;
          const verifyBudget = result.selection ? Math.max(1, explorationConfig().timeoutMs - verifyStarted) : 20000;
          const verifiedSnapshots = new Set<string>();
          const verificationStarted = performance.now();
          const mediaVerify = createMediaPlaybackVerifier(this.run, this.session.serial);
          try {
            snapshot = await this.observer.waitUntil(async (state, remaining) => {
              const verified = verify(state);
              if (verified || (policyVerification === undefined && result.selection &&
                await mediaVerify(result.selection, found.snapshot, state, remaining, signal))) return state;
              return false;
            }, `postcondition:${action.target}`, verifyBudget, signal, progress => {
              if (progress.evidence?.snapshotId) verifiedSnapshots.add(progress.evidence.snapshotId);
              onProgress?.({ ...progress, elapsedMs: Math.round(verifyStarted + progress.elapsedMs), exploration: { ...result.metrics,
                snapshotCount: result.metrics.snapshotCount + verifiedSnapshots.size, phase: 'VERIFYING' } });
            });
          } catch (error) {
            if (error instanceof AndroidExecutionError) { error.selection = result.selection; error.interactionSent = true; }
            if (error instanceof AndroidExecutionError) error.exploration = { ...result.metrics,
              snapshotCount: result.metrics.snapshotCount + verifiedSnapshots.size, phase: 'NOT_FOUND', status: error.code as ExplorationMetrics['status'], reason: error.message };
            throw error;
          } finally { this.accounting?.onVerification?.(Math.round(performance.now() - verificationStarted)); }
          exploration = { ...result.metrics, snapshotCount: result.metrics.snapshotCount + verifiedSnapshots.size };
          if (snapshot.playback && result.selection) {
            const selected = result.selection;
            this.playbackCheck = (s, cancel) => mediaVerify(selected, found.snapshot, s, 3000, cancel);
          }
          postcondition = result.selection ? `Selected ${result.selection.itemType} result ${result.selection.ordinal} and destination content verified` : 'UI transition verified';
          if (snapshot.playback) postcondition = 'Selected video title matched Android Media Session; active playback position advanced';
          if (snapshot.playback?.positionSource === 'ANDROID_PLAYBACK_CLOCK') postcondition = 'Selected video title matched Android Media Session; PLAYING confirmed across snapshots with advancing Android playback clock';
        } else {
          snapshot = await this.observer.read(15000, signal);
          verification = 'DISPATCHED';
          postcondition = 'Action sent; no trusted goal postcondition';
        }
        this.explorer.reset();
        break;
      }
      case 'INPUT_TEXT': {
        snapshot = await wait((state) => state.nodes.filter((node) => node.packageName === state.foregroundPackage && node.enabled && node.displayed !== false && node.focused && /EditText|AutoCompleteTextView/.test(node.className)).length === 1 ? state : false, 'focused EditText');
        const input = snapshot.nodes.find((node) => node.packageName === snapshot!.foregroundPackage && node.enabled && node.displayed !== false && node.focused && /EditText|AutoCompleteTextView/.test(node.className))!;
        if (this.expectedPackage && snapshot.foregroundPackage !== this.expectedPackage && !this.accounting?.allowedPackage?.(snapshot.foregroundPackage)) throw new AndroidExecutionError('UNKNOWN', 'Foreground app changed before input. No text was entered.');
        if (snapshot.foregroundPackage === 'com.android.chrome' && unsafeBrowserInput(action.text)) throw new AndroidExecutionError('CONFIG_ERROR', 'Executable/custom URL schemes or sensitive URL actions are not allowed. No text was entered.');
        if (!input.resourceId) throw new AndroidExecutionError('UNKNOWN', 'Focused input has no validated resource ID.');
        const found = await this.observer.locate(snapshot, `id:${input.resourceId}`, false, 10000, signal);
        if (!found) throw new AndroidExecutionError('UNKNOWN', 'Focused input changed before typing.');
        const path = this.session.path + `/element/${encodeURIComponent(found.id)}`;
        const focused = await this.session.client.request<string>('GET', path + '/attribute/focused', undefined, 10000, signal);
        if (focused !== 'true') throw new AndroidExecutionError('UNKNOWN', 'Input field lost focus.');
        const password = await this.session.client.request<string>('GET', path + '/attribute/password', undefined, 10000, signal);
        if (password !== 'false') throw new AndroidExecutionError('CONFIG_ERROR', 'Input is a password field or its safety is unknown; no text was entered.');
        preconditions.push('unique enabled focused non-password EditText');
        this.accounting?.beforeAction?.(action, snapshot);
        await this.session.client.request('POST', path + '/clear', {}, 15000, signal);
        await this.session.client.request('POST', path + '/value', { text: action.text }, 15000, signal);
        snapshot = await wait((state) => state.foregroundPackage === input.packageName && state.nodes.some((node) => node.packageName === input.packageName && node.resourceId === input.resourceId && node.enabled && node.displayed !== false && node.focused && node.text === action.text) ? state : false, 'input text verified');
        this.query = action.text;
        this.explorer.reset();
        postcondition = 'Input content verified exactly';
        break;
      }
      case 'PRESS_KEY': {
        const before = await this.observer.read(15000, signal);
        checkCancellation(signal);
        this.accounting?.beforeKey?.(action, before);
        if (action.key === 'ENTER') {
          const inputs = before.nodes.filter(n => n.packageName === before.foregroundPackage && n.enabled && n.displayed !== false && n.focused &&
            /EditText|AutoCompleteTextView/.test(n.className) && /search|query|url_bar|omnibox|address/.test(n.resourceId));
          if (inputs.length === 1) this.query = inputs[0].text;
        }
        await this.legacy.execute(this.session.serial, action);
        this.explorer.reset();
        if (action.key === 'ENTER' && before.screen === 'SEARCH_INPUT' && this.query) {
          const query = this.query;
          snapshot = await wait((state) => state.screen === 'SEARCH_RESULTS' && state.nodes.some((node) => node.resourceId.endsWith(':id/search_query') && node.text === query) ? state : false, 'SEARCH_RESULTS');
          postcondition = 'Query and rendered search results verified; video discovery is separate';
        } else if (action.key === 'ENTER' && this.query && before.nodes.some((node) => node.focused && /url_bar|address_bar|omnibox/.test(node.resourceId))) {
          const query = this.query;
          snapshot = await wait((state) => verifyBrowserSearch(state, query) ? state : false, 'browser query and organic results');
          postcondition = 'Browser query and organic result cards verified';
        } else if (action.key === 'BACK' && this.accounting?.verifyNavigation) {
          snapshot = await wait(state => this.accounting!.verifyNavigation!(before, state) ? state : false, 'reversible navigation verified', 10000);
          postcondition = 'Observed navigation layer removed in the same app; expected native destination verified';
        } else {
          snapshot = await this.observer.read(15000, signal);
          verification = 'DISPATCHED';
          postcondition = 'Key sent; goal postcondition not verified';
        }
        break;
      }
      case 'CLOSE_APP': {
        this.explorer.reset();
        const app = resolveAppPackage(action.app);
        await this.legacy.execute(this.session.serial, action);
        snapshot = await wait((state) => state.foregroundPackage !== app ? state : false, `closed:${app}`);
        postcondition = `App closed: ${app}`;
        break;
      }
      case 'SWIPE': {
        const before = await this.observer.read(15000, signal);
        this.accounting?.beforeAction?.(action, before);
        if (this.expectedPackage && before.foregroundPackage !== this.expectedPackage && !this.accounting?.allowedPackage?.(before.foregroundPackage)) throw new AndroidExecutionError('UNKNOWN', 'Foreground app changed before scrolling.');
        // Preserve SWIPE's finger direction; scrollGesture describes content traversal direction.
        const direction = ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[action.direction];
        const region = detectScrollRegion(before, explorationGoal('scroll content'), direction);
        if (region.status !== 'FOUND') throw new AndroidExecutionError(region.status, region.reason);
        await this.scrollController.scroll(before, region.region, direction, explorationConfig().scrollPercent, 15000, signal, explorationConfig().scrollSpeed);
        this.explorer.reset();
        snapshot = this.accounting?.verifyAction?.(action, before, before) !== undefined
          ? await wait(state => this.accounting!.verifyAction!(action, before, state) ? state : false, 'grounded scroll changed content', 10000)
          : await this.observer.read(15000, signal);
        verification = uiFingerprint(before) !== uiFingerprint(snapshot) ? 'VERIFIED' : 'DISPATCHED';
        postcondition = verification === 'VERIFIED' ? 'Scroll changed visible UI' : 'Scroll sent; no UI change verified';
        break;
      }
      case 'SCREENSHOT': throw new AndroidExecutionError('CONFIG_ERROR', 'Use the screenshot endpoint.');
    }
    if (verification === 'VERIFIED' && snapshot) this.accounting?.onVerifiedSnapshot?.(snapshot);
    return { verification, preconditions, postcondition, elapsedMs: Math.round(performance.now() - start), ...(snapshot ? { evidence: observationEvidence(snapshot) } : {}), ...(exploration ? { exploration } : {}), ...(interaction ? { interaction } : {}), ...(selection ? { selection } : {}) };
  }
}

export async function createExecutionContext(serial: string, actions: Action[], run: AdbRunner, signal?: AbortSignal, accounting?: ExecutionAccounting) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(serial)) throw new AndroidExecutionError('CONFIG_ERROR', 'Invalid device serial.');
  const backend = process.env.ANDROID_EXECUTOR_BACKEND ?? 'appium';
  if (!['adb', 'appium'].includes(backend)) throw new AndroidExecutionError('CONFIG_ERROR', 'ANDROID_EXECUTOR_BACKEND must be appium or adb.');
  const release = await acquireDeviceLock(serial, run);
  const legacy = createAndroidExecutor(run);
  let session: ManagedAppiumSession | undefined;
  let executor: ConditionExecutor | undefined;
  let closed = false;
  try {
    await assertDeviceConnected(run, serial);
    await legacy.preflight(serial, actions, backend === 'adb', backend === 'appium');
    checkCancellation(signal);
    if (backend === 'appium') {
      session = new ManagedAppiumSession(new AppiumClient(), serial, run);
      await session.open(signal);
      await release.recordSession(session.sessionId!, accounting?.executionId);
      executor = new ConditionExecutor(session, run, accounting);
    }
  } catch (error) {
    try { await session?.close(); await release(); }
    catch (cleanup) { throw new AndroidExecutionError('SESSION_ERROR', 'Session cleanup failed; device lock retained for manual inspection.', { cause: cleanup }); }
    throw error;
  }
  return {
    backend,
    discoveryMemory() { return executor?.discoveryMemory() ?? { anchored: false, items: [] }; },
    async confirmVisualTap(choice: HumanTapChoice, plan: ActionPlan, signal?: AbortSignal): Promise<ActionOutcome> {
      if (!executor || closed) throw new AndroidExecutionError('SESSION_ERROR', 'Visual confirmation requires the original active Appium Session.');
      return executor.confirmVisualTap(choice, plan, signal);
    },
    async observe(signal?: AbortSignal): Promise<Observation> {
      if (!executor || closed) throw new AndroidExecutionError('CONFIG_ERROR', 'Live snapshots require an active Appium execution context.');
      return executor.observe(signal);
    },
    async execute(action: Action, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<ActionOutcome> {
      if (closed) throw new AndroidExecutionError('SESSION_ERROR', 'Execution context is closed.');
      if (executor) return executor.execute(action, signal, onProgress);
      checkCancellation(signal);
      const start = performance.now();
      await assertDeviceConnected(run, serial);
      await legacy.execute(serial, action);
      // Legacy behavior remains available but must not imply unimplemented postconditions.
      return { verification: ['WAIT_FOR', 'INPUT_TEXT'].includes(action.type) ? 'VERIFIED' : 'DISPATCHED', elapsedMs: Math.round(performance.now() - start), evidence: { source: 'ADB', observedAt: new Date().toISOString() } };
    },
    async close() {
      if (closed) return;
      await session?.close();
      await release();
      executor?.dispose();
      closed = true;
    },
  };
}
