import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { listAndroidDevices, runAdb } from './adb';
import type { AdbRunner } from './executor';
import { acquireDeviceLock, readDeviceOwnership } from './appium/session-manager';
import { readTransportIdentity, transportMode } from './transport-identity';
import { readWirelessRecords, saveWirelessRecord, type WirelessDeviceRecord } from './wireless-store';
import { WirelessIp, WirelessPort, wirelessEndpoint } from './wireless-endpoint';

export const WirelessCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CONNECT'), ip: WirelessIp, port: WirelessPort }).strict(),
  z.object({ type: z.literal('USB_TO_WIFI'), serial: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/), ip: WirelessIp.optional(), port: WirelessPort }).strict(),
  z.object({ type: z.literal('RECONNECT'), serial: z.string().min(1).max(150) }).strict(),
  z.object({ type: z.literal('DISCONNECT'), serial: z.string().min(1).max(150) }).strict(),
]);
export type WirelessCommandValue = z.infer<typeof WirelessCommand>;
export async function discoverWirelessEndpoints(run: AdbRunner = runAdb) {
  try {
    const { stdout } = await run(['mdns', 'services'], 3000);
    return stdout.split(/\r?\n/).flatMap(line => {
      const match = line.trim().match(/^(\S+)\s+_adb-tls-connect\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+):(\d+)$/);
      if (!match) return [];
      try { wirelessEndpoint(match[2], Number(match[3])); return [{ name: match[1], ip: match[2], port: Number(match[3]), state: 'DISCOVERED' }]; }
      catch { return []; }
    });
  } catch { return []; }
}

async function assertNoExternalSession(run: AdbRunner, serial: string) {
  const identity = await readTransportIdentity(run, serial, true);
  const known = await readWirelessRecords();
  const { stdout } = await run(['forward', '--list'], 3000);
  for (const line of stdout.split(/\r?\n/).filter(line => /\btcp:6790\b/.test(line))) {
    const transport = line.split(/\s+/)[0];
    if (transport === serial || identity && (transport === identity.hardwareSerial ||
      known.find(row => row.serial === transport)?.physicalId === identity.physicalId ||
      (await readTransportIdentity(run, transport))?.physicalId === identity.physicalId)) {
      throw new Error('BUSY: an external Appium Session still owns this physical device.');
    }
  }
}
async function verifyEndpoint(run: AdbRunner, record: WirelessDeviceRecord): Promise<WirelessDeviceRecord> {
  if ((await run(['-s', record.serial, 'get-state'], 3000)).stdout.trim() !== 'device') throw new Error('ADB endpoint is offline or unauthorized. Confirm debugging on the phone.');
  const identity = await readTransportIdentity(run, record.serial, true);
  if (!identity) throw new Error('Physical identity could not be verified. No Session can be started; use USB to inspect identity.');
  if (record.physicalId && record.physicalId !== identity.physicalId) throw new Error('Endpoint identity changed. Do not resume its old execution.');
  return { ...record, physicalId: identity.physicalId, model: identity.model, osVersion: identity.osVersion, state: 'CONNECTED', lastConnectedAt: Date.now(), error: undefined };
}

export async function wirelessSnapshot() {
  const devices = await listAndroidDevices();
  const records = await readWirelessRecords();
  const connections = [];
  for (const record of records) {
    const device = devices.find(device => device.serial === record.serial);
    const owner = await readDeviceOwnership(record.serial, runAdb);
    const mismatch = Boolean(device?.physicalId && record.physicalId && device.physicalId !== record.physicalId);
    const state = owner ? 'BUSY' : mismatch ? 'ERROR' : device?.status === 'device' ? 'CONNECTED' :
      ['CONNECTING', 'RECONNECTING', 'ERROR'].includes(record.state) ? record.state : 'DISCONNECTED';
    connections.push({ ...record, state, error: mismatch ? 'Endpoint physical identity changed.' : record.error,
      currentSessionId: owner?.sessionId, currentExecutionId: owner?.executionId });
  }
  return { devices, connections, discovered: await discoverWirelessEndpoints(), pairingMode: 'TERMINAL_ONLY' as const };
}

export async function manageWireless(input: WirelessCommandValue, run: AdbRunner = runAdb) {
  const releaseControl = await acquireDeviceLock('wireless-connection-manager');
  let releaseDevice: Awaited<ReturnType<typeof acquireDeviceLock>> | undefined;
  let releaseReservation: Awaited<ReturnType<typeof acquireDeviceLock>> | undefined;
  let record: WirelessDeviceRecord | undefined;
  try {
    const records = await readWirelessRecords();
    if (input.type === 'USB_TO_WIFI') {
      if (transportMode(input.serial) !== 'USB') throw new Error('USB conversion requires a USB serial.');
      releaseDevice = await acquireDeviceLock(input.serial, run);
      await assertNoExternalSession(run, input.serial);
      const identity = await readTransportIdentity(run, input.serial, true);
      if (!identity) throw new Error('USB physical identity is unverified. No TCP/IP change was sent.');
      releaseReservation = await acquireDeviceLock('device-reservation:' + identity.physicalId);
      if ((await run(['-s', input.serial, 'get-state'], 3000)).stdout.trim() !== 'device') throw new Error('USB device is not authorized.');
      const network = await run(['-s', input.serial, 'shell', 'ip', '-o', '-4', 'addr', 'show', 'wlan0'], 3000);
      const ip = input.ip ?? network.stdout.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\//)?.[1];
      if (!ip) throw new Error('No reliable Wi-Fi address found. Enter the phone IP manually.');
      const serial = wirelessEndpoint(ip, input.port);
      record = { serial, ip, port: input.port, physicalId: identity.physicalId, model: identity.model, state: 'CONNECTING' };
      await saveWirelessRecord(record);
      await run(['-s', input.serial, 'tcpip', String(input.port)], 10000);
    } else if (input.type === 'CONNECT') {
      const serial = wirelessEndpoint(input.ip, input.port);
      record = records.find(row => row.serial === serial) ?? { serial, ip: input.ip, port: input.port, state: 'CONNECTING' };
      const owner = await readDeviceOwnership(serial, run);
      if (owner) throw new Error('BUSY: use Reconnect for the same transport; switching an active device is forbidden.');
    } else {
      record = records.find(row => row.serial === input.serial);
      if (!record) throw new Error('Endpoint was not explicitly trusted through this connection manager. Connect with IP and port first.');
      wirelessEndpoint(record.ip, record.port);
      const owner = await readDeviceOwnership(record.serial, run);
      if (input.type === 'DISCONNECT') {
        if (owner) throw new Error('BUSY: cannot disconnect a physical device with an execution or retained Session.');
        releaseReservation = await acquireDeviceLock('device-reservation:' + (record.physicalId ?? record.serial));
        releaseDevice = await acquireDeviceLock(record.serial, run);
        await assertNoExternalSession(run, record.serial);
        await run(['disconnect', record.serial], 5000);
        record = { ...record, state: 'DISCONNECTED', error: undefined };
        await saveWirelessRecord(record);
        return { connection: record, message: 'Disconnected ADB transport. TCP/IP debugging on the phone is unchanged.' };
      }
      if (owner && owner.serial !== record.serial) throw new Error('BUSY: another transport owns the device. Do not switch transport.');
      // Reconnecting an existing endpoint restores only ADB, never an Agent/Session/action.
    }
    record = { ...record!, state: input.type === 'RECONNECT' ? 'RECONNECTING' : 'CONNECTING', error: undefined };
    await saveWirelessRecord(record);
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await delay(300 * 2 ** (attempt - 1));
      try {
        const reply = await run(['connect', record.serial], 5000);
        if (/failed|cannot|unable|refused/i.test(reply.stdout + reply.stderr)) throw new Error(reply.stdout.trim() || 'ADB connect failed.');
        record = await verifyEndpoint(run, record);
        if (input.type === 'CONNECT' && await readDeviceOwnership(record.serial, run)) throw new Error('BUSY: a physical Agent/Session already owns this device through a transport. No transport selection changed.');
        if (!releaseDevice && input.type !== 'RECONNECT') releaseDevice = await acquireDeviceLock(record.serial, run);
        await saveWirelessRecord(record);
        return { connection: record, message: input.type === 'USB_TO_WIFI'
          ? 'Physical identity verified over Wi-Fi. Close executions before unplugging USB; start a new Wi-Fi execution afterwards.'
          : 'ADB and physical identity verified. No old execution or Session was resumed.' };
      } catch (error) { failure = error; if (/identity|locked|BUSY|Session/.test(error instanceof Error ? error.message : '')) break; }
    }
    throw failure;
  } catch (error) {
    if (record) await saveWirelessRecord({ ...record, state: 'ERROR', error: (error instanceof Error ? error.message : 'Connection failed.').slice(0, 300) });
    throw error;
  } finally { try { await releaseDevice?.(); } finally { try { await releaseReservation?.(); } finally { await releaseControl(); } } }
}
