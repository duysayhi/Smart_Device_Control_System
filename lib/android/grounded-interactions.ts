import type { ManagedAppiumSession } from './appium/session-manager';
import { withSessionContextLock } from './appium/session-operation-lock';
import type { StateObserver, Observation } from './state-observer';
import { geometryFingerprint } from './visual-grounding';
import { detectScrollRegion } from './exploration/scroll-regions';
import { explorationGoal } from './exploration/types';
import { consumeEffectGrant, assertEffectGrantAuthorization, isIssuedEffectGrant, EffectGrantExpired, type EffectGrant } from './agent/effect-grants';
import type { GroundedCandidateV2 } from './agent/grounded-candidates-v2';
import { checkCancellation, AndroidExecutionError } from './errors';
import { observedMathExpression } from './agent/math-keypad';
import { observedAffordances } from './agent/ui-affordances';
import { recordFieldRole } from './agent/record-forms';
import { rebindTarget } from './agent/target-identity';
import { effectJournalTicket } from './agent/effect-grants';
import { journalLocalDispatch, journalLocalAcknowledged } from './agent/local-effect-journal';
import { consumeCameraKey } from './agent/camera-fallback';
import { beforeSearchDispatch, noteSearchSubmitted, noteSearchNavigation, noteSearchQueryEntered, noteSearchCleared, isScopedSearchField, freshSearchTarget, searchTransitionSatisfied, noteSearchActivationAcknowledged, confirmSearchActivation } from './agent/generic-search';
import { beforeTemporalUiDispatch, temporalUiAcknowledged, temporalUiTransition, freshTemporalUi, pickerRole, pickerValue } from './agent/temporal-ui';
import { freshBrowserResultTarget, beforeBrowserResultDispatch, acknowledgeBrowserResult } from './agent/browser-result';

export type DispatchState = 'NOT_SENT' | 'UNKNOWN' | 'ACKNOWLEDGED';
export class GroundedInteractionFailure extends Error {
  readonly classification: 'HARD_DENY' | 'SOFT_RETRYABLE_NOT_SENT' | 'UNKNOWN_EFFECT';
  constructor(readonly dispatchState: DispatchState, readonly diagnosticCode: string, cause: unknown) {
    super((cause instanceof Error ? cause.message : 'Unknown interaction failure').replace(/[\r\n]+/g, ' ').slice(0, 160));
    this.classification = dispatchState !== 'NOT_SENT' ? 'UNKNOWN_EFFECT' : ['GRANT_EXPIRED', 'TARGET_CHANGED', 'TARGET_LOCATE'].includes(diagnosticCode) ? 'SOFT_RETRYABLE_NOT_SENT' : 'HARD_DENY';
  }
}
const notSentReceipts = new WeakMap<GroundedInteractionFailure, { grant: EffectGrant; at: number }>();
export function consumeNotSentReceipt(error: GroundedInteractionFailure, candidate: GroundedCandidateV2): boolean {
  const receipt = notSentReceipts.get(error);
  if (!receipt || error.classification !== 'SOFT_RETRYABLE_NOT_SENT' ||
    receipt.grant.candidate !== candidate || !isIssuedEffectGrant(receipt.grant) || Date.now() - receipt.at > 5000 || Date.now() < receipt.at) return false;
  notSentReceipts.delete(error); return true;
}

export async function executeGroundedInteraction(session: ManagedAppiumSession, observer: StateObserver, grant: EffectGrant, signal?: AbortSignal): Promise<Observation> {
  return withSessionContextLock(session, async () => {
    let dispatchState: DispatchState = 'NOT_SENT', diagnosticCode = 'READINESS';
    try {
    await session.ensureActive(signal);
    diagnosticCode = 'OBSERVATION';
    const c = grant.candidate, before = c.browserResult ? await observer.read(15000, signal) : await observer.readNativeSnapshot(15000, signal);
    diagnosticCode = 'GRANT';
    consumeEffectGrant(grant, session.serial, session.sessionId!);
    diagnosticCode = 'TARGET_CHANGED';
    const currentTarget = c.browserResult ? freshBrowserResultTarget(c, before) : c.search ? freshSearchTarget(c, before) : rebindTarget(c.target, before, c.action === 'CLICK');
    if (before.foregroundPackage !== grant.packageName || !currentTarget) throw new AndroidExecutionError('AMBIGUOUS', 'V2 target changed before interaction; no action sent.');
    const node = before.nodes[currentTarget.index];
    const freshDispatch = (evidence = before) => {
      checkCancellation(signal);
      assertEffectGrantAuthorization(grant);
      if (Date.now() > grant.expiresAt || Date.now() - evidence.timestamp > 5000) throw new AndroidExecutionError('AMBIGUOUS', 'V2 dispatch evidence expired; no further interaction sent.');
    };
    const send = async (path: string, body: unknown, evidence = before) => {
      freshDispatch(evidence);
      if (c.search?.phase === 'SUBMIT') beforeSearchDispatch(c, before);
      await journalLocalDispatch(effectJournalTicket(grant));
      freshDispatch(evidence);
      dispatchState = 'UNKNOWN'; diagnosticCode = 'DISPATCH_RPC';
      const result = await session.client.request('POST', path, body, 10000, signal);
      await journalLocalAcknowledged(effectJournalTicket(grant));
      dispatchState = 'ACKNOWLEDGED'; diagnosticCode = 'TRANSITION_UNVERIFIED'; return result;
    };
    if (!node || before.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName))) throw new AndroidExecutionError('CONFIG_ERROR', 'V2 UI is not authorized.');
    if (c.search && c.search.phase !== 'SUBMIT') beforeSearchDispatch(c, before);
    if (c.temporal) beforeTemporalUiDispatch(c, before);
    checkCancellation(signal);
    if (c.browserResult) {
      if (before.web?.status !== 'DOM_AVAILABLE') throw Error('BROWSER_RESULT_DOM_UNAVAILABLE');
      await observer.hybrid.clickOrdinal(before.web, 1, 30000, signal, destination => {
        freshDispatch(); beforeBrowserResultDispatch(c, before, destination);
        dispatchState = 'UNKNOWN'; diagnosticCode = 'BROWSER_RESULT_DISPATCH';
      });
      dispatchState = 'ACKNOWLEDGED'; diagnosticCode = 'BROWSER_RESULT_READBACK';
      acknowledgeBrowserResult(c);
      return await observer.read(15000, signal);
    }
    if (c.action === 'BACK') {
      if (c.search?.phase !== 'DISMISS' && (!/Dialog/.test(node.className) && node.resourceId !== 'android:id/alertTitle' || before.nodes.some(row => row.focused && /EditText|AutoCompleteTextView/.test(row.className) && row.text.trim()))) throw new AndroidExecutionError('CONFIG_ERROR', 'No reversible benign dialog authorizes BACK.');
      freshDispatch();
      await send(session.path + '/appium/device/press_keycode', { keycode: 4 });
    } else if (c.action === 'SCROLL') {
      const region = detectScrollRegion(before, explorationGoal('read navigation'), 'down');
      if (region.status !== 'FOUND' || region.region.index !== c.target.index) throw new AndroidExecutionError('AMBIGUOUS', 'Observed scroll region changed.');
      const [left, top, right, bottom] = region.region.bounds;
      freshDispatch();
      await send(session.path + '/execute/sync', { script: 'mobile: scrollGesture', args: [{ left, top, width: right - left, height: bottom - top, direction: 'down', percent: .35 }] });
    } else if (consumeCameraKey(grant)) {
      if (!c.capture || c.action !== 'CLICK' || !effectJournalTicket(grant)) throw Error('HARD_DENY: camera key requires its journaled capture grant.');
      await send(session.path + '/appium/device/press_keycode', { keycode: 27 });
    } else {
      diagnosticCode = 'TARGET_LOCATE';
      const target = `element:${before.elements[currentTarget.index].elementId}`;
      const numericTemporal = c.action === 'SET_VALUE' && Boolean(c.temporal && ['HOUR', 'MINUTE', 'SECOND'].includes(c.temporal.phase));
      let found = await observer.locate(before, target, c.action === 'CLICK' || numericTemporal && !node.focused, 10000, signal);
      if (!found && c.search?.phase === 'OPEN' && c.action === 'CLICK' && observer.locateSearchActivation) found = await observer.locateSearchActivation(before, target, 10000, signal);
      if (!found) throw new AndroidExecutionError('AMBIGUOUS', 'V2 native target cannot be uniquely grounded.');
      const path = session.path + '/element/' + encodeURIComponent(found.id);
      if (c.action === 'SET_VALUE') {
        if (c.search && !node.focused) throw new AndroidExecutionError('AMBIGUOUS', 'SEARCH_EDITABLE_NOT_ACTIVATED: focused native readback required.');
        if (!/EditText|AutoCompleteTextView/.test(node.className) || typeof c.value !== 'string' || await session.client.request('GET', path + '/attribute/password', undefined, 5000, signal) !== 'false') throw new AndroidExecutionError('CONFIG_ERROR', 'V2 field is secret or not an observed editable control.');
        freshDispatch();
        if (numericTemporal) {
          const phase = c.temporal!.phase, initialValue = pickerValue(node.text);
          const parent = node.parentIndex === undefined ? undefined : before.nodes[node.parentIndex];
          if (!parent || pickerRole(before, currentTarget.index) !== phase || initialValue === undefined || !/^\d{1,2}$/.test(c.value)) throw Error('TEMPORAL_EDITOR_UNSUPPORTED: no numeric picker protocol sent.');
          const nativeId = found.id;
          let previousSnapshot = before.snapshotId;
          const exactEditor = (view: Observation, expected: number, focused: boolean) => {
            freshDispatch(view);
            if (!freshTemporalUi(view) || view.deviceSerial !== grant.deviceId || view.foregroundPackage !== grant.packageName) throw Error('TEMPORAL_EDITOR_FOREIGN_OR_STALE');
            const matches = observedAffordances(view, grant.executionId, grant.sessionId).filter(a => pickerRole(view, a.index) === phase);
            if (matches.length !== 1) throw Error('TEMPORAL_EDITOR_ROLE_AMBIGUOUS');
            const field = matches[0], owner = view.nodes[view.nodes[field.index].parentIndex!];
            if (!field.enabled || field.sensitive || field.destructive || field.packageName !== grant.packageName || field.className !== node.className || field.resourceId !== node.resourceId ||
              !owner || owner.className !== parent.className || owner.resourceId !== parent.resourceId || pickerValue(field.text) !== expected) throw Error('TEMPORAL_EDITOR_IDENTITY_OR_VALUE_CHANGED');
            const inputs = view.nodes.filter(n => n.displayed !== false && n.focused && /EditText|AutoCompleteTextView/.test(n.className));
            if (focused && (inputs.length !== 1 || inputs[0] !== view.nodes[field.index])) throw Error('TEMPORAL_EDITOR_FOCUS_UNPROVEN');
            return field;
          };
          const readEditor = async (expected: number) => {
            checkCancellation(signal);
            const view = await observer.readNativeSnapshot(15000, signal);
            if (view.snapshotId === previousSnapshot) throw Error('TEMPORAL_EDITOR_OBSERVATION_REUSED');
            previousSnapshot = view.snapshotId;
            const field = exactEditor(view, expected, true);
            const located = await observer.locate(view, `element:${view.elements[field.index].elementId}`, false, 5000, signal);
            if (!located || located.id !== nativeId) throw Error('TEMPORAL_EDITOR_NATIVE_ID_CHANGED');
            if (await session.client.request('GET', path + '/attribute/focused', undefined, 5000, signal) !== 'true') throw Error('TEMPORAL_EDITOR_FOCUS_UNPROVEN');
            freshDispatch(view); return view;
          };
          exactEditor(before, initialValue, node.focused);
          let editing = before;
          if (!node.focused) {
            if (found.interaction?.method !== 'ELEMENT_CLICK') throw Error('TEMPORAL_EDITOR_FOCUS_NOT_LOCATABLE');
            await send(path + '/click', {}, editing);
            editing = await readEditor(initialValue);
          }
          // Focus/write/Done are one journaled attempt; each later action keeps the original grant expiry.
          await send(path + '/clear', {}, editing);
          await send(path + '/value', { text: c.value }, editing);
          const typed = await readEditor(Number(c.value));
          await send(session.path + '/execute/sync', { script: 'mobile: performEditorAction', args: [{ action: 'done' }] }, typed);
        } else if (c.search) {
          if (c.search.phase === 'CLEAR') await send(path + '/clear', {});
          else {
            if (currentTarget.text !== '') throw new AndroidExecutionError('AMBIGUOUS', 'Search entry requires independently verified empty input.');
            await send(path + '/value', { text: c.value });
          }
        } else {
          await send(path + '/clear', {});
          freshDispatch();
          await send(path + '/value', { text: c.value });
        }
      } else if (c.action === 'IME_SEARCH') {
        if (!c.search || c.search.phase !== 'SUBMIT' || !node.focused) throw new AndroidExecutionError('AMBIGUOUS', 'No focused search control authorizes IME submit.');
        freshDispatch();
        await send(session.path + '/execute/sync', { script: 'mobile: performEditorAction', args: [{ action: 'search' }] });
      } else if (c.action === 'CLICK') {
        if (found.interaction?.method !== 'ELEMENT_CLICK' && !(c.search?.phase === 'OPEN' && found.interaction?.method === 'EXCLUSIVE_POINT' && found.interaction.point)) throw new AndroidExecutionError('AMBIGUOUS', 'V2 requires a uniquely clickable native element.');
        if (c.keypad && observedMathExpression(before) !== c.keypad.before || c.desired !== undefined && (node.checkable !== true || node.checked === c.desired)) throw new AndroidExecutionError('AMBIGUOUS', 'Widget state changed before dispatch.');
        freshDispatch();
        if (found.interaction.method === 'EXCLUSIVE_POINT') await send(session.path + '/execute/sync', { script: 'mobile: clickGesture', args: [found.interaction.point] });
        else await send(path + '/click', {});
      } else throw new AndroidExecutionError('CONFIG_ERROR', 'V2 widget primitive is not implemented; no click sent.');
    }
    if (c.search?.phase === 'SUBMIT') noteSearchSubmitted(c);
    if (c.temporal) temporalUiAcknowledged(c);
    if (c.search?.phase === 'OPEN') noteSearchActivationAcknowledged(c, before);
    if (c.search && ['MENU', 'DISMISS', 'RESET'].includes(c.search.phase)) noteSearchNavigation(c);
    const after = await observer.waitUntil(after => {
      if (after.deviceSerial !== session.serial || after.foregroundPackage !== grant.packageName) return false;
      if (c.temporal) return temporalUiTransition(c, after) ? after : false;
      if (c.search?.phase === 'SUBMIT') return after;
      if (c.search && ['OPEN', 'MENU', 'DISMISS', 'RESET', 'FOCUS'].includes(c.search.phase)) {
        if (searchTransitionSatisfied(c, after)) return after;
        if (c.search.phase !== 'OPEN' || !observer.keyboardVisibility) return false;
        return (async () => {
          const fields = observedAffordances(after, grant.executionId, session.sessionId!).filter(r => r.roles.includes('editable'));
          if (fields.length !== 1 || !fields[0].focused || fields[0].sensitive || fields[0].destructive) return false;
          const field = await observer.locate(after, `element:${after.elements[fields[0].index].elementId}`, false, 5000, signal);
          if (!field) return false;
          const password = await session.client.request('GET', session.path + '/element/' + encodeURIComponent(field.id) + '/attribute/password', undefined, 5000, signal);
          return confirmSearchActivation(c, after, await observer.keyboardVisibility(signal), password === 'false') ? after : false;
        })();
      }
      if (c.capture) return after;
      if (c.action === 'BACK' && after.nodes.some(row => /Dialog/.test(row.className) || row.resourceId === 'android:id/alertTitle')) return false;
      if (c.action === 'SET_VALUE') {
        const matches = observedAffordances(after, grant.executionId, session.sessionId!).filter(n => n.resourceId === node.resourceId && n.className === node.className &&
          (c.search ? isScopedSearchField(c.search.scopeId, n) : c.record?.field ? recordFieldRole(n) === c.record.field : n.index === c.target.index));
        return matches.length === 1 && matches[0].text === c.value ? after : false;
      }
      if (c.keypad) return observedMathExpression(after) === c.keypad.after ? after : false;
      if (c.desired !== undefined) return after.nodes.filter(n => n.resourceId === node.resourceId && (n.description || n.text) === (node.description || node.text) && n.checkable && n.checked === c.desired).length === 1 ? after : false;
      return geometryFingerprint(after) !== geometryFingerprint(before) ? after : false;
    }, 'V2 grounded effect verified', 10000, signal);
    if (c.search?.phase === 'ENTER') noteSearchQueryEntered(c, before, after);
    if (c.search?.phase === 'CLEAR') noteSearchCleared(c, after);
    return after;
    } catch (error) {
      {
        const failure = Object.freeze(new GroundedInteractionFailure(dispatchState, error instanceof EffectGrantExpired ? 'GRANT_EXPIRED' : diagnosticCode, error));
        if (failure.classification === 'SOFT_RETRYABLE_NOT_SENT' && isIssuedEffectGrant(grant)) notSentReceipts.set(failure, { grant, at: Date.now() });
        throw failure;
      }
    }
  });
}
