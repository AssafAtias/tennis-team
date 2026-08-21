import type { FastifyInstance } from 'fastify'
import { CallbackQuery, MeResponse, RequestLinkBody } from '@tennis/contracts'
import type { Deps } from '../app.js'
import { newToken, TOKEN_TTL_MS } from '../auth/tokens.js'
import { consumeLoginToken, createSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.js'
import { clearSessionCookie, requireAuth, setSessionCookie } from '../plugins/session.js'

const INVALID = '/login?error=link_invalid'

export async function authRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.post(
    '/api/auth/request-link',
    {
      // Public: reachable with no session, by design — this is how a
      // session gets created in the first place.
      config: {
        public: true,
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          // Keyed on address AND caller, so neither one alone can flood a
          // mailbox. Runs at `preHandler`, not the default `onRequest`: the
          // body isn't parsed yet at `onRequest`, so `req.body` would be
          // `undefined` here and this would throw on every request.
          hook: 'preHandler',
          keyGenerator: (req) => `${req.ip}:${(req.body as RequestLinkBody).email.toLowerCase()}`,
        },
      },
      schema: { body: RequestLinkBody },
    },
    async (req, reply) => {
      const { email } = req.body as RequestLinkBody

      const member = await deps.db
        .selectFrom('members')
        .select(['id', 'email', 'status'])
        .where('email', '=', email)
        .where('status', 'in', ['invited', 'active'])
        .executeTakeFirst()

      // Identical response whether or not the address is on the team, and
      // whether or not it belongs to a removed member: the membership list
      // is the asset this app protects, and any difference here — status
      // code, body, or a measurably different response time — would leak
      // who is on the team. Do not add a "no such member" branch, and do
      // not log the address anywhere.
      if (member) {
        const { token, hash } = newToken()
        await deps.db
          .insertInto('login_tokens')
          .values({
            member_id: member.id,
            token_hash: hash,
            expires_at: new Date(deps.now().getTime() + TOKEN_TTL_MS),
          })
          .execute()
        const url = `${deps.config.appOrigin}/api/auth/callback?token=${token}`
        await deps.mailer.sendSignInLink(member.email, url, member.status === 'invited' ? 'invite' : 'signin')
        req.log.info({ memberId: member.id }, 'sign-in link sent')
      }

      return reply.code(202).send({ status: 'sent' })
    },
  )

  app.get(
    '/api/auth/callback',
    {
      // Public: reached from an emailed link with no session yet.
      config: { public: true },
      schema: { querystring: CallbackQuery },
    },
    async (req, reply) => {
      const { token } = req.query as CallbackQuery

      // Single atomic UPDATE guarded by `consumed_at is null and expires_at
      // > now`, so two concurrent requests racing on the same emailed link
      // can mint at most one session between them — see consumeLoginToken.
      const memberId = await consumeLoginToken(deps, token)
      if (memberId === null) return reply.redirect(INVALID, 302)

      const member = await deps.db
        .selectFrom('members as m')
        .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
        .select(['m.status as status', 'p.member_id as profile_id'])
        .where('m.id', '=', memberId)
        .executeTakeFirst()

      // A removed member's token could still pass consumeLoginToken (the
      // token row itself carries no status) if they were removed after the
      // link was sent but before it was redeemed. Same destination as any
      // other invalid token — nothing about status is leaked either.
      if (!member || member.status === 'removed') return reply.redirect(INVALID, 302)

      // First sign-in activates.
      if (member.status === 'invited') {
        await deps.db.updateTable('members').set({ status: 'active' }).where('id', '=', memberId).execute()
      }

      const session = await createSession(deps, memberId, req.headers['user-agent'])
      setSessionCookie(reply, session)
      req.log.info({ memberId }, 'sign-in completed')

      return reply.redirect(member.profile_id === null ? '/setup' : '/', 302)
    },
  )

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) await revokeSession(deps, token)
    clearSessionCookie(reply)
    return reply.code(204).send()
  })

  app.get(
    '/api/auth/me',
    { preHandler: requireAuth, schema: { response: { 200: MeResponse } } },
    async (req) => req.member,
  )
}
