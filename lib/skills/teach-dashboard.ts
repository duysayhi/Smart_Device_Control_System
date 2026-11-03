import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { compileSkill, type SkillCompilation } from './skill-compiler';
import { inspectJson, sensitiveMetadata, sensitiveValue } from './skill-safety';
import { parseSkillStructure, type SkillDefinition } from './skill-schema';
import { validateSkill } from './skill-validator';
import { TeachStorageService } from './teach-storage-service';
import { TeachStorageError, teachStorageError } from './db/teach-errors';
import type { TeachRepository, TeachSession, TeachSkill, TeachVersion } from './teach-repository';

const uuid = z.uuid();
const safeText = (max: number) => z.string().trim().min(1).max(max).refine(s => !sensitiveValue(s) && !sensitiveMetadata(s));
const alias = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const target = z.object({ semanticRole: z.enum(['navigation', 'search_action', 'search_field', 'search_results', 'scroll_container', 'dialog', 'status']),
  label: safeText(120), containerRole: z.enum(['app', 'toolbar', 'navigation', 'search', 'results', 'dialog']),
  resourceIdHint: z.string().regex(/^[A-Za-z0-9_:/.-]{1,160}$/).optional() }).strict();
const action = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('OPEN_APPLICATION'), appRef: alias }).strict(),
  z.object({ operation: z.literal('ACTIVATE_CONTROL'), target, purpose: z.enum(['NAVIGATION', 'SEARCH']).optional() }).strict(),
  z.object({ operation: z.literal('INPUT_TEXT'), target, value: safeText(500) }).strict(),
  z.object({ operation: z.literal('SUBMIT_SEARCH') }).strict(),
  z.object({ operation: z.enum(['OBSERVE_UI', 'ASSERT_UI']), predicate: z.unknown() }).strict(),
  z.object({ operation: z.literal('SCROLL_CONTAINER'), target, direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']), maxAttempts: z.number().int().min(1).max(5) }).strict(),
  z.object({ operation: z.literal('BACK'), reason: z.enum(['DISMISS_BENIGN', 'SEARCH_RECOVERY']) }).strict(),
]);
export type DeclaredAction = z.infer<typeof action>;
const createInput = z.object({ deviceId: uuid, command: safeText(500), name: safeText(120), appAlias: alias }).strict();
const revisionInput = z.object({ revision: z.number().int().min(1) }).strict();
const actionInput = revisionInput.extend({ action }).strict();
const parameterName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(s => !sensitiveMetadata(s));
const saveInput = z.object({ reference: uuid, confirmed: z.literal(true), name: safeText(120), description: safeText(500).optional(),
  parameterNames: z.record(parameterName, parameterName) }).strict();
type SaveInput = z.infer<typeof saveInput>;
export interface OfflineTeachConfiguration {
  mode: 'OFFLINE_TEST'; workspaceRoot: string; consentGranted: boolean;
  devices: readonly { id: string; label: string }[];
}
/** Server-only dependency injection. No connection or environment lookup occurs here. */
export interface TeachDraftPersistence { mode: 'PGLITE_TEST' | 'POSTGRESQL'; repository: TeachRepository; cleanupVerified?: (session: Readonly<TeachSession>) => Promise<boolean> }
interface Declaration {
  id: string; deviceId: string; name: string; appAlias: string; revision: number;
  status: 'CREATED' | 'RECORDING' | 'REVIEWING' | 'COMPILED' | 'FINISHED';
  actions: DeclaredAction[]; compilation?: SkillCompilation; reviewReference?: string;
  sourceSessionId?: string;
  saving?: { binding: string; promise: Promise<Awaited<ReturnType<OfflineTeachDashboard['versionView']>>> };
}
interface DraftState { skills: Map<string, TeachSkill>; versions: Map<string, TeachVersion>; dates: Map<string, string> }
const clone = <T>(value: T): T => structuredClone(value);
function invalid(): never { throw new TeachStorageError('INVALID_PAYLOAD'); }
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  if (inspectJson(value).errors.length) invalid();
  const parsed = schema.safeParse(value); if (!parsed.success) invalid(); return parsed.data;
}

/** Only the draft subset of the existing repository contract is implemented.
 * No SQL/hash/evidence generation, runtime receipts, device identity or connections. */
function offlineDraftRepository(configuration: OfflineTeachConfiguration) {
  let state: DraftState = { skills: new Map(), versions: new Map(), dates: new Map() };
  let queue: Promise<unknown> = Promise.resolve();
  const unsupported = async (): Promise<never> => { throw new TeachStorageError('INVALID_TRANSITION'); };
  function adapter(view: () => DraftState): TeachRepository {
    const consent = async () => { if (!configuration.consentGranted) throw new TeachStorageError('NO_REMOTE_CONSENT'); };
    const find = <T>(map: Map<string, T>, id: string): T => { const row = map.get(id); if (!row) throw new TeachStorageError('NOT_FOUND'); return clone(row); };
    return {
      async transaction(work) {
        const pending = queue.then(async () => {
          const draft = clone(state), result = await work(adapter(() => draft)); state = draft; return result;
        });
        queue = pending.catch(() => undefined); return pending;
      },
      assertConsent: consent,
      async createSkill(definition) {
        await consent();
        const row: TeachSkill = { id: randomUUID(), name: definition.name, description: null, currentVersionId: null, revision: 1 };
        view().skills.set(row.id, row); view().dates.set(row.id, new Date().toISOString()); return clone(row);
      },
      async getSkill(id) { return find(view().skills, id); },
      async listSkills() {
        return [...view().skills.values()].map(row => ({ id: row.id, name: row.name, description: row.description,
          version: 1, status: 'DRAFT' as const, appScope: clone(find(view().versions, row.currentVersionId!).definition.appScope),
          createdAt: view().dates.get(row.id)! }));
      },
      async createVersion(skillId, version, definition) {
        await consent(); find(view().skills, skillId);
        if ([...view().versions.values()].some(v => v.skillId === skillId && v.version === version)) throw new TeachStorageError('CONFLICT');
        // Empty hash is intentional: this offline fake has no DB attestation.
        const row: TeachVersion = { id: randomUUID(), skillId, version, definition: clone(definition), status: 'DRAFT', revision: 1,
          contentHash: '', evidenceLevel: 'COMPILED', hasTests: false };
        view().versions.set(row.id, row); return clone(row);
      },
      async getVersion(id) { return find(view().versions, id); },
      async getVersionByNumber(skillId, number) {
        const row = [...view().versions.values()].find(v => v.skillId === skillId && v.version === number);
        if (!row) throw new TeachStorageError('NOT_FOUND'); return clone(row);
      },
      async updateSkill(id, revision, name, description, versionId) {
        await consent(); const row = find(view().skills, id);
        if (row.revision !== revision) throw new TeachStorageError('CONFLICT');
        if (versionId && find(view().versions, versionId).skillId !== id) throw new TeachStorageError('CURRENT_VERSION_MISMATCH');
        const updated = { ...row, name, description, currentVersionId: versionId, revision: revision + 1 };
        view().skills.set(id, updated); return clone(updated);
      },
      upsertDevice: unsupported, getDevice: unsupported, createSession: unsupported, getSession: unsupported,
      updateSession: unsupported, insertSnapshot: unsupported, insertAction: unsupported, replaceDefinition: unsupported,
      transitionVersion: unsupported, createExecution: unsupported, insertOfflineTest: unsupported, purgeExpired: unsupported,
    };
  }
  return { repository: adapter(() => state), state: () => state };
}

/** Form declarations are deliberately separate from teach_sessions/recorded_actions receipts. */
export class OfflineTeachDashboard {
  readonly mode: 'OFFLINE_TEST_STORAGE' | 'PGLITE_TEST_STORAGE' | 'POSTGRESQL_STORAGE';
  private readonly configuration: OfflineTeachConfiguration;
  private readonly sessions = new Map<string, Declaration>();
  private readonly drafts?: ReturnType<typeof offlineDraftRepository>;
  private readonly repository: TeachRepository;
  private readonly storage: TeachStorageService;
  constructor(configuration: OfflineTeachConfiguration, persistence?: TeachDraftPersistence) {
    if (configuration.mode !== 'OFFLINE_TEST' || !configuration.devices.length) invalid();
    this.configuration = clone(configuration);
    for (const d of configuration.devices) { parse(uuid, d.id); parse(safeText(120), d.label); }
    if (new Set(configuration.devices.map(d => d.id)).size !== configuration.devices.length) invalid();
    if (persistence && !['PGLITE_TEST', 'POSTGRESQL'].includes(persistence.mode)) invalid();
    this.mode = persistence ? persistence.mode === 'PGLITE_TEST' ? 'PGLITE_TEST_STORAGE' : 'POSTGRESQL_STORAGE' : 'OFFLINE_TEST_STORAGE';
    this.drafts = persistence ? undefined : offlineDraftRepository(this.configuration);
    this.repository = persistence ? persistence.repository : this.drafts!.repository;
    this.storage = new TeachStorageService(this.repository, { workspaceRoot: configuration.workspaceRoot, cleanupVerified: persistence?.cleanupVerified });
  }
  /** Server composition only; not a public request endpoint or alternative repository. */
  recordingPersistence() { return { repository: this.repository, storage: this.storage }; }
  async prepareRecordedReview(input: { sourceSessionId: string; name: string; appAlias: string; actions: DeclaredAction[] }) {
    const source = await this.storage.getSession(input.sourceSessionId);
    if (source.status !== 'COMPILED' || source.ownership !== 'RELEASED' || this.sessions.size >= 100) throw new TeachStorageError('INVALID_TRANSITION');
    const compilation = compileSkill({ name: input.name, appAlias: input.appAlias, actions: input.actions });
    if (compilation.status !== 'DRAFT' || !compilation.draft) throw new TeachStorageError('INVALID_PAYLOAD');
    const session: Declaration = { id: randomUUID(), deviceId: source.deviceId, name: input.name, appAlias: input.appAlias,
      revision: 1, status: 'COMPILED', actions: structuredClone(input.actions), compilation, reviewReference: randomUUID(), sourceSessionId: source.id };
    this.sessions.set(session.id, session);
    return { saveSessionId: session.id, reference: session.reviewReference, compilation: clone(compilation), origin: 'RECORDED' as const };
  }
  private consent() { if (!this.configuration.consentGranted) throw new TeachStorageError('NO_REMOTE_CONSENT'); }
  private session(id: string) {
    parse(uuid, id); const session = this.sessions.get(id); if (!session) throw new TeachStorageError('NOT_FOUND'); return session;
  }
  private requireRevision(session: Declaration, input: unknown) {
    const data = parse(revisionInput, input); if (session.revision !== data.revision) throw new TeachStorageError('CONFLICT');
  }
  fixtures() { return { storageMode: this.mode, devices: clone(this.configuration.devices), persistence: this.mode === 'POSTGRESQL_STORAGE' ? 'POSTGRESQL_DATABASE' : 'MEMORY_ONLY_UNTIL_PROCESS_RESTART' }; }
  private view(session: Declaration) {
    if (session.sourceSessionId) return { id: session.id, deviceId: session.deviceId, revision: session.revision, status: session.status, storageMode: this.mode,
      actions: [], origin: 'RECORDED_REVIEW_ONLY', sourceSessionId: session.sourceSessionId };
    const ambiguous = new Set(session.compilation?.review.map(r => Number(r.path.split('/')[2])) ?? []);
    return { id: session.id, deviceId: session.deviceId, revision: session.revision, status: session.status, storageMode: this.mode,
      actions: session.actions.map((a, index) => ({ id: 's' + (index + 1), order: index + 1, operation: a.operation,
        target: 'target' in a ? clone(a.target) : undefined,
        input: a.operation === 'INPUT_TEXT' ? 'SEARCH_QUERY_SAMPLE_OMITTED' : undefined,
        declarationStatus: ambiguous.has(index) ? 'AMBIGUOUS' : 'DECLARED', dispatchStatus: 'NOT_DISPATCHED' as const })) };
  }
  create(input: unknown) {
    this.consent(); const data = parse(createInput, input);
    if (!this.configuration.devices.some(d => d.id === data.deviceId)) throw new TeachStorageError('NOT_FOUND');
    if (this.sessions.size >= 100) throw new TeachStorageError('CONFLICT');
    // The sample command is validated but not retained or returned; it is not executable code.
    const session: Declaration = { id: randomUUID(), deviceId: data.deviceId, name: data.name, appAlias: data.appAlias,
      revision: 1, status: 'CREATED', actions: [] };
    this.sessions.set(session.id, session); return this.view(session);
  }
  start(id: string, input: unknown) {
    this.consent(); const session = this.session(id); this.requireRevision(session, input);
    if (session.status !== 'CREATED') throw new TeachStorageError('INVALID_TRANSITION');
    session.status = 'RECORDING'; session.revision++; return this.view(session);
  }
  add(id: string, input: unknown) {
    this.consent(); const session = this.session(id), data = parse(actionInput, input);
    if (session.revision !== data.revision) throw new TeachStorageError('CONFLICT');
    if (session.status !== 'RECORDING') throw new TeachStorageError('NOT_RECORDING');
    const actions = [...session.actions, clone(data.action)];
    const compilation = compileSkill({ name: session.name, appAlias: session.appAlias, actions });
    if (compilation.status === 'REJECTED') invalid();
    session.actions = actions; session.compilation = compilation; session.revision++; return this.view(session);
  }
  finish(id: string, input: unknown) {
    this.consent(); const session = this.session(id); this.requireRevision(session, input);
    if (session.status !== 'RECORDING' || !session.actions.length) throw new TeachStorageError('INVALID_TRANSITION');
    session.status = 'REVIEWING'; session.revision++; return this.view(session);
  }
  compile(id: string, input: unknown) {
    this.consent(); const session = this.session(id); this.requireRevision(session, input);
    if (!['REVIEWING', 'COMPILED'].includes(session.status)) throw new TeachStorageError('INVALID_TRANSITION');
    const result = compileSkill({ name: session.name, appAlias: session.appAlias, actions: session.actions });
    if (result.status === 'REJECTED') invalid();
    session.compilation = result; session.revision++;
    if (result.status !== 'DRAFT' || !result.draft) return { session: this.view(session), compilation: clone(result) };
    session.status = 'COMPILED'; session.reviewReference = randomUUID();
    return { session: this.view(session), reference: session.reviewReference, compilation: clone(result) };
  }
  private reviewedDefinition(draft: SkillDefinition, input: SaveInput) {
    const definition = clone(draft), names = input.parameterNames;
    if (Object.keys(names).some(key => !(key in draft.parameters))) invalid();
    definition.name = input.name;
    const parameters: SkillDefinition['parameters'] = {};
    for (const [key, value] of Object.entries(draft.parameters)) {
      const renamed = names[key] ?? key; if (renamed in parameters) invalid(); parameters[renamed] = value;
    }
    definition.parameters = parameters;
    function rename(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(rename);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        (key === 'param' || key === 'labelParam') && typeof child === 'string' ? names[child] ?? child : rename(child)]));
    }
    definition.steps = rename(definition.steps) as SkillDefinition['steps'];
    const checked = parseSkillStructure(definition); if (!checked.success || !validateSkill(checked.data).ok) invalid();
    return checked.data;
  }
  save(id: string, input: unknown) {
    this.consent(); const session = this.session(id), data = parse(saveInput, input);
    if (session.reviewReference !== data.reference || !session.compilation?.draft) throw new TeachStorageError('CONFLICT');
    const definition = this.reviewedDefinition(session.compilation.draft, data);
    const binding = JSON.stringify([definition, data.description ?? null]);
    if (session.saving) {
      if (session.saving.binding !== binding) throw new TeachStorageError('CONFLICT');
      return session.saving.promise.then(clone);
    }
    if (session.status !== 'COMPILED' || this.drafts && this.drafts.state().skills.size >= 100) throw new TeachStorageError('INVALID_TRANSITION');
    // Reserve the operation before await; repeated/concurrent saves never create a second draft.
    const promise = Promise.resolve().then(async () => {
      let committed = false;
      try {
        const saved = await this.storage.createDraft({ definition, ...(data.description ? { description: data.description } : {}), ...(session.sourceSessionId ? { sessionId: session.sourceSessionId } : {}) });
        committed = true;
        const result = await this.versionView(saved.skill.id, saved.version.version);
        session.status = 'FINISHED'; session.revision++; return result;
      } catch (cause) {
        // A lost COMMIT/readback response must never trigger another createDraft.
        throw committed ? new TeachStorageError('SAVE_OUTCOME_UNKNOWN') : teachStorageError(cause);
      }
    });
    session.saving = { binding, promise }; return promise.then(clone);
  }
  list() {
    // Preserve the synchronous G1 memory API. PostgreSQL reads use listSkills below.
    const drafts = this.drafts;
    if (!drafts) throw new TeachStorageError('INVALID_TRANSITION');
    return { storageMode: this.mode, skills: [...drafts.state().skills.values()].map(skill => ({ id: skill.id, name: skill.name,
      description: skill.description, version: 1, status: 'DRAFT' as const,
      appScope: drafts.state().versions.get(skill.currentVersionId!)!.definition.appScope,
      createdAt: drafts.state().dates.get(skill.id) })) };
  }
  async listSkills() { return this.drafts ? this.list() : { storageMode: this.mode, skills: await this.storage.listSkills() }; }
  async versionView(skillId: string, version: number) {
    parse(uuid, skillId); parse(z.number().int().min(1).max(1000), version);
    const stored = await this.storage.getVersionByNumber(skillId, version), skill = await this.repository.getSkill(skillId);
    return { storageMode: this.mode, skillId, version, status: stored.status, description: skill.description, definition: stored.definition };
  }
}
