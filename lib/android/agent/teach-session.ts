import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';
import { GroundedInteractionFailure } from '../grounded-interactions';
import { deviceReadiness } from './device-readiness';
import { generateGroundedCandidates, issueObservedTeachScroll, type GroundedCandidateV2 } from './grounded-candidates-v2';
import { observedAffordances } from './ui-affordances';
import { foldIntent } from './outcome-spec';
import { beginSearch, closeSearch, isScopedSearchField, searchTransitionSatisfied, type SearchScope } from './generic-search';
import { issueEffectGrant } from './effect-grants';
import { verifyPredicate, verifySearchOutcome } from './verification-registry';
import type { VerifiedEvidence } from './evidence-predicates';
import { decidePermission } from './permission-decision';
import type { GoalNodeV2 } from './goal-graph';
import type { V2Execution } from './agent-v2';
import type { DiscoveredApplication } from './application-discovery';
import type { AgentBudget } from './budget';
import { sanitizeSnapshot } from '../../skills/snapshot-sanitizer';
import { sensitiveMetadata, sensitiveValue } from '../../skills/skill-safety';
import { uniqueControlAt } from '../../skills/frame-geometry';
import type { DeclaredAction } from '../../skills/teach-dashboard';
import type { TargetDescriptor, SkillVerifier } from '../../skills/skill-schema';
import { semanticTargetMatches } from '../../skills/skill-program';
import type { TeachCommandValue, TeachFrame, TeachReceipt, TeachSessionView, TeachStatus } from './teach-contracts';

export class TeachRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new TeachRuntimeError(code); }
type Offered = { candidate: GroundedCandidateV2; node: GoalNodeV2; operation: string; action: DeclaredAction };
interface FrameState { view: TeachFrame; before: Observation; offered: Map<string, Offered> }
export interface TeachSessionDependencies {
  clock?():number;
  lifecycle?(event:import('./teach-lifecycle').TeachLifecycleEvent):Promise<void>;
  provenance?: 'ANDROID_RUNTIME' | 'SIMULATED_RECEIPT';
  capture(): Promise<Buffer>;
  privacy(packageName: string): Promise<'SAFE_WINDOW' | 'SECURE_WINDOW' | 'UNKNOWN'>;
  ready(): Promise<ReturnType<typeof deviceReadiness>>;
  cleanup(): Promise<void>;
  closed?(view: TeachSessionView): void | Promise<void>;
}
/** One manual step at a time on an already owned V2 Session. No planner or executor loop. */
export class TeachSession {
  readonly leaseId = randomUUID();
  readonly ownerToken = randomBytes(32).toString('hex');
  private status: TeachStatus = 'RECORDING';
  private cleanupState: TeachSessionView['cleanup'] = 'PENDING';
  private revision = 1;
  private heartbeatAt = Date.now();
  private closeReason?:TeachSessionView['closeReason'];
  private now(){return this.dependencies.clock?.()??Date.now();}
  private frames = new Map<string, FrameState>();
  private attempts = new Map<string, { binding: string; work: Promise<TeachReceipt> }>();
  private receipts: TeachReceipt[] = [];
  private scope?: SearchScope;
  private busy = false;
  private closeWork?: Promise<TeachSessionView>;
  private frameWork?: Promise<TeachFrame>;
  private timer: ReturnType<typeof setInterval>;
  private readonly nativeSessionId: string;
  private readonly verificationBefore = new Map<string,string>();
  constructor(readonly recordingRef: string, readonly deviceId: string, readonly physicalId: string, readonly executionId: string,
    readonly appRef: string, readonly query: string, private readonly app: DiscoveredApplication, private readonly execution: V2Execution,
    private readonly budget: AgentBudget, private readonly signal: AbortSignal, private readonly dependencies: TeachSessionDependencies) {
    if (!execution.sessionId() || app.serial !== deviceId || sensitiveValue(query) || sensitiveMetadata(appRef)) fail('INVALID_RECORDER_SCOPE');
    this.nativeSessionId = execution.sessionId()!;this.heartbeatAt=this.now();
    this.timer = setInterval(() => {
      const reason=signal.aborted?'ABORT_SIGNAL':this.now()-this.heartbeatAt>30000?'HEARTBEAT_EXPIRED':this.budget.remaining()<=0?'BUDGET_EXHAUSTED':undefined;
      if(reason)void this.close('INTERRUPTED',reason);
    }, 2000); this.timer.unref();
    signal.addEventListener('abort', () => { void this.close('INTERRUPTED','ABORT_SIGNAL'); }, { once: true });
  }
  authorize(token: string) {
    const a = Buffer.from(token), b = Buffer.from(this.ownerToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) fail('TEACH_OWNER_MISMATCH');
    this.heartbeatAt = this.now();
  }
  view(): TeachSessionView {
    return structuredClone({ leaseId: this.leaseId, recordingRef: this.recordingRef, deviceId: this.deviceId, physicalId: this.physicalId,
      executionId: this.executionId, sessionId: this.nativeSessionId, status: this.status, revision: this.revision,
      cleanup: this.cleanupState, closeReason:this.closeReason, receipts: this.receipts, expiresAt: this.heartbeatAt + 30000, modelCalls: 0,
      metrics: {rpcCount:this.budget.profiling.rpcCount,adbCount:this.budget.profiling.adbCount,elapsedMs:Math.round(performance.now()-this.budget.started)} });
  }
  pause() { if (this.busy || this.status !== 'RECORDING') fail('TEACH_INVALID_STATE'); this.status = 'PAUSED'; this.revision++; return this.view(); }
  resume() { if (this.busy || this.status !== 'PAUSED') fail('TEACH_INVALID_STATE'); this.budget.check(); this.status = 'RECORDING'; this.revision++; return this.view(); }
  private node(kind: 'SEARCH' | 'NAVIGATE', value: string): GoalNodeV2 {
    const source = kind === 'SEARCH' ? 'search ' + JSON.stringify(value) : 'navigate ' + JSON.stringify(value);
    if (decidePermission({ source, stage: 'REQUEST' }).decision === 'DENY') fail('HARD_DENY');
    return { id: kind === 'SEARCH' ? 'teach-search' : 'teach-nav-' + value, capability: kind, app: this.appRef, packageName: this.app.packageName,
      outcome: { id: kind, kind, value, app: this.appRef, span: { start: 0, end: source.length, text: source }, effect: 'READ', negated: false, ambiguity: [] },
      dependencies: [], preconditions: ['owned-session', 'fresh-native-state'], predicates: ['FOREGROUND_IS'], inputs: [], outputs: [], status: 'RUNNING', evidenceIds: [] };
  }
  private safeSnapshot(snapshot: Observation, safeWindow = false) {
    const rows = observedAffordances(snapshot, this.executionId, this.execution.sessionId()!);
    return sanitizeSnapshot(snapshot.nodes.map((node, index) => ({ ...node, secure: safeWindow ? false : undefined,
      sensitive: rows.find(a => a.index === index)?.sensitive ?? true,
      fieldType: this.scope && rows.some(a => a.index === index && isScopedSearchField(this.scope!.id, a)) ? 'SEARCH' as const : /EditText|AutoCompleteTextView/.test(node.className) ? 'UNKNOWN' as const : 'TEXT' as const })));
  }
  private descriptor(candidate: GroundedCandidateV2): TargetDescriptor & { label: string } {
    const search = candidate.search, input = candidate.action === 'SET_VALUE';
    return { semanticRole: search ? input ? 'search_field' : 'search_action' : candidate.action === 'SCROLL' ? 'scroll_container' : 'navigation',
      label: search && input ? 'Search' : (candidate.target.label || 'Observed container').slice(0, 120),
      containerRole: search ? input ? 'search' : 'toolbar' : candidate.action === 'SCROLL' ? 'results' : 'navigation',
      ...(/^[A-Za-z0-9_:/.-]{1,160}$/.test(candidate.target.resourceId) ? { resourceIdHint: candidate.target.resourceId } : {}) };
  }
  private offer(snapshot: Observation): Map<string, Offered> {
    const offered = new Map<string, Offered>();
    if (snapshot.foregroundPackage !== this.app.packageName) return offered;
    const collect = (node: GoalNodeV2, candidate: GroundedCandidateV2) => {
      // Generic dialog BACK is a navigation primitive, not an issued search transition.
      // Keep its NAVIGATE-node offer below, so the existing grant validator remains authoritative.
      if(node.capability==='SEARCH'&&!candidate.search)return;
      if ([candidate.target.label, candidate.target.hint, candidate.target.resourceId, candidate.target.text].some(v => typeof v === 'string' && (sensitiveValue(v) || sensitiveMetadata(v)))) return;
      let action: DeclaredAction | undefined;
      if (candidate.search) {
        if (['OPEN', 'FOCUS'].includes(candidate.search.phase)) action = { operation: 'ACTIVATE_CONTROL', purpose: 'SEARCH', target: this.descriptor(candidate) };
        if (candidate.search.phase === 'ENTER') action = { operation: 'INPUT_TEXT', target: this.descriptor(candidate), value: this.query };
        if (candidate.search.phase === 'SUBMIT') action = { operation: 'SUBMIT_SEARCH' };
        // Recovery controls are offered only when they have a truthful portable contract.
        if (candidate.search.phase === 'DISMISS') action = { operation: 'BACK', reason: 'DISMISS_BENIGN' };
      } else if (candidate.action === 'CLICK' && candidate.target.roles.includes('navigation')) action = /^(back|navigate up|quay lai|tro ve)$/.test(foldIntent(candidate.target.label).trim())
        ? { operation: 'BACK', reason: 'DISMISS_BENIGN' } : { operation: 'ACTIVATE_CONTROL', purpose: 'NAVIGATION', target: this.descriptor(candidate) };
      else if (candidate.action === 'SCROLL') action = { operation: 'SCROLL_CONTAINER', direction: 'DOWN', maxAttempts: 1, target: this.descriptor(candidate) };
      else if (candidate.action === 'BACK') action = { operation: 'BACK', reason: 'DISMISS_BENIGN' };
      if (action && ![...offered.values()].some(o=>o.operation===action.operation&&o.candidate.action===candidate.action&&o.candidate.snapshotId===candidate.snapshotId&&o.candidate.target.index===candidate.target.index))
        offered.set(candidate.id, { node, candidate, operation: action.operation, action });
    };
    if (this.query) {
      const node = this.node('SEARCH', this.query);
      this.scope ??= beginSearch(node, this.deviceId, this.executionId, this.execution.sessionId()!);
      for (const c of generateGroundedCandidates(node, snapshot, this.executionId, this.execution.sessionId()!, false, 0, '', false, undefined, false, this.scope).candidates) collect(node, c);
    }
    const affordances = observedAffordances(snapshot, this.executionId, this.execution.sessionId()!);
    if (affordances.some(a => a.focused && a.roles.includes('editable') && a.text.trim() && (!this.scope || !isScopedSearchField(this.scope.id, a)))) return offered;
    for (const row of observedAffordances(snapshot, this.executionId, this.execution.sessionId()!).filter(r => r.roles.includes('navigation') && r.label && !r.sensitive && !r.destructive)) {
      const node = this.node('NAVIGATE', row.label);
      for (const c of generateGroundedCandidates(node, snapshot, this.executionId, this.execution.sessionId()!, false).candidates) if (c.target.index === row.index && ![...offered.values()].some(o => o.candidate.target.index === row.index)) collect(node, c);
    }
    const scrollNode = this.node('NAVIGATE', 'observed scroll container'), scroll = issueObservedTeachScroll(scrollNode, snapshot, this.executionId, this.execution.sessionId()!);
    if (scroll) collect(scrollNode, scroll);
    for (const c of generateGroundedCandidates(scrollNode, snapshot, this.executionId, this.execution.sessionId()!, false).candidates) if(c.action==='BACK')collect(scrollNode,c);
    return offered;
  }
  frame(): Promise<TeachFrame> {
    return this.freshFrame(false);
  }
  private freshFrame(semanticOnly:boolean):Promise<TeachFrame>{
    if (this.frameWork) return Promise.reject(new TeachRuntimeError('TEACH_FRAME_PENDING'));
    const work = this.captureFrame(semanticOnly); this.frameWork = work;
    void work.finally(() => { if (this.frameWork === work) this.frameWork = undefined; }).catch(() => undefined);
    return work;
  }
  private async captureFrame(semanticOnly=false): Promise<TeachFrame> {
    if (!['RECORDING', 'PAUSED'].includes(this.status) || this.busy) fail('TEACH_INVALID_STATE');
    this.busy = true;
    try {
      this.budget.check(); this.signal.throwIfAborted();
      if (await this.dependencies.ready() !== 'READY') fail('DEVICE_NOT_READY');
      if (this.query) this.scope ??= beginSearch(this.node('SEARCH', this.query), this.deviceId, this.executionId, this.execution.sessionId()!);
      const before = await this.execution.observe(this.signal);
      if (before.observationStatus !== 'OBSERVED' || before.deviceSerial !== this.deviceId) fail('OBSERVATION_UNAVAILABLE');
      const offered = this.offer(before);
      const privacy = before.foregroundPackage === this.app.packageName ? await this.dependencies.privacy(before.foregroundPackage) : 'UNKNOWN';
      const safe = this.safeSnapshot(before, privacy === 'SAFE_WINDOW');
      const view: TeachFrame = { id: randomUUID(), recordingRef: this.recordingRef, deviceId: this.deviceId, physicalId: this.physicalId,
        sessionId: this.execution.sessionId()!, snapshotId: before.snapshotId, at: before.timestamp, expiresAt: before.timestamp + 5000,
        width: before.viewport.width, height: before.viewport.height, orientation: before.viewport.width > before.viewport.height ? 'LANDSCAPE' : 'PORTRAIT',
        transport: 'SCREENSHOT_POLLING', minimumIntervalMs: 2000,
        controls: [...offered.values()].map(o => ({ id: o.candidate.id, operation: o.operation, label: o.candidate.description,
          rectangle: [...o.candidate.target.bounds] as [number, number, number, number] })) };
      if(semanticOnly)view.imageOmittedReason='SEMANTIC_OBSERVATION_ONLY';
      else if (before.foregroundPackage !== this.app.packageName) view.imageOmittedReason = 'OUTSIDE_APP_SCOPE';
      else if (privacy !== 'SAFE_WINDOW') view.imageOmittedReason = 'CAPTURE_SAFETY_UNKNOWN';
      else if (safe.redactionStatus !== 'REDACTED') view.imageOmittedReason = safe.redactionStatus;
      else {
        const raw = await this.dependencies.capture(), metadata = await sharp(raw).metadata();
        const after = await this.execution.observe(this.signal);
        if (after.deviceSerial!==this.deviceId||after.observationStatus!=='OBSERVED'||after.foregroundPackage!==this.app.packageName||metadata.width !== view.width || metadata.height !== view.height || geometryFingerprint(before) !== geometryFingerprint(after) || Date.now() >= view.expiresAt) fail('FRAME_CHANGED_DURING_CAPTURE');
        if(await this.dependencies.privacy(after.foregroundPackage)!=='SAFE_WINDOW'||this.safeSnapshot(after,true).redactionStatus!=='REDACTED')view.imageOmittedReason='CAPTURE_SAFETY_UNKNOWN';
        else view.image = 'data:image/jpeg;base64,' + (await sharp(raw).resize({ width: Math.min(720, view.width) }).jpeg({ quality: 65 }).toBuffer()).toString('base64');
      }
      for (const [id, entry] of this.frames) if (entry.view.expiresAt <= Date.now()) this.frames.delete(id);
      while (this.frames.size >= 3) this.frames.delete(this.frames.keys().next().value!);
      this.frames.set(view.id, { view, before, offered }); return view;
    } finally { this.busy = false; }
  }
  /** Backend-only semantic boundary; no screenshot, coordinates or raw hierarchy leaves it. */
  async inspectSkill(expected:SkillVerifier){
    const frame=await this.freshFrame(true),state=this.frames.get(frame.id)!;
    const rows=observedAffordances(state.before,this.executionId,this.nativeSessionId);
    const dialog=state.before.nodes.some(n=>n.displayed!==false&&(/Dialog/.test(n.className)||n.resourceId==='android:id/alertTitle'));
    const secureOverlay=state.before.nodes.some(n=>n.displayed!==false&&(/permissioncontroller|packageinstaller/.test(n.packageName)||/keyguard|bouncer/.test(n.resourceId)||n.password===true))||rows.some(r=>r.roles.includes('editable')&&r.sensitive);
    const dangerous=rows.some(r=>r.sensitive||r.destructive);
    const targets=[...state.offered.values()].map(o=>({id:o.candidate.id,operation:o.action.operation,...('target'in o.action?{target:o.action.target}:{}),
      ...(dialog&&o.action.operation==='BACK'?{recovery:'DISMISS_BENIGN' as const}:{})}));
    return {id:frame.id,snapshotId:state.before.snapshotId,observedAt:frame.at,expiresAt:frame.expiresAt,foreground:state.before.foregroundPackage===this.app.packageName,
      blocker:secureOverlay?'SENSITIVE' as const:dialog?(dangerous?'SENSITIVE' as const:targets.some(t=>t.recovery)?'BENIGN_DIALOG' as const:'UNSUPPORTED_DIALOG' as const):'NONE' as const,
      candidates:targets,proof:this.skillProof(expected,state.before)};
  }
  private skillProof(expected:SkillVerifier,snapshot:Observation,beforeFingerprint?:string):VerifiedEvidence|undefined {
    const context={deviceId:this.deviceId,executionId:this.executionId,nodeId:this.scope?.nodeId??'teach-step',packageName:this.app.packageName};
    if(expected.kind==='FOREGROUND_IS')return expected.appRef===this.appRef?verifyPredicate({kind:'FOREGROUND_IS',packageName:this.app.packageName},snapshot,context).evidence:undefined;
    if(expected.kind==='STATE_CHANGED')return beforeFingerprint?verifyPredicate({kind:'STATE_CHANGED',beforeFingerprint},snapshot,context).evidence:undefined;
    if(expected.kind==='TEXT_EQUALS')return verifyPredicate(expected,snapshot,context).evidence;
    if(expected.kind==='SEARCH_OUTCOME_MATCHES')return this.scope&&expected.value===this.query?verifySearchOutcome(this.scope,snapshot,context):undefined;
    if(expected.kind==='KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED')return this.scope?verifyPredicate({kind:expected.kind,scopeId:this.scope.id},snapshot,context).evidence:undefined;
    const rows=observedAffordances(snapshot,this.executionId,this.nativeSessionId).filter(row=>!row.sensitive&&!row.destructive&&(
      expected.target.semanticRole==='search_field'?!!this.scope&&isScopedSearchField(this.scope.id,row):row.roles.includes('navigation')&&semanticTargetMatches(expected.target,{semanticRole:'navigation',label:row.label,containerRole:'navigation'})));
    if(rows.length!==1)return;
    const row=rows[0],label=row.description||row.hint||row.text;
    if(!label)return;
    if(expected.kind==='WIDGET_STATE')return typeof expected.expected==='string'?verifyPredicate({kind:'WIDGET_STATE',label,property:'value',expected:expected.expected},snapshot,context).evidence:undefined;
    // An exact typed-widget readback is stronger than visible search-field presence.
    if(expected.target.semanticRole==='search_field')return verifyPredicate({kind:'WIDGET_STATE',label,property:'value',expected:row.text},snapshot,context).evidence;
    return verifyPredicate({kind:expected.kind,label},snapshot,context).evidence;
  }
  async verifySkill(expected:SkillVerifier,receiptId?:string){
    if(await this.dependencies.ready()!=='READY')fail('DEVICE_NOT_READY');
    const snapshot=await this.execution.observe(this.signal),proof=this.skillProof(expected,snapshot,receiptId?this.verificationBefore.get(receiptId):undefined);
    if(proof&&this.status==='PAUSED')this.resume();return proof;
  }
  step(command: Extract<TeachCommandValue, { type: 'STEP' }>): Promise<TeachReceipt> {
    this.authorize(command.ownerToken);
    if (command.leaseId !== this.leaseId) return Promise.reject(new TeachRuntimeError('TEACH_OWNER_MISMATCH'));
    const binding = JSON.stringify(command), old = this.attempts.get(command.requestId);
    if (old) return old.binding === binding ? old.work : Promise.reject(new TeachRuntimeError('TEACH_REPLAY_BINDING_MISMATCH'));
    if (this.attempts.size >= 40 || this.receipts.length >= 20) return Promise.reject(new TeachRuntimeError('TEACH_ACTION_LIMIT'));
    const work = Promise.resolve().then(() => this.perform(command));
    this.attempts.set(command.requestId, { binding, work }); return work;
  }
  private async perform(command: Extract<TeachCommandValue, { type: 'STEP' }>): Promise<TeachReceipt> {
    if (this.status !== 'RECORDING' || this.busy) fail('TEACH_INVALID_STATE');
    const frame = this.frames.get(command.frameId);
    if (!frame || Date.now() >= frame.view.expiresAt) fail('STALE_FRAME');
    this.busy = true;
    let sent = false, before = frame.before;
    const receipt: TeachReceipt = { id: randomUUID(), requestId: command.requestId, recordingRef: this.recordingRef, leaseId: this.leaseId,
      deviceId: this.deviceId, physicalId: this.physicalId, executionId: this.executionId, sessionId: this.execution.sessionId()!,
      operation: command.operation, dispatch: 'NOT_SENT', verification: 'UNVERIFIED', at: Date.now(), before: this.safeSnapshot(before), beforeSnapshotId: before.snapshotId,
      provenance:this.dependencies.provenance??'SIMULATED_RECEIPT' };
    let checkpointed=false;
    try {
      await this.dependencies.lifecycle?.({kind:'EFFECT_PENDING',effectRequestId:command.requestId});checkpointed=true;
      this.budget.consume('steps'); this.signal.throwIfAborted();
      if (await this.dependencies.ready() !== 'READY') fail('DEVICE_NOT_READY');
      before = await this.execution.observe(this.signal);
      if (before.deviceSerial !== this.deviceId || before.observationStatus !== 'OBSERVED' || geometryFingerprint(before) !== geometryFingerprint(frame.before) || Date.now() >= frame.view.expiresAt) fail('STALE_FRAME');
      receipt.before = this.safeSnapshot(before); receipt.beforeSnapshotId = before.snapshotId;
      this.verificationBefore.set(receipt.id,geometryFingerprint(before));
      let after: Observation;
      const context = { deviceId: this.deviceId, executionId: this.executionId, nodeId: 'teach-step', packageName: this.app.packageName };
      if (command.operation === 'OPEN_APPLICATION') {
        if (command.value || command.candidateId || command.touch) fail('INVALID_OPEN_PAYLOAD');
        receipt.action = { operation: 'OPEN_APPLICATION', appRef: this.appRef };
        if (before.foregroundPackage !== this.app.packageName) {
          sent = true; await this.execution.execute({ type: 'OPEN_APP', app: this.app.packageName }, this.signal); receipt.dispatch = 'ACK';
        }
        after = await this.execution.observe(this.signal);
        const proof = verifyPredicate({ kind: 'FOREGROUND_IS', packageName: this.app.packageName }, after, context).evidence;
        if (proof) { receipt.verification = 'PASSED'; receipt.evidenceId = proof.id; }
        if (!sent) receipt.reason = 'ALREADY_FOREGROUND_NOT_DISPATCHED';
      } else if (command.operation === 'OBSERVE_UI'||command.operation==='ASSERT_UI') {
        if (command.value || command.candidateId || command.touch) fail('INVALID_OBSERVE_PAYLOAD');
        after = await this.execution.observe(this.signal);
        if(command.operation==='ASSERT_UI'&&!command.expected)fail('PREDICATE_REQUIRED');
        const proof = verifyPredicate({ kind: 'FOREGROUND_IS', packageName: this.app.packageName }, after, context).evidence;
        receipt.action = { operation: command.operation, predicate: command.expected??{ kind: 'FOREGROUND_IS', appRef: this.appRef } };
        if (proof) { receipt.verification = 'PASSED'; receipt.evidenceId = proof.id; }
      } else {
        let offered = command.candidateId ? frame.offered.get(command.candidateId) : undefined;
        if (command.touch) {
          const match = uniqueControlAt(frame.view.controls.filter(c => c.operation === command.operation), frame.view, command.touch);
          if (!match || offered && offered.candidate.id !== match.id) fail('UNRESOLVED_TARGET');
          offered = frame.offered.get(match.id);
        }
        if (!offered || offered.operation !== command.operation) fail('UNRESOLVED_TARGET');
        if (command.operation === 'INPUT_TEXT' ? command.value !== this.query : command.value !== undefined) fail('VALUE_NOT_AUTHORIZED');
        const c = offered.candidate;
        receipt.action = structuredClone(offered.action);
        const grant = issueEffectGrant(c, offered.node);
        sent = true; after = await this.execution.interactV2(grant, this.signal); receipt.dispatch = 'ACK';
        const ctx = { ...context, nodeId: offered.node.id };
        let proof;
        if (c.search?.phase === 'SUBMIT' && this.scope) {
          proof = verifySearchOutcome(this.scope, after, ctx);
          // Read-only verification polling; never redispatch submission.
          for(let read=0;!proof&&read<2;read++){this.signal.throwIfAborted();after=await this.execution.observe(this.signal);proof=verifySearchOutcome(this.scope,after,ctx);}
        }
        else if (c.action === 'SET_VALUE' && this.scope && observedAffordances(after, this.executionId, this.execution.sessionId()!).filter(a => isScopedSearchField(this.scope!.id, a) && a.text === this.query).length === 1)
          proof = verifyPredicate({ kind: 'TEXT_EQUALS', value: this.query }, after, ctx).evidence;
        else if (c.search && searchTransitionSatisfied(c, after) || !c.search)
          proof = verifyPredicate({ kind: 'STATE_CHANGED', beforeFingerprint: geometryFingerprint(before) }, after, ctx).evidence;
        if (proof) { receipt.verification = 'PASSED'; receipt.evidenceId = proof.id; }
      }
      if(command.expected){const proof=this.skillProof(command.expected,after,geometryFingerprint(before));receipt.verification=proof?'PASSED':'FAILED';receipt.evidenceId=proof?.id;}
      receipt.after = this.safeSnapshot(after); receipt.afterSnapshotId = after.snapshotId;
      if (receipt.verification !== 'PASSED') { receipt.verification = 'FAILED'; receipt.reason = 'POSTCONDITION_UNVERIFIED'; this.status = 'PAUSED'; }
    } catch (error) {
      receipt.dispatch = error instanceof GroundedInteractionFailure ? error.dispatchState === 'NOT_SENT' ? 'NOT_SENT' : 'UNKNOWN' : sent ? 'UNKNOWN' : 'NOT_SENT';
      const diagnostic = error instanceof TeachRuntimeError ? error.code : error instanceof GroundedInteractionFailure ? error.diagnosticCode : 'EXECUTION_OR_OBSERVATION_FAILED';
      receipt.reason = /^[A-Z0-9_]{1,80}$/.test(diagnostic) ? diagnostic : 'EXECUTION_OR_OBSERVATION_FAILED';
      receipt.verification = 'UNVERIFIED';
      if (receipt.dispatch === 'UNKNOWN') this.status = 'INTERRUPTED';
    } finally {
      this.frames.clear(); this.busy = false; this.revision++; this.receipts.push(receipt);
      if(checkpointed)await this.dependencies.lifecycle?.({kind:'EFFECT_RESOLVED',effectRequestId:command.requestId,dispatch:receipt.dispatch});
    }
    return structuredClone(receipt);
  }
  close(status: 'REVIEWING' | 'CANCELLED' | 'INTERRUPTED' = 'REVIEWING',reason:NonNullable<TeachSessionView['closeReason']>=status==='REVIEWING'?'OWNER_STOP':status==='CANCELLED'?'OWNER_CANCEL':'RUNTIME_INTERRUPTED'): Promise<TeachSessionView> {
    this.closeWork ??= (async () => {
      clearInterval(this.timer); this.status = status;this.closeReason=reason; this.frames.clear();
      try {
        await this.dependencies.lifecycle?.({kind:'CLOSE_INTENT',closeReason:reason});
        // Never release reservation while a dispatch is still pending.
        await Promise.allSettled([...this.attempts.values()].map(a => a.work));
        await this.frameWork?.catch(() => undefined);
        this.frames.clear();this.verificationBefore.clear();
        this.status = status === 'REVIEWING' && this.receipts.some(r => r.dispatch === 'UNKNOWN') ? 'INTERRUPTED' : status;
        await this.execution.close(); await this.dependencies.cleanup(); this.cleanupState = 'PROVEN';
      }
      catch { this.cleanupState = 'UNCERTAIN'; this.status = 'INTERRUPTED'; }
      if (this.scope) closeSearch(this.scope); this.revision++;
      const view = this.view(); await this.dependencies.closed?.(view); return view;
    })(); return this.closeWork;
  }
}
