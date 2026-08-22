import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import { InviteBody, MemberIdParams, PatchMemberBody, Roster } from '@tennis/contracts'
import type { RosterEntry } from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { Database } from '../db/schema.js'
import { conflict, notFound } from '../plugins/error-handler.js'
import { requireAuth, requireRole } from '../plugins/session.js'
import { newToken, TOKEN_TTL_MS } from '../auth/tokens.js'
import { revokeAllForMember } from '../auth/sessions.js'

/**
 * Refuses any change that would leave the team with no active admin. Without
 * this, one click can lock every member out of their own roster.
 *
 * Counts survivors by `status = 'active'`, not merely `<> 'removed'`: an
 * `invited` admin has never signed in and may never accept, so they are not
 * a real safety net. Without this distinction, promoting a still-invited
 * member to admin (promotion itself never trips this guard, since it can
 * only ever increase the active-admin count) would let the sole real admin
 * then demote or remove themselves, believing the invitee covers them --
 * leaving the team with zero active admins. That state is exactly what Task
 * 6's `bootstrap.ts` "resurrected" outcome exists to recover from, and its
 * doc comment calls it unreachable in normal operation specifically because
 * this guard is supposed to be the thing preventing it.
 *
 * Takes a row lock (`FOR UPDATE`) on every currently active admin before
 * counting. A bare `SELECT COUNT` followed by a separate `UPDATE` would let
 * two concurrent requests -- each demoting/removing a DIFFERENT admin when
 * exactly two remain -- both read "one survivor" and both proceed, leaving
 * zero. Locking the whole active-admin set (not just "the others") means a
 * second, concurrent call touching either admin row blocks on this SELECT
 * until the first transaction commits, then re-reads the now-updated
 * membership and correctly refuses. This only does its job when called
 * inside the same transaction as the write it guards -- see
 * `guardedAdminWrite` below, which is the only place that should call this.
 */
export async function assertAdminRemains(
  db: Kysely<Database>,
  memberId: number,
  next: { role?: 'admin' | 'player'; status?: 'invited' | 'active' | 'removed' },
): Promise<void> {
  const stillAdmin = next.role === undefined ? undefined : next.role === 'admin'
  const stillActive = next.status === undefined ? undefined : next.status === 'active'
  if (stillAdmin !== false && stillActive !== false) return

  const activeAdmins = await db
    .selectFrom('members')
    .select('id')
    .where('role', '=', 'admin')
    .where('status', '=', 'active')
    .forUpdate()
    .execute()

  const survivors = activeAdmins.filter((m) => m.id !== memberId).length
  if (survivors === 0) {
    throw conflict('The team must keep at least one active admin', 'last_admin')
  }
}

/**
 * Runs `assertAdminRemains` and the write it guards as one transaction, so
 * the row lock the guard takes is actually held across both statements --
 * see the doc comment on `assertAdminRemains` for why that matters.
 *
 * Takes the connection to run on rather than always opening its own
 * transaction, for the same reason `activateAndCreateSession` in
 * `routes/auth.ts` does: `db.transaction()` throws ("calling the
 * transaction method for a Transaction is not supported") when `db` is
 * already inside one -- which it always is under this repo's test harness,
 * since every test runs inside one outer, always-rolled-back transaction.
 * `deps.db.isTransaction` picks the right thing for each case: wrap in a
 * real transaction in production, reuse the existing one in tests.
 */
async function guardedAdminWrite<T>(
  deps: Deps,
  memberId: number,
  next: { role?: 'admin' | 'player'; status?: 'invited' | 'active' | 'removed' },
  write: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  const run = (trx: Kysely<Database>): Promise<T> =>
    assertAdminRemains(trx, memberId, next).then(() => write(trx))
  return deps.db.isTransaction ? run(deps.db) : deps.db.transaction().execute(run)
}

async function sendInvite(deps: Deps, memberId: number, email: string): Promise<void> {
  const { token, hash } = newToken()
  await deps.db
    .insertInto('login_tokens')
    .values({
      member_id: memberId,
      token_hash: hash,
      expires_at: new Date(deps.now().getTime() + TOKEN_TTL_MS),
    })
    .execute()
  await deps.mailer.sendSignInLink(email, `${deps.config.appOrigin}/api/auth/callback?token=${token}`, 'invite')
}

export async function memberRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(
    '/api/members',
    { preHandler: requireAuth, schema: { response: { 200: Roster } } },
    async () => {
      const rows = await deps.db
        .selectFrom('members as m')
        .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
        .select([
          'm.id',
          'm.email',
          'm.role',
          'm.status',
          'p.display_name',
          'p.nickname',
          'p.photo_key',
          'p.preferred_format',
          'p.rating_system',
          'p.rating_value',
        ])
        .where('m.status', 'in', ['invited', 'active'])
        .orderBy('p.display_name', 'asc')
        .orderBy('m.email', 'asc')
        .execute()

      return rows.map(
        (r): RosterEntry => ({
          id: r.id,
          email: r.email,
          role: r.role,
          status: r.status,
          displayName: r.display_name ?? null,
          nickname: r.nickname ?? null,
          photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
          preferredFormat: r.preferred_format ?? null,
          ratingSystem: r.rating_system ?? 'none',
          ratingValue: r.rating_value ?? null,
        }),
      )
    },
  )

  app.post(
    '/api/members',
    { preHandler: requireRole('admin'), schema: { body: InviteBody } },
    async (req, reply) => {
      const { email } = req.body as InviteBody

      // An address may already exist as a removed member; reinstate rather
      // than fail -- but ONLY a removed row. The `where` on the conflict
      // update scopes this to that case alone: without it, `doUpdateSet`
      // fires on ANY conflicting email, including an active or invited
      // member's, silently flipping their status to 'invited' and killing
      // their live session on their very next request (`resolveSession`
      // requires `status = 'active'`) -- with the inviting admin seeing an
      // ordinary 201 and no idea their teammate just got signed out.
      // Reinstating also resets role to 'player': `doUpdateSet` only
      // touches the columns listed, so leaving role out would let a former
      // admin come back with the admin role restored -- a privilege grant
      // nobody chose, since `InviteBody` gives the inviting admin no way to
      // say "make them an admin" for a brand-new invitee either. That
      // re-promotion is one explicit PATCH away instead.
      const member = await deps.db
        .insertInto('members')
        .values({ email, role: 'player', status: 'invited' })
        .onConflict((oc) =>
          oc
            .column('email')
            .doUpdateSet({ status: 'invited', role: 'player' })
            // Table-qualified, not bare 'status': Postgres has BOTH the
            // target row and the `excluded` (proposed-insert) pseudo-row in
            // scope inside an `ON CONFLICT ... DO UPDATE ... WHERE` clause,
            // and `excluded` also carries a `status` column (the 'invited'
            // being inserted) -- an unqualified `status` is genuinely
            // ambiguous between the two and Postgres rejects it outright
            // ("column reference \"status\" is ambiguous"), confirmed by
            // hand against this exact statement before adding the
            // qualifier fixed it.
            .where('members.status', '=', 'removed'),
        )
        .returning(['id', 'email', 'role', 'status'])
        .executeTakeFirst()

      if (!member) {
        // The email conflicted but the existing row wasn't 'removed', so
        // Postgres's `ON CONFLICT ... WHERE` left it untouched and the
        // statement returned no row -- meaning the address already belongs
        // to an active or invited member. Surface that instead of a silent
        // no-op the inviting admin would read as success.
        throw conflict(
          'That address is already on the team. Use resend invite if they have not signed in yet.',
          'already_member',
        )
      }

      await sendInvite(deps, member.id, member.email)
      req.log.info({ memberId: member.id, by: req.member.id }, 'member invited')
      return reply.code(201).send(member)
    },
  )

  app.patch(
    '/api/members/:id',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams, body: PatchMemberBody } },
    async (req) => {
      const { id } = req.params as MemberIdParams
      const { role } = req.body as PatchMemberBody

      const updated = await guardedAdminWrite(deps, id, { role }, (trx) =>
        trx
          .updateTable('members')
          .set({ role })
          .where('id', '=', id)
          .where('status', '<>', 'removed')
          .returning(['id', 'email', 'role', 'status'])
          .executeTakeFirst(),
      )
      if (!updated) throw notFound('No such member')
      req.log.info({ memberId: id, by: req.member.id, role }, 'member role changed')
      return updated
    },
  )

  app.delete(
    '/api/members/:id',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams } },
    async (req, reply) => {
      const { id } = req.params as MemberIdParams

      const removed = await guardedAdminWrite(deps, id, { status: 'removed' }, (trx) =>
        trx
          .updateTable('members')
          .set({ status: 'removed' })
          .where('id', '=', id)
          .where('status', '<>', 'removed')
          .returning('id')
          .executeTakeFirst(),
      )
      if (!removed) throw notFound('No such member')

      await revokeAllForMember(deps, id)
      req.log.info({ memberId: id, by: req.member.id }, 'member removed')
      return reply.code(204).send()
    },
  )

  app.post(
    '/api/members/:id/resend-invite',
    {
      preHandler: requireRole('admin'),
      schema: { params: MemberIdParams },
      // Admin-only, but still sends email, exactly like
      // `/api/auth/request-link` -- an admin-UI retry loop or a compromised
      // admin session can otherwise spam an invited member's mailbox with
      // no ceiling at all. Per-IP is enough here (unlike request-link,
      // there's no anonymous-caller address to also key on), and the
      // default hook (`onRequest`) is fine too: the default keyGenerator
      // only reads `req.ip`, not the body, so there's no need to defer to
      // `preHandler` the way request-link's address-keyed limiter does.
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { id } = req.params as MemberIdParams
      const member = await deps.db
        .selectFrom('members')
        .select(['id', 'email'])
        .where('id', '=', id)
        .where('status', '=', 'invited')
        .executeTakeFirst()
      if (!member) throw notFound('No pending invitation for that member')

      await sendInvite(deps, member.id, member.email)
      return reply.code(202).send({ status: 'sent' })
    },
  )
}
