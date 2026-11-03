export type DeviceReadiness = 'READY' | 'UNLOCK_REQUIRED' | 'UNKNOWN';
// A foreground package may be reported behind the keyguard; it is not unlock evidence.
export function deviceReadiness(policy: string): DeviceReadiness {
  const showing = [...policy.matchAll(/\bmIsShowing=(true|false)\b/g)].map(row => row[1]);
  const screens = [...policy.matchAll(/\bscreenState=(SCREEN_STATE_[A-Z_]+)\b/g)].map(row => row[1]);
  if (showing.includes('true') || screens.some(value => value !== 'SCREEN_STATE_ON')) return 'UNLOCK_REQUIRED';
  return showing.length > 0 && screens.length > 0 ? 'READY' : 'UNKNOWN';
}
