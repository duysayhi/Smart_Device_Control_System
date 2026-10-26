import { randomUUID } from 'node:crypto';
import type { AdbRunner } from '../executor';
import type { ManagedAppiumSession } from '../appium/session-manager';
import { withSessionContextLock } from '../appium/session-operation-lock';
import type { StateObserver, Observation } from '../state-observer';
import { deviceReadiness } from './device-readiness';
import { assertIntentApproval, type IntentApproval } from './intent-capabilities';
import { IntentRequestSchema, type IntentBinding, type IntentRequest } from './intent-schema';
import { assertOwnerTestExecution, type OwnerTestExecution } from './owner-test-policy';
import { matchesNativeAddress } from '../hybrid-context-observer';
import { SettingMutationController, statePair, verifySettingPair } from './setting-mutations';
import type { SettingName } from './setting-schema';
import { fullControlHardBlock } from './full-control-policy';

const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const componentPattern = /^[A-Za-z][\w.]*\/[A-Za-z_.$][\w.$]*$/;
export const fullComponent = (s: string) => s.replace('/.', '/' + s.split('/')[0] + '.');
export interface IntentResolution { packageName: string; component: string; action: string; data?: string }
export async function resolveIntent(serial: string, request: IntentRequest, run: AdbRunner): Promise<IntentResolution> {
  request = IntentRequestSchema.parse(request);
  if (request.name === 'COMPOSE_SMS') throw Error('NOT_IMPLEMENTED: compose applications may persist drafts; no dispatch authorized.');
  const action = request.name === 'OPEN_APP' ? 'android.intent.action.MAIN' : request.name === 'OPEN_URL' ? 'android.intent.action.VIEW' : request.name === 'OPEN_DIALER' ? 'android.intent.action.DIAL' : request.name === 'OPEN_SETTINGS' ? request.args.action : 'android.settings.SETTINGS';
  const data = request.name === 'OPEN_URL' ? request.args.url : request.name === 'OPEN_DIALER' ? 'tel:' + request.args.number : undefined;
  const options = ['-a', action, ...(data ? ['-d', quote(data)] : []), ...(request.name === 'OPEN_APP' ? ['-c', 'android.intent.category.LAUNCHER', '-p', quote(request.args.packageName)] : [])];
  const result = await run(['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', ...options], 5000);
  const components = [...new Set(result.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => componentPattern.test(s)))];
  if (components.length !== 1 || /(?:Resolver|Chooser)Activity/.test(components[0])) throw Error('SAFE_BLOCKED: intent handler missing or ambiguous.');
  const packageName = components[0].split('/')[0];
  if (request.name === 'OPEN_APP' && request.args.packageName !== packageName) throw Error('SAFE_BLOCKED: installed package resolution mismatch.');
  return { packageName, component: components[0], action, data };
}

export interface IntentEvidence { id: string; deviceId: string; executionId: string; sessionId: string; name: IntentRequest['name'];
  evidenceClass: 'INDEPENDENT_NATIVE_ACTIVITY_READBACK' | 'INDEPENDENT_STATE_READBACK'; observedAt: number; value?: string; component?: string; snapshotId?: string }
const proofs = new WeakMap<IntentEvidence, string>();
export const isIntentEvidence = (p: IntentEvidence) => proofs.get(p) === JSON.stringify(p);
const attempts = new WeakMap<IntentApproval, Set<string>>();
const mutations = new WeakMap<ManagedAppiumSession, SettingMutationController>();
const settlements = new WeakMap<ManagedAppiumSession, ReturnType<SettingMutationController['settle']>>();
export async function settleIntentMutations(session: ManagedAppiumSession, success: boolean) {
  const controller = mutations.get(session); if (!controller) return;
  let settlement = settlements.get(session);
  if (!settlement) { settlement = withSessionContextLock(session, () => controller.settle(success)); settlements.set(session, settlement); }
  return settlement;
}

export function verifyIntentScreen(request: IntentRequest, resolution: IntentResolution, snapshot: Observation, activityDump: string): boolean {
  if (snapshot.observationStatus !== 'OBSERVED' || Date.now() - snapshot.timestamp > 5000 || Date.now() < snapshot.timestamp || snapshot.foregroundPackage !== resolution.packageName ||
    snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /Dialog|ProgressBar/.test(n.className))) return false;
  const expected = fullComponent(resolution.component);
  const activities = [...activityDump.matchAll(/(?:mResumedActivity|topResumedActivity)[^\r\n]*?\s([A-Za-z][\w.]*\/[A-Za-z_.$][\w.$]*)/g)].map(m => fullComponent(m[1]));
  const native = snapshot.activity?.startsWith('.') ? resolution.packageName + '/' + resolution.packageName + snapshot.activity : resolution.packageName + '/' + snapshot.activity;
  if (!activities.length || activities.some(a => a !== expected) || native !== expected) return false;
  if (request.name === 'OPEN_URL') return snapshot.nodes.filter(n => /EditText|AutoCompleteTextView/.test(n.className) && n.password !== true && n.displayed !== false && matchesNativeAddress(n.text, request.args.url)).length === 1;
  if (request.name === 'OPEN_DIALER') return snapshot.nodes.filter(n => n.displayed !== false && n.password !== true && n.text.replace(/[\s()\-]/g, '') === request.args.number).length === 1;
  return request.name === 'OPEN_APP' || request.name === 'OPEN_SETTINGS';
}

export function stateReadCommands(state: 'battery' | SettingName): [string[], string[]] {
  if (!['wifi', 'battery', 'media_volume', 'ring_volume', 'brightness'].includes(state)) return statePair(state as SettingName);
  if (state === 'wifi') return [['settings', 'get', 'global', 'wifi_on'], ['cmd', 'wifi', 'status']];
  if (state === 'battery') return [['dumpsys', 'battery'], ['cat', '/sys/class/power_supply/battery/capacity']];
  if (state === 'brightness') return [['settings', 'get', 'system', 'screen_brightness'], ['dumpsys', 'display']];
  return [['cmd', 'media_session', 'volume', '--stream', state === 'media_volume' ? '3' : '2', '--get'], ['dumpsys', 'audio']];
}
export function corroborateState(state: string, first: string, second: string): string | undefined {
  if (!['wifi', 'battery', 'media_volume', 'ring_volume', 'brightness'].includes(state)) {
    const value = verifySettingPair(state as SettingName, first, second); return value === undefined ? undefined : String(value);
  }
  let a: number | undefined, b: number | undefined;
  if (state === 'wifi') {
    if (!/^[01]$/.test(first.trim())) return;
    const readings = [...second.matchAll(/\bWi-?Fi is (enabled|disabled)\b/gi)]; if (readings.length !== 1) return;
    a = Number(first.trim()); b = readings[0][1].toLowerCase() === 'enabled' ? 1 : 0;
  } else if (state === 'battery') {
    const readings = [...first.matchAll(/^\s*level:\s*(\d+)\s*$/gm)]; if (readings.length !== 1 || !/^\d+$/.test(second.trim())) return;
    a = Number(readings[0][1]); b = Number(second.trim()); if (a > 100 || b > 100) return;
  } else if (state === 'brightness') {
    const readings = [...second.matchAll(/^\s*mScreenBrightness(?:Setting)?=(\d+(?:\.\d+)?)\s*$/gm)].map(m => m[1].includes('.') && Number(m[1]) <= 1 ? Math.round(Number(m[1]) * 255) : Number(m[1]));
    if (!readings.length || new Set(readings).size !== 1 || !/^\d+$/.test(first.trim())) return;
    a = Number(first.trim()); b = readings[0]; if (a > 255 || b > 255) return;
  } else {
    const m = /\bvolume is (\d+)\b/i.exec(first), stream = state === 'media_volume' ? 'STREAM_MUSIC' : state === 'ring_volume' ? 'STREAM_RING' : undefined;
    if (!m || !stream) return;
    const section = second.split(stream + ':')[1]?.split(/\n\s*-?\s*STREAM_/)[0], current = /\bCurrent:\s*([^\r\n]+)/.exec(section ?? '')?.[1];
    const values = [...(current ?? '').matchAll(/:\s*(\d+)(?=,|\s*$)/g)].map(x => Number(x[1]));
    if (!values.length || new Set(values).size !== 1) return;
    a = Number(m[1]); b = values[0];
  }
  return a === b ? String(a) : undefined;
}

export async function executeIntentCapability(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, approval: IntentApproval,
  binding: IntentBinding, span: { start: number; end: number }, executionId: string, expectedPackage: string | undefined, signal?: AbortSignal, owner?: OwnerTestExecution): Promise<IntentEvidence> {
  return withSessionContextLock(session, async () => {
    const assert = () => { signal?.throwIfAborted(); assertIntentApproval(approval, session.serial, executionId, span, binding, Boolean(owner?.fullControl)); if (owner) assertOwnerTestExecution(owner, session.serial, approval.physicalId, executionId); };
    if (owner?.fullControl && fullControlHardBlock(approval.source)) throw Error('HARD_BLOCKED: excluded source cannot obtain an intent grant.');
    assert(); await session.ensureActive(signal);
    const request = binding.request, sessionId = session.sessionId;
    const resolution = request.name === 'READ_STATE' ? undefined : await resolveIntent(session.serial, request, run);
    if (request.name !== 'READ_STATE' && (!expectedPackage || resolution?.packageName !== expectedPackage)) throw Error('SAFE_BLOCKED: resolved handler changed before dispatch.');
    const ready = await run(['-s', session.serial, 'shell', 'dumpsys', 'window', 'policy'], 5000);
    if (deviceReadiness(ready.stdout) !== 'READY') throw Error('SAFE_BLOCKED: device is locked or readiness unknown.');
    await session.assertPhysicalIdentity(signal);
    assert(); const expiresAt = Date.now() + 5000, key = JSON.stringify([span, binding]);
    const ledger = attempts.get(approval) ?? new Set<string>(); attempts.set(approval, ledger);
    if (ledger.has(key)) throw Error('SAFE_BLOCKED: intent effect is never replayed.');
    const dispatch = async (args: string[]) => {
      assert(); if (Date.now() > expiresAt) throw Error('SAFE_BLOCKED: intent grant expired; TTL unchanged.');
      ledger.add(key); return run(['-s', session.serial, 'shell', ...args], 10000);
    };
    let proof: IntentEvidence, assertFreshRead: (() => void) | undefined;
    if (request.name === 'SET_DEVICE_STATE') {
      if (!owner?.fullControl) throw Error('SAFE_BLOCKED: explicit full-control mode required.');
      ledger.add(key);
      let controller = mutations.get(session);
      if (!controller) { controller = new SettingMutationController(session, observer, run, owner, approval.source, executionId, expectedPackage!); mutations.set(session, controller); }
      const value = await controller.apply(request.args, signal);
      proof = { id: randomUUID(), name: request.name, deviceId: session.serial, executionId, sessionId: session.sessionId!, observedAt: controller.lastVerifiedAt, evidenceClass: 'INDEPENDENT_STATE_READBACK', value: String(value) };
    } else if (request.name === 'READ_STATE') {
      assertFreshRead = () => {
        assert();
        if (!sessionId || session.sessionId !== sessionId) throw Error('SAFE_BLOCKED: READ_STATE requires the same owned Appium Session.');
        if (Date.now() < expiresAt - 5000 || Date.now() > expiresAt) throw Error('SAFE_BLOCKED: independent state readback is stale.');
      };
      assertFreshRead();
      const [a, b] = stateReadCommands(request.args.state);
      const first = await dispatch(a); assertFreshRead();
      const second = await dispatch(b); assertFreshRead();
      if (first.stderr?.trim() || second.stderr?.trim()) throw Error('SAFE_BLOCKED: independent state paths returned errors.');
      const value = corroborateState(request.args.state, first.stdout, second.stdout);
      if (value === undefined) throw Error('SAFE_BLOCKED: independent state paths unavailable or disagree.');
      proof = { id: randomUUID(), name: request.name, deviceId: session.serial, executionId, sessionId: sessionId!, observedAt: Date.now(), evidenceClass: 'INDEPENDENT_STATE_READBACK', value };
    } else {
      if (!resolution) throw Error('SAFE_BLOCKED: intent handler is not bound.');
      await dispatch(['am', 'start', '-W', '-a', resolution.action, ...(resolution.data ? ['-d', quote(resolution.data)] : []), '-n', quote(resolution.component)]);
      const deadline = Date.now() + 12000; let snapshot: Observation | undefined;
      do {
        assert(); const s = await observer.readNativeSnapshot(15000, signal);
        const activity = await run(['-s', session.serial, 'shell', 'dumpsys', 'activity', 'activities'], 5000);
        if (verifyIntentScreen(request, resolution, s, activity.stdout)) { snapshot = s; break; }
      } while (Date.now() < deadline);
      if (!snapshot) throw Error('SAFE_BLOCKED: intent dispatched once; independent screen outcome unverified, no replay.');
      proof = { id: randomUUID(), name: request.name, deviceId: session.serial, executionId, sessionId: session.sessionId!, observedAt: snapshot.timestamp,
        snapshotId: snapshot.snapshotId, component: resolution.component, evidenceClass: 'INDEPENDENT_NATIVE_ACTIVITY_READBACK' };
    }
    await session.assertPhysicalIdentity(signal); assertFreshRead?.(); assert();
    const sealed = Object.freeze(proof); proofs.set(sealed, JSON.stringify(sealed)); return sealed;
  });
}
