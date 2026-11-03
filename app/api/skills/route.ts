import { teachResponse } from '@/lib/skills/teach-api';

export function GET(request: Request) { return teachResponse(request, 'skills'); }
