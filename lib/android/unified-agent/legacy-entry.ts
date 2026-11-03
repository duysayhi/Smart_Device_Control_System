// Re-enabling legacy public entry points requires an explicit source change.
export const LEGACY_ENTRY_ENABLED: boolean = false;
export const LEGACY_ENTRY_DISABLED_MESSAGE = 'LEGACY_ENTRY_DISABLED: Chua ho tro khoi chay qua API cu. Su dung /api/unified-agent.';
export function legacyEntryDenied() {
  return Response.json({ success: false, error: LEGACY_ENTRY_DISABLED_MESSAGE, code: 'LEGACY_ENTRY_DISABLED' }, { status: 410 });
}
