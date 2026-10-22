import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

export interface PackageRevision { packageName: string; versionCode: string; updatedAt?: string }
const rowSchema = z.object({ physicalId: z.string().min(1).max(200), packageName: z.string().regex(/^[A-Za-z][\w]*(?:\.[\w]+)+$/),
  versionCode: z.string().regex(/^\d{1,30}$/), updatedAt: z.string().max(100).optional(), component: z.string().max(300),
  labels: z.array(z.string().min(1).max(150).refine(s => !/[\u0000-\u001f]/.test(s))).max(200), retryAfter: z.number().finite().optional(), at: z.number().finite() }).strict();
type Row = z.infer<typeof rowSchema>;
const fileSchema = z.object({ schema: z.literal(1), rows: z.array(rowSchema).max(500) }).strict();
export const launcherCacheDirectory = () => join(tmpdir(), 'phone-commander-label-cache-v1');

// Names only. No caller may use this cache as proof of installation, identity or execution authority.
export class LauncherLabelCache {
  private rows: Row[] = [];
  private dirty = false;
  constructor(readonly directory = launcherCacheDirectory()) {}
  async load() {
    this.rows = [];
    try {
      const file = join(this.directory, 'labels.json');
      if ((await stat(file)).size > 1024 * 1024) return;
      this.rows = fileSchema.parse(JSON.parse(await readFile(file, 'utf8'))).rows;
    } catch { /* Absent, corrupt or incompatible metadata is a miss, never authority. */ }
  }
  get(physicalId: string, revision: PackageRevision, component: string): string[] | undefined {
    const row = this.rows.find(r => r.physicalId === physicalId && r.packageName === revision.packageName && r.component === component &&
      r.versionCode === revision.versionCode && r.updatedAt === revision.updatedAt);
    return row && (row.labels.length || row.retryAfter && row.retryAfter > Date.now()) ? [...row.labels] : undefined;
  }
  put(physicalId: string, revision: PackageRevision, component: string, labels: string[]) {
    const row = rowSchema.parse({ physicalId, ...revision, component, labels, at: Date.now(), ...(!labels.length ? { retryAfter: Date.now() + 300000 } : {}) });
    if (!component.startsWith(revision.packageName + '/')) throw Error('Foreign launcher component.');
    this.rows = this.rows.filter(r => !(r.physicalId === physicalId && r.packageName === revision.packageName && r.component === component));
    this.rows.push(row);
    const devices = [...new Set([...this.rows].sort((a, b) => b.at - a.at).map(r => r.physicalId))].slice(0, 8);
    this.rows = this.rows.filter(r => devices.includes(r.physicalId)).sort((a, b) => b.at - a.at).slice(0, 500);
    this.dirty = true;
  }
  async save() {
    if (!this.dirty) return;
    const content = JSON.stringify({ schema: 1, rows: this.rows });
    if (Buffer.byteLength(content) > 1024 * 1024) return;
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, 'labels.' + randomUUID() + '.tmp');
    try { await writeFile(temp, content, { mode: 0o600 }); await rename(temp, join(this.directory, 'labels.json')); this.dirty = false; }
    finally { await unlink(temp).catch(() => {}); }
  }
}

export function packageRevisions(dump: string): Map<string, PackageRevision> {
  const revisions = new Map<string, PackageRevision>();
  // Disabled system originals are not the installed replacement's revision.
  const installed = dump.split(/\r?\nHidden system packages:/)[0];
  for (const block of installed.split(/(?=^  Package \[)/m)) {
    const packageName = /^  Package \[([A-Za-z][\w]*(?:\.[\w]+)+)\]/m.exec(block)?.[1];
    const versionCode = /^\s+versionCode=(\d+)\b/m.exec(block)?.[1];
    const updatedAt = /^\s+lastUpdateTime=([^\r\n]+)\s*$/m.exec(block)?.[1]?.trim();
    if (packageName && versionCode && !revisions.has(packageName)) revisions.set(packageName, { packageName, versionCode, ...(updatedAt ? { updatedAt } : {}) });
  }
  return revisions;
}
