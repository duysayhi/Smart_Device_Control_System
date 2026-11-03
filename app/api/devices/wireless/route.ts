import { isLocalSameOrigin } from '@/lib/android/agent/request-origin';
import { manageWireless, WirelessCommand, wirelessSnapshot } from '@/lib/android/wireless-manager';
const rate = globalThis as typeof globalThis & { wirelessRequests?: number[] };

export async function GET(request: Request) {
  if (!isLocalSameOrigin(request)) return Response.json({ error: 'Invalid local origin.' }, { status: 403 });
  try { return Response.json({ success: true, ...await wirelessSnapshot() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ success: false, error: error instanceof Error ? error.message : 'Cannot read wireless connections.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!request.headers.get('origin') || !isLocalSameOrigin(request)) return Response.json({ error: 'Same-origin local connection management required.' }, { status: 403 });
  rate.wirelessRequests = (rate.wirelessRequests ?? []).filter(at => at > Date.now() - 60000);
  if (rate.wirelessRequests.length >= 8) return Response.json({ error: 'Connection request limit reached; wait one minute.' }, { status: 429 });
  rate.wirelessRequests.push(Date.now());
  const input = WirelessCommand.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'Invalid typed connection request. IP, port and operation must be valid; raw commands and pairing codes are not accepted.' }, { status: 400 });
  try { return Response.json({ success: true, ...await manageWireless(input.data) }); }
  catch (error) { return Response.json({ success: false, error: error instanceof Error ? error.message : 'Wireless connection failed.' }, { status: 409 }); }
}
