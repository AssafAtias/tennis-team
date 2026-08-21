import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { buildTestApp } from './setup/harness.js'
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js'
import { requireAuth, requireRole } from '../src/plugins/session.js'
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
})
