import { z } from 'zod';
import { SkillSchema, type SkillStep } from '../../skills/skill-schema';
import type { ReplayAdapter, ReplayBinding, ReplayProof, ReplayObservation, ExecutionReceipt, RecoveryDecision, ReplayProvenance } from '../../skills/replay-contracts';
import { predicateDigest, ReplayCheckpointSchema } from '../../skills/replay-contracts';
import { programError } from '../../skills/skill-program';
import { isVerifiedEvidence } from './verification-registry';
import type { VerifiedEvidence } from './evidence-predicates';
import type { TeachSession } from './teach-session';
import type { TeachReceipt } from './teach-contracts';

const uuid=z.uuid(),token=z.string().regex(/^[a-f0-9]{64}$/),digest=token;
export const ReplayCommandSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('OPEN'),requestId:uuid,deviceId:z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/),expectedPhysicalId:z.string().regex(/^android:[a-f0-9]{64}$/),
    skillId:uuid,versionId:uuid,version:z.number().int().positive(),contentHash:digest,definitionDigest:digest,definition:SkillSchema,
    parameters:z.record(z.string().max(64),z.union([z.string().max(500),z.number().int()])).refine(p=>Object.keys(p).length<=20),authorizationId:uuid,confirmed:z.literal(true)}).strict(),
  z.object({type:z.enum(['STATE','PAUSE','CANCEL']),leaseId:uuid,ownerToken:token}).strict(),
  z.object({type:z.literal('RESUME'),leaseId:uuid,ownerToken:token,checkpoint:ReplayCheckpointSchema}).strict(),
]);
export type ReplayCommandValue=z.infer<typeof ReplayCommandSchema>;
/** Translates semantic contracts to the already owned Unified V2 single-step seam. No driver/RPC implementation. */
export class UnifiedSkillReplayAdapter implements ReplayAdapter {
  private generation=0;
  constructor(readonly binding:ReplayBinding,readonly provenance:ReplayProvenance,private readonly session:TeachSession,
    private readonly validateOwner:()=>Promise<void>,private readonly interrupt:()=>void){}
  async authorize(){await this.validateOwner();this.session.authorize(this.session.ownerToken);if(this.session.view().cleanup!=='PENDING')programError('REPLAY_SESSION_CLOSED');}
  private proof(step:SkillStep,evidence:VerifiedEvidence|undefined):ReplayProof|undefined {
    if(!evidence||!isVerifiedEvidence(evidence))return;
    if(evidence.deviceId!==this.binding.deviceId||evidence.executionId!==this.binding.executionId)programError('REPLAY_PROOF_MISMATCH');
    return {id:evidence.id,snapshotId:evidence.snapshotId,observedAt:evidence.observedAt,stepId:step.id,predicateDigest:predicateDigest(step),binding:this.binding,provenance:this.provenance};
  }
  private bindSignal(signal:AbortSignal){signal.throwIfAborted();signal.addEventListener('abort',this.interrupt,{once:true});return()=>signal.removeEventListener('abort',this.interrupt);}
  async observe(step:SkillStep,signal:AbortSignal):Promise<ReplayObservation>{
    const remove=this.bindSignal(signal);try{await this.authorize();const observation=await this.session.inspectSkill(step.verify);
      return {...observation,generation:++this.generation,binding:this.binding,proof:this.proof(step,observation.proof),provenance:this.provenance};
    }finally{remove();}
  }
  private receipt(step:SkillStep,r:TeachReceipt):ExecutionReceipt {
    if(r.deviceId!==this.binding.deviceId||r.physicalId!==this.binding.physicalId||r.sessionId!==this.binding.sessionId||r.executionId!==this.binding.executionId||r.provenance!==this.provenance)programError('REPLAY_RECEIPT_MISMATCH');
    return {id:r.id,requestId:r.requestId,stepId:step.id,binding:this.binding,dispatch:r.dispatch,verification:r.verification,beforeId:r.beforeSnapshotId,
      ...(r.afterSnapshotId?{afterId:r.afterSnapshotId}:{}),provenance:this.provenance,...(r.reason?{reason:r.reason}:{})};
  }
  async execute(step:SkillStep,observation:ReplayObservation,candidateId:string|undefined,requestId:string,signal:AbortSignal){
    const remove=this.bindSignal(signal);try{await this.authorize();
      const receipt=await this.session.step({type:'STEP',leaseId:this.session.leaseId,ownerToken:this.session.ownerToken,requestId,frameId:observation.id,
        operation:step.operation,...(candidateId?{candidateId}:{}),...(step.operation==='INPUT_TEXT'?{value:typeof step.arguments.value==='string'?step.arguments.value:programError('BOUND_VALUE_REQUIRED')} : {}),expected:step.verify});
      return this.receipt(step,receipt);
    }finally{remove();}
  }
  async verify(step:SkillStep,receipt:ExecutionReceipt,signal:AbortSignal){
    const remove=this.bindSignal(signal);try{await this.authorize();if(receipt.dispatch==='UNKNOWN')return;return this.proof(step,await this.session.verifySkill(step.verify,receipt.id));}finally{remove();}
  }
  async recover(decision:RecoveryDecision,observation:ReplayObservation,requestId:string,signal:AbortSignal){
    const step:SkillStep=decision.action==='REOPEN_SCOPE'?{id:'recovery',operation:'OPEN_APPLICATION',arguments:{appRef:this.session.appRef},verify:{kind:'FOREGROUND_IS',appRef:this.session.appRef},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'}:
      {id:'recovery',operation:'BACK',arguments:{reason:'DISMISS_BENIGN'},verify:{kind:'STATE_CHANGED'},effectClass:'READ',timeoutMs:5000,onFail:'BLOCK'};
    if(decision.action!=='REOPEN_SCOPE'&&decision.action!=='DISMISS_BENIGN')programError('RECOVERY_UNSUPPORTED');
    if(decision.action==='DISMISS_BENIGN'&&observation.blocker!=='BENIGN_DIALOG')programError('RECOVERY_UNGROUNDED');
    const candidates=observation.candidates.filter(c=>c.recovery==='DISMISS_BENIGN');
    if(decision.action==='DISMISS_BENIGN'&&candidates.length!==1)programError('RECOVERY_AMBIGUOUS');
    if(this.session.view().status==='PAUSED')this.session.resume();
    return this.execute(step,observation,decision.action==='DISMISS_BENIGN'?candidates[0].id:undefined,requestId,signal);
  }
  async close(){const result=await this.session.close('REVIEWING');return {cleanup:result.cleanup==='PROVEN'?'PROVEN' as const:'UNCERTAIN' as const};}
}
