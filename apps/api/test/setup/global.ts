import { createDb, createPool } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is required to run integration tests')
  const pool = createPool(url)
  const db = createDb(pool)
  try {
    await runMigrations(db)
  } finally {
    await db.destroy()
  }
}
