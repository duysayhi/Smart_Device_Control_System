import { randomUUID } from 'node:crypto';
import { mkdir, open, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagedAppiumSession } from '../appium/session-manager';
import type { AdbRunner } from '../executor';
import type { StateObserver } from '../state-observer';
import { deviceReadiness } from './device-readiness';
import { assertFullControl, SettingMutation, type SettingName } from './full-control-policy';
import type { OwnerTestExecution } from './owner-test-policy';
import { StrategyFailure, reflectStrategies, rememberVerifiedStrategy, type Reflection } from './strategy-reflection';

export interface MutationRecord { id: string; state: SettingName; before: number; desired: number; dispatch: 'PREPARED' | 'UNKNOWN' | 'ACKNOWLEDGED'; verified: boolean; restoration: 'PENDING' | 'RESTORED' | 'MANUAL_REQUIRED'; restoreSent: boolean; reason?: string }
interface SettingGrant { id: string; deviceId: string; sessionId: string; executionId: string; args: SettingMutation; before: number; expiresAt: number }
const grants = new WeakSet<SettingGrant>();
export function statePair(state: SettingName): [string[], string[]] {
  const config: Partial<Record<SettingName, [string, string, string[]]>> = {
    wifi: ['global', 'wifi_on', ['cmd', 'wifi', 'status']],
    // Fixed backend-only projection keeps current root fields, not unbounded service history.
    bluetooth: ['global', 'bluetooth_on', ['dumpsys', 'bluetooth_manager', '|', 'head', '-n', '12']],
    dnd: ['global', 'zen_mode', ['dumpsys', 'notification']], rotation: ['system', 'accelerometer_rotation', ['wm', 'user-rotation']],
    brightness: ['system', 'screen_brightness', ['dumpsys', 'display']], airplane: ['global', 'airplane_mode_on', ['cmd', 'connectivity', 'airplane-mode']],
  };
  const c = config[state]; if (!c) throw new StrategyFailure('SAFE_BLOCKED: no independent state pair and reversible executor for ' + state);
  return [['settings', 'get', c[0], c[1]], c[2]];
}
export function verifySettingPair(state: SettingName, primary: string, independent: string): number | undefined {
  if (!/^\d+$/.test(primary.trim())) return;
  const a = Number(primary.trim()); let values: number[] = [];
  if (state === 'wifi') values = [...independent.matchAll(/^\s*Wi-?Fi is (enabled|disabled)\s*$/gim)].map(m => m[1].toLowerCase() === 'enabled' ? 1 : 0);
  if (state === 'bluetooth') {
    values = [...independent.matchAll(/^\s*enabled:\s*(true|false)\s*$/gm)].map(m => m[1] === 'true' ? 1 : 0);
    const states = [...independent.matchAll(/^\s*state:\s*(\w+)\s*$/gm)].map(m => m[1]);
    if (!states.length || states.some(s => a === 1 ? s !== 'ON' : !['OFF', 'BLE_ON'].includes(s))) return;
  }
  if (state === 'dnd') {
    const modes: Record<string, number> = { ZEN_MODE_OFF: 0, ZEN_MODE_IMPORTANT_INTERRUPTIONS: 1, ZEN_MODE_NO_INTERRUPTIONS: 2, ZEN_MODE_ALARMS: 3 };
    values = [...independent.matchAll(/^\s*mZenMode=(ZEN_MODE_[A-Z_]+)\s*$/gm)].flatMap(m => modes[m[1]] === undefined ? [] : [modes[m[1]]]);
  }
  if (state === 'rotation') values = /^free\s*$/.test(independent.trim()) ? [1] : /^lock [0-3]\s*$/.test(independent.trim()) ? [0] : [];
  if (state === 'brightness') values = [...independent.matchAll(/^\s*mScreenBrightness=(\d+(?:\.\d+)?)\s*$/gm)].map(m => m[1].includes('.') && Number(m[1]) <= 1 ? Math.round(Number(m[1]) * 255) : Number(m[1]));
  if (state === 'airplane') values = /^enabled\s*$/.test(independent.trim()) ? [1] : /^disabled\s*$/.test(independent.trim()) ? [0] : [];
  if (!values.length || values.some(v => v !== a)) return;
  if (!SettingMutation.safeParse({ state, value: a }).success && !(state === 'brightness' && a === 0)) return;
  return a;
}
export function settingCommand(args: SettingMutation): string[] {
  args = SettingMutation.parse(args);
  if (args.state === 'wifi' || args.state === 'bluetooth') return ['svc', args.state, args.value ? 'enable' : 'disable'];
  if (args.state === 'brightness') return ['settings', 'put', 'system', 'screen_brightness', String(args.value)];
  if (args.state === 'dnd') return ['cmd', 'notification', 'set_dnd', ['all', 'priority', 'none', 'alarms'][args.value]];
  if (args.state === 'rotation') return ['settings', 'put', 'system', 'accelerometer_rotation', String(args.value)];
  throw new StrategyFailure('SAFE_BLOCKED: no supported reversible mutation contract for ' + args.state);
}

export class SettingMutationController {
  readonly records: MutationRecord[] = [];
  readonly reflections: Reflection[] = [];
  readonly journalId = randomUUID();
  private journal?: string;
  private calls = 0;
  private settled = false;
  lastVerifiedAt = 0;
  constructor(private readonly session: ManagedAppiumSession, private readonly observer: StateObserver, private readonly run: AdbRunner,
    private readonly owner: OwnerTestExecution, private readonly source: string, private readonly executionId: string, private readonly packageName?: string) {}
  private check() { assertFullControl(this.owner, this.session.serial, this.owner.physicalId, this.executionId, this.source); }
  private async log(event: string, record?: MutationRecord) {
    if (!this.journal) {
      const root = join(tmpdir(), 'phone-commander-mutations'); await mkdir(root, { recursive: true });
      this.journal = join(root, this.journalId + '.jsonl'); const handle = await open(this.journal, 'wx', 0o600); await handle.close();
    }
    await appendFile(this.journal, JSON.stringify({ at: Date.now(), event, executionId: this.executionId, deviceId: this.session.serial,
      physicalId: this.owner.physicalId, authorizationId: this.owner.id, sessionId: this.session.sessionId, ...(record ? { record } : {}) }) + '\n', { mode: 0o600, flush: true });
  }
  private async ready(signal?: AbortSignal) {
    this.check(); signal?.throwIfAborted(); await this.session.ensureActive(signal); await this.session.assertPhysicalIdentity(signal);
    const policy = await this.run(['-s', this.session.serial, 'shell', 'dumpsys', 'window', 'policy'], 5000);
    if (deviceReadiness(policy.stdout) !== 'READY') throw new StrategyFailure('SAFE_BLOCKED: unlock/readiness required.');
  }
  async read(state: SettingName, signal?: AbortSignal): Promise<number> {
    await this.ready(signal); const [a, b] = statePair(state);
    let first, second;
    try {
      first = await this.run(['-s', this.session.serial, 'shell', ...a], 5000);
      second = await this.run(['-s', this.session.serial, 'shell', ...b], 5000);
    } catch { throw new StrategyFailure('SAFE_BLOCKED: independent read command unavailable for ' + state); }
    this.check(); signal?.throwIfAborted(); await this.session.assertPhysicalIdentity(signal);
    const value = verifySettingPair(state, first.stdout, second.stdout);
    if (value === undefined) throw new StrategyFailure('SAFE_BLOCKED: independent state paths unavailable or disagree for ' + state);
    return value;
  }
  async apply(input: SettingMutation, signal?: AbortSignal): Promise<number> {
    this.check(); if (this.settled || ++this.calls > 6) throw new StrategyFailure('Mutation budget exhausted/settled.');
    const args = SettingMutation.parse(input);
    let changed = false;
    return reflectStrategies(args.state, { INTENT: async () => {
      if (['wifi', 'bluetooth', 'airplane'].includes(args.state) && /[:.]/.test(this.session.serial)) throw new StrategyFailure('SAFE_BLOCKED: network mutation requires verified USB transport.');
      settingCommand(args); // Unsupported contracts fail before any grant or write.
      if (args.state === 'brightness') {
        const mode = await this.run(['-s', this.session.serial, 'shell', 'settings', 'get', 'system', 'screen_brightness_mode'], 5000);
        if (mode.stdout.trim() !== '0') throw new StrategyFailure('SAFE_BLOCKED: automatic brightness requires a separate source-bound operation.');
      }
      const before = await this.read(args.state, signal);
      if (!SettingMutation.safeParse({ state: args.state, value: before }).success) throw new StrategyFailure('SAFE_BLOCKED: pre-state has no exact registered undo value.');
      const snapshot = await this.observer.readNativeSnapshot(15000, signal);
      if (snapshot.deviceSerial !== this.session.serial || snapshot.observationStatus !== 'OBSERVED' || Date.now() - snapshot.timestamp < 0 || Date.now() - snapshot.timestamp > 5000) throw new StrategyFailure('SAFE_BLOCKED: fresh UI required before grant.');
      await this.ready(signal);
      if (await this.read(args.state, signal) !== before) throw new StrategyFailure('Pre-state changed before mutation grant; no overwrite.');
      if (before === args.value) { this.lastVerifiedAt = Date.now(); await this.log('ALREADY_SATISFIED_NO_MUTATION'); return before; }
      const grant: SettingGrant = Object.freeze({ id: randomUUID(), deviceId: this.session.serial, sessionId: this.session.sessionId!, executionId: this.executionId, args: Object.freeze(args), before, expiresAt: Date.now() + 5000 });
      grants.add(grant);
      const record: MutationRecord = { id: grant.id, state: args.state, before, desired: args.value, dispatch: 'PREPARED', verified: false, restoration: 'PENDING', restoreSent: false };
      await this.log('PREPARED_WITH_EXACT_UNDO', record);
      this.check(); signal?.throwIfAborted();
      if (!grants.delete(grant) || grant.expiresAt <= Date.now() || grant.deviceId !== this.session.serial || grant.sessionId !== this.session.sessionId || grant.executionId !== this.executionId) throw new StrategyFailure('Single-use mutation grant expired/replayed/foreign.');
      this.records.push(record); record.dispatch = 'UNKNOWN'; await this.log('DISPATCH_ATTEMPT', record);
      try {
        if (Date.now() >= grant.expiresAt) throw Error('Mutation grant expired after journal write; not dispatched.');
        changed = true; await this.run(['-s', this.session.serial, 'shell', ...settingCommand(args)], 5000); record.dispatch = 'ACKNOWLEDGED';
        const deadline = Date.now() + 8000;
        do {
          let actual: number | undefined;
          try { actual = await this.read(args.state, signal); } catch (e) { if (!(e instanceof StrategyFailure)) throw e; }
          if (actual === args.value) {
            this.lastVerifiedAt = Date.now();
            record.verified = true; await this.log('INDEPENDENT_POST_STATE_VERIFIED', record);
            if (this.packageName) try {
              const os = await this.run(['-s', this.session.serial, 'shell', 'getprop', 'ro.build.fingerprint'], 5000);
              const app = await this.run(['-s', this.session.serial, 'shell', 'dumpsys', 'package', this.packageName], 5000);
              const code = /\bversionCode=(\d+)\b/.exec(app.stdout)?.[1];
              if (code) rememberVerifiedStrategy(this.owner.physicalId + '|' + this.packageName, os.stdout.trim() + ':' + code, args.state, 'INTENT');
            } catch { /* Advisory memory failure cannot fabricate or invalidate independent evidence. */ }
            return actual;
          }
          if (Date.now() >= deadline) break; await delay(100, undefined, { signal });
        } while (Date.now() < deadline);
        throw Error('Independent desired state not verified; no mutation replay.');
      } catch (e) { await this.log('UNCERTAIN_NO_REPLAY', record); throw new StrategyFailure(e instanceof Error ? e.message : 'Unknown mutation outcome', record.dispatch); }
    } }, this.reflections, () => { this.check(); signal?.throwIfAborted(); }, () => changed);
  }
  async settle(success: boolean) {
    if (this.settled) throw Error('Mutation settlement cannot replay.'); this.settled = true;
    const cleanup = AbortSignal.timeout(25000); let failed = false;
    for (const record of [...this.records].reverse()) {
      try {
        if (!success && !this.owner.fullControl?.rollbackOnFailure) throw Error('Rollback-on-failure not enabled; manual restoration required.');
        const current = await this.read(record.state, cleanup);
        if (record.dispatch === 'UNKNOWN' && current === record.before && !record.verified) throw Error('Baseline observed but original dispatch remains UNKNOWN; manual inspection required, no replay.');
        if (current !== record.before) {
          if (current !== record.desired || record.restoreSent) throw Error('Foreign/intervening state or uncertain undo; no overwrite/retry.');
          const snapshot = await this.observer.readNativeSnapshot(15000, cleanup);
          if (snapshot.deviceSerial !== this.session.serial || snapshot.observationStatus !== 'OBSERVED' || Date.now() - snapshot.timestamp < 0 || Date.now() - snapshot.timestamp > 5000) throw Error('Fresh UI required for undo.');
          if (await this.read(record.state, cleanup) !== current) throw Error('State changed during undo preparation; no overwrite.');
          this.check(); cleanup.throwIfAborted();
          const undo: SettingGrant = Object.freeze({ id: randomUUID(), deviceId: this.session.serial, sessionId: this.session.sessionId!, executionId: this.executionId,
            args: Object.freeze({ state: record.state, value: record.before }), before: current, expiresAt: Date.now() + 5000 });
          grants.add(undo);
          await this.log('UNDO_PREPARED', record);
          this.check(); if (!grants.delete(undo) || Date.now() >= undo.expiresAt) throw Error('Undo grant expired/replayed.');
          record.restoreSent = true; await this.log('UNDO_DISPATCH_ATTEMPT', record);
          if (Date.now() >= undo.expiresAt) throw Error('Undo grant expired after journal write; not dispatched.');
          await this.run(['-s', this.session.serial, 'shell', ...settingCommand(undo.args)], 5000);
          const deadline = Date.now() + 8000; let restored = false;
          do {
            try { restored = await this.read(record.state, cleanup) === record.before; } catch (e) { if (!(e instanceof StrategyFailure)) throw e; }
            if (restored || Date.now() >= deadline) break; await delay(100, undefined, { signal: cleanup });
          } while (Date.now() < deadline);
          if (!restored) throw Error('Undo independent readback missing; no retry.');
        }
        record.restoration = 'RESTORED'; await this.log('RESTORATION_VERIFIED', record);
      } catch (e) { record.restoration = 'MANUAL_REQUIRED'; record.reason = e instanceof Error ? e.message.slice(0, 180) : 'Unknown cleanup failure'; failed = true; await this.log('MANUAL_RESTORATION_REQUIRED', record); }
    }
    return { journalId: this.journalId, records: this.records.map(r => ({ ...r })), reflections: this.reflections.slice(), restored: !failed };
  }
}
