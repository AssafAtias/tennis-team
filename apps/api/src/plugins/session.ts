import type { FastifyReply, FastifyRequest } from 'fastify'
import { forbidden, unauthorized } from './error-handler.js'
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS, type SessionMember } from '../auth/sessions.js'

declare module 'fastify' {
  interface FastifyRequest {
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

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
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
