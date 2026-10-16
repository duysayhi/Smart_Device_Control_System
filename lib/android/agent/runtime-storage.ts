import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
export function runtimeDirectory(root = process.cwd()) {
  return join(tmpdir(), 'phone-commander-runtime-' + createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 20));
}
export interface WorkerAddress { port: number; token: string; pid: number; protocol: 1 }
