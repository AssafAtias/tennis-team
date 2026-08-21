import { loadConfig } from './config.js'
import { createDb, createPool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { bootstrapAdmin } from './db/bootstrap.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl)
const db = createDb(pool)

try {
  const applied = await runMigrations(db)
  // eslint-disable-next-line no-console -- CLI release command's own stdout output, not a request-serving code path
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No migrations to apply')
  const result = await bootstrapAdmin(db, config.bootstrapAdminEmail)
  // eslint-disable-next-line no-console -- CLI release command's own stdout output, not a request-serving code path
  console.log(`Admin bootstrap: ${result}`)
} finally {
  await db.destroy()
}
