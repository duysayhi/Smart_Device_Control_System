import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseSkillStructure, type SkillDefinition } from './skill-schema';
import { validateSkill } from './skill-validator';
import { inspectJson, sensitiveMetadata, sensitiveValue } from './skill-safety';
import { sanitizeSnapshot, SanitizedTeachSnapshotSchema } from './snapshot-sanitizer';
import { compileSkill, parseDemonstration } from './skill-compiler';
import type { ActionInsert, TeachRepository, TeachSession } from './teach-repository';
import { TeachAssetStore } from './teach-assets';
import { TeachStorageError, teachStorageError } from './db/teach-errors';

const id = z.uuid(), revision = z.number().int().min(1);
const safe = (max: number) => z.string().min(1).max(max).refine(s=>!sensitiveValue(s));
const device = z.object({ serial:z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/),hardwareSerial:z.string().regex(/^[A-Za-z0-9._-]{5,128}$/).refine(s=>!/^(unknown|null|none|0+|1234567890)$/i.test(s)),model:safe(120),manufacturer:safe(120),androidVersion:safe(40).optional() }).strict();
const createSession = z.object({device,skillId:id.optional(),command:safe(500).optional()}).strict();
const transition = z.object({sessionId:id,revision,status:z.enum(['RECORDING','REVIEWING','COMPILED','FINISHED','INTERRUPTED','CANCELLED','FAILED','EXPIRED'])}).strict();
const snapshot = z.object({sessionId:id,liveNodes:z.unknown(),persistAsset:z.boolean().default(false)}).strict();
const action = z.object({sessionId:id,order:z.number().int().min(1),definition:z.unknown(),stepId:z.string().min(1).max(64),receipt:z.enum(['ACK','NOT_SENT','UNKNOWN']),beforeId:id.optional(),afterId:id.optional(),missingReason:z.enum(['NOT_CAPTURED','CAPTURE_SAFETY_UNKNOWN','SENSITIVE_CONTENT_OMITTED']).optional()}).strict();
const versionInput = z.object({skillId:id,version:z.number().int().min(1),definition:z.unknown(),sessionId:id.optional()}).strict();
function parse<S extends z.ZodType>(schema: S, input: unknown, live = false): z.output<S> {
  if (inspectJson(input,!live).errors.length) throw new TeachStorageError('INVALID_PAYLOAD');
  const result = schema.safeParse(input); if (!result.success) throw new TeachStorageError('INVALID_PAYLOAD'); return result.data;
}
function definition(input: unknown): SkillDefinition {
  if (!validateSkill(input).ok) throw new TeachStorageError('INVALID_PAYLOAD');
  const result = parseSkillStructure(input); if (!result.success) throw new TeachStorageError('INVALID_PAYLOAD'); return result.data;
}
const actionTypes: Record<SkillDefinition['steps'][number]['operation'],string> = {OPEN_APPLICATION:'OPEN_APP',ACTIVATE_CONTROL:'TAP_ELEMENT',INPUT_TEXT:'INPUT_TEXT',SUBMIT_SEARCH:'PRESS_KEY',OBSERVE_UI:'WAIT_FOR_STATE',ASSERT_UI:'WAIT_FOR_STATE',SCROLL_CONTAINER:'SCROLL_ELEMENT',BACK:'PRESS_KEY'};
export interface TeachStorageOptions {
  workspaceRoot: string;
  /** Backend-only cleanup inspection. It runs outside SQL transactions; default is fail-closed. */
  cleanupVerified?: (session: Readonly<TeachSession>) => Promise<boolean>;
}

/** Storage only. No recorder, execution loop, worker call, model, migration or automatic connection. */
export class TeachStorageService {
  private readonly assets: TeachAssetStore;
  private retention?: ReturnType<typeof setInterval>;
  private purging = false;
  constructor(private readonly repository: TeachRepository, private readonly options: TeachStorageOptions) { this.assets=new TeachAssetStore(options.workspaceRoot); }
  private async guard<T>(work:()=>Promise<T>): Promise<T> { try { return await work(); } catch(e) { throw teachStorageError(e); } }
  async createSession(input: unknown) {
    const data = parse(createSession,input), d=data.device;
    // Same canonical tuple and prefix as transport-identity.ts, without invoking Android.
    const physicalId = 'android:' + createHash('sha256').update(JSON.stringify([d.hardwareSerial,d.manufacturer,d.model])).digest('hex');
    const serialHash = createHash('sha256').update(d.serial).digest('hex');
    return this.guard(()=>this.repository.transaction(async r=>{
      const row = await r.upsertDevice({physicalId,serialHash,model:d.model,manufacturer:d.manufacturer,androidVersion:d.androidVersion});
      return r.createSession(row.id,data.skillId,data.command);
    }));
  }
  async transitionSession(input: unknown) {
    const data=parse(transition,input);
    return this.guard(()=>this.repository.transaction(async r=>{
      const old=await r.getSession(data.sessionId);
      if(old.revision!==data.revision)throw new TeachStorageError('CONFLICT');
      const ownership=data.status==='RECORDING'?'HELD':data.status==='INTERRUPTED'?'RETAINED_PENDING_CLEANUP':old.ownership;
      return r.updateSession(old.id,data.revision,data.status,ownership,data.status==='INTERRUPTED'?'CONNECTION_INTERRUPTED':old.interruptedReason??undefined);
    }));
  }
  async releaseAfterCleanup(input: unknown) {
    const data=parse(z.object({sessionId:id,revision}).strict(),input);
    const before=await this.guard(()=>this.repository.getSession(data.sessionId));
    if(before.revision!==data.revision)throw new TeachStorageError('CONFLICT');
    if(!this.options.cleanupVerified || !await this.guard(()=>this.options.cleanupVerified!(Object.freeze({...before}))))throw new TeachStorageError('CLEANUP_UNPROVEN');
    return this.guard(()=>this.repository.transaction(async r=>{
      let current=await r.getSession(before.id);
      if(current.revision!==data.revision || current.physicalId!==before.physicalId)throw new TeachStorageError('CONFLICT');
      if(!['HELD','RETAINED_PENDING_CLEANUP'].includes(current.ownership))throw new TeachStorageError('CLEANUP_UNPROVEN');
      if(current.status==='RECORDING')current=await r.updateSession(current.id,current.revision,'INTERRUPTED','RETAINED_PENDING_CLEANUP','SESSION_CLEANUP',true);
      return r.updateSession(current.id,current.revision,current.status,'RELEASED',current.interruptedReason??undefined,true);
    }));
  }
  async storeSnapshot(input: unknown) {
    const data=parse(snapshot,input,true), semantics=sanitizeSnapshot(data.liveNodes);
    if(inspectJson(semantics).errors.length)throw new TeachStorageError('INVALID_PAYLOAD');
    const owner=await this.guard(()=>this.repository.getSession(data.sessionId));
    await this.guard(()=>this.repository.assertConsent(owner.deviceId));
    // No screenshot or raw XML path; the optional asset contains only sanitized structural JSON.
    let assetRef: string | undefined;
    if(data.persistAsset && semantics.redactionStatus==='REDACTED')assetRef=await this.assets.write(semantics);
    try { return await this.guard(()=>this.repository.transaction(r=>r.insertSnapshot(owner.id,owner.deviceId,semantics,assetRef))); }
    catch(e) { if(assetRef)await this.assets.remove(assetRef); throw e; }
  }
  async recordAction(input: unknown) {
    const data=parse(action,input), skill=definition(data.definition), step=skill.steps.find(s=>s.id===data.stepId);
    if(!step)throw new TeachStorageError('INVALID_PAYLOAD');
    if((!data.beforeId || !data.afterId) && !data.missingReason)throw new TeachStorageError('SNAPSHOT_REQUIRED');
    const insert:ActionInsert={sessionId:data.sessionId,order:data.order,actionType:actionTypes[step.operation],operation:step.operation,args:step.arguments,
      target:'target' in step.arguments?step.arguments.target:{},receipt:data.receipt,beforeId:data.beforeId,afterId:data.afterId,missingReason:data.missingReason,
      ...(step.operation==='INPUT_TEXT'?{inputTemplate:typeof step.arguments.value==='string'?step.arguments.value:JSON.stringify(step.arguments.value)}:{})};
    return this.guard(()=>this.repository.transaction(r=>r.insertAction(insert)));
  }
  async createDraft(input: unknown) {
    const data=parse(z.object({definition:z.unknown(),sessionId:id.optional(),description:safe(500).optional()}).strict(),input), skill=definition(data.definition);
    return this.guard(()=>this.repository.transaction(async r=>{
      const row=await r.createSkill(skill), version=await r.createVersion(row.id,1,skill,data.sessionId);
      const linked=await r.updateSkill(row.id,row.revision,row.name,data.description ?? row.description,version.id);
      if (data.sessionId) {
        const source = await r.getSession(data.sessionId);
        if (source.status === 'COMPILED' && source.ownership === 'RELEASED') await r.updateSession(source.id,source.revision,'FINISHED','RELEASED');
      }
      return {skill:linked,version};
    }));
  }
  /** Internal receipt ingestion. Public routes never accept receipt/snapshot fields from clients. */
  async recordObservedAction(input: unknown) {
    const runtime = z.object({ receiptId:id, executionId:id, sessionIdentity:z.string().min(1).max(200), physicalId:z.string().regex(/^android:[a-f0-9]{64}$/),
      beforeObservationId:id, afterObservationId:id.optional(), result:z.enum(['PASSED','FAILED','UNVERIFIED']), evidenceId:id.optional() }).strict();
    const data = parse(z.object({ sessionId:id, name:safe(120), appAlias:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), actions:z.array(z.unknown()).min(1).max(20),
      receipt:z.enum(['ACK','NOT_SENT','UNKNOWN']), before:SanitizedTeachSnapshotSchema, after:SanitizedTeachSnapshotSchema.optional(), runtime }).strict(), input);
    const demonstration = parseDemonstration({name:data.name,appAlias:data.appAlias,actions:data.actions});
    if (!demonstration || compileSkill(demonstration).status === 'REJECTED') throw new TeachStorageError('INVALID_PAYLOAD');
    const action = demonstration.actions.at(-1)!;
    const { operation, ...args } = action;
    const target = 'target' in action ? action.target : {};
    if (operation === 'INPUT_TEXT') (args as {value:unknown}).value = {param:'query'};
    return this.guard(()=>this.repository.transaction(async r=>{
      const session = await r.getSession(data.sessionId);
      if (session.status !== 'RECORDING' || session.physicalId !== data.runtime.physicalId) throw new TeachStorageError('NOT_RECORDING');
      const before = await r.insertSnapshot(session.id,session.deviceId,data.before);
      const after = data.after ? await r.insertSnapshot(session.id,session.deviceId,data.after) : undefined;
      return r.insertAction({sessionId:session.id,order:demonstration.actions.length,operation,actionType:actionTypes[operation],args,target,receipt:data.receipt,
        beforeId:before.id,afterId:after?.id,...(!after?{missingReason:'NOT_CAPTURED'}:{}),
        ...(operation==='INPUT_TEXT'?{inputTemplate:'{{query}}'}:{}),runtime:data.runtime});
    }));
  }
  async createVersion(input: unknown) {
    const data=parse(versionInput,input), skill=definition(data.definition);
    return this.guard(()=>this.repository.transaction(r=>r.createVersion(data.skillId,data.version,skill,data.sessionId)));
  }
  async replaceDefinition(input: unknown) {
    const data=parse(z.object({versionId:id,revision,definition:z.unknown()}).strict(),input), skill=definition(data.definition);
    return this.guard(()=>this.repository.transaction(r=>r.replaceDefinition(data.versionId,data.revision,skill)));
  }
  async updateSkill(input: unknown) {
    const data=parse(z.object({skillId:id,revision,name:safe(120),description:safe(500).nullable(),currentVersionId:id.nullable()}).strict(),input);
    if(sensitiveMetadata(data.name))throw new TeachStorageError('INVALID_PAYLOAD');
    return this.guard(()=>this.repository.transaction(r=>r.updateSkill(data.skillId,data.revision,data.name,data.description,data.currentVersionId)));
  }
  async transitionVersion(input: unknown) {
    // Evidence-bearing promotion is reserved for the later, owner-approved runtime seam.
    const data=parse(z.object({versionId:id,revision,status:z.enum(['DRAFT','PENDING_VALIDATION','REJECTED','DISABLED','DEPRECATED'])}).strict(),input);
    return this.guard(()=>this.repository.transaction(r=>r.transitionVersion(data.versionId,data.revision,data.status)));
  }
  async createExecution(input: unknown) {
    const data=parse(z.object({deviceId:id,versionId:id,runtimeDigest:z.string().regex(/^[0-9a-f]{64}$/)}).strict(),input);
    return this.guard(()=>this.repository.transaction(async r=>{await r.getDevice(data.deviceId);await r.getVersion(data.versionId);return r.createExecution(data.deviceId,data.versionId,data.runtimeDigest);}));
  }
  async recordOfflineTest(input: unknown) {
    const data=parse(z.object({deviceId:id,versionId:id,executionId:id.optional(),result:z.enum(['PASSED','FAILED','BLOCKED','UNVERIFIED'])}).strict(),input);
    return this.guard(()=>this.repository.transaction(async r=>{await r.getDevice(data.deviceId);await r.getVersion(data.versionId,true);return r.insertOfflineTest(data.versionId,data.deviceId,data.result,data.executionId);}));
  }
  async getVersion(versionId: string) { const value=parse(id,versionId);return this.guard(()=>this.repository.getVersion(value)); }
  async listSkills() { return this.guard(()=>this.repository.listSkills()); }
  async getVersionByNumber(skillId: string, version: number) {
    const data=parse(z.object({skillId:id,version:z.number().int().min(1).max(1000)}).strict(),{skillId,version});
    return this.guard(()=>this.repository.getVersionByNumber(data.skillId,data.version));
  }
  async getSession(sessionId: string) { const value=parse(id,sessionId);return this.guard(()=>this.repository.getSession(value)); }
  async purgeExpired() {
    if(this.purging)return {skipped:true,removed:0,missing:0,blocked:0};
    this.purging=true;
    try {
      const refs=await this.guard(()=>this.repository.purgeExpired());let removed=0,missing=0,blocked=0;
      for(const ref of new Set(refs)) {try {if(await this.assets.remove(ref))removed++;else missing++;}catch{blocked++;}}
      return {skipped:false,removed,missing,blocked};
    } finally {this.purging=false;}
  }
  startRetention(intervalMs=60000,onError?:(error:TeachStorageError)=>void) {
    if(this.retention || !Number.isInteger(intervalMs) || intervalMs<1000 || intervalMs>86400000)throw new TeachStorageError('INVALID_PAYLOAD');
    this.retention=setInterval(()=>{void this.purgeExpired().catch(e=>onError?.(teachStorageError(e)));},intervalMs);this.retention.unref();
  }
  stopRetention() {if(this.retention)clearInterval(this.retention);this.retention=undefined;}
}
