import { handleLegacyInterpret, LegacyInterpretRequestSchema } from '@/lib/android/unified-agent/legacy-interpret-handler';
import { LEGACY_ENTRY_ENABLED, legacyEntryDenied } from '@/lib/android/unified-agent/legacy-entry';
import { isLocalMutation } from '@/lib/android/agent/request-origin';
import { assertSafeSource } from '@/lib/android/safety-envelope';

export async function POST(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ success: false, error: 'Same-origin JSON request required.' }, { status: 403 });
  const input = LegacyInterpretRequestSchema.safeParse(await request.clone().json().catch(() => null));
  if (!input.success) return Response.json({ success: false, error: 'Invalid legacy interpretation request.' }, { status: 400 });
  try { assertSafeSource(input.data.prompt); }
  catch { return Response.json({ success: false, error: 'HARD_DENY: unsafe source; no interpretation authorized.' }, { status: 403 }); }
  if (!LEGACY_ENTRY_ENABLED) return legacyEntryDenied();
  return handleLegacyInterpret(request);
}
