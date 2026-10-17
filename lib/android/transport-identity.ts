import { createHash } from 'node:crypto';
import type { AdbRunner } from './executor';
import type { ConnectionType } from '../../types/device';
import { AndroidExecutionError } from './errors';

export function transportMode(serial: string): ConnectionType {
  return serial.includes(':') || /_adb-tls-connect\._tcp\.?$/.test(serial) ? 'Wi-Fi' : 'USB';
}
export interface TransportIdentity { physicalId: string; hardwareSerial: string; model: string; manufacturer: string; osVersion?: string }
const cache = new Map<string, { expires: number; identity?: TransportIdentity }>();
export async function readTransportIdentity(run: AdbRunner, serial: string, fresh = false, timeoutMs = 5000, strictErrors = false): Promise<TransportIdentity | undefined> {
  const old = cache.get(serial);
  if (!fresh && old && old.expires > Date.now()) return old.identity;
  let identity: TransportIdentity | undefined;
  try {
    const { stdout } = await run(['-s', serial, 'shell', 'getprop'], Math.max(1, Math.ceil(Math.min(5000, timeoutMs))));
    const props = new Map([...stdout.matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]\s*$/gm)].map(m => [m[1], m[2]]));
    const hardwareSerial = props.get('ro.serialno'), boot = props.get('ro.boot.serialno');
    const manufacturer = props.get('ro.product.manufacturer'), model = props.get('ro.product.model');
    if (hardwareSerial && hardwareSerial === boot && /^[A-Za-z0-9._-]{5,128}$/.test(hardwareSerial) &&
      !/^(unknown|null|none|0+|1234567890)$/i.test(hardwareSerial) && manufacturer && model) {
      identity = { hardwareSerial, manufacturer, model, osVersion: props.get('ro.build.version.release'),
        physicalId: 'android:' + createHash('sha256').update(JSON.stringify([hardwareSerial, manufacturer, model])).digest('hex') };
    }
  } catch (error) {
    if (strictErrors) {
      const failure = error as { cause?: { killed?: boolean; code?: string }; message?: string };
      if (failure.cause?.killed || failure.cause?.code === 'ETIMEDOUT' || /ETIMEDOUT|timed? ?out/i.test(failure.message ?? '')) {
        throw new AndroidExecutionError('TIMEOUT', 'Physical identity observation exceeded its deadline; do not infer a USB/Wi-Fi disconnect.', { cause: error });
      }
      throw new AndroidExecutionError('DEVICE_ERROR', 'Unable to verify the physical device through the selected transport.', { cause: error });
    }
    // Discovery can keep other devices available without guessing this device's identity.
  }
  if (cache.size > 100) cache.clear();
  cache.set(serial, { identity, expires: Date.now() + (identity ? 10000 : 1000) });
  return identity;
}
