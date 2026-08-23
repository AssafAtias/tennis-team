import { createDb, createPool } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is required to run integration tests')
  // Guard against a copy-paste of DATABASE_URL: without this, one missing
  // "_test" suffix migrates and writes test data into the dev/prod database.
  if (!/_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must name a database ending in "_test"')
  }
  const pool = createPool(url)
  const db = createDb(pool)
  try {
    await runMigrations(db)
  } finally {
    await db.destroy()
  }
}
