import { mkdir, open, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import type { Observation } from '../state-observer';
import type { GoalNodeV2 } from './goal-graph';
import type { GroundedCandidateV2 } from './grounded-candidates-v2';
import { isGroundedCandidate } from './grounded-candidates-v2';
import { assertOwnerTestExecution, type OwnerTestExecution } from './owner-test-policy';
import { decidePermission, issueJournalAuthorization } from './permission-decision';
import { observedMathExpression } from './math-keypad';
import { isVerifiedEvidence } from './verification-registry';
import type { VerifiedEvidence } from './evidence-predicates';
import { isIssuedMediaInventory, type MediaInventory } from './media-evidence';
import { issuedTemporalInventory, isTemporalEvidence, temporalPrecondition, type TemporalInventory, type TemporalEvidence } from './temporal-evidence';
import { issuedTemporalUiInventory, temporalUiPrecondition, isTemporalUiProof, type TemporalUiInventory, type TemporalUiProof } from './temporal-ui';

export interface LocalEffectRecord { id: string; nodeId: string; kind: 'CREATE_ARTIFACT' | 'CREATE_RECORD' | 'EXACT_LOCAL_CALCULATION' | 'CREATE_ALARM' | 'START_TIMER'; dispatch: 'NOT_SENT' | 'UNKNOWN' | 'ACKNOWLEDGED'; verified: boolean; evidenceId?: string; artifactUri?: string; disposition: 'NO_EFFECT' | 'UNVERIFIED_LEFT_IN_PLACE' | 'LEFT_IN_PLACE' | 'NON_PERSISTING'; }
export interface LocalEffectTicket { readonly authorization: object; readonly candidate: GroundedCandidateV2; readonly journalId: string }
const tickets = new WeakMap<LocalEffectTicket, { journal: LocalEffectJournal; record: LocalEffectRecord; sent: boolean }>();
export class LocalEffectJournal {
  readonly id = randomUUID();
  readonly authorization: object;
  readonly records: LocalEffectRecord[] = [];
  private readonly attempted = new Set<string>();
  private path = '';
  private constructor(readonly owner: OwnerTestExecution, readonly source: string, readonly node: GoalNodeV2) {
    this.authorization = issueJournalAuthorization(owner, source, node.outcome);
  }
  static async begin(owner: OwnerTestExecution, source: string, node: GoalNodeV2, snapshot: Observation, preState: unknown) {
    if (snapshot.deviceSerial !== owner.deviceId || snapshot.foregroundPackage !== node.packageName || snapshot.observationStatus !== 'OBSERVED' || Date.now() - snapshot.timestamp < 0 || Date.now() - snapshot.timestamp > 5000) throw Error('HARD_DENY: fresh local pre-state required.');
    if (node.capability === 'CALCULATE') {
      const expression = observedMathExpression(snapshot);
      if (expression !== undefined && expression.trim()) throw Error('HARD_DENY: existing calculation cannot be replaced.');
    }
    if (node.capability === 'CAPTURE_MEDIA') {
      const inventory = preState as MediaInventory;
      if (!inventory || !isIssuedMediaInventory(inventory) || !inventory.summary || inventory.deviceId !== owner.deviceId || inventory.physicalId !== owner.physicalId || Date.now() - inventory.observedAt > 5000) throw Error('HARD_DENY: issued complete MediaStore pre-state required.');
    }
    if (node.outcome.temporal) {
      const inventory = preState as TemporalInventory;
      const ui = preState as TemporalUiInventory;
      if (issuedTemporalUiInventory(ui)) {
        if (ui.deviceId !== owner.deviceId || ui.packageName !== node.packageName) throw Error('HARD_DENY: foreign UI temporal inventory.');
        temporalUiPrecondition(ui, node.outcome.temporal);
      } else {
        if (!issuedTemporalInventory(inventory) || inventory.deviceId !== owner.deviceId || inventory.packageName !== node.packageName) throw Error('HARD_DENY: issued temporal inventory required.');
        temporalPrecondition(inventory, node.outcome.temporal);
      }
    }
    const journal = new LocalEffectJournal(owner, source, node);
    const directory = join(tmpdir(), 'phone-commander-local-effects'); await mkdir(directory, { recursive: true });
    journal.path = join(directory, journal.id + '.jsonl'); const file = await open(journal.path, 'wx', 0o600); await file.close();
    await journal.log('PRE_STATE', { snapshotId: snapshot.snapshotId, preState }); return journal;
  }
  private check() {
    const result = decidePermission({ source: this.source, stage: 'EFFECT', owner: this.owner, deviceId: this.owner.deviceId, physicalId: this.owner.physicalId, executionId: this.owner.executionId, outcome: this.node.outcome, journal: this.authorization });
    if (result.decision !== 'ALLOW') throw Error('HARD_DENY: ' + result.reason);
  }
  validate() { this.check(); }
  async temporalDispatch() {
    this.check();
    if (!this.node.outcome.temporal || this.attempted.has('temporal')) throw Error('HARD_DENY: temporal effect cannot be replayed.');
    this.attempted.add('temporal');
    const record: LocalEffectRecord = { id: randomUUID(), nodeId: this.node.id, kind: this.node.outcome.temporal.kind === 'ALARM' ? 'CREATE_ALARM' : 'START_TIMER', dispatch: 'UNKNOWN', verified: false, disposition: 'UNVERIFIED_LEFT_IN_PLACE' };
    this.records.push(record); await this.log('DISPATCH_ATTEMPT', record);
  }
  async temporalAcknowledged() {
    this.check(); const record = this.records.at(-1);
    if (!record || record.dispatch !== 'UNKNOWN') throw Error('HARD_DENY: temporal dispatch missing.');
    record.dispatch = 'ACKNOWLEDGED'; await this.log('DISPATCH_ACKNOWLEDGED', record);
  }
  async verifiedTemporal(proof: TemporalEvidence) {
    this.check();
    if (!isTemporalEvidence(proof) || proof.deviceId !== this.owner.deviceId || proof.executionId !== this.owner.executionId || proof.nodeId !== this.node.id || JSON.stringify(proof.request) !== JSON.stringify(this.node.outcome.temporal)) throw Error('HARD_DENY: independent temporal proof required.');
    const record = this.records.at(-1);
    if (!record || record.dispatch !== 'ACKNOWLEDGED') throw Error('HARD_DENY: acknowledged temporal dispatch required.');
    record.verified = true; record.evidenceId = proof.id; record.artifactUri = proof.identity; record.disposition = 'LEFT_IN_PLACE';
    await this.log('INDEPENDENT_OUTCOME_VERIFIED', record);
  }
  async verifiedTemporalUi(proof: TemporalUiProof) {
    this.check();
    if (!isTemporalUiProof(proof) || proof.deviceId !== this.owner.deviceId || proof.executionId !== this.owner.executionId || proof.nodeId !== this.node.id || JSON.stringify(proof.request) !== JSON.stringify(this.node.outcome.temporal)) throw Error('HARD_DENY: issued UI temporal proof required.');
    if (!this.records.some(r => r.dispatch !== 'NOT_SENT')) throw Error('HARD_DENY: no recorded temporal UI dispatch.');
    for (const record of this.records.filter(r => r.dispatch !== 'NOT_SENT')) {
      record.verified = true; record.evidenceId = proof.id; record.artifactUri = proof.identity; record.disposition = 'LEFT_IN_PLACE';
    }
    // UNKNOWN stays UNKNOWN in the audit; independent late evidence does not forge an ACK.
    await this.log('UI_TEMPORAL_OUTCOME_VERIFIED', { tier: proof.tier, proof, records: this.records });
  }
  async log(event: string, detail: unknown) {
    this.check(); await appendFile(this.path, JSON.stringify({ at: Date.now(), event, journalId: this.id, deviceId: this.owner.deviceId, physicalId: this.owner.physicalId,
      executionId: this.owner.executionId, authorizationId: this.owner.id, nodeId: this.node.id, sourceHash: createHash('sha256').update(this.source).digest('hex'), detail }) + '\n', { mode: 0o600, flush: true });
  }
  async prepare(candidate: GroundedCandidateV2): Promise<LocalEffectTicket> {
    this.check();
    if (!isGroundedCandidate(candidate) || candidate.nodeId !== this.node.id || candidate.deviceId !== this.owner.deviceId || candidate.executionId !== this.owner.executionId) throw Error('HARD_DENY: foreign local candidate.');
    const kind = this.node.outcome.temporal?.kind === 'ALARM' ? 'CREATE_ALARM' : this.node.outcome.temporal?.kind === 'TIMER' ? 'START_TIMER' : this.node.capability === 'CAPTURE_MEDIA' ? 'CREATE_ARTIFACT' : this.node.capability === 'CREATE_RECORD' ? 'CREATE_RECORD' : 'EXACT_LOCAL_CALCULATION';
    const record: LocalEffectRecord = { id: randomUUID(), nodeId: this.node.id, kind, dispatch: 'NOT_SENT', verified: false, disposition: 'NO_EFFECT' };
    const ticket = Object.freeze({ authorization: this.authorization, candidate, journalId: this.id });
    tickets.set(ticket, { journal: this, record, sent: false }); this.records.push(record); await this.log('PREPARED_SINGLE_USE', record); return ticket;
  }
  async dispatch(ticket: LocalEffectTicket) {
    this.check(); const state = tickets.get(ticket);
    if (!state || state.journal !== this) throw Error('HARD_DENY: unissued journal ticket.');
    const c = ticket.candidate, key = c.capture ? 'capture' : JSON.stringify([c.action, c.record?.phase, c.record?.field, c.temporal?.scopeId, c.temporal?.phase, c.keypad?.before, c.keypad?.after, c.value]);
    if (!state.sent) {
      if (this.attempted.has(key)) throw Error('HARD_DENY: local effect is never replayed.');
      this.attempted.add(key); state.sent = true;
    }
    state.record.dispatch = 'UNKNOWN'; state.record.disposition = 'UNVERIFIED_LEFT_IN_PLACE'; await this.log('DISPATCH_ATTEMPT', state.record);
  }
  async acknowledged(ticket: LocalEffectTicket) {
    const state = tickets.get(ticket); if (!state || state.journal !== this) throw Error('HARD_DENY: foreign journal receipt.');
    state.record.dispatch = 'ACKNOWLEDGED'; await this.log('DISPATCH_ACKNOWLEDGED', state.record);
  }
  async verified(evidence: VerifiedEvidence) {
    if (!isVerifiedEvidence(evidence) || evidence.deviceId !== this.owner.deviceId || evidence.executionId !== this.owner.executionId || evidence.nodeId !== this.node.id) throw Error('HARD_DENY: independent issued evidence required.');
    const expected = this.node.capability === 'CAPTURE_MEDIA' ? 'ARTIFACT_EXISTS' : this.node.capability === 'CREATE_RECORD' ? 'RECORD_READBACK_MATCHES' : 'VALUE_EQUALS';
    if (evidence.predicate.kind !== expected || this.node.capability === 'CAPTURE_MEDIA' && (!evidence.media || evidence.provider !== 'MEDIA_STORE_V2')) throw Error('HARD_DENY: launch/transition evidence cannot prove a local outcome.');
    for (const record of this.records.filter(r => r.dispatch === 'ACKNOWLEDGED')) {
      record.verified = true; record.evidenceId = evidence.id; record.artifactUri = evidence.media?.uri;
      record.disposition = record.kind === 'EXACT_LOCAL_CALCULATION' ? 'NON_PERSISTING' : 'LEFT_IN_PLACE';
    }
    await this.log('INDEPENDENT_OUTCOME_VERIFIED', this.records);
  }
}
export function assertLocalEffectTicket(ticket: LocalEffectTicket, owner: OwnerTestExecution, candidate: GroundedCandidateV2) {
  const state = tickets.get(ticket);
  assertOwnerTestExecution(owner, candidate.deviceId, owner.physicalId, candidate.executionId);
  if (!state || state.sent || state.journal.owner !== owner || ticket.candidate !== candidate) throw Error('HARD_DENY: local ticket is foreign, modified or used.');
  state.journal.validate();
}
export async function journalLocalDispatch(ticket?: LocalEffectTicket) { if (ticket) await tickets.get(ticket)!.journal.dispatch(ticket); }
export async function journalLocalAcknowledged(ticket?: LocalEffectTicket) { if (ticket) await tickets.get(ticket)!.journal.acknowledged(ticket); }

export async function journalAutoInterpretation(owner: OwnerTestExecution, source: string, plan: import('./outcome-spec').OutcomeSpecV2) {
  const decision = decidePermission({ source, stage: 'INTERPRETATION', owner, deviceId: owner.deviceId, physicalId: owner.physicalId, executionId: owner.executionId, plan });
  if (decision.decision !== 'ALLOW') throw Error('HARD_DENY: interpretation is not eligible for auto-review.');
  const directory = join(tmpdir(), 'phone-commander-local-effects'); await mkdir(directory, { recursive: true });
  await appendFile(join(directory, 'interpretations.jsonl'), JSON.stringify({ at: Date.now(), event: 'SOURCE_EXACT_AUTO_REVIEW',
    deviceId: owner.deviceId, executionId: owner.executionId, authorizationId: owner.id, expiresAt: owner.expiresAt, plan }) + '\n', { mode: 0o600, flush: true });
}
