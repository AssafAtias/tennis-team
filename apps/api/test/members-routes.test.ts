import { describe, expect, it } from 'vitest'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('members routes', () => {
  it('lists invited and active members but not removed ones', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await signIn(app, ctx, { email: 'invited@example.com', status: 'invited', profile: false })
      await signIn(app, ctx, { email: 'gone@example.com', status: 'removed', profile: false })

      const res = await app.inject({ method: 'GET', url: '/api/members', cookies: admin.cookies })
      expect(res.statusCode).toBe(200)
      const emails = res.json().map((m: { email: string }) => m.email)
      expect(emails).toContain('admin@example.com')
      expect(emails).toContain('invited@example.com')
      expect(emails).not.toContain('gone@example.com')
    })
  })

  it('requires a session to read the roster', async () => {
    await buildTestApp(async (app) => {
      expect((await app.inject({ method: 'GET', url: '/api/members' })).statusCode).toBe(401)
    })
  })

  it('marks the roster response no-store', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const res = await app.inject({ method: 'GET', url: '/api/members', cookies: admin.cookies })
      expect(res.headers['cache-control']).toBe('no-store')
    })
  })

  it('lets an admin invite a teammate and emails them', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'newbie@example.com' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ email: 'newbie@example.com', status: 'invited', role: 'player' })
      expect(ctx.mailer.last).toMatchObject({ to: 'newbie@example.com', kind: 'invite' })
    })
  })

  it('refuses an invite from a player', async () => {
    await buildTestApp(async (app, ctx) => {
      const player = await signIn(app, ctx, { email: 'player@example.com', role: 'player' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: player.cookies,
        payload: { email: 'newbie@example.com' },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  it('reinstates a removed member instead of failing on the unique address', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await ctx.db.insertInto('members').values({ email: 'back@example.com', status: 'removed' }).execute()

      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'back@example.com' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ status: 'invited' })
    })
  })

  it('refuses to remove the last active admin', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'only@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/members/${admin.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: 'last_admin' } })
    })
  })

  it('refuses to demote the last active admin', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'only@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/members/${admin.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { role: 'player' },
      })
      expect(res.statusCode).toBe(409)
    })
  })

  it('allows demoting one admin while another remains', async () => {
    await buildTestApp(async (app, ctx) => {
      const a = await signIn(app, ctx, { email: 'a@example.com', role: 'admin' })
      const b = await signIn(app, ctx, { email: 'b@example.com', role: 'admin' })
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/members/${b.id}`,
        headers: ORIGIN,
        cookies: a.cookies,
        payload: { role: 'player' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ role: 'player' })
    })
  })

  it('a removed admin does not count toward the active-admin quorum', async () => {
    await buildTestApp(async (app, ctx) => {
      const a = await signIn(app, ctx, { email: 'a@example.com', role: 'admin' })
      await ctx.db.insertInto('members').values({ email: 'b@example.com', role: 'admin', status: 'removed' }).execute()

      // Only `a` is an active admin; the removed admin `b` must not be
      // counted as a survivor, so demoting or removing `a` is still refused.
      const demote = await app.inject({
        method: 'PATCH',
        url: `/api/members/${a.id}`,
        headers: ORIGIN,
        cookies: a.cookies,
        payload: { role: 'player' },
      })
      expect(demote.statusCode).toBe(409)
      expect(demote.json()).toMatchObject({ error: { code: 'last_admin' } })

      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/members/${a.id}`,
        headers: ORIGIN,
        cookies: a.cookies,
      })
      expect(remove.statusCode).toBe(409)
      expect(remove.json()).toMatchObject({ error: { code: 'last_admin' } })
    })
  })

  it('removes a member, revokes their sessions, and hides their profile', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const victim = await signIn(app, ctx, { email: 'victim@example.com', role: 'player' })

      // Their session works before removal.
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: victim.cookies })).statusCode).toBe(200)

      // Positive control: their profile is visible while active, so the 404
      // asserted below (after removal) is provably the removed-member check
      // in loadDetail, not just `/api/players/:id` being an unregistered
      // route -- without this, the two assertions can't be told apart.
      expect(
        (await app.inject({ method: 'GET', url: `/api/players/${victim.id}`, cookies: admin.cookies })).statusCode,
      ).toBe(200)

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/members/${victim.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(res.statusCode).toBe(204)

      // Removal takes effect immediately, not at token expiry.
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: victim.cookies })).statusCode).toBe(401)

      const profile = await app.inject({
        method: 'GET',
        url: `/api/players/${victim.id}`,
        cookies: admin.cookies,
      })
      expect(profile.statusCode).toBe(404)
    })
  })

  it('resends an invitation', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const pending = await ctx.db
        .insertInto('members')
        .values({ email: 'pending@example.com', status: 'invited' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const res = await app.inject({
        method: 'POST',
        url: `/api/members/${pending.id}/resend-invite`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(res.statusCode).toBe(202)
      expect(ctx.mailer.last).toMatchObject({ to: 'pending@example.com', kind: 'invite' })
    })
  })

  it('rate-limits resend-invite after 20 requests from the same caller in the window', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const pending = await ctx.db
        .insertInto('members')
        .values({ email: 'flooded-invite@example.com', status: 'invited' })
        .returning('id')
        .executeTakeFirstOrThrow()

      let last
      for (let i = 0; i < 20; i++) {
        last = await app.inject({
          method: 'POST',
          url: `/api/members/${pending.id}/resend-invite`,
          headers: ORIGIN,
          cookies: admin.cookies,
        })
      }
      expect(last!.statusCode).toBe(202)
      expect(ctx.mailer.sent).toHaveLength(20)

      const twentyFirst = await app.inject({
        method: 'POST',
        url: `/api/members/${pending.id}/resend-invite`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(twentyFirst.statusCode).toBe(429)
      expect(twentyFirst.json()).toMatchObject({ error: { code: 'rate_limited' } })
      expect(ctx.mailer.sent).toHaveLength(20)
    })
  })

  // --- Fix round 1 coverage -------------------------------------------------

  it('an invited (not-yet-accepted) admin does not count toward the active-admin quorum', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      const bob = await ctx.db
        .insertInto('members')
        .values({ email: 'bob@example.com', role: 'player', status: 'invited' })
        .returning('id')
        .executeTakeFirstOrThrow()

      // Promotion itself must succeed: it never reduces the active-admin
      // count, so the guard shouldn't even engage for it.
      const promote = await app.inject({
        method: 'PATCH',
        url: `/api/members/${bob.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { role: 'admin' },
      })
      expect(promote.statusCode).toBe(200)

      // Bob is now role=admin but status=invited -- he has never signed in
      // and may never accept. He must not count as the safety net that lets
      // the one real (active) admin demote or remove themselves.
      const demote = await app.inject({
        method: 'PATCH',
        url: `/api/members/${admin.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { role: 'player' },
      })
      expect(demote.statusCode).toBe(409)
      expect(demote.json()).toMatchObject({ error: { code: 'last_admin' } })

      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/members/${admin.id}`,
        headers: ORIGIN,
        cookies: admin.cookies,
      })
      expect(remove.statusCode).toBe(409)
      expect(remove.json()).toMatchObject({ error: { code: 'last_admin' } })
    })
  })

  it('refuses to invite an address that already belongs to an active member, and leaves it untouched', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await signIn(app, ctx, { email: 'already-active@example.com', status: 'active', profile: false })

      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'already-active@example.com' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: 'already_member' } })
      expect(ctx.mailer.sent).toHaveLength(0)

      const row = await ctx.db
        .selectFrom('members')
        .select('status')
        .where('email', '=', 'already-active@example.com')
        .executeTakeFirstOrThrow()
      expect(row.status).toBe('active')
    })
  })

  it('refuses to invite an address that already has a pending invitation', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await ctx.db.insertInto('members').values({ email: 'already-invited@example.com', status: 'invited' }).execute()

      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'already-invited@example.com' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: 'already_member' } })
    })
  })

  it('reinstates a removed member on invite (unaffected by the already_member guard)', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await ctx.db.insertInto('members').values({ email: 'back2@example.com', status: 'removed' }).execute()

      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'back2@example.com' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ status: 'invited', role: 'player' })
    })
  })

  it('reinstates a removed admin as a player, not with their old admin role restored', async () => {
    await buildTestApp(async (app, ctx) => {
      const admin = await signIn(app, ctx, { email: 'admin@example.com', role: 'admin' })
      await ctx.db
        .insertInto('members')
        .values({ email: 'ex-admin@example.com', role: 'admin', status: 'removed' })
        .execute()

      const res = await app.inject({
        method: 'POST',
        url: '/api/members',
        headers: ORIGIN,
        cookies: admin.cookies,
        payload: { email: 'ex-admin@example.com' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ status: 'invited', role: 'player' })
    })
  })
})
