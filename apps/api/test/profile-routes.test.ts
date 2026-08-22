import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('profile routes', () => {
  it('creates a profile on setup and reports hasProfile afterwards', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'fresh@example.com', profile: false })

      const before = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: me.cookies })
      expect(before.json()).toMatchObject({ hasProfile: false })

      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Fresh Legs', dominantHand: 'left', backhand: 'two', ratingSystem: 'ntrp', ratingValue: '4.0' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ displayName: 'Fresh Legs', dominantHand: 'left', ratingValue: '4.0' })

      const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: me.cookies })
      expect(after.json()).toMatchObject({ hasProfile: true })
    })
  })

  it('rejects a rating value when the system is none', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'bad@example.com', profile: false })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Bad', ratingSystem: 'none', ratingValue: '4.0' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: { code: 'bad_request' } })
    })
  })

  it('rejects a blank display name', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'blank@example.com', profile: false })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: '   ' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('merges a patch without clearing untouched fields', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'merge@example.com', profile: false })
      await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Merger', racquet: 'Pure Aero' },
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { bio: 'Loves a long rally.' },
      })
      expect(res.json()).toMatchObject({ displayName: 'Merger', racquet: 'Pure Aero', bio: 'Loves a long rally.' })
    })
  })

  it('clears a field when the patch sends null explicitly', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'clear@example.com', profile: false })
      await app.inject({
        method: 'PUT',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { displayName: 'Clearer', racquet: 'Old Wilson' },
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/players/me',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { racquet: null },
      })
      expect(res.json().racquet).toBeNull()
    })
  })

  it('returns another player with their record attached', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'viewer@example.com' })
      const them = await signIn(app, ctx, { email: 'subject@example.com' })

      const res = await app.inject({ method: 'GET', url: `/api/players/${them.id}`, cookies: me.cookies })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: them.id, record: { matchesPlayed: 0, wins: 0, losses: 0 } })
    })
  })

  it('404s for a member who has not set up a profile', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'viewer@example.com' })
      const pending = await signIn(app, ctx, { email: 'pending@example.com', status: 'invited', profile: false })
      const res = await app.inject({ method: 'GET', url: `/api/players/${pending.id}`, cookies: me.cookies })
      expect(res.statusCode).toBe(404)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/players/1' })).statusCode).toBe(401)
      expect(
        (await app.inject({ method: 'PUT', url: '/api/players/me', headers: ORIGIN, payload: { displayName: 'X' } }))
          .statusCode,
      ).toBe(401)
    })
  })
})
