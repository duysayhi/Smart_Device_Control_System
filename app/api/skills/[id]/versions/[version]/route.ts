import { teachResponse } from '@/lib/skills/teach-api';

export async function GET(request: Request, context: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await context.params; return teachResponse(request, 'version', { id, version });
}
