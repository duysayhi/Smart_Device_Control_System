import { handleLegacyExecution, LegacyExecutionRequestSchema } from '@/lib/android/unified-agent/legacy-execution-handler';
import { LEGACY_ENTRY_ENABLED, legacyEntryDenied } from '@/lib/android/unified-agent/legacy-entry';
import { isLocalMutation } from '@/lib/android/agent/request-origin';
import { assertSafePlan, forbiddenSource } from '@/lib/android/safety-envelope';
import { isValidAndroidSerial } from '@/lib/android/adb';

export async function POST(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ success: false, error: 'Same-origin JSON request required.' }, { status: 403 });
  const input = LegacyExecutionRequestSchema.safeParse(await request.clone().json().catch(() => null));
  if (!input.success || !isValidAndroidSerial(input.data?.deviceId ?? '')) return Response.json({ success: false, error: 'Invalid legacy execution request.' }, { status: 400 });
  try { assertSafePlan(input.data.originalRequest, input.data.actionPlan); }
  catch (error) { return Response.json({ success: false, error: error instanceof Error ? error.message : 'Blocked request.' }, { status: forbiddenSource(input.data.originalRequest) ? 403 : 422 }); }
  if (!LEGACY_ENTRY_ENABLED) return legacyEntryDenied();
  return handleLegacyExecution(request);
}
