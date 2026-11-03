import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AdbRunner } from '../executor';
import type { ManagedAppiumSession } from '../appium/session-manager';
import { withSessionContextLock } from '../appium/session-operation-lock';
import type { StateObserver } from '../state-observer';
import { deviceReadiness } from './device-readiness';
import { assertOwnerTestExecution } from './owner-test-policy';
import { checkTemporalEffectGrant, consumeTemporalEffectGrant, type TemporalEffectGrant } from './effect-grants';
import { temporalAction, temporalExtras, type TemporalRequest } from './temporal-contract';
import { TemporalProviderReader, temporalPrecondition, issuedTemporalInventory, verifyTemporalReadback, type TemporalInventory } from './temporal-evidence';

export async function resolveTemporalHandler(serial: string, request: TemporalRequest, run: AdbRunner, show = false) {
  const action = temporalAction(request.kind, show);
  const output = (await run(['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', action], 5000)).stdout;
  const rows = [...new Set(output.split(/\r?\n/).map(r => r.trim()).filter(r => /^[A-Za-z][\w.]*\/[A-Za-z_.$][\w.$]*$/.test(r)))];
  if (rows.length !== 1 || /ResolverActivity|ChooserActivity/.test(rows[0])) throw Error('TEMPORAL_HANDLER_AMBIGUOUS: no action sent.');
  return { action, component: rows[0], packageName: rows[0].split('/')[0] };
}
export async function temporalInventory(session: ManagedAppiumSession, run: AdbRunner, packageName: string, request: TemporalRequest, signal?: AbortSignal) {
  return withSessionContextLock(session, async () => {
    signal?.throwIfAborted(); await session.ensureActive(signal); await session.assertPhysicalIdentity(signal);
    if (deviceReadiness((await run(['-s', session.serial, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout) !== 'READY') throw Error('DEVICE_LOCKED: no temporal action sent.');
    const target = await resolveTemporalHandler(session.serial, request, run), show = await resolveTemporalHandler(session.serial, request, run, true);
    if (target.packageName !== packageName || show.packageName !== packageName) throw Error('TEMPORAL_HANDLER_CHANGED: no write sent.');
    const before = await new TemporalProviderReader(session.serial, run).read(packageName, request.kind, undefined, signal);
    temporalPrecondition(before, request); return before;
  });
}
export async function executeTemporal(session: ManagedAppiumSession, observer: StateObserver, run: AdbRunner, grant: TemporalEffectGrant, before: TemporalInventory, signal?: AbortSignal) {
  return withSessionContextLock(session, async () => {
    const state = checkTemporalEffectGrant(grant, session.serial, session.sessionId!);
    const guard = async () => {
      signal?.throwIfAborted();
      if (state.owner) assertOwnerTestExecution(state.owner, session.serial, grant.physicalId, grant.executionId);
      await session.ensureActive(signal); await session.assertPhysicalIdentity(signal);
      if (deviceReadiness((await run(['-s', session.serial, 'shell', 'dumpsys', 'window', 'policy'], 5000)).stdout) !== 'READY') throw Error('DEVICE_LOCKED: temporal verification interrupted; never replay.');
    };
    await guard();
    if (!issuedTemporalInventory(before) || before.deviceId !== grant.deviceId || before.packageName !== grant.packageName) throw Error('HARD_DENY: foreign temporal pre-state.');
    temporalPrecondition(before, grant.request);
    const reader = new TemporalProviderReader(session.serial, run), latest = await reader.read(grant.packageName, grant.request.kind, before.uri, signal);
    temporalPrecondition(latest, grant.request);
    if (JSON.stringify(latest.rows) !== JSON.stringify(before.rows) || latest.zone !== before.zone) throw Error('STALE_TEMPORAL_PRE_STATE: no write sent.');
    const target = await resolveTemporalHandler(session.serial, grant.request, run), show = await resolveTemporalHandler(session.serial, grant.request, run, true);
    if ([target, show].some(r => r.packageName !== grant.packageName)) throw Error('TEMPORAL_HANDLER_CHANGED: no write sent.');
    const snapshot = await observer.readNativeSnapshot(15000, signal);
    if (snapshot.deviceSerial !== grant.deviceId || snapshot.foregroundPackage !== grant.packageName || snapshot.observationStatus !== 'OBSERVED' || Date.now() - snapshot.timestamp > 5000 || Date.now() < snapshot.timestamp || snapshot.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /Dialog|ProgressBar/.test(n.className))) throw Error('STALE_TEMPORAL_UI: no write sent.');
    const label = 'PhoneCommander-' + randomUUID();
    consumeTemporalEffectGrant(grant, session.serial, session.sessionId!);
    await state.journal?.temporalDispatch();
    signal?.throwIfAborted();
    if (Date.now() >= grant.expiresAt) throw Error('TEMPORAL_GRANT_EXPIRED: no RPC sent; journal conservatively unknown, never replay.');
    try {
      const result = await run(['-s', session.serial, 'shell', 'am', 'start', '-W', '-a', target.action, '-n', "'" + target.component + "'", ...temporalExtras(grant.request, label)], 10000);
      if (/error|exception|permission denial/i.test(result.stdout + result.stderr)) throw Error('Intent error');
      await state.journal?.temporalAcknowledged();
    } catch { throw Error('UNKNOWN_EFFECT: temporal dispatch attempted once; no retry or cleanup authorized.'); }
    // Reopen the persisted collection, never use the editor/dispatch response as proof.
    const readback = async () => {
      await guard();
      const result = await run(['-s', session.serial, 'shell', 'am', 'start', '-W', '-a', show.action, '-n', "'" + show.component + "'"], 10000);
      if (/error|exception/i.test(result.stdout + result.stderr)) throw Error('TEMPORAL_REOPEN_UNAVAILABLE: effect left in place, no replay.');
      let inventory;
      try { inventory = await reader.read(grant.packageName, grant.request.kind, before.uri, signal); }
      catch { signal?.throwIfAborted(); throw Error('TEMPORAL_READBACK_UNVERIFIED: provider unavailable after dispatch; effect left in place, never retry.'); }
      const view = await observer.readNativeSnapshot(15000, signal); return { inventory, view };
    };
    const first = await readback();
    if (grant.request.kind === 'TIMER') await delay(1500, undefined, { signal });
    const second = await readback(); await guard();
    const proof = verifyTemporalReadback(before, first.inventory, second.inventory, [first.view, second.view], grant.request, label, grant);
    if (!proof) throw Error('TEMPORAL_READBACK_UNVERIFIED: new identity, unchanged old records, enabled alarm or running countdown not independently proven; effect left in place, no replay.');
    await state.journal?.verifiedTemporal(proof); return proof;
  });
}
