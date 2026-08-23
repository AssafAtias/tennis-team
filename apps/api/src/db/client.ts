import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

// count(...) returns bigint; without this every aggregate arrives as a string.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))
// date columns arrive as JS Date objects by default; the schema types played_on
// as a string (and later API/pagination code treats it as YYYY-MM-DD), so keep
// it as the raw string instead of letting node-postgres parse it.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 })
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}
