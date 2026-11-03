import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SanitizedTeachSnapshot } from './snapshot-sanitizer';
import { inspectJson } from './skill-safety';
import { TeachStorageError } from './db/teach-errors';

const contained = (root: string, file: string) => { const relative = path.relative(root,file); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
const redacted = z.object({nodes:z.array(z.object({role:z.enum(['search_field','search_action','navigation','collection','dialog','control','status','unknown']),labelClass:z.enum(['SEARCH_FIELD','SEARCH_ACTION','BACK_ACTION','NAVIGATION_CONTROL','COLLECTION','STRUCTURAL_ONLY','OMITTED']),enabled:z.boolean(),displayed:z.boolean(),editable:z.boolean(),redactionStatus:z.literal('REDACTED'),reasons:z.array(z.literal('METADATA_ONLY'))}).strict()).max(1000),redactionStatus:z.literal('REDACTED'),reasons:z.array(z.literal('METADATA_ONLY')),captureAllowed:z.literal(false)}).strict();
/** The root is server-owned. Clients can neither choose the root nor supply image bytes. */
export class TeachAssetStore {
  readonly root: string;
  constructor(private readonly workspaceRoot: string) { this.root = path.resolve(workspaceRoot,'data/teach-mode/assets'); }
  private reference(ref: string): string {
    if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$/.test(ref) || ref.split('/').some(p=>!p || p==='.' || p==='..' || p.endsWith('.')) || path.win32.isAbsolute(ref)) throw new TeachStorageError('ASSET_PATH_REJECTED');
    const resolved = path.resolve(this.root,ref); if (!contained(this.root,resolved)) throw new TeachStorageError('ASSET_PATH_REJECTED'); return resolved;
  }
  private async directories(create: boolean) {
    const workspace = path.resolve(this.workspaceRoot);
    for (const part of ['data','data/teach-mode','data/teach-mode/assets']) {
      const folder = path.join(workspace,part);
      try { if ((await fs.lstat(folder)).isSymbolicLink()) throw new TeachStorageError('ASSET_PATH_REJECTED'); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw e;
        await fs.mkdir(folder);
      }
    }
    const physicalRoot = await fs.realpath(this.root), physicalWorkspace = await fs.realpath(workspace);
    if (!contained(physicalWorkspace,physicalRoot)) throw new TeachStorageError('ASSET_PATH_REJECTED');
    return physicalRoot;
  }
  async write(snapshot: SanitizedTeachSnapshot): Promise<string> {
    if (inspectJson(snapshot).errors.length || !redacted.safeParse(snapshot).success) throw new TeachStorageError('INVALID_PAYLOAD');
    try {
      const physicalRoot = await this.directories(true), ref = randomUUID() + '.json';
      await fs.writeFile(path.join(physicalRoot,ref),JSON.stringify(snapshot),{encoding:'utf8',flag:'wx',mode:0o600}); return ref;
    } catch (e) { if (e instanceof TeachStorageError) throw e; throw new TeachStorageError('ASSET_ERROR'); }
  }
  async remove(ref: string): Promise<boolean> {
    const file = this.reference(ref);
    try {
      const root = await this.directories(false);
      let current = this.root;
      for (const component of ref.split('/')) {
        current = path.join(current,component); if ((await fs.lstat(current)).isSymbolicLink()) throw new TeachStorageError('ASSET_PATH_REJECTED');
      }
      if (!contained(root,await fs.realpath(file))) throw new TeachStorageError('ASSET_PATH_REJECTED');
      await fs.unlink(file); return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      if (e instanceof TeachStorageError) throw e;
      throw new TeachStorageError('ASSET_ERROR');
    }
  }
}
