import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Observation } from '../state-observer';
import { geometryFingerprint } from '../visual-grounding';
import type { VerifiedEvidence } from './evidence-predicates';
import { isVerifiedEvidence } from './verification-registry';
import { isGroundedCandidate, type GroundedCandidateV2 } from './grounded-candidates-v2';
import { runtimeDirectory } from './runtime-storage';

const Edge = z.object({ from: z.string().max(10000), to: z.string().max(10000), action: z.enum(['CLICK', 'BACK', 'SCROLL']), label: z.string().max(160), at: z.number() }).strict();
const Document = z.object({ version: z.literal(1), physicalId: z.string(), packageName: z.string(), packageVersion: z.string(), edges: z.array(Edge).max(80) }).strict();
export class RouteHints {
  private readonly file: string;
  constructor(private readonly scope: { deviceId: string; physicalId: string; executionId: string; packageName: string; packageVersion: string }, private readonly root = join(runtimeDirectory(), 'route-hints')) {
    if (!scope.physicalId || !scope.packageName || !/^[\w.+-]{1,80}$/.test(scope.packageVersion)) throw Error('Route identity/version unavailable.');
    this.file = join(root, createHash('sha256').update(JSON.stringify([scope.physicalId, scope.packageName, scope.packageVersion])).digest('hex') + '.json');
  }
  hints() {
    try {
      const raw = readFileSync(this.file, 'utf8'); if (raw.length > 1000000) return [];
      const doc = Document.parse(JSON.parse(raw));
      if (doc.physicalId !== this.scope.physicalId || doc.packageName !== this.scope.packageName || doc.packageVersion !== this.scope.packageVersion) return [];
      return doc.edges.map(e => ({ ...e, verified: true as const }));
    } catch { return []; }
  }
  record(before: Observation, after: Observation, candidate: GroundedCandidateV2, proof: VerifiedEvidence) {
    if (!isGroundedCandidate(candidate) || !isVerifiedEvidence(proof) || candidate.effect !== 'READ' || candidate.nodeId !== proof.nodeId ||
      candidate.deviceId !== this.scope.deviceId || candidate.executionId !== this.scope.executionId || candidate.target.packageName !== this.scope.packageName ||
      candidate.snapshotId !== before.snapshotId || !['CLICK', 'BACK', 'SCROLL'].includes(candidate.action) || proof.deviceId !== this.scope.deviceId || proof.executionId !== this.scope.executionId || proof.snapshotId !== after.snapshotId ||
      proof.predicate.kind !== 'ELEMENT_VISIBLE' || [before, after].some(s => s.deviceSerial !== this.scope.deviceId || s.foregroundPackage !== this.scope.packageName || s.observationStatus !== 'OBSERVED') ||
      Date.now() - after.timestamp > 5000 || after.timestamp > Date.now() || after.timestamp < before.timestamp || geometryFingerprint(before) === geometryFingerprint(after)) throw Error('Only independently verified navigation may be persisted.');
    const edge = Edge.parse({ from: geometryFingerprint(before), to: geometryFingerprint(after), action: candidate.action, label: candidate.target.label.slice(0, 160), at: Date.now() });
    const edges = this.hints().filter(e => e.from !== edge.from || e.to !== edge.to || e.action !== edge.action).map(({ from, to, action, label, at }) => ({ from, to, action, label, at }));
    const doc = Document.parse({ version: 1, physicalId: this.scope.physicalId, packageName: this.scope.packageName, packageVersion: this.scope.packageVersion, edges: [...edges, edge].slice(-80) });
    mkdirSync(this.root, { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, JSON.stringify(doc), { flag: 'wx', mode: 0o600 }); renameSync(temp, this.file);
  }
}
