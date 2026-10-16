import { createServer } from 'node:net';
import { mkdir, rmdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PortLease { systemPort: number; chromedriverPort: number; mjpegServerPort: number; release(): Promise<void> }
async function available(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer(); server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
// Filesystem reservations cover separate Next/worker processes as well as one process.
export async function allocateSessionPorts(serial: string): Promise<PortLease> {
  const root = join(tmpdir(), 'phone-commander-appium-ports'); await mkdir(root, { recursive: true });
  const leaseId = randomUUID();
  const reserved: { port: number; path: string }[] = [];
  async function release() {
    for (const item of [...reserved].reverse()) {
      const owner = JSON.parse(await readFile(join(item.path, 'owner.json'), 'utf8'));
      if (owner.leaseId !== leaseId) throw new Error('Appium port ownership changed; retain the device lock for inspection.');
      await unlink(join(item.path, 'owner.json')); await rmdir(item.path);
      reserved.splice(reserved.indexOf(item), 1);
    }
  }
  async function reserve(start: number) {
    for (let port = start; port < start + 80; port++) {
      const path = join(root, String(port));
      try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
      try {
        try { await writeFile(join(path, 'owner.json'), JSON.stringify({ serial, pid: process.pid, leaseId }), 'utf8'); }
        catch (error) { await unlink(join(path, 'owner.json')).catch(() => {}); await rmdir(path); throw error; }
        reserved.push({ port, path });
        if (await available(port)) return port;
        await unlink(join(path, 'owner.json')); await rmdir(path); reserved.pop();
      } catch (error) { throw error; }
    }
    throw new Error('No isolated Appium port is available.');
  }
  try {
    const systemPort = await reserve(8200), chromedriverPort = await reserve(9515), mjpegServerPort = await reserve(9100);
    return { systemPort, chromedriverPort, mjpegServerPort, release };
  } catch (error) { await release(); throw error; }
}
