import type { FastifyReply, FastifyRequest } from 'fastify'
import { forbidden, unauthorized } from './error-handler.js'
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS, type SessionMember } from '../auth/sessions.js'

declare module 'fastify' {
  interface FastifyRequest {
    // Non-optional is intentional and only safe because `app.ts`'s `onRoute`
    // hook refuses to register any `/api/` route that lacks an auth
    // `preHandler` and isn't marked `config: { public: true }`. That hook is
    // what makes it impossible to reach a handler where this is unset.
    member: SessionMember
  }
}

export async function requireAuth(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) throw unauthorized()
  const member = await resolveSession(req.server.deps, token)
  if (!member) throw unauthorized()
  req.member = member
}

export function requireRole(role: 'admin') {
  return async function (req: FastifyRequest): Promise<void> {
    await requireAuth(req)
    if (req.member.role !== role) throw forbidden()
  }
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
