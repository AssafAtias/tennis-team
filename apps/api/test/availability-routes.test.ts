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
