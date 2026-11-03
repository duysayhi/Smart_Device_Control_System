import { teachResponse, unknownTeachOperation } from '@/lib/skills/teach-api';

export async function POST(request: Request, context: { params: Promise<{ id: string; operation: string }> }) {
  const { id, operation } = await context.params;
  if (operation !== 'start' && operation !== 'actions' && operation !== 'finish' && operation !== 'compile' && operation !== 'save-draft') return unknownTeachOperation();
  return teachResponse(request, operation, { id });
}
