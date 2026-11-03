import { skillReplayResponse } from '@/lib/skills/skill-replay-api';
export async function POST(request:Request,context:{params:Promise<{id:string;version:string}>}){const {id,version}=await context.params;return skillReplayResponse(request,id,version);}
