import { sql } from 'kysely'
import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('availability routes', () => {
  it('replaces the whole grid rather than merging', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'free@example.com' })
      const put = (slots: unknown) =>
        app.inject({
          method: 'PUT',
          url: '/api/players/me/availability',
          headers: ORIGIN,
          cookies: me.cookies,
          payload: { slots },
        })

      await put([
        { weekday: 6, block: 'morning' },
        { weekday: 0, block: 'evening' },
      ])
      let res = await app.inject({
        method: 'GET',
        url: `/api/players/${me.id}/availability`,
        cookies: me.cookies,
      })
      expect(res.json()).toHaveLength(2)

      // A second call with one slot must leave exactly one slot behind.
      await put([{ weekday: 3, block: 'afternoon' }])
      res = await app.inject({
        method: 'GET',
        url: `/api/players/${me.id}/availability`,
        cookies: me.cookies,
      })
      expect(res.json()).toEqual([{ weekday: 3, block: 'afternoon' }])
    })
  })

  it('accepts an empty grid, clearing availability', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'busy@example.com' })
      await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [{ weekday: 1, block: 'morning' }] },
      })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [] },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })
  })

  it('is idempotent when the same slot appears twice', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'dupe@example.com' })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: {
          slots: [
            { weekday: 2, block: 'evening' },
            { weekday: 2, block: 'evening' },
          ],
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(1)
    })
  })

  it('rejects an out-of-range weekday', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'bad@example.com' })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [{ weekday: 7, block: 'morning' }] },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: { code: 'validation_failed' } })
    })
  })

  it('lists who is free in a slot, excluding removed members', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker@example.com' })
      const keen = await signIn(app, ctx, { email: 'keen@example.com' })
      const gone = await signIn(app, ctx, { email: 'gone@example.com' })

      for (const m of [keen, gone]) {
        await ctx.db.insertInto('availability').values({ member_id: m.id, weekday: 6, block: 'morning' }).execute()
      }
      await ctx.db.updateTable('members').set({ status: 'removed' }).where('id', '=', gone.id).execute()

      const res = await app.inject({
        method: 'GET',
        url: '/api/availability?weekday=6&block=morning',
        cookies: me.cookies,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().map((r: { id: number }) => r.id)).toEqual([keen.id])
    })
  })

  it('includes an active member with no profile row yet, falling back to their email', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker2@example.com' })
      // `profile: false` is the harness flag built exactly for this case: an
      // active member who has never touched `PUT /api/players/me`, so their
      // `player_profiles` row does not exist yet.
      const noProfile = await signIn(app, ctx, { email: 'no-profile@example.com', profile: false })

      await ctx.db
        .insertInto('availability')
        .values({ member_id: noProfile.id, weekday: 2, block: 'evening' })
        .execute()

      const res = await app.inject({
        method: 'GET',
        url: '/api/availability?weekday=2&block=evening',
        cookies: me.cookies,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([{ id: noProfile.id, displayName: noProfile.email, photoUrl: null }])
    })
  })

  it('404s for a removed member\'s availability, mirroring GET /api/players/:id', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker3@example.com' })
      const gone = await signIn(app, ctx, { email: 'gone2@example.com' })
      await ctx.db.updateTable('members').set({ status: 'removed' }).where('id', '=', gone.id).execute()

      const res = await app.inject({
        method: 'GET',
        url: `/api/players/${gone.id}/availability`,
        cookies: me.cookies,
      })
      expect(res.statusCode).toBe(404)
    })
  })

  it('404s for a nonexistent member\'s availability', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker4@example.com' })
      const res = await app.inject({
        method: 'GET',
        url: '/api/players/999999/availability',
        cookies: me.cookies,
      })
      expect(res.statusCode).toBe(404)
    })
  })

  it('leaves the original grid intact when a mid-replace write fails', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'atomic@example.com' })

      // Establish a baseline grid.
      await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { slots: [{ weekday: 1, block: 'morning' }] },
      })

      // Poison one specific slot with a CHECK constraint that the request
      // schema itself cannot reject (weekday 4 / 'evening' is otherwise a
      // perfectly valid cell), so the failure can only surface once the
      // route's own INSERT runs -- after its DELETE has already executed in
      // the same statement batch. This is DDL inside the test's outer
      // transaction, so it vanishes with the rest of the test's rollback;
      // it never touches the real schema.
      await sql`
        alter table availability
        add constraint temp_poison_slot check (not (weekday = 4 and block = 'evening'))
      `.execute(ctx.db)

      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/availability',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: {
          slots: [
            { weekday: 5, block: 'afternoon' },
            { weekday: 4, block: 'evening' },
          ],
        },
      })
      // Not a validation error -- the schema allows this combination fine.
      // It fails at the database, which withTransaction's savepoint must
      // roll back as a unit.
      expect(res.statusCode).toBe(500)

      // The DELETE that ran before the poisoned INSERT must have been rolled
      // back along with it: the original single slot from the baseline PUT
      // is still there, untouched -- not half-deleted, and not partially
      // replaced with the one non-poisoned row from the failed attempt.
      const after = await app.inject({
        method: 'GET',
        url: `/api/players/${me.id}/availability`,
        cookies: me.cookies,
      })
      expect(after.json()).toEqual([{ weekday: 1, block: 'morning' }])
    })
  })

  it('requires both query parameters', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'asker@example.com' })
      const res = await app.inject({ method: 'GET', url: '/api/availability?weekday=6', cookies: me.cookies })
      expect(res.statusCode).toBe(400)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/players/1/availability' })).statusCode).toBe(401)
    })
  })
})
