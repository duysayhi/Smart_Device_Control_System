import type { SkillDefinition } from './skill-schema';
import type { SanitizedTeachSnapshot } from './snapshot-sanitizer';

export type TeachSessionStatus = 'CREATED' | 'RECORDING' | 'REVIEWING' | 'COMPILED' | 'FINISHED' | 'INTERRUPTED' | 'CANCELLED' | 'FAILED' | 'EXPIRED';
export type TeachOwnership = 'NONE' | 'HELD' | 'RELEASED' | 'RETAINED_PENDING_CLEANUP' | 'ADMIN_DISPOSED_UNVERIFIED';
export type TeachVersionStatus = 'DRAFT' | 'PENDING_VALIDATION' | 'VERIFIED' | 'PUBLISHED' | 'REJECTED' | 'DISABLED' | 'DEPRECATED';
export interface TeachDevice { id: string; serialHash: string; physicalId: string; model: string; manufacturer: string; androidVersion: string | null }
export interface DeviceRegistration { serialHash: string; physicalId: string; model: string; manufacturer: string; androidVersion?: string }
export interface TeachSession { id: string; deviceId: string; physicalId: string; skillId: string | null; status: TeachSessionStatus; ownership: TeachOwnership; revision: number; interruptedReason: string | null }
export interface TeachSkill { id: string; name: string; description: string | null; currentVersionId: string | null; revision: number }
export interface TeachSkillSummary { id: string; name: string; description: string | null; version: number; status: 'DRAFT'; appScope: SkillDefinition['appScope']; createdAt: string }
export interface TeachVersion { id: string; skillId: string; version: number; status: TeachVersionStatus; revision: number; definition: SkillDefinition; contentHash: string; evidenceLevel: string; hasTests: boolean }
export interface TeachSnapshot { id: string; sessionId: string; deviceId: string; redactionStatus: SanitizedTeachSnapshot['redactionStatus']; semantics: SanitizedTeachSnapshot; assetRef: string | null }
export interface TeachRecordedAction { id: string; sessionId: string; order: number; operation: string; receipt: 'ACK' | 'NOT_SENT' | 'UNKNOWN' }
export interface TeachExecution { id: string; deviceId: string; versionId: string; status: string; runtimeDigest: string }
export interface TeachTest { id: string; versionId: string; deviceId: string; result: 'PASSED' | 'FAILED' | 'BLOCKED' | 'UNVERIFIED' }
export interface ActionInsert { sessionId: string; order: number; actionType: string; operation: string; args: unknown; target: unknown;
  inputTemplate?: string; beforeId?: string; afterId?: string; missingReason?: string; receipt: 'ACK' | 'NOT_SENT' | 'UNKNOWN';
  runtime?: { receiptId: string; executionId: string; sessionIdentity: string; physicalId: string; beforeObservationId: string; afterObservationId?: string; result: 'PASSED' | 'FAILED' | 'UNVERIFIED'; evidenceId?: string } }

/** Domain interface: no SQL, pool, Android context, model, grants or Skill DSL storage details. */
export interface TeachRepository {
  administrativeSession?(id:string):Promise<import('./legacy-retirement-contracts').AdministrativeSession>;
  retireLegacy?(id:string,revision:number,audit:import('./legacy-retirement-contracts').LegacyRetirementAudit,clearance:import('./legacy-retirement-contracts').AdministrativeClearance):Promise<TeachSession>;
  admitAuthorizedFresh?(id:string,revision:number,clearance:import('./legacy-retirement-contracts').AdministrativeClearance,successorId:string,authenticationSha256:string):Promise<TeachSession>;
  reauthorizeAndAdmitFresh?(id:string,revision:number,audit:import('./legacy-retirement-contracts').ClearanceReauthorizationAudit,successorId:string):Promise<TeachSession>;
  continueAndAdmitFresh?(audit:import('./continuation-contracts').ContinuationAudit):Promise<TeachSession>;
  getContinuation?(id:string):Promise<import('./continuation-contracts').ContinuationAudit>;
  assertContinuationReady?():Promise<void>;
  continuationPredecessor?(parent:string,previous:string):Promise<boolean>;
  assertReauthorizationReady?():Promise<void>;
  assertRecorderBranchBinding?(expectedFingerprint: string): Promise<void>;
  getOwnedSession?(physicalId: string): Promise<TeachSession | undefined>;
  transaction<T>(work: (repository: TeachRepository) => Promise<T>): Promise<T>;
  assertConsent(deviceId?: string): Promise<void>;
  upsertDevice(input: DeviceRegistration): Promise<TeachDevice>;
  getDevice(id: string): Promise<TeachDevice>;
  createSession(deviceId: string, skillId?: string, command?: string): Promise<TeachSession>;
  getSession(id: string): Promise<TeachSession>;
  updateSession(id: string, revision: number, status: TeachSessionStatus, ownership: TeachOwnership, reason?: string, cleanupOnly?: boolean): Promise<TeachSession>;
  insertSnapshot(sessionId: string, deviceId: string, semantics: SanitizedTeachSnapshot, assetRef?: string): Promise<TeachSnapshot>;
  insertAction(input: ActionInsert): Promise<TeachRecordedAction>;
  createSkill(definition: SkillDefinition): Promise<TeachSkill>;
  getSkill(id: string): Promise<TeachSkill>;
  listSkills(): Promise<TeachSkillSummary[]>;
  updateSkill(id: string, revision: number, name: string, description: string | null, versionId: string | null): Promise<TeachSkill>;
  createVersion(skillId: string, version: number, definition: SkillDefinition, sessionId?: string): Promise<TeachVersion>;
  getVersion(id: string, lock?: boolean): Promise<TeachVersion>;
  getVersionByNumber(skillId: string, version: number): Promise<TeachVersion>;
  replaceDefinition(id: string, revision: number, definition: SkillDefinition): Promise<TeachVersion>;
  transitionVersion(id: string, revision: number, status: TeachVersionStatus): Promise<TeachVersion>;
  createExecution(deviceId: string, versionId: string, runtimeDigest: string): Promise<TeachExecution>;
  insertOfflineTest(versionId: string, deviceId: string, result: TeachTest['result'], executionId?: string): Promise<TeachTest>;
  purgeExpired(): Promise<string[]>;
}
