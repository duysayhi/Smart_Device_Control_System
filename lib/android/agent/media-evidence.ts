import type { AdbRunner } from '../executor';
import { readTransportIdentity } from '../transport-identity';
import { checkCancellation } from '../errors';

export interface SavedMediaIdentity { uri: string; mediaId: string; size: number; mimeType: string; ownerPackage: string; dateAdded: number }
export interface MediaInventory { deviceId: string; physicalId: string; observedAt: number; rows: readonly SavedMediaIdentity[];
  summary?: { count: number; maxId: string; maxDateAdded: number; deviceTime: number } }
const inventories = new WeakSet<MediaInventory>();
export const isIssuedMediaInventory = (inventory: MediaInventory) => inventories.has(inventory);
const completeIds = new WeakMap<MediaInventory, readonly string[]>();

export class MediaStoreReader {
  private readonly since = Math.floor(Date.now() / 1000) - 120;
  constructor(private readonly deviceId: string, private readonly run: AdbRunner) {}
  async readCapture(physicalId: string, signal?: AbortSignal): Promise<MediaInventory> {
    const summary = async () => {
      checkCancellation(signal);
      const clock = await this.run(['-s', this.deviceId, 'shell', 'date', '+%s'], 5000);
      if (!/^\d{10}$/.test(clock.stdout.trim()) || clock.stderr.trim()) throw Error('MEDIA_CLOCK_UNREADABLE');
      const result = await this.run(['-s', this.deviceId, 'shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id:date_added'], 10000);
      if (result.stderr.trim()) throw Error('MEDIA_SUMMARY_UNREADABLE');
      const rows = result.stdout.trim() === 'No result found.' ? [] : result.stdout.trim().split(/\r?\n/).map(line => {
        const match = /^Row: \d+ _id=(\d{1,20}), date_added=(\d+)$/.exec(line);
        if (!match || !Number.isSafeInteger(Number(match[2]))) throw Error('MEDIA_SUMMARY_UNREADABLE');
        return { id: match[1], date: Number(match[2]) };
      });
      const ids = rows.map(r => r.id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      if (ids.length > 100000 || new Set(ids).size !== ids.length) throw Error('MEDIA_SUMMARY_INCOMPLETE');
      return { ids, count: ids.length, maxId: ids.at(-1) ?? '0', maxDateAdded: Math.max(0, ...rows.map(r => r.date)), deviceTime: Number(clock.stdout.trim()) };
    };
    const pre = await summary(), inventory = await this.read(physicalId, signal), post = await summary();
    if (JSON.stringify(pre.ids) !== JSON.stringify(post.ids) || pre.maxDateAdded !== post.maxDateAdded) throw Error('MEDIA_SUMMARY_CHANGED_DURING_READ');
    const result: MediaInventory = Object.freeze({ ...inventory, observedAt: Date.now(), summary: Object.freeze({ count: post.count, maxId: post.maxId, maxDateAdded: post.maxDateAdded, deviceTime: post.deviceTime }) });
    inventories.add(result); completeIds.set(result, Object.freeze(post.ids)); return result;
  }
  async read(physicalId: string, signal?: AbortSignal): Promise<MediaInventory> {
    checkCancellation(signal);
    const before = await readTransportIdentity(this.run, this.deviceId, true, 5000, true);
    if (before?.physicalId !== physicalId) throw Error('MEDIA_PROVIDER_DEVICE_MISMATCH');
    const result = await this.run(['-s', this.deviceId, 'shell', 'content', 'query', '--uri', 'content://media/external/images/media',
      '--projection', '_id:date_added:_size:mime_type:owner_package_name', '--where', '"date_added >= ' + this.since + '"'], 10000);
    checkCancellation(signal);
    const after = await readTransportIdentity(this.run, this.deviceId, true, 5000, true);
    if (after?.physicalId !== physicalId) throw Error('MEDIA_PROVIDER_DEVICE_MISMATCH');
    const lines = result.stdout.trim().split(/\r?\n/);
    if (result.stderr.trim() || /exception|permission denial|error|security/i.test(result.stdout)) throw Error('MEDIA_PROVIDER_UNAVAILABLE: Android denied metadata access.');
    const rows: SavedMediaIdentity[] = [];
    if (result.stdout.trim() !== 'No result found.') for (const line of lines) {
      if (rows.length >= 200 || !/^Row: \d+ /.test(line)) throw Error('MEDIA_PROVIDER_UNAVAILABLE: incomplete or oversized inventory.');
      const entries = line.replace(/^Row: \d+ /, '').split(', ').map(part => part.split('='));
      if (entries.length !== 5 || entries.some(entry => entry.length !== 2)) throw Error('MEDIA_PROVIDER_UNAVAILABLE: malformed metadata.');
      const data = Object.fromEntries(entries);
      if (new Set(entries.map(entry => entry[0])).size !== 5 || !/^\d{1,20}$/.test(data._id ?? '') || !/^\d+$/.test(data.date_added ?? '') || !/^\d+$/.test(data._size ?? '') || !Number.isSafeInteger(Number(data.date_added)) || !Number.isSafeInteger(Number(data._size)) ||
        !/^image\/[a-z0-9.+-]+$/i.test(data.mime_type ?? '') || !/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(data.owner_package_name ?? '')) throw Error('MEDIA_PROVIDER_UNAVAILABLE: identity/owner metadata is not usable.');
      rows.push(Object.freeze({ uri: 'content://media/external/images/media/' + data._id, mediaId: data._id, size: Number(data._size), mimeType: data.mime_type, ownerPackage: data.owner_package_name, dateAdded: Number(data.date_added) }));
    }
    if (new Set(rows.map(row => row.uri)).size !== rows.length) throw Error('MEDIA_PROVIDER_UNAVAILABLE: duplicate media identity.');
    const inventory: MediaInventory = Object.freeze({ deviceId: this.deviceId, physicalId, observedAt: Date.now(), rows: Object.freeze(rows) });
    inventories.add(inventory); return inventory;
  }
}

export function capturedMediaDelta(before: MediaInventory, after: MediaInventory, deviceId: string, physicalId: string, ownerPackage: string): SavedMediaIdentity | undefined {
  if (!inventories.has(before) || !inventories.has(after) || before.deviceId !== deviceId || after.deviceId !== deviceId || before.physicalId !== physicalId || after.physicalId !== physicalId ||
    after.observedAt < before.observedAt || after.observedAt - before.observedAt > 120000 || Date.now() - after.observedAt > 5000) return;
  const added = after.rows.filter(row => !before.rows.some(old => old.uri === row.uri));
  if (before.summary || after.summary) {
    const oldIds = completeIds.get(before), newIds = completeIds.get(after), present = new Set(newIds);
    if (!before.summary || !after.summary || !oldIds || !newIds || after.summary.count !== before.summary.count + 1 ||
      oldIds.some(id => !present.has(id)) || BigInt(after.summary.maxId) <= BigInt(before.summary.maxId)) return;
  }
  if (added.length !== 1 || added[0].ownerPackage !== ownerPackage || added[0].size <= 0 || added[0].dateAdded < (before.summary?.deviceTime ?? Math.floor(before.observedAt / 1000)) || added[0].dateAdded > (after.summary?.deviceTime ?? Math.floor(after.observedAt / 1000)) + 5) return;
  return added[0];
}

export function mediaDeltaReason(before: MediaInventory, after: MediaInventory): string {
  if (!inventories.has(before) || !inventories.has(after)) return 'MEDIA_UNREADABLE';
  const delta = before.summary && after.summary ? after.summary.count - before.summary.count : after.rows.filter(r => !before.rows.some(old => old.uri === r.uri)).length;
  if (delta === 0) return 'MEDIA_DELTA_ZERO';
  if (delta !== 1) return 'MEDIA_DELTA_MULTIPLE_OR_REMOVED';
  const added = after.rows.filter(r => !before.rows.some(old => old.uri === r.uri));
  if (added.length === 1 && added[0].dateAdded < (before.summary?.deviceTime ?? Math.floor(before.observedAt / 1000))) return 'MEDIA_STALE_TIMESTAMP';
  return 'MEDIA_IDENTITY_OWNER_SIZE_OR_PROVENANCE_MISMATCH';
}
