import { historyResponse } from '@/lib/history/history-api';
export async function GET(request:Request){return historyResponse(request);}
