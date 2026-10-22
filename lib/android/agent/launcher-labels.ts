import { execFile } from 'node:child_process';
import { access, mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AdbRunner } from '../executor';
import { checkCancellation } from '../errors';
import { readTransportIdentity } from '../transport-identity';
import { LauncherLabelCache, packageRevisions } from './launcher-label-cache';

const exec = promisify(execFile);
const validLabel = (s: string) => s.length > 0 && s.length <= 150 && !/[\u0000-\u001f]/.test(s);
export function launcherLabelsFromBadging(text: string, packageName: string, component: string): string[] {
  if (!text.startsWith("package: name='" + packageName + "'")) return [];
  const activity = text.split(/\r?\n/).find(l => l.startsWith('launchable-activity:'));
  const name = activity?.match(/\bname='([^']+)'/)?.[1], label = activity?.match(/\blabel='([^']*)'/)?.[1];
  if (!component.startsWith(packageName + '/')) return [];
  if (name && packageName + '/' + name === component.replace('/.', '/' + packageName + '.') && label && validLabel(label)) return [label];
  return [...new Set([...text.matchAll(/^application-label(?:-[^:]+)?:'([^'\r\n]+)'$/gm)].map(m => m[1]).filter(validLabel))];
}
async function aaptPath(): Promise<string | undefined> {
  const roots = [...new Set([process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'AppData', 'Local', 'Android', 'Sdk')].filter((p): p is string => Boolean(p)))];
  for (const root of roots) try {
    for (const version of (await readdir(join(root, 'build-tools'))).sort().reverse()) {
      const file = join(root, 'build-tools', version, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
      try { await access(file); return file; } catch { /* Try the next installed SDK tool. */ }
    }
  } catch { /* Labels remain unavailable without a verified local resource reader. */ }
}
export interface LabelTiming { stage: 'identity' | 'metadata' | 'query' | 'pull' | 'aapt2' | 'parse' | 'cache-hit'; packageName?: string; elapsedMs: number }
export interface LabelReadOptions {
  directory?: string; budgetMs?: number; maxExtractions?: number; priorityPackages?: readonly string[]; expectedPhysicalId?: string;
  onTiming?(row: LabelTiming): void;
  extract?: (component: string, run: AdbRunner, signal?: AbortSignal) => Promise<string[]>;
}
// Only reads installed launcher APK resources; never installs a helper or opens an app.
export async function readLauncherLabels(serial: string, components: readonly string[], run: AdbRunner, signal?: AbortSignal, options: LabelReadOptions = {}): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(), deadline = Date.now() + Math.min(60000, Math.max(1, options.budgetMs ?? 60000));
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
  const measured = async <T>(stage: LabelTiming['stage'], packageName: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now(); try { return await fn(); } finally { options.onTiming?.({ stage, packageName, elapsedMs: performance.now() - start }); }
  };
  const invoke: AdbRunner = (args, timeout, extra) => run(args, Math.min(timeout ?? 5000, Math.max(1, deadline - Date.now())), { ...extra, signal: bounded });
  const cache = new LauncherLabelCache(options.directory);
  await cache.load();
  try {
    const identity = await measured('identity', undefined, () => readTransportIdentity(invoke, serial, true));
    checkCancellation(bounded);
    if (!identity || options.expectedPhysicalId && options.expectedPhysicalId !== identity.physicalId) return result;
    const metadata = await measured('metadata', undefined, () => invoke(['-s', serial, 'shell', 'dumpsys', 'package', 'packages'], 5000, { maxBufferBytes: 4 * 1024 * 1024 }));
    const revisions = packageRevisions(metadata.stdout), missing: string[] = [];
    // Read all valid hits even on a partial scan. Only unresolved, freshly revision-bound entries do APK work.
    for (const component of components) {
      const revision = revisions.get(component.split('/')[0]);
      if (!revision || !component.startsWith(revision.packageName + '/')) continue;
      const saved = cache.get(identity.physicalId, revision, component);
      if (saved) { result.set(component, saved); options.onTiming?.({ stage: 'cache-hit', packageName: revision.packageName, elapsedMs: 0 }); }
      else missing.push(component);
    }
    const priority = new Set(options.priorityPackages);
    missing.sort((a, b) => Number(priority.has(b.split('/')[0])) - Number(priority.has(a.split('/')[0])));
    if (options.maxExtractions === 0) return result;
    const aapt = missing.length && !options.extract ? await aaptPath() : undefined;
    if (!aapt && !options.extract) return result;
    for (const component of missing.slice(0, options.maxExtractions ?? missing.length)) {
      if (bounded.aborted) break;
      const pkg = component.split('/')[0]; let folder: string | undefined;
      try {
        let labels: string[];
        if (options.extract) labels = await options.extract(component, invoke, bounded);
        else {
          const paths = await measured('query', pkg, () => invoke(['-s', serial, 'shell', 'pm', 'path', pkg], 5000));
          const apk = paths.stdout.split(/\r?\n/).find(s => /^package:\/(?:data|system|product|vendor|system_ext)\/[^\r\n\u0000]+\.apk$/.test(s) && !/\/split[^/]*\.apk$/.test(s))?.slice(8);
          if (!apk) continue;
          folder = await mkdtemp(join(tmpdir(), 'phone-commander-label-'));
          const file = join(folder, 'launcher.apk');
          await measured('pull', pkg, () => invoke(['-s', serial, 'pull', apk, file], 15000));
          const output = await measured('aapt2', pkg, () => exec(aapt!, ['dump', 'badging', file], { timeout: Math.min(5000, Math.max(1, deadline - Date.now())), maxBuffer: 2000000, windowsHide: true, signal: bounded }));
          const start = performance.now(); labels = launcherLabelsFromBadging(output.stdout, pkg, component);
          options.onTiming?.({ stage: 'parse', packageName: pkg, elapsedMs: performance.now() - start });
        }
        checkCancellation(bounded);
        const stillSame = await measured('identity', pkg, () => readTransportIdentity(invoke, serial, true));
        checkCancellation(bounded);
        if (stillSame?.physicalId !== identity.physicalId) { result.clear(); return result; }
        result.set(component, labels); cache.put(identity.physicalId, revisions.get(pkg)!, component, labels);
      } catch { if (bounded.aborted) break; cache.put(identity.physicalId, revisions.get(pkg)!, component, []); }
      finally { if (folder) { await unlink(join(folder, 'launcher.apk')).catch(() => {}); await rmdir(folder).catch(() => {}); } }
    }
  } catch { checkCancellation(signal); }
  finally { await cache.save().catch(() => {}); }
  checkCancellation(signal);
  return result;
}
