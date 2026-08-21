import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type { Kysely } from 'kysely'
import { CallbackQuery, MeResponse, RequestLinkBody } from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { Database } from '../db/schema.js'
import { newToken, TOKEN_TTL_MS } from '../auth/tokens.js'
import { consumeLoginToken, createSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.js'
import { clearSessionCookie, requireAuth, setSessionCookie } from '../plugins/session.js'

const INVALID = '/login?error=link_invalid'

/**
 * Collapses an IPv6 address to its /64 before it's used as a rate-limit
 * key; IPv4 addresses pass through unchanged. Residential and mobile ISPs
 * routinely delegate an entire /64 (often more) to one customer, so keying
 * on the full address would let that customer mint a fresh source address
 * every 20 probes and walk the membership list at full speed anyway —
 * exactly the thing `requestLinkIpBudget` below exists to stop.
 *
 * `@fastify/rate-limit` already does this collapsing internally, but only
 * for its own DEFAULT keyGenerator (see `defaultKeyGenerator` in its
 * source) — `requestLinkIpBudget` needs a custom one, to key on IP alone
 * rather than the plugin's default of IP+nothing, so it has to redo the
 * collapsing itself or not get it at all.
 *
 * Delegates to the plugin's own exported `normalizeIP` rather than
 * hand-rolling IPv6 parsing: it's already implemented (via the `ip-address`
 * package's real CIDR math, not a regex/split job) and already exercised by
 * the plugin's own test suite. Verified directly against the cases that
 * matter: `2001:db8::1` and `2001:db8::dead:beef` (same /64) both collapse
 * to `2001:db8::`; `2001:db8:1::1` (a different /64) collapses to
 * `2001:db8:1::`; `::1`, `::`, and a zone-index address (`fe80::1%eth0`)
 * all parse without throwing; a plain IPv4 address passes through as-is.
 */
export function ipBudgetKey(ip: string): string {
  return rateLimit.normalizeIP(ip)
}

/**
 * Activates an invited member and mints their session as one unit: if
 * `createSession` failed right after a bare status UPDATE, the member would
 * be left activated with no session and their token already burned, so
 * their next link would arrive as a "signin" email rather than the "invite"
 * they were expecting.
 *
 * Takes the connection to run on rather than opening its own transaction,
 * because `db.transaction()` throws ("calling the transaction method for a
 * Transaction is not supported") when `db` is already inside one — which it
 * always is under this repo's test harness (every test runs inside one
 * outer, always-rolled-back transaction). `deps.db.isTransaction` at the
 * call site below picks the right thing for each case: wrap in a real
 * transaction in production, reuse the existing one in tests.
 */
async function activateAndCreateSession(
  db: Kysely<Database>,
  now: () => Date,
  memberId: number,
  status: 'invited' | 'active' | 'removed',
  userAgent: string | undefined,
): Promise<string> {
  if (status === 'invited') {
    await db.updateTable('members').set({ status: 'active' }).where('id', '=', memberId).execute()
  }
  return createSession({ db, now }, memberId, userAgent)
}

export async function authRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  // A second, IP-only rate budget alongside the per-address one in
  // request-link's `config.rateLimit` below. The per-address limiter caps
  // mailbox flooding, but places no ceiling at all on the number of
  // *distinct* addresses one IP can probe — every new address gets a fresh
  // bucket, so an attacker can walk the membership list at full speed. It
  // also closes the per-address limiter's own escape hatch: the attacker
  // controls the address half of that key, so they can mint enough distinct
  // keys to evict a victim's bucket from the rate-limit store's bounded LRU
  // cache and resume flooding that mailbox. This budget, keyed on IP alone,
  // is immune to both.
  //
  // Built from `app.createRateLimit(...)` rather than `app.rateLimit(...)`
  // or a second `config.rateLimit` entry (a route can only have one of
  // those anyway), because `@fastify/rate-limit`'s route-level handler
  // (`rateLimitRequestHandler`) sets a per-request `rateLimitRan` flag and
  // silently no-ops on every subsequent call for that request — including
  // one from a *different* limiter instance, since the flag lives on
  // `pluginComponent`, inherited by every limiter this plugin creates.
  // Stacking two `app.rateLimit(...)`-produced preHandlers (or one of those
  // plus `config.rateLimit`) on the same route means only the first one
  // that runs ever actually counts anything — confirmed by hand: with that
  // approach the address-keyed limiter's own response headers never
  // appeared and it never rejected a request, no matter how many were sent.
  // `createRateLimit` returns the guard-free counting primitive instead, so
  // it can safely run alongside the address-keyed one. Note its result
  // shape: `isAllowed` is true *only* for an allow-listed caller; the
  // pass/reject signal for the normal (counted) path is `isExceeded`.
  const requestLinkIpBudget = app.createRateLimit({
    max: 20,
    timeWindow: '15 minutes',
    keyGenerator: (req) => ipBudgetKey(req.ip),
  })

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
      // Unbranded (it doesn't establish request.member), which would
      // normally trip the onRoute default-deny guard in app.ts — but that
      // guard returns before ever inspecting preHandlers for a route marked
      // config: { public: true }, which this one is.
      preHandler: async (req) => {
        const result = await requestLinkIpBudget(req)
        // `isAllowed` is true only for an allow-listed caller (none are
        // configured here); the real pass/reject signal on the counted path
        // is `isExceeded`, which only exists on that branch of the result.
        if (!result.isAllowed && result.isExceeded) {
          throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })
        }
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
        // Fire-and-forget, deliberately not awaited: awaiting this call put
        // mail-provider health on the response path, so a known address hit
        // a throttled/5xx/slow Resend and got a 500 while an unknown address
        // always got a 202 immediately — a status-code (and timing) oracle
        // on exactly the membership list this route exists to protect. Both
        // branches must return the identical 202 right away; a member whose
        // mail genuinely fails now gets that 202 with no email sent, visible
        // only in the logs below — an honest error here is the anti-leak.
        void deps.mailer
          .sendSignInLink(member.email, url, member.status === 'invited' ? 'invite' : 'signin')
          .then(() => req.log.info({ memberId: member.id }, 'sign-in link sent'))
          .catch((err: unknown) =>
            req.log.error(
              { memberId: member.id, errName: err instanceof Error ? err.name : typeof err },
              'sign-in mail failed',
            ),
          )
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

      // Activation and session creation happen atomically — see
      // activateAndCreateSession's doc comment for why this isn't a plain
      // `deps.db.transaction().execute(...)` here.
      const userAgent = req.headers['user-agent']
      const session = deps.db.isTransaction
        ? await activateAndCreateSession(deps.db, deps.now, memberId, member.status, userAgent)
        : await deps.db
            .transaction()
            .execute((trx) => activateAndCreateSession(trx, deps.now, memberId, member.status, userAgent))
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
    async (req) => {
      // `cache-control: no-store` is set globally for every /api/ response
      // by an onSend hook in app.ts — see the comment there. This response
      // carries PII (email, role) tied to the caller's session, which is
      // exactly the kind of thing that hook exists to protect.
      return req.member
    },
  )
}
