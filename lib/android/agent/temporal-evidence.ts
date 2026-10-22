import { createHash, randomUUID } from 'node:crypto';
import type { AdbRunner } from '../executor';
import type { Observation } from '../state-observer';
import type { TemporalRequest } from './temporal-contract';

export interface TemporalRow { id: string; label: string; hour?: number; minute?: number; enabled?: boolean; seconds?: number; remaining?: number; running?: boolean }
export interface TemporalInventory { deviceId: string; packageName: string; uri: string; kind: TemporalRequest['kind']; zone: string; observedAt: number; monotonicMs: number; rows: readonly TemporalRow[] }
export interface TemporalEvidence { id: string; deviceId: string; executionId: string; nodeId: string; sessionId: string; observedAt: number; kind: TemporalRequest['kind']; identity: string; request: TemporalRequest; zone: string; snapshots: string[]; provider: 'INDEPENDENT_TEMPORAL_PROVIDER'; }
const inventories = new WeakMap<TemporalInventory, string>(), proofs = new WeakMap<TemporalEvidence, string>();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const issuedTemporalInventory = (value: TemporalInventory) => inventories.get(value) === digest(value);
export const isTemporalEvidence = (value: TemporalEvidence) => proofs.get(value) === digest(value);
const numeric = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;

// Compatibility contracts name their units explicitly; private vendor schemas are not inferred.
export function parseTemporalRows(output: string, kind: TemporalRequest['kind']): TemporalRow[] | undefined {
  if (/^No result found\.?(?:\r?\n)?$/.test(output.trim())) return [];
  const lines = output.trim().split(/\r?\n/); if (!lines.length || lines.length > 1000) return;
  const rows: TemporalRow[] = [];
  for (const line of lines) {
    if (!/^Row: \d+ /.test(line)) return;
    const fields = line.replace(/^Row: \d+ /, '').split(/, (?=[A-Za-z_][A-Za-z_0-9]*=)/), values: Record<string, string> = {};
    for (const field of fields) {
      const m = /^([A-Za-z_][A-Za-z_0-9]*)=([\s\S]*)$/.exec(field); if (!m || Object.hasOwn(values, m[1])) return; values[m[1]] = m[2];
    }
    const expected = kind === 'ALARM' ? ['_id', 'hour', 'minutes', 'enabled', 'label'] : ['_id', 'duration_seconds', 'remaining_seconds', 'running', 'label'];
    if (Object.keys(values).length !== expected.length || expected.some(k => !Object.hasOwn(values, k)) || !/^\d+$/.test(values._id) || rows.some(r => r.id === values._id)) return;
    const row: TemporalRow = { id: values._id, label: values.label === 'NULL' ? '' : values.label };
    if (kind === 'ALARM') {
      row.hour = numeric(values.hour); row.minute = numeric(values.minutes); row.enabled = values.enabled === '1';
      if (!Number.isFinite(row.hour) || row.hour > 23 || !Number.isFinite(row.minute) || row.minute > 59 || !/^[01]$/.test(values.enabled)) return;
    } else {
      row.seconds = numeric(values.duration_seconds); row.remaining = numeric(values.remaining_seconds); row.running = values.running === '1';
      if (!Number.isFinite(row.seconds) || row.seconds < 1 || !Number.isFinite(row.remaining) || row.remaining > row.seconds || !/^[01]$/.test(values.running)) return;
    }
    rows.push(row);
  }
  return rows;
}
export class TemporalProviderReader {
  constructor(private readonly serial: string, private readonly run: AdbRunner) {}
  async read(packageName: string, kind: TemporalRequest['kind'], uri?: string, signal?: AbortSignal): Promise<TemporalInventory> {
    signal?.throwIfAborted();
    if (!/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(packageName)) throw Error('TEMPORAL_PROVIDER_UNAVAILABLE: invalid package.');
    const metadata = (await this.run(['-s', this.serial, 'shell', 'dumpsys', 'package', packageName], 5000)).stdout;
    const section = metadata.split('ContentProvider Authorities:')[1]?.split(/\r?\n\S/)[0] ?? '';
    const authorities = [...section.matchAll(/\[([A-Za-z][\w.]*)\]:\s*\r?\n\s*Provider\{[^\r\n]+\s([A-Za-z][\w.]*)\/([^}\s]+)/g)]
      .filter(m => m[2] === packageName && new RegExp(kind === 'ALARM' ? 'alarm' : 'timer', 'i').test(m[3])).map(m => m[1]);
    const candidates = [...new Set(authorities)].slice(0, 8).map(authority => 'content://' + authority + (kind === 'ALARM' ? '/alarms' : '/timers'));
    if (uri && !candidates.includes(uri)) throw Error('TEMPORAL_PROVIDER_CHANGED: no dispatch/replay.');
    const zones = (await this.run(['-s', this.serial, 'shell', 'getprop', 'persist.sys.timezone'], 5000)).stdout.trim();
    let zone: string; try { zone = new Intl.DateTimeFormat('en', { timeZone: zones }).resolvedOptions().timeZone; if (!zones) throw Error(); } catch { throw Error('DEVICE_TIMEZONE_UNAVAILABLE'); }
    const matches: TemporalInventory[] = [];
    for (const path of uri ? [uri] : candidates) {
      signal?.throwIfAborted();
      const projection = kind === 'ALARM' ? '_id:hour:minutes:enabled:label' : '_id:duration_seconds:remaining_seconds:running:label';
      const observedAt = Date.now(), monotonicMs = performance.now();
      let result;
      try { result = await this.run(['-s', this.serial, 'shell', 'content', 'query', '--uri', path, '--projection', projection], 5000); }
      catch { signal?.throwIfAborted(); continue; }
      const rows = !result.stderr.trim() && parseTemporalRows(result.stdout, kind);
      if (!rows) continue;
      let count;
      try { count = await this.run(['-s', this.serial, 'shell', 'content', 'query', '--uri', path, '--projection', "'COUNT(_id) AS total'"], 5000); }
      catch { signal?.throwIfAborted(); continue; }
      const total = /^Row: 0 total=(\d+)$/.exec(count.stdout.trim());
      if (!total || count.stderr.trim() || Number(total[1]) !== rows.length || Date.now() - observedAt < 0 || Date.now() - observedAt > 5000) continue;
      const inventory = Object.freeze({ deviceId: this.serial, packageName, uri: path, kind, zone, observedAt, monotonicMs, rows: Object.freeze(rows.map(r => Object.freeze(r))) });
      inventories.set(inventory, digest(inventory)); matches.push(inventory);
    }
    if (matches.length !== 1) throw Error('TEMPORAL_PROVIDER_UNAVAILABLE: no unique readable complete inventory with verified time units; no write sent.');
    return matches[0];
  }
}
export function temporalPrecondition(before: TemporalInventory, request: TemporalRequest): void {
  if (!issuedTemporalInventory(before) || before.kind !== request.kind || Date.now() - before.observedAt < 0 || Date.now() - before.observedAt > 5000) throw Error('STALE_TEMPORAL_INVENTORY');
  if (request.kind === 'ALARM') {
    if (request.zone && new Intl.DateTimeFormat('en', { timeZone: request.zone }).resolvedOptions().timeZone !== before.zone) throw Error('TIMEZONE_MISMATCH: cross-zone scheduling unsupported.');
    if (before.rows.some(row => row.hour === request.hour && row.minute === request.minute)) throw Error('ALARM_ALREADY_EXISTS: new-only contract cannot reuse or enable an existing alarm.');
  } else if (before.rows.some(row => row.running || row.seconds === request.seconds)) throw Error('TIMER_CONFLICT: existing timer cannot be restarted or overwritten.');
}
export function verifyTemporalReadback(before: TemporalInventory, first: TemporalInventory, second: TemporalInventory, snapshots: Observation[],
  request: TemporalRequest, label: string, context: { executionId: string; nodeId: string; sessionId: string }): TemporalEvidence | undefined {
  if (![before, first, second].every(issuedTemporalInventory) || first === second || !/^PhoneCommander-[a-f0-9-]{36}$/.test(label) || before.rows.some(r => r.label === label)) return;
  if (![first, second].every(v => v.deviceId === before.deviceId && v.packageName === before.packageName && v.uri === before.uri && v.zone === before.zone && v.kind === request.kind) ||
    before.kind !== request.kind || first.observedAt < before.observedAt || second.observedAt < first.observedAt || second.observedAt - before.observedAt > 60000 || Date.now() - second.observedAt > 5000 || Date.now() < second.observedAt) return;
  const added = (v: TemporalInventory) => v.rows.filter(r => !before.rows.some(old => old.id === r.id));
  const a = added(first), b = added(second);
  if (a.length !== 1 || b.length !== 1 || a[0].id !== b[0].id || a[0].label !== label || b[0].label !== label ||
    ![first, second].every(v => v.rows.length === before.rows.length + 1 && before.rows.every(old => v.rows.some(row => digest(row) === digest(old))))) return;
  if (snapshots.length !== 2 || snapshots[0].snapshotId === snapshots[1].snapshotId || !snapshots.every(s => s.deviceSerial === before.deviceId && s.foregroundPackage === before.packageName && s.observationStatus === 'OBSERVED' &&
    s.timestamp >= first.observedAt && s.timestamp <= second.observedAt + 5000 && Date.now() - s.timestamp <= 5000 && !s.nodes.some(n => /permissioncontroller|packageinstaller/.test(n.packageName) || /Dialog|ProgressBar|EditText|NumberPicker|TimePicker/.test(n.className)) &&
    s.nodes.filter(n => n.displayed !== false && (n.text === label || n.description === label)).length === 1)) return;
  if (request.kind === 'ALARM') {
    if (![a[0], b[0]].every(r => r.hour === request.hour && r.minute === request.minute && r.enabled === true)) return;
  } else {
    const elapsed = (second.monotonicMs - first.monotonicMs) / 1000, decrement = a[0].remaining! - b[0].remaining!;
    if (![a[0], b[0]].every(r => r.seconds === request.seconds && r.running === true && r.remaining! > 0) ||
      request.seconds - a[0].remaining! > (first.observedAt - before.observedAt) / 1000 + 2 || decrement <= 0 || Math.abs(decrement - elapsed) > 2) return;
  }
  const proof: TemporalEvidence = Object.freeze({ id: randomUUID(), deviceId: before.deviceId, executionId: context.executionId, nodeId: context.nodeId, sessionId: context.sessionId,
    observedAt: second.observedAt, kind: request.kind, identity: before.uri + '/' + b[0].id, request: Object.freeze({ ...request }), zone: second.zone, snapshots: snapshots.map(s => s.snapshotId), provider: 'INDEPENDENT_TEMPORAL_PROVIDER' });
  proofs.set(proof, digest(proof)); return proof;
}
