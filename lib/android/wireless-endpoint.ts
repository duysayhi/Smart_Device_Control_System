import { networkInterfaces } from 'node:os';
import { z } from 'zod';

export const WirelessPort = z.number().int().min(1024).max(65535);
export const WirelessIp = z.ipv4();
export function ipv4Number(ip: string): number { return ip.split('.').reduce((n, octet) => (n * 256 + Number(octet)) >>> 0, 0); }
export function addressAllowed(ip: string, cidrs: string[]): boolean {
  if (!WirelessIp.safeParse(ip).success) return false;
  const n = ipv4Number(ip);
  if (!((n >>> 24) === 10 || (n >>> 20) === 0xac1 || (n >>> 16) === 0xc0a8)) return false;
  return cidrs.some(cidr => {
    const [base, prefix] = cidr.split('/'), bits = Number(prefix);
    if (!WirelessIp.safeParse(base).success || !Number.isInteger(bits) || bits < 8 || bits > 32) return false;
    if (bits === 32) return n === ipv4Number(base);
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    const host = n & (~mask >>> 0);
    return ((n & mask) >>> 0) === ((ipv4Number(base) & mask) >>> 0) && host !== 0 && host !== (~mask >>> 0);
  });
}
export function allowedWirelessCidrs(): string[] {
  const configured = process.env.ANDROID_WIRELESS_ALLOWED_CIDRS?.split(',').map(s => s.trim()).filter(Boolean);
  return configured ?? Object.values(networkInterfaces()).flatMap(rows => (rows ?? []).filter(row => row.family === 'IPv4' && !row.internal && row.cidr).map(row => row.cidr!));
}
export function wirelessEndpoint(ip: string, port: number, cidrs = allowedWirelessCidrs()): string {
  WirelessPort.parse(port);
  if (!addressAllowed(ip, cidrs)) throw new Error('Only private IPv4 addresses on an allowed local subnet can be used for ADB. Check ANDROID_WIRELESS_ALLOWED_CIDRS.');
  return `${ip}:${port}`;
}
