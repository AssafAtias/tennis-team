import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

const singles = (a: number, b: number) => ({
  playedOn: '2026-08-15',
  format: 'singles' as const,
  venue: 'Club court 3',
  winnerSide: 1 as const,
  side1: [{ memberId: a }],
  side2: [{ memberId: b }],
  sets: [
    { side1Games: 6, side2Games: 4 },
    { side1Games: 6, side2Games: 3 },
  ],
})

describe('match routes', () => {
  it('records a singles match a member played in', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'winner@example.com' })
      const them = await signIn(app, ctx, { email: 'loser@example.com' })

      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, them.id),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toMatchObject({ format: 'singles', winnerSide: 1, playedOn: '2026-08-15' })
      expect(body.sets).toHaveLength(2)
      expect(body.side1[0]).toMatchObject({ memberId: me.id })
    })
  })

  it('updates both players records', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'winner@example.com' })
      const them = await signIn(app, ctx, { email: 'loser@example.com' })
      await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, them.id),
      })

      const mine = await app.inject({ method: 'GET', url: `/api/players/${me.id}/record`, cookies: me.cookies })
      expect(mine.json()).toMatchObject({ matchesPlayed: 1, wins: 1, losses: 0 })
      const theirs = await app.inject({ method: 'GET', url: `/api/players/${them.id}/record`, cookies: me.cookies })
      expect(theirs.json()).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 1 })
    })
  })

  it('accepts a guest opponent', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'host@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { ...singles(me.id, me.id), side2: [{ guestName: 'Visiting Club' }] },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().side2[0]).toMatchObject({ memberId: null, displayName: 'Visiting Club' })
    })
  })

  it('refuses a player recording a match they did not play in', async () => {
    await buildTestApp(async (app, ctx) => {
      const outsider = await signIn(app, ctx, { email: 'nosy@example.com' })
      const a = await signIn(app, ctx, { email: 'a@example.com' })
      const b = await signIn(app, ctx, { email: 'b@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: outsider.cookies,
        payload: singles(a.id, b.id),
      })
      expect(res.statusCode).toBe(403)
    })
  })

  it('lets an admin record a match they did not play in', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const a = await signIn(app, ctx, { email: 'a@example.com' })
      const b = await signIn(app, ctx, { email: 'b@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: singles(a.id, b.id),
      })
      expect(res.statusCode).toBe(201)
    })
  })

  it('rejects a singles match with two players on a side', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { ...singles(me.id, x.id), side1: [{ memberId: me.id }, { memberId: x.id }] },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toMatch(/singles/i)
    })
  })

  it('rejects a doubles match with one player on a side', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { ...singles(me.id, x.id), format: 'doubles' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('rejects the same member appearing twice in one match', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, me.id),
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('pages newest first with a cursor', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      for (const day of ['2026-08-01', '2026-08-05', '2026-08-09']) {
        await app.inject({
          method: 'POST',
          url: '/api/matches',
          headers: ORIGIN,
          cookies: me.cookies,
          payload: { ...singles(me.id, x.id), playedOn: day },
        })
      }

      const first = await app.inject({ method: 'GET', url: '/api/matches?limit=2', cookies: me.cookies })
      const page1 = first.json()
      expect(page1.items.map((m: { playedOn: string }) => m.playedOn)).toEqual(['2026-08-09', '2026-08-05'])
      expect(page1.nextCursor).not.toBeNull()

      const second = await app.inject({
        method: 'GET',
        url: `/api/matches?limit=2&cursor=${page1.nextCursor}`,
        cookies: me.cookies,
      })
      expect(second.json().items.map((m: { playedOn: string }) => m.playedOn)).toEqual(['2026-08-01'])
      expect(second.json().nextCursor).toBeNull()
    })
  })

  it('lets the recorder correct a match and an admin delete it', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const created = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, x.id),
      })
      const id = created.json().id

      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { venue: 'Court 1', winnerSide: 2 },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json()).toMatchObject({ venue: 'Court 1', winnerSide: 2 })

      const denied = await app.inject({
        method: 'DELETE',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: x.cookies,
      })
      expect(denied.statusCode).toBe(403)

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(deleted.statusCode).toBe(204)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/matches' })).statusCode).toBe(401)
    })
  })
})
