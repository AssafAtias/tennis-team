import { afterAll } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { createDb, createPool } from '../../src/db/client.js'
import type { Database } from '../../src/db/schema.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required to run integration tests')

// vitest's default `isolate: true` re-evaluates this module per test FILE, so
// each file gets its own pool/`root`/`afterAll` here. That is what makes a
// module-scope pool safe: it is NOT shared across files. See vitest.config.ts.
const pool = createPool(testDatabaseUrl)
const root = createDb(pool)

afterAll(async () => {
  await root.destroy()
})

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, so tests within
 * one file share a migrated database without leaking rows into each other.
 * (Each test file gets its own pool/connection — see the `isolate` note above
 * — so this does not coordinate rollback across files, only within one.)
 *
 * If `fn` needs to assert that a statement violates a constraint, use
 * `expectViolation` below rather than a bare `rejects.toThrow`: a failed
 * statement aborts the surrounding Postgres transaction (error 25P02), and
 * every following statement in the same `withTx` body — including any
 * "confirm nothing was written" query — would fail with a confusing
 * "current transaction is aborted" error instead of running.
 */
export async function withTx(fn: (db: Kysely<Database>) => Promise<void>): Promise<void> {
  const sentinel = new Error('rollback')
  try {
    await root.transaction().execute(async (tx) => {
      await fn(tx)
      throw sentinel
    })
  } catch (err) {
    if (err !== sentinel) throw err
  }
}

/** Asserts `run` violates a constraint WITHOUT aborting the surrounding withTx. */
export async function expectViolation(
  tx: Kysely<Database>,
  match: RegExp,
  run: () => Promise<unknown>,
): Promise<void> {
  await sql`savepoint expect_violation`.execute(tx)
  let err: unknown
  try {
    await run()
  } catch (e) {
    err = e
  }
  await sql`rollback to savepoint expect_violation`.execute(tx)
  if (err === undefined) throw new Error(`expected a violation matching ${match}`)
  if (!match.test(String(err))) throw err
}
