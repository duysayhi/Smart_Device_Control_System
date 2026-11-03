import {ContinuationAuditSchema,type ContinuationAudit} from '../continuation-contracts';
import type { SkillDefinition } from '../skill-schema';
import { createHash } from 'node:crypto';
import { parseSkillStructure } from '../skill-schema';
import { validateSkill } from '../skill-validator';
import type { SanitizedTeachSnapshot } from '../snapshot-sanitizer';
import type { ActionInsert, DeviceRegistration, TeachDevice, TeachExecution, TeachOwnership, TeachRecordedAction, TeachRepository, TeachSession, TeachSessionStatus, TeachSkill, TeachSkillSummary, TeachSnapshot, TeachTest, TeachVersion, TeachVersionStatus } from '../teach-repository';
import type { TeachDatabase, TeachQuery } from './pg-database';
import { TeachStorageError, teachStorageError } from './teach-errors';
import {AdministrativeClearanceSchema,LegacyRetirementAuditSchema,ClearanceReauthorizationAuditSchema,type ClearanceReauthorizationAudit,type AdministrativeClearance,type LegacyRetirementAudit} from '../legacy-retirement-contracts';

export function teachDatabaseSchema(value = process.env.TEACH_DATABASE_SCHEMA ?? 'teach_mode'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value) || value.length > 63) throw new TeachStorageError('INVALID_SCHEMA');
  return value;
}
type Row = Record<string, unknown>;
const device = (r: Row): TeachDevice => ({ id: String(r.id), serialHash: String(r.serial_hash), physicalId: String(r.physical_identity_hash),
  model: String(r.model), manufacturer: String(r.manufacturer), androidVersion: r.android_version === null ? null : String(r.android_version) });
const session = (r: Row): TeachSession => ({ id: String(r.id), deviceId: String(r.device_id), physicalId: String(r.device_identity_hash), skillId: r.skill_id === null ? null : String(r.skill_id),
  status: r.status as TeachSessionStatus, ownership: r.ownership_state as TeachOwnership, revision: Number(r.revision), interruptedReason:r.interrupted_reason === null ? null : String(r.interrupted_reason) });
const skill = (r: Row): TeachSkill => ({ id: String(r.id), name: String(r.name), description: r.description === null ? null : String(r.description), currentVersionId: r.current_version_id === null ? null : String(r.current_version_id), revision: Number(r.revision) });
function version(r: Row): TeachVersion {
  const parsed = parseSkillStructure(r.workflow_json);
  if (!parsed.success || !validateSkill(parsed.data).ok) throw new TeachStorageError('INVALID_PAYLOAD');
  return { id: String(r.id), skillId: String(r.skill_id), version: Number(r.version_no), status: r.status as TeachVersionStatus,
    revision: Number(r.revision), definition: parsed.data, contentHash: String(r.content_hash), evidenceLevel: String(r.evidence_level), hasTests: r.has_tests === true };
}

/** SQL is confined to this adapter. All identifiers are schema-qualified, including functions. */
export class PostgresTeachRepository implements TeachRepository {
  private readonly schema: string;
  constructor(private readonly database: TeachDatabase, schema?: string, private readonly connection?: TeachQuery) { this.schema = teachDatabaseSchema(schema); }
  async assertRecorderBranchBinding(expectedFingerprint: string) {
    if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new TeachStorageError('INVALID_PAYLOAD');
    const row = await this.one("SELECT current_database() AS db,current_setting('neon.branch_id',true) AS branch_id", []);
    if (row.db !== 'neondb' || typeof row.branch_id !== 'string' || createHash('sha256').update(row.branch_id).digest('hex') !== expectedFingerprint) throw new TeachStorageError('DATABASE_ERROR');
    const migration = await this.one(`SELECT version,name FROM ${this.table('teach_schema_migrations')} WHERE version=1`, []);
    if (migration.name !== 'teach_mode_v1') throw new TeachStorageError('DATABASE_ERROR');
  }
  async getOwnedSession(physicalId: string) {
    const rows = (await this.query(`SELECT * FROM ${this.table('teach_sessions')} WHERE device_identity_hash=$1 AND ownership_state IN ('HELD','RETAINED_PENDING_CLEANUP','ADMIN_DISPOSED_UNVERIFIED')`, [physicalId])).rows.filter(row=>row.ownership_state!=='ADMIN_DISPOSED_UNVERIFIED'||!(row.administrative_clearance as {successorSessionId?:string}|null)?.successorSessionId);
    if(rows.length>1)throw new TeachStorageError('PHYSICAL_IDENTITY_AMBIGUOUS');
    return rows[0]?session(rows[0]):undefined;
  }
  async administrativeSession(id:string){const row=await this.one(`SELECT s.*,(SELECT count(*)::int FROM ${this.table('recorded_actions')} a WHERE a.session_id=s.id) AS action_count,(SELECT count(*)::int FROM ${this.table('ui_snapshots')} u WHERE u.teach_session_id=s.id) AS snapshot_count FROM ${this.table('teach_sessions')} s WHERE s.id=$1`,[id]);
    if(!Array.isArray(row.administrative_audit)||!('administrative_clearance'in row))throw new TeachStorageError('DATABASE_ERROR');
    return {session:session(row),audit:row.administrative_audit,clearance:row.administrative_clearance===null?null:AdministrativeClearanceSchema.parse(row.administrative_clearance),recordedActions:Number(row.action_count),snapshots:Number(row.snapshot_count)};
  }
  async retireLegacy(id:string,revision:number,audit:LegacyRetirementAudit,clearance:AdministrativeClearance){
    const a=LegacyRetirementAuditSchema.parse(audit),c=AdministrativeClearanceSchema.parse(clearance);
    return this.transaction(async repository=>{const r=repository as PostgresTeachRepository;const current=await r.getSession(id);await r.assertConsent(current.deviceId);
      return session(await r.one(`SELECT * FROM ${r.table('teach_retire_with_clearance')}($1::uuid,$2,$3::jsonb,$4::jsonb)`,[id,revision,JSON.stringify(a),JSON.stringify(c)]));});
  }
  async admitAuthorizedFresh(id:string,revision:number,clearance:AdministrativeClearance,successorId:string,authenticationSha256:string){
    const c=AdministrativeClearanceSchema.parse(clearance);if(!/^[a-f0-9]{64}$/.test(authenticationSha256)||c.successorSessionId)throw new TeachStorageError('INVALID_PAYLOAD');
    return this.transaction(async repository=>{const r=repository as PostgresTeachRepository;const original=await r.getSession(id);await r.assertConsent(original.deviceId);
      return session(await r.one(`SELECT * FROM ${r.table('teach_admit_fresh')}($1::uuid,$2,$3::uuid,$4::uuid,$5,$6::uuid,$7)`,[id,revision,c.id,c.requestId,c.sourceSha256,successorId,authenticationSha256]));});
  }
  async reauthorizeAndAdmitFresh(id:string,revision:number,audit:ClearanceReauthorizationAudit,successorId:string){
    const a=ClearanceReauthorizationAuditSchema.parse(audit);
    if(!/^[0-9a-f-]{36}$/.test(successorId))throw new TeachStorageError('INVALID_PAYLOAD');
    return this.transaction(async repository=>{
      const r=repository as PostgresTeachRepository,current=await r.getSession(id);
      await r.assertConsent(current.deviceId);
      return session(await r.one(`SELECT * FROM ${r.table('teach_reauthorize_and_admit')}($1::uuid,$2,$3::jsonb,$4::uuid)`,[id,revision,JSON.stringify(a),successorId]));
    });
  }
  async getContinuation(id:string){return ContinuationAuditSchema.parse((await this.one(`SELECT audit FROM ${this.table('teach_continuations')} WHERE id=$1`,[id])).audit);}
  async assertContinuationReady(){
    const row=await this.one(`SELECT name,pg_catalog.to_regprocedure($1) IS NOT NULL AS installed,pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure($1),'EXECUTE') AS allowed FROM ${this.table('teach_schema_migrations')} WHERE version=4`,[`${this.table('teach_continue_and_admit')}(jsonb)`]);
    if(row.name!=='teach_continuation_v1'||row.installed!==true||row.allowed!==true)throw new TeachStorageError('DATABASE_ERROR');
  }
  async continuationPredecessor(parent:string,previous:string){
    const row=await this.one(`SELECT EXISTS(SELECT 1 FROM ${this.table('teach_sessions')} WHERE id=$1 AND administrative_clearance->>'successorSessionId'=$2) OR EXISTS(SELECT 1 FROM ${this.table('teach_continuations')} WHERE parent_id=$1 AND successor_id=$2::uuid) AS matched`,[parent,previous]);return row.matched===true;
  }
  async continueAndAdmitFresh(input:ContinuationAudit){const audit=ContinuationAuditSchema.parse(input);return this.transaction(async repository=>{const r=repository as PostgresTeachRepository;await r.assertConsent((await r.getSession(audit.binding.sessionId)).deviceId);return session(await r.one(`SELECT * FROM ${r.table('teach_continue_and_admit')}($1::jsonb)`,[JSON.stringify(audit)]));});}
  async assertReauthorizationReady(){
    const row=await this.one(`SELECT name,pg_catalog.to_regprocedure($1) IS NOT NULL AS installed,
      pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure($1),'EXECUTE') AS allowed
      FROM ${this.table('teach_schema_migrations')} WHERE version=3`,[`${this.table('teach_reauthorize_and_admit')}(uuid,integer,jsonb,uuid)`]);
    if(row.name!=='teach_clearance_reauthorization_v1'||row.installed!==true||row.allowed!==true)throw new TeachStorageError('DATABASE_ERROR');
  }
  private table(name: string) { return `"${this.schema}"."${name}"`; }
  private async query(sql: string, values: unknown[] = []) {
    try { return await (this.connection ?? this.database).query(sql, values); } catch (e) { throw teachStorageError(e); }
  }
  private async one(sql: string, values: unknown[], conflict = false): Promise<Row> {
    const result = await this.query(sql, values);
    if (result.rows.length !== 1 || conflict && result.rowCount !== 1) throw new TeachStorageError(conflict ? 'CONFLICT' : 'NOT_FOUND');
    return result.rows[0];
  }
  async transaction<T>(work: (repository: TeachRepository) => Promise<T>): Promise<T> {
    if (this.connection) return work(this);
    try { return await this.database.transaction(tx => work(new PostgresTeachRepository(this.database, this.schema, tx))); }
    catch (e) { throw teachStorageError(e); }
  }
  async assertConsent(deviceId?: string): Promise<void> {
    const r = await this.one(`SELECT ${this.table('teach_has_remote_consent')}($1::uuid, 'local-owner') AS allowed`, [deviceId ?? null]);
    if (r.allowed !== true) throw new TeachStorageError('NO_REMOTE_CONSENT');
  }
  async upsertDevice(input: DeviceRegistration): Promise<TeachDevice> {
    return this.transaction(async repository => {
      const r = repository as PostgresTeachRepository;
      // Short DB-only lock serializes registrations made through this repository; runtime locks are untouched.
      await r.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1))', [input.physicalId]);
      const rows = (await r.query(`SELECT * FROM ${r.table('devices')} WHERE physical_identity_hash=$1 FOR UPDATE`, [input.physicalId])).rows;
      if (rows.length > 1) throw new TeachStorageError('PHYSICAL_IDENTITY_AMBIGUOUS');
      await r.assertConsent(rows[0] ? String(rows[0].id) : undefined);
      const values = [input.serialHash, input.physicalId, input.model, input.manufacturer, input.androidVersion ?? null];
      if (!rows.length) return device(await r.one(`INSERT INTO ${r.table('devices')} (serial_hash,physical_identity_hash,model,manufacturer,android_version) VALUES ($1,$2,$3,$4,$5) RETURNING *`, values));
      return device(await r.one(`UPDATE ${r.table('devices')} SET serial_hash=$1,model=$3,manufacturer=$4,android_version=$5,last_seen_at=now() WHERE physical_identity_hash=$2 AND id=$6 RETURNING *`, [...values, rows[0].id]));
    });
  }
  async getDevice(id: string) { return device(await this.one(`SELECT * FROM ${this.table('devices')} WHERE id=$1`, [id])); }
  async createSession(deviceId: string, skillId?: string, command?: string) {
    await this.assertConsent(deviceId);
    return session(await this.one(`INSERT INTO ${this.table('teach_sessions')} (device_id,skill_id,original_command,status) VALUES ($1,$2,$3,'CREATED') RETURNING *`, [deviceId, skillId ?? null, command ?? null]));
  }
  async getSession(id: string) { return session(await this.one(`SELECT * FROM ${this.table('teach_sessions')} WHERE id=$1`, [id])); }
  async updateSession(id: string, revision: number, status: TeachSessionStatus, ownership: TeachOwnership, reason?: string, cleanupOnly = false) {
    const existing = await this.getSession(id);
    if (!cleanupOnly) await this.assertConsent(existing.deviceId);
    // cleanupOnly is an internal service path after a trusted cleanup callback, never a request flag.
    return session(await this.one(`UPDATE ${this.table('teach_sessions')} SET status=$3,ownership_state=$4,interrupted_reason=$5 WHERE id=$1 AND revision=$2 RETURNING *`, [id,revision,status,ownership,reason ?? null], true));
  }
  async insertSnapshot(sessionId: string, deviceId: string, semantics: SanitizedTeachSnapshot, assetRef?: string): Promise<TeachSnapshot> {
    await this.assertConsent(deviceId);
    const reason = semantics.redactionStatus === 'REDACTED' ? null : semantics.reasons.join(',');
    const row = await this.one(`INSERT INTO ${this.table('ui_snapshots')} (teach_session_id,device_id,ui_semantics,redaction_status,no_capture_reason,ui_metadata_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [sessionId,deviceId,JSON.stringify(semantics),semantics.redactionStatus,reason,assetRef ?? null]);
    return { id:String(row.id), sessionId:String(row.teach_session_id), deviceId:String(row.device_id), semantics:row.ui_semantics as SanitizedTeachSnapshot,
      redactionStatus:row.redaction_status as SanitizedTeachSnapshot['redactionStatus'], assetRef:row.ui_metadata_ref as string | null };
  }
  async insertAction(input: ActionInsert): Promise<TeachRecordedAction> {
    const owner = await this.getSession(input.sessionId); await this.assertConsent(owner.deviceId);
    const r = await this.one(`INSERT INTO ${this.table('recorded_actions')} (session_id,step_order,action_type,safe_args,semantic_target,input_template,before_snapshot_id,after_snapshot_id,no_snapshot_reason,receipt_status,diagnostic)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [input.sessionId,input.order,input.actionType,JSON.stringify(input.args),JSON.stringify(input.target),input.inputTemplate ?? null,input.beforeId ?? null,input.afterId ?? null,input.missingReason ?? null,input.receipt,JSON.stringify({operation:input.operation,...(input.runtime ? {runtime:input.runtime} : {})})]);
    return {id:String(r.id),sessionId:String(r.session_id),order:Number(r.step_order),operation:input.operation,receipt:r.receipt_status as TeachRecordedAction['receipt']};
  }
  async createSkill(definition: SkillDefinition) {
    await this.assertConsent();
    return skill(await this.one(`INSERT INTO ${this.table('skills')} (name,app_scope,owner_ref) VALUES ($1,$2,'local-owner') RETURNING *`, [definition.name,JSON.stringify([definition.appScope.alias])]));
  }
  async getSkill(id: string) { return skill(await this.one(`SELECT * FROM ${this.table('skills')} WHERE id=$1`, [id])); }
  async listSkills(): Promise<TeachSkillSummary[]> {
    const rows = (await this.query(`SELECT v.*, s.name AS skill_name, s.description, s.created_at AS skill_created_at
      FROM ${this.table('skills')} s JOIN ${this.table('skill_versions')} v ON v.id=s.current_version_id AND v.skill_id=s.id
      WHERE s.owner_ref='local-owner' AND s.status='DRAFT' AND v.status='DRAFT' ORDER BY s.created_at DESC, s.id`)).rows;
    return rows.map(row => ({ id: String(row.skill_id), name: String(row.skill_name), description: row.description === null ? null : String(row.description),
      version: Number(row.version_no), status: 'DRAFT', appScope: version(row).definition.appScope,
      createdAt: row.skill_created_at instanceof Date ? row.skill_created_at.toISOString() : String(row.skill_created_at) }));
  }
  async updateSkill(id: string, revision: number, name: string, description: string | null, versionId: string | null) {
    await this.assertConsent();
    return skill(await this.one(`UPDATE ${this.table('skills')} SET name=$3,description=$4,current_version_id=$5 WHERE id=$1 AND revision=$2 RETURNING *`, [id,revision,name,description,versionId], true));
  }
  async createVersion(skillId: string, number: number, definition: SkillDefinition, sessionId?: string) {
    await this.assertConsent();
    const r = await this.one(`INSERT INTO ${this.table('skill_versions')} (skill_id,version_no,workflow_json,parameter_schema,verification_schema,schema_version,compiler_version,source_session_id,status)
      VALUES ($1,$2,$3,$4,$5,1,'teach-rules-v1',$6,'DRAFT') RETURNING *`, [skillId,number,JSON.stringify(definition),JSON.stringify(definition.parameters),JSON.stringify({steps:definition.steps.map(s=>({id:s.id,verify:s.verify}))}),sessionId ?? null]);
    return version({...r,has_tests:false});
  }
  async getVersion(id: string, lock = false) {
    return version(await this.one(`SELECT v.*, EXISTS(SELECT 1 FROM ${this.table('skill_tests')} t WHERE t.skill_version_id=v.id) AS has_tests FROM ${this.table('skill_versions')} v WHERE v.id=$1${lock ? ' FOR UPDATE OF v' : ''}`, [id]));
  }
  async getVersionByNumber(skillId: string, number: number) {
    return version(await this.one(`SELECT v.*, EXISTS(SELECT 1 FROM ${this.table('skill_tests')} t WHERE t.skill_version_id=v.id) AS has_tests
      FROM ${this.table('skill_versions')} v JOIN ${this.table('skills')} s ON s.id=v.skill_id
      WHERE v.skill_id=$1 AND v.version_no=$2 AND s.owner_ref='local-owner'`, [skillId, number]));
  }
  async replaceDefinition(id: string, revision: number, definition: SkillDefinition) {
    await this.assertConsent(); const old = await this.getVersion(id, true);
    if (old.hasTests) throw new TeachStorageError('VERSION_HAS_TESTS');
    if (!['DRAFT','PENDING_VALIDATION'].includes(old.status)) throw new TeachStorageError('IMMUTABLE');
    const r = await this.one(`UPDATE ${this.table('skill_versions')} SET workflow_json=$3,parameter_schema=$4,verification_schema=$5 WHERE id=$1 AND revision=$2 RETURNING *`, [id,revision,JSON.stringify(definition),JSON.stringify(definition.parameters),JSON.stringify({steps:definition.steps.map(s=>({id:s.id,verify:s.verify}))})], true);
    return version({...r,has_tests:false});
  }
  async transitionVersion(id: string, revision: number, status: TeachVersionStatus) {
    await this.assertConsent();
    const r = await this.one(`UPDATE ${this.table('skill_versions')} SET status=$3 WHERE id=$1 AND revision=$2 RETURNING *`, [id,revision,status], true);
    return version({...r,has_tests:(await this.getVersion(id)).hasTests});
  }
  async createExecution(deviceId: string, versionId: string, runtimeDigest: string): Promise<TeachExecution> {
    await this.assertConsent(deviceId);
    const r = await this.one(`INSERT INTO ${this.table('executions')} (device_id,skill_version_id,engine,status,runtime_digest) VALUES ($1,$2,'UNIFIED_V2','PLANNED',$3) RETURNING *`, [deviceId,versionId,runtimeDigest]);
    return {id:String(r.id),deviceId:String(r.device_id),versionId:String(r.skill_version_id),status:String(r.status),runtimeDigest:String(r.runtime_digest)};
  }
  async insertOfflineTest(versionId: string, deviceId: string, result: TeachTest['result'], executionId?: string): Promise<TeachTest> {
    await this.assertConsent(deviceId); await this.getVersion(versionId,true);
    const r = await this.one(`INSERT INTO ${this.table('skill_tests')} (skill_version_id,device_id,execution_id,test_kind,result,verifier_name,independently_verified) VALUES ($1,$2,$3,'OFFLINE',$4,'TEACH_OFFLINE_TEST',false) RETURNING *`, [versionId,deviceId,executionId ?? null,result]);
    return {id:String(r.id),versionId:String(r.skill_version_id),deviceId:String(r.device_id),result:r.result as TeachTest['result']};
  }
  async purgeExpired(): Promise<string[]> {
    const r = await this.query(`SELECT asset_ref FROM ${this.table('teach_purge_expired')}()`);
    return r.rows.map(row=>String(row.asset_ref));
  }
}
