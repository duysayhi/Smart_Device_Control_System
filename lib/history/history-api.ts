import { isLocalSameOrigin } from '../android/agent/request-origin';
import { historyStorage } from './history-database';
import { HistoryError, HistoryQuerySchema } from './history-model';
import type { HistoryRepository } from './postgres-history-repository';
export async function historyResponse(request:Request,provided?:{repository:HistoryRepository;verified:Promise<unknown>}) {
  if(request.method!=='GET')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
  if(!isLocalSameOrigin(request))return Response.json({code:'LOCAL_ORIGIN_REQUIRED'},{status:403});
  const params=new URL(request.url).searchParams;
  if(new Set(params.keys()).size!==params.size)return Response.json({code:'INVALID_HISTORY_QUERY'},{status:400});
  const parsed=HistoryQuerySchema.safeParse(Object.fromEntries(params));if(!parsed.success)return Response.json({code:'INVALID_HISTORY_QUERY'},{status:400});
  try{const store=provided??historyStorage();await store.verified;return Response.json(await store.repository.read(parsed.data),{headers:{'Cache-Control':'no-store'}});}
  catch(error){const code=error instanceof HistoryError?error.code:'HISTORY_DATABASE_UNAVAILABLE';return Response.json({code,error:'Không đọc được lịch sử PostgreSQL. Không dùng dữ liệu JSON thay thế.'},{status:code==='HISTORY_NOT_FOUND'?404:503,headers:{'Cache-Control':'no-store'}});}
}
