import { sql, type Kysely } from 'kysely'
import type { Database } from './schema.js'

// Module-level: savepoint names only need to be unique within whatever
// transaction/session is currently nesting them, and an ever-incrementing
// counter guarantees that trivially, even across concurrent requests that
// each hold their own connection.
let nextId = 0
function nextSavepointId(): number {
  return ++nextId
}

/**
 * Runs `run` atomically whether or not `db` is already inside a transaction.
 *
 * `db.transaction()` throws ("calling the transaction method for a
 * Transaction is not supported") when `db` is already inside one — which it
 * always is under this repo's test harness (every test runs inside one
 * outer, always-rolled-back transaction; see `withTx` in
 * `test/setup/harness.ts`). A plain `isTransaction ? run(db) : ...`
 * ternary "solves" that by skipping the transaction entirely on the
 * branch every test takes, which means the atomicity guarantee itself goes
 * completely unexercised by the test suite.
 *
 * A nested call instead uses a SAVEPOINT, so the atomicity guarantee holds
 * under the test harness as well as in production: a failure inside `run`
 * rolls back only the work `run` did, `db` remains perfectly usable for
 * whatever the caller does next (the harness's own `expectViolation` relies
 * on the same mechanism, for the same reason), and a real production call
 * (where `db` is the root connection, not already a transaction) still gets
 * a genuine `BEGIN`/`COMMIT`.
 *
 * Kysely 0.27's `Transaction` type has no public savepoint API (it only
 * overrides `.transaction()`, `.connection()`, `.destroy()`), so raw SQL is
 * the right tool here, not a workaround.
 */
export async function withTransaction<T>(
  db: Kysely<Database>,
  run: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  if (!db.isTransaction) return db.transaction().execute(run)
  const name = `sp_${nextSavepointId()}`
  await sql.raw(`savepoint ${name}`).execute(db)
  try {
    const result = await run(db)
    await sql.raw(`release savepoint ${name}`).execute(db)
    return result
  } catch (err) {
    await sql.raw(`rollback to savepoint ${name}`).execute(db)
    throw err
  }
}
