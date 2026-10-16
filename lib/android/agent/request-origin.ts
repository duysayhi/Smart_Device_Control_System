// Next dev can normalize Request.url to localhost; browser authority is in Host.
// Accept only the actual loopback authority, never arbitrary forwarded hosts or aliases.
export function isLocalSameOrigin(request: Request): boolean {
  try {
    const internal = new URL(request.url), authority = request.headers.get('host') ?? internal.host;
    const expected = new URL(internal.protocol + '//' + authority);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) || expected.username || expected.password) return false;
    const origin = request.headers.get('origin');
    return !origin || new URL(origin).origin === expected.origin;
  } catch { return false; }
}
