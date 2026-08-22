import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn, type SignedIn } from './setup/harness.js'

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

  it('pages newest first with a cursor, without player identity leaking across matches on the same page', async () => {
    await buildTestApp(async (app, ctx) => {
      // Deliberately disjoint players per match (not the uniform `me`/`x`
      // pair the old fixture used): a page holding two matches whose
      // `side()` filter forgot to scope by match_id would return the UNION
      // of every player on the page for a given side number, which a
      // uniform two-player fixture can never reveal.
      const viewer = await signIn(app, ctx, { email: 'viewer@example.com' })
      const aWin = await signIn(app, ctx, { email: 'a-win@example.com' })
      const aLose = await signIn(app, ctx, { email: 'a-lose@example.com' })
      const bWin = await signIn(app, ctx, { email: 'b-win@example.com' })
      const bLose = await signIn(app, ctx, { email: 'b-lose@example.com' })
      const cWin = await signIn(app, ctx, { email: 'c-win@example.com' })
      const cLose = await signIn(app, ctx, { email: 'c-lose@example.com' })

      const record = (recorder: SignedIn, a: SignedIn, b: SignedIn, day: string) =>
        app.inject({
          method: 'POST',
          url: '/api/matches',
          headers: ORIGIN,
          cookies: recorder.cookies,
          payload: { ...singles(a.id, b.id), playedOn: day },
        })

      await record(aWin, aWin, aLose, '2026-08-01')
      await record(bWin, bWin, bLose, '2026-08-05')
      await record(cWin, cWin, cLose, '2026-08-09')

      const first = await app.inject({ method: 'GET', url: '/api/matches?limit=2', cookies: viewer.cookies })
      const page1 = first.json()
      expect(page1.items.map((m: { playedOn: string }) => m.playedOn)).toEqual(['2026-08-09', '2026-08-05'])
      // The page holds both match C and match B; each one's side1/side2 must
      // carry only ITS OWN players, not the union of everyone on the page.
      expect(page1.items[0].side1).toEqual([expect.objectContaining({ memberId: cWin.id })])
      expect(page1.items[0].side2).toEqual([expect.objectContaining({ memberId: cLose.id })])
      expect(page1.items[1].side1).toEqual([expect.objectContaining({ memberId: bWin.id })])
      expect(page1.items[1].side2).toEqual([expect.objectContaining({ memberId: bLose.id })])
      expect(page1.nextCursor).not.toBeNull()

      const second = await app.inject({
        method: 'GET',
        url: `/api/matches?limit=2&cursor=${page1.nextCursor}`,
        cookies: viewer.cookies,
      })
      const page2 = second.json()
      expect(page2.items.map((m: { playedOn: string }) => m.playedOn)).toEqual(['2026-08-01'])
      expect(page2.items[0].side1).toEqual([expect.objectContaining({ memberId: aWin.id })])
      expect(page2.items[0].side2).toEqual([expect.objectContaining({ memberId: aLose.id })])
      expect(page2.nextCursor).toBeNull()
    })
  })

  it('pages correctly when matches share the same played_on date', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const ids: number[] = []
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/matches',
          headers: ORIGIN,
          cookies: me.cookies,
          payload: { ...singles(me.id, x.id), playedOn: '2026-08-10' },
        })
        ids.push(res.json().id)
      }
      // Same played_on for all three, so the tiebreak is `id desc`: newest
      // (highest id) first.
      const expectedOrder = [...ids].sort((a, b) => b - a)

      const first = await app.inject({ method: 'GET', url: '/api/matches?limit=2', cookies: me.cookies })
      const page1 = first.json()
      expect(page1.items.map((m: { id: number }) => m.id)).toEqual(expectedOrder.slice(0, 2))
      expect(page1.nextCursor).not.toBeNull()

      const second = await app.inject({
        method: 'GET',
        url: `/api/matches?limit=2&cursor=${page1.nextCursor}`,
        cookies: me.cookies,
      })
      const page2 = second.json()
      expect(page2.items.map((m: { id: number }) => m.id)).toEqual(expectedOrder.slice(2))
      expect(page2.nextCursor).toBeNull()

      // No row dropped or repeated across the two pages sharing one date.
      const seenIds = [...page1.items, ...page2.items].map((m: { id: number }) => m.id).sort((a, b) => a - b)
      expect(seenIds).toEqual([...ids].sort((a, b) => a - b))
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

  it('rejects a PATCH whose MERGED result is invalid, even though each field looks fine in isolation', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'me@example.com' })
      const x = await signIn(app, ctx, { email: 'x@example.com' })
      const created = await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: singles(me.id, x.id),
      })
      const id = created.json().id

      // Patching only `format` to 'doubles' leaves the existing 1-per-side
      // players untouched -- the MERGED shape is what must be rejected.
      const badFormat = await app.inject({
        method: 'PATCH',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { format: 'doubles' },
      })
      expect(badFormat.statusCode).toBe(400)

      // Patching only `side2` to reuse `me`'s id leaves side1 (also `me`)
      // untouched -- the MERGED sides are what must be rejected as a
      // duplicate participant, not the patch body in isolation.
      const dupMember = await app.inject({
        method: 'PATCH',
        url: `/api/matches/${id}`,
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { side2: [{ memberId: me.id }] },
      })
      expect(dupMember.statusCode).toBe(400)
    })
  })

  it('404s on GET/PATCH/DELETE for a match id that does not exist', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const missingId = 999999

      const get = await app.inject({ method: 'GET', url: `/api/matches/${missingId}`, cookies: admin.cookies })
      expect(get.statusCode).toBe(404)

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/matches/${missingId}`,
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { venue: 'Nowhere' },
      })
      expect(patch.statusCode).toBe(404)

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/matches/${missingId}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(del.statusCode).toBe(404)
    })
  })

  it('404s on GET /api/players/:id/record for a member id that does not exist', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const res = await app.inject({ method: 'GET', url: '/api/players/999999/record', cookies: admin.cookies })
      expect(res.statusCode).toBe(404)
    })
  })
})
