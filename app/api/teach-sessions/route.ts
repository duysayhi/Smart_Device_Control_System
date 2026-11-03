import { teachResponse } from '@/lib/skills/teach-api';

export function GET(request: Request) { return teachResponse(request, 'fixtures'); }
export function POST(request: Request) { return teachResponse(request, 'create'); }
