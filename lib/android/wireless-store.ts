import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runtimeDirectory } from './agent/runtime-storage';

export const WirelessState = z.enum(['DISCONNECTED', 'DISCOVERED', 'PAIRING', 'CONNECTING', 'CONNECTED', 'BUSY', 'RECONNECTING', 'ERROR']);
export const WirelessRecord = z.object({
  serial: z.string().min(1).max(150), ip: z.string().min(1).max(40), port: z.number().int().min(1024).max(65535),
  physicalId: z.string().optional(), model: z.string().optional(), osVersion: z.string().optional(),
  state: WirelessState, lastConnectedAt: z.number().optional(), error: z.string().max(300).optional(),
});
export type WirelessDeviceRecord = z.infer<typeof WirelessRecord>;
const file = () => join(runtimeDirectory(), 'wireless-devices.json');
export async function readWirelessRecords(): Promise<WirelessDeviceRecord[]> {
  try { return z.array(WirelessRecord).max(100).parse(JSON.parse(await readFile(file(), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('Wireless registry is unreadable; inspect it before reconnecting.'); }
}
// Mutations are serialized by the connection manager's cross-process control lock.
export async function saveWirelessRecord(record: WirelessDeviceRecord): Promise<void> {
  const rows = (await readWirelessRecords()).filter(row => row.serial !== record.serial);
  if (rows.length >= 100) throw new Error('Wireless registry is full.');
  rows.push(WirelessRecord.parse(record));
  await mkdir(runtimeDirectory(), { recursive: true });
  const temp = file() + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(rows), { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file());
}
export async function wirelessIdentityAllowed(serial: string, physicalId: string): Promise<boolean> {
  const record = (await readWirelessRecords()).find(row => row.serial === serial);
  return !record?.physicalId || record.physicalId === physicalId;
}
