import type { Kysely } from 'kysely'
import { FormatRegistry } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { Email } from '@tennis/contracts'
import type { Database } from './schema.js'

// TypeBox's `format` keyword only fires once a checker is registered for
// it: `Value.Check` treats an *unregistered* format as an unconditional
// failure, not as "unchecked" — verified directly: without this,
// `Value.Check(Email, 'a@b.com')` returns false for a plainly valid
// address. Fastify's own route validation gets `email` for free because
// `@fastify/ajv-compiler` (bundled by fastify, see app.ts) wires up
// ajv-formats' "full" formats automatically. This registers the exact same
// regex — copied from `ajv-formats`'s `fullFormats.email`, the mode
// ajv-formats defaults to — with TypeBox's FormatRegistry, so this
// CLI-only check can never disagree with what `POST /api/auth/request-link`
// accepts.
if (!FormatRegistry.Has('email')) {
  FormatRegistry.Set(
    'email',
    (value: string) =>
      /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
        value,
      ),
  )
}

/**
 * Resolves the configured bootstrap address into a definite state before
 * `bootstrapAdmin` ever sees it. `/api/auth/request-link` validates every
 * incoming address against this same `Email` schema (see
 * `packages/contracts/src/auth.ts`); the CLI path had no such gate, so a
 * malformed value (missing `@`, a stray trailing space, a copy-paste
 * artefact) would otherwise be inserted as-is, `bootstrapAdmin` would
 * report `'created'`, and the resulting row would be a login door nobody
 * could ever open — the exact failure mode this task exists to close.
 * Throws instead, so the release fails loudly rather than succeeding into
 * a locked-out deployment.
 *
 * A whitespace-only value is treated the same as unset (returns
 * `undefined`, which the caller reports as `'no-email'`): the two are
 * indistinguishable in intent. (`config.ts`'s `process.env[name] ||
 * undefined` already turns a truly empty string into `undefined` before
 * this ever runs, so only something like `" "` reaches here.)
 */
export function resolveBootstrapEmail(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (!Value.Check(Email, trimmed)) {
    // Deliberately does not echo `raw` or `trimmed`: this throw becomes an
    // uncaught top-level exception in release.ts, which Node prints straight
    // to stderr. A malformed value is the input most likely to still be a
    // real person's address with a typo, so it belongs to the same "never in
    // the logs" rule as everything else here (see app.ts's comment on why
    // addresses never reach the logs, and error-handler.ts's scrubSensitive
    // for the analogous pg-duplicate-key case). Not using scrubSensitive
    // here: it would rewrite a malformed value inconsistently depending on
    // whether its own regex happens to match, which is worse than omitting
    // the value outright.
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL is not a valid email address. ' +
        'Check the configured value; it is not echoed here because logs must not carry email addresses.',
    )
  }
  return trimmed
}

export type BootstrapResult = 'created' | 'promoted' | 'resurrected' | 'skipped' | 'no-email'

/**
 * Invite-only auth cannot bootstrap itself: with no members, nobody can invite
 * anybody. Idempotent, so it is safe on every deploy.
 *
 * The outcomes reflect the target row's state *before* the upsert:
 *  - 'no-email': no bootstrap address configured (or resolved to blank).
 *  - 'skipped': a non-removed admin already exists — nothing done.
 *  - 'created': no row existed for the address; a brand-new admin was inserted.
 *  - 'promoted': a row existed (invited, or active and not yet admin) and was upgraded.
 *  - 'resurrected': a row existed with status 'removed' and was reactivated as an
 *    active admin.
 *
 * 'resurrected' can only happen when the team has zero active admins — a
 * non-removed admin always short-circuits to 'skipped' above — so this is
 * the break-glass path for a deployment that would otherwise have no way
 * back in. A future guard is expected to prevent removing the last active
 * admin through the app, making this state unreachable except by a direct
 * DB edit. Deliberately not blocked here: `release.ts` reports it loudly
 * instead, so an operator notices a reactivation they didn't expect.
 */
export async function bootstrapAdmin(
  db: Kysely<Database>,
  email: string | undefined,
): Promise<BootstrapResult> {
  if (!email) return 'no-email'

  const existingAdmin = await db
    .selectFrom('members')
    .select('id')
    .where('role', '=', 'admin')
    .where('status', '<>', 'removed')
    .executeTakeFirst()
  if (existingAdmin) return 'skipped'

  const target = await db.selectFrom('members').select('status').where('email', '=', email).executeTakeFirst()

  await db
    .insertInto('members')
    .values({ email, role: 'admin', status: 'active' })
    .onConflict((oc) => oc.column('email').doUpdateSet({ role: 'admin', status: 'active' }))
    .execute()

  if (!target) return 'created'
  return target.status === 'removed' ? 'resurrected' : 'promoted'
}
