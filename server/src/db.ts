import pg, { type PoolClient, type QueryResultRow } from 'pg'
import { config } from './config.js'
import {instrumentAuditClient,instrumentAuditPool} from './audit-context.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'careframe-api',
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
})
instrumentAuditPool(pool);
pool.on('connect',client=>instrumentAuditClient(client));

pool.on('error', error => {
  console.error('Unexpected PostgreSQL pool error', error)
})

export async function withTenant<T>(
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function queryOne<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  const result = await pool.query<T>(sql, values)
  return result.rows[0] ?? null
}
