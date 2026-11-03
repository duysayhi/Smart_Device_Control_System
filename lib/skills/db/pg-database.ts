import pg, { type Pool } from 'pg';
import { TeachStorageError, teachStorageError } from './teach-errors';
export interface TeachQueryResult { rows: Record<string, unknown>[]; rowCount: number | null }
export interface TeachQuery { query(sql: string, values?: unknown[]): Promise<TeachQueryResult> }
export interface TeachDatabase extends TeachQuery { transaction<T>(work: (connection: TeachQuery) => Promise<T>): Promise<T>; close(): Promise<void>; connectionSecurity?():Promise<{encrypted:boolean;authorized:boolean}> }
export class PgTeachDatabase implements TeachDatabase {
  constructor(private readonly pool: Pool) {}
  /** Read-only client TLS evidence. A pooler/backend pg_stat_ssl row describes a different network leg. */
  async connectionSecurity() {
    const client=await this.pool.connect().catch(e=>{throw teachStorageError(e);});
    try{const stream=(client as unknown as {connection?:{stream?:{encrypted?:boolean;authorized?:boolean}}}).connection?.stream;
      return {encrypted:stream?.encrypted===true,authorized:stream?.authorized===true};
    }finally{client.release();}
  }
  async query(sql: string, values: unknown[] = []): Promise<TeachQueryResult> { try { return await this.pool.query(sql, values); } catch (e) { throw teachStorageError(e); } }
  async transaction<T>(work: (connection: TeachQuery) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect().catch(e => { throw teachStorageError(e); });
    let committing = false, uncertain = false;
    try {
      await connection.query('BEGIN'); const result = await work(connection); committing = true; await connection.query('COMMIT'); return result;
    } catch (e) {
      const error = teachStorageError(e);
      uncertain = committing && error.code === 'DATABASE_ERROR';
      try { await connection.query('ROLLBACK'); } catch { /* Preserve only the sanitized domain error. */ }
      throw uncertain ? new TeachStorageError('SAVE_OUTCOME_UNKNOWN') : error;
    }
    finally { connection.release(uncertain); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
/** No environment access, migration, default credentials, connection or consent at import time. */
export function createTeachPostgresDatabase(connectionString: string): PgTeachDatabase {
  if (typeof connectionString !== 'string' || !/^postgres(?:ql)?:\/\//.test(connectionString)) throw new TeachStorageError('INVALID_PAYLOAD');
  return new PgTeachDatabase(new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000 }));
}
