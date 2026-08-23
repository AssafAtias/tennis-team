import { loadConfig } from './config.js'
import { createDb, createPool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { bootstrapAdmin, resolveBootstrapEmail } from './db/bootstrap.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl)
const db = createDb(pool)

try {
  const applied = await runMigrations(db)
  // eslint-disable-next-line no-console -- CLI release command's own stdout output, not a request-serving code path
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No migrations to apply')

  // Throws loudly on a malformed BOOTSTRAP_ADMIN_EMAIL rather than letting
  // bootstrapAdmin insert an address nobody could ever request a sign-in
  // link for — see resolveBootstrapEmail's doc comment.
  const bootstrapEmail = resolveBootstrapEmail(config.bootstrapAdminEmail)
  const result = await bootstrapAdmin(db, bootstrapEmail)
  if (result === 'resurrected') {
    // Deliberately does not name the address: this line goes to deploy
    // logs, which must not carry member email addresses.
    // eslint-disable-next-line no-console -- CLI release command's own stdout output, not a request-serving code path
    console.log(
      'Admin bootstrap: RESURRECTED a previously removed member ' +
        '(address was deliberately removed; unset BOOTSTRAP_ADMIN_EMAIL if that was intended)',
    )
  } else {
    // eslint-disable-next-line no-console -- CLI release command's own stdout output, not a request-serving code path
    console.log(`Admin bootstrap: ${result}`)
  }
} finally {
  await db.destroy()
}
