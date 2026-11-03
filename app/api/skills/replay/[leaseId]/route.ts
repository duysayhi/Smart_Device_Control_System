import { skillReplayControlResponse } from '@/lib/skills/skill-replay-api';
export async function POST(request:Request,context:{params:Promise<{leaseId:string}>}){return skillReplayControlResponse(request,(await context.params).leaseId);}
