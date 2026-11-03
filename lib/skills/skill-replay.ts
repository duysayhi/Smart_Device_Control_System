import { randomBytes, randomUUID } from 'node:crypto';
import type { SkillDefinition, SkillStep } from './skill-schema';
import { stableJson, programError, bindSkillParameters, loadSkillProgram, type SkillProgram } from './skill-program';
import { resolvePortableTarget } from './skill-portability';
import { checkpointSignature, parseCheckpoint, predicateDigest, ReplayBindingSchema, ReplayProofSchema, ReplayObservationSchema, ExecutionReceiptSchema, type ReplayAdapter, type ReplayCheckpoint, type ReplayStatus, type ReplayObservation, type ExecutionReceipt, type ReplayProof } from './replay-contracts';

const allowed: Record<ReplayStatus, readonly ReplayStatus[]> = {
  CREATED:['VALIDATING'],VALIDATING:['READY','BLOCKED'],READY:['ACQUIRING_DEVICE','BLOCKED'],ACQUIRING_DEVICE:['RUNNING','BLOCKED','FAILED'],
  RUNNING:['VERIFYING','RECOVERING','PAUSED','BLOCKED','CANCELLED','INTERRUPTED','UNKNOWN_EFFECT','COMPLETED'],
  VERIFYING:['RUNNING','RECOVERING','COMPLETED','BLOCKED','CANCELLED','INTERRUPTED','UNKNOWN_EFFECT'],RECOVERING:['RUNNING','VERIFYING','BLOCKED','CANCELLED','INTERRUPTED','UNKNOWN_EFFECT'],
  PAUSED:['RUNNING','CANCELLED','BLOCKED','INTERRUPTED'],COMPLETED:[],BLOCKED:[],FAILED:[],CANCELLED:[],INTERRUPTED:[],UNKNOWN_EFFECT:[],
};
// Storage failure is an explicit fail-closed fault edge, including failure to persist a terminal state.
const storageFaultEdges:Partial<Record<ReplayStatus,readonly ReplayStatus[]>>=Object.fromEntries(Object.keys(allowed).map(status=>[status,['INTERRUPTED','UNKNOWN_EFFECT']]));
export class SkillReplayController {
  private checkpoint: ReplayCheckpoint;
  private published:ReplayCheckpoint;
  private journalFailed=false;
  private readonly key: Buffer;
  private readonly abort = new AbortController();
  private work?: Promise<ReplayCheckpoint>;
  private readonly requests = new Map<string,Promise<ExecutionReceipt>>();
  private readonly receipts = new Map<string,ExecutionReceipt>();
  private pauseRequested = false;
  private closed?: Promise<void>;
  private deadline = 0;
  private stepDeadline=0;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private readonly definition: SkillDefinition;
  private readonly program:SkillProgram;
  private readonly transitions: ReplayStatus[] = ['CREATED'];
  private readonly events: {kind:string;stepId?:string;receiptId?:string;dispatch?:string;reason?:string}[]=[];
  constructor(program: SkillProgram,parameters:unknown,private readonly adapter: ReplayAdapter,
    private readonly changed:(checkpoint:ReplayCheckpoint,event:Readonly<Record<string,unknown>>)=>Promise<void>|void=()=>undefined,key?:Buffer) {
    this.key=key??randomBytes(32);
    this.program=loadSkillProgram(program.definition);if(this.program.definitionDigest!==program.definitionDigest)programError('PROGRAM_INTEGRITY_INVALID');
    this.definition=bindSkillParameters(this.program,parameters);
    const binding=ReplayBindingSchema.parse(adapter.binding);
    this.checkpoint={contractVersion:1,binding,status:'CREATED',revision:1,currentStep:0,observationGeneration:0,verifiedSteps:[],recoveryCount:0,ownership:'HELD',provenance:adapter.provenance,signature:''};this.sign();this.published=structuredClone(this.checkpoint);
  }
  private sign(){const {signature:ignored,...body}=this.checkpoint;void ignored;this.checkpoint.signature=checkpointSignature(body,this.key);}
  view(){return structuredClone(this.published);}
  history(){return structuredClone({transitions:this.transitions,events:this.events});}
  private async save(kind:string,detail:Record<string,unknown>={}){
    this.checkpoint.revision++;this.sign();const event={kind,...detail};this.events.push(event);if(this.events.length>100)this.events.shift();
    if(!this.journalFailed){try{await this.changed(structuredClone(this.checkpoint),event);}catch{
      this.journalFailed=true;const fault=this.checkpoint.pending?'UNKNOWN_EFFECT':'INTERRUPTED';if(!storageFaultEdges[this.checkpoint.status]?.includes(fault))programError('REPLAY_INVALID_TRANSITION');this.checkpoint.status=fault;this.transitions.push(fault);if(this.checkpoint.pending)this.checkpoint.pending.dispatch='UNKNOWN';
      this.checkpoint.reason='CHECKPOINT_STORAGE_UNAVAILABLE';this.sign();this.published=structuredClone(this.checkpoint);programError('CHECKPOINT_STORAGE_UNAVAILABLE');
    }}this.published=structuredClone(this.checkpoint);
  }
  private async transition(next:ReplayStatus,reason?:string){
    if(!allowed[this.checkpoint.status].includes(next))programError('REPLAY_INVALID_TRANSITION');
    this.checkpoint.status=next;this.checkpoint.reason=reason;this.transitions.push(next);await this.save('STATE',{status:next,...(reason?{reason}:{})});
  }
  private match(binding:unknown){if(stableJson(binding)!==stableJson(this.checkpoint.binding))programError('REPLAY_CONTEXT_MISMATCH');}
  private check(){this.abort.signal.throwIfAborted();if(Date.now()>=this.deadline)programError('REPLAY_TIMEOUT');}
  private async rpc<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(Math.max(1,(this.stepDeadline||this.deadline)-Date.now()))]);
    signal.throwIfAborted();
    let listener:()=>void=()=>undefined;
    const expired=new Promise<never>((resolve,reject)=>{void resolve;listener=()=>reject(Error('REPLAY_RPC_TIMEOUT_OR_CANCELLED'));if(signal.aborted)listener();else signal.addEventListener('abort',listener,{once:true});});
    try{return await Promise.race([work(signal),expired]);}finally{signal.removeEventListener('abort',listener);}
  }
  private isStatus(status:ReplayStatus){return this.checkpoint.status===status;}
  private proof(step:SkillStep,proof:ReplayProof|undefined):proof is ReplayProof {
    if(!proof)return false;if(!ReplayProofSchema.safeParse(proof).success)programError('REPLAY_PROOF_INVALID');this.match(proof.binding);
    if(proof.stepId!==step.id||proof.predicateDigest!==predicateDigest(step)||proof.provenance!==this.adapter.provenance||Date.now()-proof.observedAt<0||Date.now()-proof.observedAt>5000)programError('REPLAY_PROOF_MISMATCH');
    return Boolean(proof.id&&proof.snapshotId);
  }
  private async observe(step:SkillStep){
    this.check();await this.adapter.authorize();const observation=await this.rpc(signal=>this.adapter.observe(step,signal));if(!ReplayObservationSchema.safeParse(observation).success)programError('REPLAY_OBSERVATION_INVALID');this.match(observation.binding);
    if(observation.provenance!==this.adapter.provenance||observation.generation<=this.checkpoint.observationGeneration||observation.observedAt>Date.now()||Date.now()>=observation.expiresAt)programError('REPLAY_STALE_OBSERVATION');
    this.checkpoint.observationGeneration=observation.generation;
    await this.save('OBSERVATION',{stepId:step.id,snapshotId:observation.snapshotId,generation:observation.generation,foreground:observation.foreground,blocker:observation.blocker});return observation;
  }
  private async dispatched(step:SkillStep,observation:ReplayObservation,candidateId?:string){
    this.check();await this.adapter.authorize();
    const requestId=randomUUID();this.checkpoint.pending={requestId,stepId:step.id,dispatch:'PENDING'};
    // Same Worker journal is updated before any RPC. A crash here cannot imply NOT_SENT.
    await this.save('DISPATCH_PENDING',{stepId:step.id});
    const promise=this.rpc(signal=>this.adapter.execute(step,observation,candidateId,requestId,signal));this.requests.set(requestId,promise);
    let receipt:ExecutionReceipt;
    try{receipt=await promise;}catch{this.checkpoint.pending.dispatch='UNKNOWN';await this.transition('UNKNOWN_EFFECT','DISPATCH_OUTCOME_UNKNOWN');return;}
    if(!ExecutionReceiptSchema.safeParse(receipt).success)programError('REPLAY_RECEIPT_INVALID');this.match(receipt.binding);
    if(receipt.requestId!==requestId||receipt.stepId!==step.id||receipt.provenance!==this.adapter.provenance)programError('REPLAY_RECEIPT_MISMATCH');
    if(this.receipts.has(receipt.id))programError('REPLAY_DUPLICATE_RECEIPT');this.receipts.set(receipt.id,receipt);
    this.checkpoint.pending.dispatch=receipt.dispatch;await this.save('RECEIPT',{stepId:step.id,receiptId:receipt.id,dispatch:receipt.dispatch});
    if(receipt.dispatch==='UNKNOWN'){await this.transition('UNKNOWN_EFFECT','DISPATCH_OUTCOME_UNKNOWN');return;}
    if(receipt.dispatch==='NOT_SENT'&&!['OPEN_APPLICATION','OBSERVE_UI','ASSERT_UI'].includes(step.operation)){await this.transition('BLOCKED',receipt.reason??'ACTION_NOT_SENT');return;}
    return receipt;
  }
  run():Promise<ReplayCheckpoint>{
    if(this.work)return this.work;
    if(this.checkpoint.status!=='CREATED')return Promise.resolve(this.view());
    this.work=this.begin().finally(()=>{this.work=undefined;});return this.work;
  }
  private async begin(){
    try{
    await this.transition('VALIDATING');
    if(!this.program.compatibility.supported||this.program.definitionDigest!==this.adapter.binding.definitionDigest){await this.transition('BLOCKED','SKILL_UNSUPPORTED_OR_CHANGED');await this.cleanup();return this.view();}
    await this.transition('READY');await this.transition('ACQUIRING_DEVICE');
    await this.adapter.authorize();await this.transition('RUNNING');this.deadline=Date.now()+Math.min(120000,this.definition.steps.reduce((sum,s)=>sum+s.timeoutMs,0));
      this.deadlineTimer=setTimeout(()=>{this.abort.abort();if(!this.work)void this.cancel();},Math.max(1,this.deadline-Date.now()));this.deadlineTimer.unref();return await this.loop();}
    catch(error){await this.failure(error);return this.view();}
  }
  private async loop():Promise<ReplayCheckpoint>{
    try {
      while(this.checkpoint.currentStep<this.definition.steps.length&&this.checkpoint.status==='RUNNING'){
        this.check();if(this.pauseRequested){await this.transition('PAUSED');return this.view();}
        const step=this.definition.steps[this.checkpoint.currentStep],stepDeadline=Math.min(this.deadline,Date.now()+step.timeoutMs);
        this.stepDeadline=stepDeadline;
        let observation=await this.observe(step),observes=0;
        observation=await this.recoverObservation(step,observation,'RUNNING');
        if(this.checkpoint.status!=='RUNNING')break;
        // A fresh, independent proof can skip an already visible search-entry step.
        if(['OPEN_APPLICATION','ACTIVATE_CONTROL','OBSERVE_UI','ASSERT_UI'].includes(step.operation)&&this.proof(step,observation.proof)){
          await this.completeStep(step,observation.proof!,'OBSERVED_NOT_DISPATCHED');continue;
        }
        const resolution=resolvePortableTarget(step,observation);
        if(resolution.status==='BLOCKED'){await this.transition(step.onFail==='ASK_USER'?'PAUSED':'BLOCKED',resolution.reason);break;}
        if(resolution.status==='RESOLVED')await this.save('PORTABILITY_RESOLVED',{stepId:step.id,match:resolution.match,policyVersion:resolution.policyVersion});
        const receipt=await this.dispatched(step,observation,resolution.status==='RESOLVED'?resolution.candidateId:undefined);if(!receipt)break;
        await this.transition('VERIFYING');let proof:ReplayProof|undefined;
        do{this.check();await this.adapter.authorize();proof=await this.rpc(signal=>this.adapter.verify(step,receipt,signal));const verified=this.proof(step,proof);await this.save('VERIFICATION',{stepId:step.id,outcome:verified?'PASSED':'UNVERIFIED',...(verified?{evidenceId:proof!.id,snapshotId:proof!.snapshotId}:{})});if(verified)break;
          if(++observes>=3||Date.now()>=stepDeadline)break;
          await this.recoverObservation(step,await this.observe(step),'VERIFYING');
          if(!this.isStatus('VERIFYING'))break;
          await new Promise(resolve=>setTimeout(resolve,50));
        }while(true);
        if(!this.isStatus('VERIFYING'))break;
        if(!this.proof(step,proof)){await this.transition('BLOCKED','POSTCONDITION_UNVERIFIED');break;}
        await this.completeStep(step,proof!,'INDEPENDENTLY_VERIFIED');
      }
      if(this.checkpoint.status==='RUNNING'){
        await this.transition('VERIFYING');await this.cleanup();
        if(this.checkpoint.ownership==='RELEASED')await this.transition('COMPLETED');
      }
    }catch(error){await this.failure(error);}
    if(this.checkpoint.status!=='PAUSED')await this.cleanup();return this.view();
  }
  private async recoverObservation(step:SkillStep,initial:ReplayObservation,returnStatus:'RUNNING'|'VERIFYING'){
    let observation=initial;
    while((observation.blocker!=='NONE'||!observation.foreground&&step.operation!=='OPEN_APPLICATION')&&this.checkpoint.status===returnStatus){
      if(this.checkpoint.recoveryCount>=3){await this.transition('BLOCKED','RECOVERY_BUDGET_EXHAUSTED');break;}
      if(observation.blocker==='SENSITIVE'||observation.blocker==='UNSUPPORTED_DIALOG'){await this.transition('BLOCKED','OWNER_ASSISTANCE_REQUIRED');break;}
      const decision=observation.blocker==='BENIGN_DIALOG'?{action:'DISMISS_BENIGN' as const,reason:'OBSERVED_BENIGN_DIALOG'}:{action:'REOPEN_SCOPE' as const,reason:'APP_SCOPE_RECOVERY'};
      const primaryPending=this.checkpoint.pending;
      await this.transition('RECOVERING');await this.adapter.authorize();const requestId=randomUUID();
      this.checkpoint.pending={requestId,stepId:step.id,dispatch:'PENDING'};await this.save('RECOVERY_PENDING',{reason:decision.reason});
      let result:ExecutionReceipt;try{result=await this.rpc(signal=>this.adapter.recover(decision,observation,requestId,signal));}catch(error){this.checkpoint.pending.dispatch='UNKNOWN';const reason=error instanceof Error&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'RECOVERY_OUTCOME_UNKNOWN';await this.transition('UNKNOWN_EFFECT',reason);break;}
      if(!ExecutionReceiptSchema.safeParse(result).success)programError('REPLAY_RECEIPT_INVALID');this.match(result.binding);if(result.requestId!==requestId||result.provenance!==this.adapter.provenance)programError('REPLAY_RECEIPT_MISMATCH');
      this.checkpoint.pending.dispatch=result.dispatch;this.checkpoint.recoveryCount++;
      await this.save('RECOVERY_RECEIPT',{receiptId:result.id,dispatch:result.dispatch,...(result.reason?{reason:result.reason}:{})});
      if(result.dispatch==='UNKNOWN'){await this.transition('UNKNOWN_EFFECT','RECOVERY_OUTCOME_UNKNOWN');break;}
      if(result.verification!=='PASSED'){await this.transition('BLOCKED','RECOVERY_UNVERIFIED');break;}
      this.checkpoint.pending=primaryPending;await this.transition(returnStatus);observation=await this.observe(step);
    }
    return observation;
  }
  private async completeStep(step:SkillStep,proof:ReplayProof,reason:string){
    this.checkpoint.verifiedSteps.push({stepId:step.id,evidenceId:proof.id,snapshotId:proof.snapshotId});this.checkpoint.currentStep++;this.checkpoint.pending=undefined;
    if(this.checkpoint.status==='VERIFYING')await this.transition('RUNNING');await this.save('STEP_VERIFIED',{stepId:step.id,reason});
  }
  private async failure(error:unknown){
    const reason=this.abort.signal.aborted?'CANCELLED':error instanceof Error&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'ADAPTER_UNAVAILABLE';
    const unknown=this.checkpoint.pending&&this.checkpoint.pending.dispatch!=='NOT_SENT';
    if(unknown)this.checkpoint.pending!.dispatch='UNKNOWN';
    const next=unknown?'UNKNOWN_EFFECT':this.abort.signal.aborted?'CANCELLED':'INTERRUPTED';
    if(allowed[this.checkpoint.status].includes(next))await this.transition(next,reason);
    else if(allowed[this.checkpoint.status].includes('BLOCKED'))await this.transition('BLOCKED',reason);
    await this.cleanup();
  }
  private async cleanup(){
    this.closed??=(async()=>{if(this.deadlineTimer)clearTimeout(this.deadlineTimer);let proven=false;try{proven=(await this.adapter.close()).cleanup==='PROVEN';}catch{}this.checkpoint.ownership=proven?'RELEASED':'RETAINED_PENDING_CLEANUP';
      if(!proven&&this.checkpoint.status==='VERIFYING')await this.transition('INTERRUPTED','CLEANUP_UNPROVEN');
      await this.save('CLEANUP',{ownership:this.checkpoint.ownership});})();await this.closed;
  }
  pause(){this.pauseRequested=true;return this.view();}
  async cancel(){this.abort.abort();if(this.work)await this.work;else{if(allowed[this.checkpoint.status].includes('CANCELLED'))await this.transition('CANCELLED');await this.cleanup();}return this.view();}
  resume(input:unknown):Promise<ReplayCheckpoint>{
    const checkpoint=parseCheckpoint(input,this.key);
    if(stableJson(checkpoint)!==stableJson(this.checkpoint)||checkpoint.status!=='PAUSED'||checkpoint.pending||checkpoint.ownership!=='HELD')programError('CHECKPOINT_RECONCILIATION_REQUIRED');
    if(this.work)return this.work.then(()=>this.resume(input));
    this.pauseRequested=false;
    this.work=(async()=>{try{await this.adapter.authorize();const step=this.definition.steps[this.checkpoint.currentStep];if(!step)programError('CHECKPOINT_INVALID');await this.observe(step);await this.transition('RUNNING');return await this.loop();}catch(error){await this.failure(error);return this.view();}})().finally(()=>{this.work=undefined;});return this.work;
  }
  /** Restarted controllers never accept client checkpoint authority or replay automatically. */
  reconcile(input:unknown){const parsed=parseCheckpoint(input,this.key);this.match(parsed.binding);
    if(stableJson(parsed)!==stableJson(this.checkpoint))programError('CHECKPOINT_RECONCILIATION_REQUIRED');return {checkpoint:this.view(),automaticResume:false as const,canResume:parsed.status==='PAUSED'&&!parsed.pending&&parsed.ownership==='HELD'};
  }
}
