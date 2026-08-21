import type { FastifyReply, FastifyRequest } from 'fastify'
import { forbidden, unauthorized } from './error-handler.js'
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS, type SessionMember } from '../auth/sessions.js'

declare module 'fastify' {
  interface FastifyRequest {
    // Non-optional is intentional. `app.ts`'s `onRoute` hook refuses to
    // register any `/api/` route whose `preHandler`(s) do not include one
    // branded with `AUTH_PREHANDLER` below (see `isAuthPreHandler`), unless
    // the route is marked `config: { public: true }`. That brand check is
    // what backs this type — look there, not just at this comment, if you
    // need to verify the guarantee.
    member: SessionMember
  }
}

/**
 * Marks a preHandler as one that actually establishes `request.member`. The
 * `onRoute` guard in `buildApp` requires a preHandler carrying this brand, so
 * an unrelated preHandler (a rate limiter, a logger, a typo'd no-op) cannot
 * satisfy the check just by being present.
 */
const AUTH_PREHANDLER = Symbol.for('tennis.authPreHandler')

type Branded = { [AUTH_PREHANDLER]?: true }

export const requireAuth = Object.assign(
  async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies[SESSION_COOKIE]
    if (!token) throw unauthorized()
    const member = await resolveSession(req.server.deps, token)
    if (!member) {
      // A cookie was presented but didn't resolve to anything — expired,
      // revoked, or (the case this exists for) belonging to a member whose
      // status is no longer 'active'. Without this, that cookie is
      // undeletable: `resolveSession` filters on `m.status = 'active'`, so
      // a removed member can never again pass a check that would let them
      // reach `POST /api/auth/logout` to clear it themselves, and they'd
      // carry an unusable 30-day cookie until it expires on its own.
      clearSessionCookie(reply)
      throw unauthorized()
    }
    req.member = member
  },
  { [AUTH_PREHANDLER]: true as const },
)

export function requireRole(role: 'admin') {
  return Object.assign(
    async function requireRoleHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      await requireAuth(req, reply)
      if (req.member.role !== role) throw forbidden()
    },
    { [AUTH_PREHANDLER]: true as const },
  )
}

/** True only for a preHandler branded by `requireAuth`/`requireRole` above. */
export function isAuthPreHandler(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as Branded)[AUTH_PREHANDLER] === true
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  // Derived, not caller-supplied: a caller (e.g. a route) could otherwise
  // pass `false` in production and nothing would object. Deliberately not
  // `@fastify/cookie`'s `secure: 'auto'` either — that silently downgrades to
  // `false` when a proxy omits `X-Forwarded-Proto`, which is exactly the
  // failure mode this is meant to avoid.
  const secure = reply.server.deps.config.appOrigin.startsWith('https://')
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
