import { RuntimeCommand, EvidenceQuery } from '@/lib/android/agent/runtime-schema';
import { workerRequest } from '@/lib/android/agent/worker-client';
import { isLocalSameOrigin, isLocalMutation } from '@/lib/android/agent/request-origin';
export async function GET(request: Request) {
  if (!isLocalSameOrigin(request)) return Response.json({ error: 'Origin không hợp lệ.' }, { status: 403 });
  const query = new URL(request.url).searchParams;
  if (query.size) {
    const evidence = EvidenceQuery.safeParse(Object.fromEntries(query));
    if (!evidence.success) return Response.json({ error: 'Evidence identity không hợp lệ.' }, { status: 400 });
    try {
      const reply = await workerRequest('GET', evidence.data, '/evidence');
      return new Response(await reply.arrayBuffer(), { status: reply.status, headers: { 'Content-Type': reply.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return Response.json({ error: 'Evidence không còn khả dụng.' }, { status: 410 }); }
  }
  try { const response = await workerRequest('GET'); return Response.json(await response.json(), { status: response.status }); }
  catch { return Response.json({ error: 'Runtime worker không sẵn sàng.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ error: 'Origin không hợp lệ.' }, { status: 403 });
  const command = RuntimeCommand.safeParse(await request.json().catch(() => null));
  if (!command.success) return Response.json({ error: 'Lệnh runtime không hợp lệ.' }, { status: 400 });
  try { const response = await workerRequest('POST', command.data); return Response.json(await response.json(), { status: response.status }); }
  catch { return Response.json({ error: 'Runtime worker không sẵn sàng. Kiểm tra trạng thái trước khi gửi lại.' }, { status: 503 }); }
}
