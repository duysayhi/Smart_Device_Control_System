import { skillReplayOptionsResponse } from '@/lib/skills/skill-replay-api';
export async function GET(request: Request) { return skillReplayOptionsResponse(request); }
