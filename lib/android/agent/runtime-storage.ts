import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readdirSync, readFileSync } from 'node:fs';
export function androidRuntimeDigest(): string | undefined {
  try {
    const root = join(process.cwd(), 'lib', 'android');
    return createHash('sha256').update(readdirSync(root, { recursive: true }).filter((f): f is string => typeof f === 'string' && f.endsWith('.ts')).sort()
      .map(f => f + '\n' + readFileSync(join(root, f), 'utf8')).join('\n')).digest('hex');
  } catch { return undefined; } // Packaged deployments may omit source; acceptance must not guess a digest.
}
export function runtimeDirectory(root = process.cwd()) {
  return join(tmpdir(), 'phone-commander-runtime-' + createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 20));
}
export function teachRuntimeDigest(): string | undefined {
  const android=androidRuntimeDigest();if(!android)return;
  try {
    const root=join(process.cwd(),'lib','skills');
    return createHash('sha256').update(android+'\n'+readdirSync(root,{recursive:true}).filter((f):f is string=>typeof f==='string'&&f.endsWith('.ts')).sort()
      .map(f=>f+'\n'+readFileSync(join(root,f),'utf8')).join('\n')).digest('hex');
  } catch{return undefined;}
}
export interface WorkerAddress { port: number; token: string; pid: number; protocol: 1; features?: string[]; runtimeSha256?: string; teachRuntimeSha256?: string; ownerAuthSha256?:string; observerIdleTimeoutMs?: number }
