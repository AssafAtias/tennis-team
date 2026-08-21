import type { Kysely } from 'kysely'
import type { Database } from './schema.js'

/**
 * Invite-only auth cannot bootstrap itself: with no members, nobody can invite
 * anybody. Idempotent, so it is safe on every deploy.
 */
export async function bootstrapAdmin(
  db: Kysely<Database>,
  email: string | undefined,
): Promise<'created' | 'skipped' | 'no-email'> {
  if (!email) return 'no-email'

  const existingAdmin = await db
    .selectFrom('members')
    .select('id')
    .where('role', '=', 'admin')
    .where('status', '<>', 'removed')
    .executeTakeFirst()
  if (existingAdmin) return 'skipped'

  await db
    .insertInto('members')
    .values({ email, role: 'admin', status: 'active' })
    .onConflict((oc) => oc.column('email').doUpdateSet({ role: 'admin', status: 'active' }))
    .execute()
  return 'created'
}
