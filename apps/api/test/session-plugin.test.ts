import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { buildTestApp } from './setup/harness.js'
import { createSession, revokeAllForMember, revokeSession, SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/sessions.js'
import { requireAuth, requireRole, setSessionCookie } from '../src/plugins/session.js'
import type { Database } from '../src/db/schema.js'

async function seedMember(
  db: Kysely<Database>,
  email: string,
  role: 'admin' | 'player',
  withProfile = true,
) {
  const m = await db
    .insertInto('members')
    .values({ email, role, status: 'active' })
    .returning(['id'])
    .executeTakeFirstOrThrow()
  if (withProfile) {
    await db.insertInto('player_profiles').values({ member_id: m.id, display_name: email }).execute()
  }
  return m.id
}

describe('session plugin', () => {
  it('rejects a request with no cookie', async () => {
    await buildTestApp(async (app) => {
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret' })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } })
    })
  })

  it('rejects a forged cookie', async () => {
    await buildTestApp(async (app) => {
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({
        method: 'GET',
        url: '/api/secret',
        cookies: { [SESSION_COOKIE]: 'not-a-real-token' },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  it('resolves a valid session onto request.member', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'player@example.com', 'player')
      const token = await createSession(
        { db: ctx.db, now: () => ctx.clock.now },
        id,
        'vitest',
      )
      app.get('/api/whoami', { preHandler: requireAuth }, (req) => req.member)

      const res = await app.inject({
        method: 'GET',
        url: '/api/whoami',
        cookies: { [SESSION_COOKIE]: token },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id, role: 'player', hasProfile: true })
    })
  })

  it('rejects an expired session', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'stale@example.com', 'player')
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, id, 'vitest')
      ctx.clock.now = new Date('2026-12-01T10:00:00Z') // more than 30 days later
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(res.statusCode).toBe(401)
    })
  })

  it('rejects a session whose member has been removed', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'gone@example.com', 'player')
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, id, 'vitest')
      await ctx.db.updateTable('members').set({ status: 'removed' }).where('id', '=', id).execute()
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(res.statusCode).toBe(401)
    })
  })

  it('refuses a player on an admin-only route and allows an admin', async () => {
    await buildTestApp(async (app, ctx) => {
      const playerId = await seedMember(ctx.db, 'p@example.com', 'player')
      const adminId = await seedMember(ctx.db, 'a@example.com', 'admin')
      const clock = { db: ctx.db, now: () => ctx.clock.now }
      const playerToken = await createSession(clock, playerId, 'vitest')
      const adminToken = await createSession(clock, adminId, 'vitest')

      app.get('/api/admin-only', { preHandler: requireRole('admin') }, () => ({ ok: true }))

      const denied = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        cookies: { [SESSION_COOKIE]: playerToken },
      })
      expect(denied.statusCode).toBe(403)
      expect(denied.json()).toMatchObject({ error: { code: 'forbidden' } })

      const allowed = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        cookies: { [SESSION_COOKIE]: adminToken },
      })
      expect(allowed.statusCode).toBe(200)
    })
  })

  it('reports hasProfile false for a member who has not completed setup', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'new@example.com', 'player', false)
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, id, 'vitest')
      app.get('/api/whoami', { preHandler: requireAuth }, (req) => req.member)
      const res = await app.inject({ method: 'GET', url: '/api/whoami', cookies: { [SESSION_COOKIE]: token } })
      expect(res.json()).toMatchObject({ hasProfile: false })
    })
  })

  it('rejects a session for a member who has never activated (status invited)', async () => {
    await buildTestApp(async (app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'pending@example.com', role: 'player', status: 'invited' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, m.id, 'vitest')
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(res.statusCode).toBe(401)
    })
  })

  it('revoking a session rejects the very next request bearing that cookie', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'revoke@example.com', 'player')
      const clock = { db: ctx.db, now: () => ctx.clock.now }
      const token = await createSession(clock, id, 'vitest')
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))

      const before = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(before.statusCode).toBe(200)

      await revokeSession(clock, token)

      const after = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(after.statusCode).toBe(401)
    })
  })

  it('revokeAllForMember rejects every session belonging to that member', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'revoke-all@example.com', 'player')
      const clock = { db: ctx.db, now: () => ctx.clock.now }
      const tokenA = await createSession(clock, id, 'device-a')
      const tokenB = await createSession(clock, id, 'device-b')
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))

      await revokeAllForMember(clock, id)

      const resA = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: tokenA } })
      const resB = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: tokenB } })
      expect(resA.statusCode).toBe(401)
      expect(resB.statusCode).toBe(401)
    })
  })

  it('slides expiry forward on each use, capped at now + SESSION_TTL_MS', async () => {
    await buildTestApp(async (app, ctx) => {
      const id = await seedMember(ctx.db, 'slide@example.com', 'player')
      const clock = { db: ctx.db, now: () => ctx.clock.now }
      const token = await createSession(clock, id, 'vitest')
      app.get('/api/secret', { preHandler: requireAuth }, () => ({ ok: true }))

      const initial = await ctx.db
        .selectFrom('sessions')
        .select('expires_at')
        .where('member_id', '=', id)
        .executeTakeFirstOrThrow()

      // Still well within the 30-day window, but a day further along.
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 24 * 60 * 60 * 1000)
      const res = await app.inject({ method: 'GET', url: '/api/secret', cookies: { [SESSION_COOKIE]: token } })
      expect(res.statusCode).toBe(200)

      const after = await ctx.db
        .selectFrom('sessions')
        .select('expires_at')
        .where('member_id', '=', id)
        .executeTakeFirstOrThrow()

      const initialExpiry = new Date(initial.expires_at).getTime()
      const afterExpiry = new Date(after.expires_at).getTime()
      expect(afterExpiry).toBeGreaterThan(initialExpiry)
      // Capped, not extended beyond one full window from the use that moved it.
      expect(afterExpiry).toBe(ctx.clock.now.getTime() + SESSION_TTL_MS)
    })
  })

  it('setSessionCookie sets HttpOnly, SameSite=Lax, Path=/, the 30-day Max-Age, and no Secure over an http appOrigin', async () => {
    await buildTestApp(async (app) => {
      // `public: true`: exercises cookie-setting mechanics, not auth — see
      // app.test.ts's default-deny hook note.
      app.get('/api/set-cookie', { config: { public: true } }, (_req, reply) => {
        setSessionCookie(reply, 'placeholder-token-value')
        return { ok: true }
      })
      const res = await app.inject({ method: 'GET', url: '/api/set-cookie' })
      const raw = res.headers['set-cookie']
      const cookie = Array.isArray(raw) ? raw.join('; ') : String(raw)

      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('Max-Age=2592000') // 30 * 24 * 60 * 60
      // testConfig.appOrigin is http://localhost:3000 — no Secure attribute.
      expect(cookie).not.toContain('Secure')
    })
  })
})
