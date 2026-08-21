import { afterAll } from 'vitest'
import type { Kysely } from 'kysely'
import { createDb, createPool } from '../../src/db/client.js'
import type { Database } from '../../src/db/schema.js'

const pool = createPool(process.env.TEST_DATABASE_URL!)
const root = createDb(pool)

afterAll(async () => {
  await root.destroy()
})

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, so tests share
 * one migrated database without leaking rows into each other.
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
