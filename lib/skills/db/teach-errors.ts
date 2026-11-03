const messages = {
  IMMUTABLE: 'The Teach record is immutable.', INVALID_TRANSITION: 'The Teach state transition is invalid.',
  EVIDENCE_REJECTED: 'The evidence level must be computed by the database.', CURRENT_VERSION_MISMATCH: 'The current version belongs to another skill.',
  APPEND_ONLY: 'Skill tests are append-only.', SNAPSHOT_REQUIRED: 'A snapshot or a safe missing-snapshot reason is required.',
  EXECUTION_MISMATCH: 'The execution does not match the device and skill version.', PHYSICAL_IDENTITY_REQUIRED: 'Verified physical identity is required.',
  SNAPSHOT_DEVICE_MISMATCH: 'The snapshot device differs from its session.', SNAPSHOT_SESSION_MISMATCH: 'The snapshot belongs to another session.',
  NO_REMOTE_CONSENT: 'Valid owner consent for Teach storage is required.', NOT_RECORDING: 'The session is not recording.',
  SAVE_OUTCOME_UNKNOWN: 'Kết quả lưu chưa xác định. Kiểm tra Skill Library trước khi thử thao tác mới.',
  CONFLICT: 'The revision or unique record conflicts with current data.', CONSTRAINT_REJECTED: 'A database constraint rejected the Teach record.',
  REFERENCE_CONFLICT: 'A referenced Teach record is missing or still in use.', DATABASE_ERROR: 'The Teach database operation failed.',
  INVALID_PAYLOAD: 'The Teach payload failed validation.', INVALID_SCHEMA: 'The Teach database schema name is invalid.',
  PHYSICAL_IDENTITY_AMBIGUOUS: 'More than one device row matches the physical identity.', NOT_FOUND: 'The Teach record was not found.',
  VERSION_HAS_TESTS: 'Create a new version after a version has test evidence.', CLEANUP_UNPROVEN: 'Ownership is retained until cleanup is proven.',
  ASSET_PATH_REJECTED: 'The asset is outside the private Teach storage.', ASSET_ERROR: 'The private Teach asset operation failed.',
} as const;
export type TeachErrorCode = keyof typeof messages;
export class TeachStorageError extends Error {
  readonly code: TeachErrorCode;
  constructor(code: TeachErrorCode) { super(messages[code]); this.name = 'TeachStorageError'; this.code = code; }
}
const codes: Readonly<Record<string, TeachErrorCode>> = Object.freeze({
  TH001: 'IMMUTABLE', TH002: 'INVALID_TRANSITION', TH003: 'EVIDENCE_REJECTED', TH004: 'CURRENT_VERSION_MISMATCH',
  TH005: 'APPEND_ONLY', TH006: 'SNAPSHOT_REQUIRED', TH007: 'EXECUTION_MISMATCH', TH008: 'PHYSICAL_IDENTITY_REQUIRED',
  TH009: 'SNAPSHOT_DEVICE_MISMATCH', TH010: 'SNAPSHOT_SESSION_MISMATCH', TH011: 'NO_REMOTE_CONSENT', TH012: 'NOT_RECORDING',
  '23505': 'CONFLICT', '23514': 'CONSTRAINT_REJECTED', '23503': 'REFERENCE_CONFLICT', '23001': 'REFERENCE_CONFLICT',
});
/** Never retain a vendor message, SQL, detail, URL or query parameter in public errors. */
export function teachStorageError(error: unknown): TeachStorageError {
  if (error instanceof TeachStorageError) return error;
  try {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    return new TeachStorageError(typeof code === 'string' ? codes[code] ?? 'DATABASE_ERROR' : 'DATABASE_ERROR');
  } catch { return new TeachStorageError('DATABASE_ERROR'); }
}
