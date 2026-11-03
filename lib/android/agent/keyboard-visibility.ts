import type { AdbRunner } from '../executor';

export interface KeyboardVisibility { deviceId: string; observedAt: number; shown?: boolean; status: 'KNOWN' | 'UNKNOWN'; why: string }
const issued = new WeakMap<KeyboardVisibility, string>();
export const isKeyboardVisibility = (proof: KeyboardVisibility) => issued.get(proof) === JSON.stringify(proof);
export async function readKeyboardVisibility(deviceId: string, run: AdbRunner, signal?: AbortSignal): Promise<KeyboardVisibility> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)) throw Error('Invalid keyboard device identity.');
  signal?.throwIfAborted(); let shown: boolean | undefined, why = 'INPUT_METHOD_VISIBILITY_UNAVAILABLE';
  try {
    const { stdout } = await run(['-s', deviceId, 'shell', 'dumpsys', 'input_method'], 5000);
    signal?.throwIfAborted();
    const values = [...stdout.matchAll(/\bmInputShown=(true|false)\b/g)].map(m => m[1]);
    if (values.length && new Set(values).size === 1) { shown = values[0] === 'true'; why = 'Device-scoped InputMethodManager mInputShown readback.'; }
    else why = 'INPUT_METHOD_VISIBILITY_MISSING_OR_CONFLICTING';
  } catch { signal?.throwIfAborted(); }
  const proof = Object.freeze({ deviceId, observedAt: Date.now(), shown, status: shown === undefined ? 'UNKNOWN' as const : 'KNOWN' as const, why });
  issued.set(proof, JSON.stringify(proof)); return proof;
}
