import { AndroidExecutionError, checkCancellation } from '../errors';
import { matchUiTarget, canonicalUiText } from '../ui-understanding';
import { isNodeInteractable } from '../screen-state';
import { observationEvidence, waitForObservation, type Observation, type ObserverProgress, type StateObserver } from '../state-observer';
import { DiscoveredElementMemory, discoveryCandidates } from './element-memory';
import { clippedBounds, detectScrollRegion, isDescendant, regionFingerprint } from './scroll-regions';
import { explorationConfig, explorationGoal, type ExplorationConfig, type ExplorationMetrics, type ExplorationResult, type ExplorationStatus, type ScrollDirection } from './types';
import type { ScrollController } from './scroll-controller';
import { resolveInteractionTarget } from '../interaction-target-resolver';

function screenContext(snapshot: Observation): { base: string; anchor?: string } {
  const node = snapshot.nodes.find(n => n.packageName === snapshot.foregroundPackage && /:id\/(search_query|url_bar|address_bar|omnibox)$/.test(n.resourceId));
  let anchor = node?.text.trim() || undefined;
  if (node && /url_bar|address_bar|omnibox/.test(node.resourceId) && anchor) {
    try {
      const url = new URL(/^https?:\/\//.test(anchor) ? anchor : `https://${anchor}`);
      anchor = url.searchParams.has('q') ? JSON.stringify([url.hostname, url.searchParams.get('q')])
        : url.pathname === '/' && !url.search ? undefined : url.href;
    } catch { /* A non-URL address field remains a literal scope anchor. */ }
  }
  return { base: JSON.stringify([snapshot.deviceSerial, snapshot.foregroundPackage, snapshot.activity]), anchor };
}
const reverse = (direction: ScrollDirection): ScrollDirection => ({ up: 'down', down: 'up', left: 'right', right: 'left' })[direction] as ScrollDirection;

export class UIExplorer {
  private memory?: DiscoveredElementMemory;
  private memoryRegion?: string;
  constructor(private readonly observer: Pick<StateObserver, 'read' | 'locate'> & Partial<Pick<StateObserver, 'locateDelegatedLabel'>>,
    private readonly scrollController: Pick<ScrollController, 'scroll'>,
    private readonly config: ExplorationConfig = explorationConfig()) {}
  reset(): void { this.memory = undefined; this.memoryRegion = undefined; }
  memorySummary() {
    return { anchored: this.memory?.anchored ?? false, items: this.memory?.items.slice(0, 50).map((item, i) =>
      ({ identity: item.identity, title: item.title.slice(0, 150), itemType: item.itemType, ordinal: i + 1 })) ?? [] };
  }
  async find(target: string, timeoutMs: number, forClick: boolean, signal?: AbortSignal, onProgress?: (value: ObserverProgress) => void): Promise<ExplorationResult> {
    const goal = explorationGoal(target);
    const started = performance.now();
    const budget = Math.min(timeoutMs, this.config.timeoutMs);
    const remaining = () => Math.max(1, budget - (performance.now() - started));
    const metrics: ExplorationMetrics = { phase: 'SEARCHING', scrollCount: 0, snapshotCount: 0, newElements: 0, duplicateElements: 0, elapsedMs: 0, aiCalls: 0, aiElapsedMs: 0 };
    let snapshot: Observation | undefined;
    let blockedTarget: ExplorationResult['blockedTarget'];
    const emit = (phase: ExplorationMetrics['phase'], status?: ExplorationStatus, reason?: string) => {
      Object.assign(metrics, { phase, status, reason, elapsedMs: Math.round(performance.now() - started) });
      onProgress?.({ waitingFor: target, elapsedMs: metrics.elapsedMs, evidence: snapshot && observationEvidence(snapshot), exploration: { ...metrics } });
    };
    const finish = (status: ExplorationStatus, reason: string): ExplorationResult => {
      emit(status === 'AMBIGUOUS' || status === 'UNKNOWN' ? 'AMBIGUOUS' : 'NOT_FOUND', status, reason);
      return { status, reason, metrics: { ...metrics }, ...(status === 'AMBIGUOUS' && blockedTarget ? { blockedTarget } : {}) };
    };
    const read = async (limit = remaining()) => {
      checkCancellation(signal);
      const state = await this.observer.read(Math.min(limit, remaining()), signal);
      metrics.snapshotCount++;
      snapshot = state;
      return state;
    };
    let context: ReturnType<typeof screenContext> | undefined;
    let regionSignature: string | undefined;
    let unchanged = 0;
    let lastScrollMore: boolean | undefined;
    let origin = goal.kind !== 'ordinal';
    let overlapRefinements = 0;
    let refinedPercent: number | undefined;
    try {
      emit('SEARCHING');
      snapshot = await read();
      context = screenContext(snapshot);
      if (goal.kind === 'ordinal') {
        const key = `${JSON.stringify(context)}:${goal.itemType}`;
        if (this.memory?.context !== key) { this.memory = new DiscoveredElementMemory(key, this.config.maxElements); this.memoryRegion = undefined; }
        origin = this.memory.anchored;
      }
      while (performance.now() - started < budget) {
        checkCancellation(signal);
        if (snapshot.observationStatus !== 'OBSERVED') return finish('UNKNOWN', 'UI hierarchy is not sufficiently observed for exploration.');
        const currentContext = screenContext(snapshot);
        if (currentContext.base !== context.base || currentContext.anchor && context.anchor && currentContext.anchor !== context.anchor) return finish('UNKNOWN', 'Foreground, activity or observed search scope changed during exploration.');
        // Mobile browser toolbars collapse during scroll. An absent anchor is not
        // a new query; ordinal continuity is still required by memory.ingest below.
        if (context.anchor && !currentContext.anchor && goal.kind === 'ordinal' && !this.memory?.anchored) return finish('UNKNOWN', 'Scope anchor disappeared before list origin was established.');
        let direction = goal.direction;
        let emptyVideoViewport = false;
        if (goal.kind === 'target') {
          const match = matchUiTarget(snapshot, target, false);
          if (match.status === 'AMBIGUOUS') return finish('AMBIGUOUS', match.reason!);
          const bounds = match.node && clippedBounds(snapshot, match.node);
          const onScreen = bounds && match.node && (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > 0 &&
            Math.max(0, bounds[2] - bounds[0]) * Math.max(0, bounds[3] - bounds[1]) / ((match.node.bounds[2] - match.node.bounds[0]) * (match.node.bounds[3] - match.node.bounds[1])) >= .9;
          if (match.status === 'MATCH' && onScreen) {
            emit('VERIFYING');
            const found = await this.observer.locate(snapshot, target, forClick, remaining(), signal);
            checkCancellation(signal);
            if (performance.now() - started >= budget) return finish('TIMEOUT', 'Native verification exceeded exploration deadline.');
            if (!found) {
              if (forClick && match.node) blockedTarget = { snapshot, node: match.node, target,
                selection: { itemType: 'list', ordinal: 1, identity: canonicalUiText(match.node.text || match.node.description), title: match.node.text || match.node.description } };
              return finish('AMBIGUOUS', 'Native element no longer matches the observed target.');
            }
            metrics.newElements = 1;
            emit('FOUND', 'FOUND'); return { status: 'FOUND', found, metrics: { ...metrics } };
          }
          if (target.startsWith('element:')) return finish('UNKNOWN', 'Snapshot-bound element references cannot be explored across snapshots.');
        }
        const detected = detectScrollRegion(snapshot, goal);
        if (detected.status !== 'FOUND') return finish(detected.status, detected.reason);
        const chosenRegion = detected.region;
        if (goal.kind === 'ordinal') {
          if (this.memoryRegion && chosenRegion.signature !== this.memoryRegion) return finish('AMBIGUOUS', 'Observed list container changed between ordinal goals.');
          this.memoryRegion = chosenRegion.signature;
        }
        if (goal.kind === 'target') {
          const observed = matchUiTarget(snapshot, target);
          if (observed.node && observed.node.bounds[1] < chosenRegion.bounds[1]) direction = 'up';
        }
        if (regionSignature && chosenRegion.signature !== regionSignature) return finish('AMBIGUOUS', 'Relevant scroll container changed during exploration.');
        regionSignature = chosenRegion.signature;
        if (goal.kind === 'ordinal') {
          if (!origin) direction = reverse(goal.direction);
          else {
            emit('CHECKING_LIST');
            const evidence = discoveryCandidates(snapshot, chosenRegion, goal);
            if (evidence.status === 'AMBIGUOUS') return finish('AMBIGUOUS', evidence.reason!);
            emptyVideoViewport = goal.itemType === 'video' && !evidence.candidates.length && !this.memory!.items.length;
            const update = this.memory!.ingest(snapshot, evidence.candidates);
            if (update.status === 'AMBIGUOUS' && update.reason?.startsWith('No overlap') && overlapRefinements < 2 && metrics.scrollCount < this.config.maxScrolls) {
              overlapRefinements++;
              refinedPercent = Math.min(.2, this.config.scrollPercent);
              emit('SCROLLING', undefined, 'Reacquire observed ordinal overlap; no guessed result is counted.');
              await this.scrollController.scroll(snapshot, chosenRegion, reverse(goal.direction), refinedPercent, remaining(), signal, this.config.scrollSpeed);
              metrics.scrollCount++;
              emit('WAITING_DATA', undefined, 'Bounded backward overlap refinement');
              snapshot = await read();
              lastScrollMore = undefined;
              continue;
            }
            if (update.status !== 'OBSERVED') return finish(update.status === 'LIMIT' ? 'SCROLL_LIMIT_REACHED' : 'AMBIGUOUS', update.reason!);
            metrics.newElements = this.memory!.items.length;
            metrics.duplicateElements = this.memory!.duplicates;
            const selected = this.memory!.items[goal.ordinal - 1];
            const current = selected && evidence.candidates.find(c => c.identity === selected.identity);
            if (selected && !current) return finish('AMBIGUOUS', 'Selected ordinal disappeared; cannot safely reposition an unobserved result.');
            if (current) {
              let activationNode = current.node;
              let delegate = false;
              const measuredHeight = Math.max(...this.memory!.items.map(item => item.maxObservedHeight));
              const exposedHeight = current.node.bounds[3] - current.node.bounds[1];
              const touchesTop = current.node.bounds[1] <= chosenRegion.bounds[1] + 8;
              const touchesBottom = current.node.bounds[3] >= chosenRegion.bounds[3] - 8;
              // UiAutomator may itself truncate node bounds. Compare boundary rows with
              // heights actually observed in this list, not a guessed video size.
              const truncated = current.partial || (touchesTop || touchesBottom) && exposedHeight < measuredHeight * .9;
              if (truncated && forClick) {
                if (lastScrollMore === false) return finish('AMBIGUOUS', 'Selected item remains clipped at a list boundary.');
                direction = touchesTop ? 'up' : 'down';
              } else {
                blockedTarget = { snapshot, node: current.node, target, selection: { identity: selected.identity, title: selected.title,
                  url: selected.url, itemType: selected.itemType, ordinal: goal.ordinal } };
                if (forClick && (goal.itemType === 'video' || goal.itemType === 'browser')) {
                  const labels = snapshot.nodes.filter(n => n !== current.node && n.enabled && n.displayed !== false && isDescendant(snapshot!.nodes, n, current.node) &&
                    [n.text, n.description].some(value => value && canonicalUiText(value) === canonicalUiText(current.title)));
                  if (labels.length > 1) return finish('AMBIGUOUS', 'Multiple title activation labels belong to this video card.');
                  if (labels.length === 1) { activationNode = labels[0]; delegate = !activationNode.clickable; }
                  else if (goal.itemType === 'video') {
                    const thumbnails = snapshot.nodes.filter(n => n.clickable && n.enabled && n.displayed !== false &&
                      /:id\/(thumbnail|video_thumbnail)$/.test(n.resourceId) && isDescendant(snapshot!.nodes, n, current.node));
                    if (thumbnails.length > 1) return finish('AMBIGUOUS', 'Multiple thumbnail activation controls belong to this video.');
                    if (thumbnails.length === 1) activationNode = thumbnails[0];
                    else {
                      const resolution = resolveInteractionTarget(snapshot, current.node, { video: true });
                      if (resolution.status !== 'RESOLVED') return finish('AMBIGUOUS', resolution.reason);
                      activationNode = resolution.target.node;
                    }
                  }
                }
                const activationIndex = snapshot.nodes.indexOf(activationNode);
                const resolution = forClick ? resolveInteractionTarget(snapshot, activationNode, { owner: delegate ? current.node : undefined, title: delegate ? current.title : undefined }) : undefined;
                if (resolution?.status === 'AMBIGUOUS') return finish('AMBIGUOUS', resolution.reason);
                const ready = (!resolution || resolution.status === 'RESOLVED') && isNodeInteractable(delegate ? { ...activationNode, clickable: true } : activationNode, snapshot.nodes, snapshot.viewport,
                  activationNode === current.node ? target : 'activation label', activationIndex);
                if (!forClick && !current.partial || ready) {
                  const index = snapshot.nodes.indexOf(activationNode);
                  emit('VERIFYING');
                  const found = delegate ? await this.observer.locateDelegatedLabel?.(snapshot, activationNode, current.node, remaining(), signal)
                    : await this.observer.locate(snapshot, `element:${snapshot.elements[index].elementId}`, forClick, remaining(), signal);
                  checkCancellation(signal);
                  if (performance.now() - started >= budget) return finish('TIMEOUT', 'Native verification exceeded exploration deadline.');
                  if (!found) return finish('AMBIGUOUS', 'Remembered item failed fresh native validation.');
                  emit('FOUND', 'FOUND');
                  return { status: 'FOUND', found, metrics: { ...metrics }, selection: { identity: selected.identity, title: selected.title,
                    url: selected.url, itemType: selected.itemType, ordinal: goal.ordinal } };
                }
                direction = activationNode.bounds[1] < chosenRegion.bounds[1] ? 'up' : 'down';
              }
            } else if (lastScrollMore === false) return finish('NOT_FOUND', 'End of list reached without the requested ordinal.');
          }
        } else if (lastScrollMore === false) return finish('NOT_FOUND', 'End of list reached without the requested target.');
        if (metrics.scrollCount >= this.config.maxScrolls) return finish('SCROLL_LIMIT_REACHED', 'Configured scroll count limit reached.');
        const before = regionFingerprint(snapshot, chosenRegion);
        emit('SCROLLING');
        const baseScrollPercent = goal.kind === 'ordinal' && goal.itemType === 'video' && this.memory!.items.length
          ? this.config.videoScrollPercent : this.config.scrollPercent;
        let scrollPercent = refinedPercent ?? (emptyVideoViewport ? Math.max(baseScrollPercent, this.config.emptyVideoScrollPercent) : baseScrollPercent);
        if (goal.kind === 'ordinal' && goal.itemType === 'video' && origin && direction === goal.direction && this.memory!.items.length && !this.memory!.items[goal.ordinal - 1]) {
          const evidence = discoveryCandidates(snapshot, chosenRegion, goal);
          const tail = evidence.candidates.at(-1);
          if (tail) {
            const clipped = clippedBounds(snapshot, tail.node), height = chosenRegion.bounds[3] - chosenRegion.bounds[1];
            // Preserve an observed identity instead of skipping short cards.
            const keep = Math.min((clipped[3] - clipped[1]) * .5, height * .25);
            const overlapPercent = (clipped[3] - chosenRegion.bounds[1] - keep) / height;
            if (overlapPercent <= 0) return finish('AMBIGUOUS', 'No observed overlap anchor authorizes further ordinal scrolling.');
            scrollPercent = overlapPercent >= .1 ? Math.min(scrollPercent, overlapPercent) : Math.min(scrollPercent, .2);
          }
        }
        const more = await this.scrollController.scroll(snapshot, chosenRegion, direction, scrollPercent, remaining(), signal, this.config.scrollSpeed);
        metrics.scrollCount++;
        emit('WAITING_DATA', undefined, `${direction}: scrollPercent=${scrollPercent}, canScrollMore=${more}`);
        snapshot = await read();
        let nextRegion = detectScrollRegion(snapshot, goal);
        if (nextRegion.status !== 'FOUND') return finish(nextRegion.status, nextRegion.reason);
        let changed = regionFingerprint(snapshot, nextRegion.region) !== before;
        if (!changed && more) {
          // Poll for observed content change/lazy data. Never send another gesture blindly.
          try {
            snapshot = await waitForObservation(read, state => {
              const result = detectScrollRegion(state, goal);
              if (result.status !== 'FOUND') return false;
              return regionFingerprint(state, result.region) !== before ? state : false;
            }, 'scroll content change', emptyVideoViewport ? remaining() : Math.min(this.config.settleTimeoutMs, remaining()), signal);
            nextRegion = detectScrollRegion(snapshot, goal);
            changed = nextRegion.status === 'FOUND' && regionFingerprint(snapshot, nextRegion.region) !== before;
          } catch (error) {
            if (!(error instanceof AndroidExecutionError && error.code === 'TIMEOUT')) throw error;
          }
        }
        if (performance.now() - started >= budget) return finish('TIMEOUT', 'Exploration deadline exceeded.');
        if (nextRegion.status !== 'FOUND') return finish(nextRegion.status, nextRegion.reason);
        if (nextRegion.region.signature !== regionSignature) return finish('AMBIGUOUS', 'Scroll container identity changed.');
        if (!origin && !more) { origin = true; this.memory!.anchored = true; lastScrollMore = undefined; unchanged = 0; continue; }
        if (!changed && more) {
          unchanged++;
          if (unchanged >= this.config.maxUnchanged) return finish('NOT_FOUND', 'UI did not change after scroll; stopped safely.');
          // A retry is a fresh observation, not another gesture on unchanged content.
          for (let retry = unchanged; retry < this.config.maxUnchanged && !changed; retry++) {
            snapshot = await read();
            const result = detectScrollRegion(snapshot, goal);
            changed = result.status === 'FOUND' && regionFingerprint(snapshot, result.region) !== before;
          }
          if (!changed) return finish('NOT_FOUND', 'UI remained unchanged after bounded observation retries.');
        } else unchanged = 0;
        // A gesture can return false while still exposing new content (for
        // example an ad consuming the initial viewport). Confirm a boundary on
        // unchanged content before treating it as the end of the list.
        lastScrollMore = changed ? undefined : more;
      }
      return finish('TIMEOUT', 'Exploration deadline exceeded.');
    } catch (error) {
      if (!(error instanceof AndroidExecutionError)) throw error;
      if (['DEVICE_ERROR', 'SESSION_ERROR', 'CANCELLED', 'TIMEOUT', 'UNKNOWN'].includes(error.code)) return finish(error.code as ExplorationStatus, error.message);
      throw error;
    }
  }
}
