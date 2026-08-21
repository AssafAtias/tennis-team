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
 */
export async function assertAdminRemains(
  db: Kysely<Database>,
  memberId: number,
  next: { role?: 'admin' | 'player'; status?: 'invited' | 'active' | 'removed' },
): Promise<void> {
  const stillAdmin = next.role === undefined ? undefined : next.role === 'admin'
  const stillActive = next.status === undefined ? undefined : next.status !== 'removed'
  if (stillAdmin !== false && stillActive !== false) return

  const others = await db
    .selectFrom('members')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('role', '=', 'admin')
    .where('status', '<>', 'removed')
    .where('id', '<>', memberId)
    .executeTakeFirstOrThrow()

  if (others.n === 0) {
    throw conflict('The team must keep at least one active admin', 'last_admin')
  }
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

      // An address may already exist as a removed member; reinstate rather than fail.
      const member = await deps.db
        .insertInto('members')
        .values({ email, role: 'player', status: 'invited' })
        .onConflict((oc) => oc.column('email').doUpdateSet({ status: 'invited' }))
        .returning(['id', 'email', 'role', 'status'])
        .executeTakeFirstOrThrow()

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
      await assertAdminRemains(deps.db, id, { role })

      const updated = await deps.db
        .updateTable('members')
        .set({ role })
        .where('id', '=', id)
        .where('status', '<>', 'removed')
        .returning(['id', 'email', 'role', 'status'])
        .executeTakeFirst()
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
      await assertAdminRemains(deps.db, id, { status: 'removed' })

      const removed = await deps.db
        .updateTable('members')
        .set({ status: 'removed' })
        .where('id', '=', id)
        .where('status', '<>', 'removed')
        .returning('id')
        .executeTakeFirst()
      if (!removed) throw notFound('No such member')

      await revokeAllForMember(deps, id)
      req.log.info({ memberId: id, by: req.member.id }, 'member removed')
      return reply.code(204).send()
    },
  )

  app.post(
    '/api/members/:id/resend-invite',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams } },
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
