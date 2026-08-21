import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql, type Kysely } from 'kysely'
import type { Database } from './schema.js'

const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(here, '../../../../db/migrations')

export async function runMigrations(db: Kysely<Database>): Promise<string[]> {
  await sql`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `.execute(db)

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set(
    (await sql<{ name: string }>`select name from _migrations`.execute(db)).rows.map((r) => r.name),
  )

  const ran: string[] = []
  for (const name of files) {
    if (applied.has(name)) continue
    const body = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    await db.transaction().execute(async (tx) => {
      await sql.raw(body).execute(tx)
      await sql`insert into _migrations (name) values (${name})`.execute(tx)
    })
    ran.push(name)
  }
  return ran
}
