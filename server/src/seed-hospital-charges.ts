import dotenv from 'dotenv'
import pg from 'pg'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

dotenv.config({ path: process.env.ENV_FILE ?? '.env' })

const filename = '021_seed_hospital_charge_master.sql'

async function seedHospitalCharges() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [741_920_121])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename])
    if (applied.rowCount) {
      console.log(`${filename} already applied`)
      return
    }

    const sql = await readFile(path.resolve(process.cwd(), 'database/migrations', filename), 'utf8')
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename])
    console.log(`${filename} applied successfully`)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [741_920_121]).catch(() => undefined)
    await client.end()
  }
}

await seedHospitalCharges()
