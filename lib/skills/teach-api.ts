import { isLocalMutation, isLocalSameOrigin } from '../android/agent/request-origin';
import { TeachStorageError, teachStorageError } from './db/teach-errors';
import { OfflineTeachDashboard } from './teach-dashboard';
import { createHash } from 'node:crypto';
import { createTeachPostgresDatabase } from './db/pg-database';
import { PostgresTeachRepository, teachDatabaseSchema } from './db/postgres-teach-repository';

// Explicit G1 fixture configuration. This grants no device or remote-storage permission.
const globalStore = globalThis as typeof globalThis & {
  phoneCommanderTeachOfflineG1?: OfflineTeachDashboard;
  phoneCommanderTeachPostgres?: { binding: string; dashboard: OfflineTeachDashboard };
  phoneCommanderTeachLiveG3?: { cleanupProven(sessionId: string): boolean };
};
export function offlineTeachDashboard() {
  return globalStore.phoneCommanderTeachOfflineG1 ??= new OfflineTeachDashboard({ mode: 'OFFLINE_TEST', workspaceRoot: process.cwd(),
    consentGranted: true, devices: [{ id: '10000000-0000-4000-8000-000000000001', label: 'Thiết bị mẫu offline — không kết nối Android' }] });
}

/** Server composition only. The explicit offline default never masks a PostgreSQL failure. */
export function teachDashboard() {
  const mode = process.env.TEACH_STORAGE_MODE ?? 'OFFLINE_TEST';
  if (mode === 'OFFLINE_TEST') return offlineTeachDashboard();
  if (mode !== 'POSTGRESQL') throw new TeachStorageError('DATABASE_ERROR');
  const url = process.env.DATABASE_URL;
  if (!url || teachDatabaseSchema() !== 'teach_mode') throw new TeachStorageError('DATABASE_ERROR');
  const binding = createHash('sha256').update(JSON.stringify([process.cwd(), url, 'teach_mode'])).digest('hex');
  const existing = globalStore.phoneCommanderTeachPostgres;
  // Configuration changes need a process restart; never silently reuse another database or pool.
  if (existing) {
    if (existing.binding !== binding) throw new TeachStorageError('DATABASE_ERROR');
    return existing.dashboard;
  }
  const database = createTeachPostgresDatabase(url);
  const dashboard = new OfflineTeachDashboard({ mode: 'OFFLINE_TEST', workspaceRoot: process.cwd(),
    // Permission to declare a form is not remote consent; repository/DB check consent on Save.
    consentGranted: true, devices: [{ id: '10000000-0000-4000-8000-000000000001', label: 'Phiên khai báo mẫu — không kết nối Android' }] },
  { mode: 'POSTGRESQL', repository: new PostgresTeachRepository(database, 'teach_mode'), cleanupVerified: async session => globalStore.phoneCommanderTeachLiveG3?.cleanupProven(session.id) === true });
  globalStore.phoneCommanderTeachPostgres = { binding, dashboard };
  return dashboard;
}

export type TeachEndpoint = 'fixtures' | 'create' | 'start' | 'actions' | 'finish' | 'compile' | 'save-draft' | 'skills' | 'version';
export async function teachResponse(request: Request, endpoint: TeachEndpoint, params: { id?: string; version?: string } = {},
  service?: OfflineTeachDashboard) {
  const read = ['fixtures', 'skills', 'version'].includes(endpoint);
  if (request.method !== (read ? 'GET' : 'POST')) return Response.json({ error: 'Method not supported.' }, { status: 405 });
  if (!(read ? isLocalSameOrigin(request) : isLocalMutation(request))) return Response.json({ error: 'Local same-origin JSON request required.' }, { status: 403 });
  try {
    service ??= teachDashboard();
    const body = read ? undefined : await request.json().catch(() => null);
    let result: unknown;
    switch (endpoint) {
      case 'fixtures': result = service.fixtures(); break;
      case 'create': result = service.create(body); break;
      case 'start': result = service.start(params.id ?? '', body); break;
      case 'actions': result = service.add(params.id ?? '', body); break;
      case 'finish': result = service.finish(params.id ?? '', body); break;
      case 'compile': result = service.compile(params.id ?? '', body); break;
      case 'save-draft': result = await service.save(params.id ?? '', body); break;
      case 'skills': result = await service.listSkills(); break;
      case 'version': result = await service.versionView(params.id ?? '', /^\d{1,4}$/.test(params.version ?? '') ? Number(params.version) : 0); break;
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = teachStorageError(cause);
    const status = error.code === 'NO_REMOTE_CONSENT' ? 403 : error.code === 'NOT_FOUND' ? 404 :
      error.code === 'DATABASE_ERROR' ? 500 : ['CONFLICT', 'INVALID_TRANSITION', 'NOT_RECORDING', 'SAVE_OUTCOME_UNKNOWN'].includes(error.code) ? 409 : 400;
    return Response.json({ code: error.code, error: error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
export function unknownTeachOperation() {
  const error = new TeachStorageError('NOT_FOUND'); return Response.json({ code: error.code, error: error.message }, { status: 404 });
}
