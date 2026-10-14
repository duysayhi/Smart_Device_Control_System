import { z } from 'zod';
import { probeOllama } from '@/lib/android/agent/diagnostics';

let active = false;
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') return Response.json({ error: 'Development-only probe.' }, { status: 404 });
  const input = z.object({ chat: z.boolean().default(false) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: 'Invalid probe input.' }, { status: 400 });
  if (active) return Response.json({ error: 'Probe already running.' }, { status: 409 });
  active = true;
  try { return Response.json(await probeOllama(input.data.chat, request.signal), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Local probe configuration failed.' }, { status: 422 }); }
  finally { active = false; }
}
