import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'
import { SESSION_COOKIE } from '../src/auth/sessions.js'

const ORIGIN = { origin: 'http://localhost:3000' }

describe('auth routes', () => {
  it('emails a link to a known member', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'known@example.com', status: 'active' }).execute()
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'known@example.com' },
      })
      expect(res.statusCode).toBe(202)
      expect(ctx.mailer.last?.to).toBe('known@example.com')
      expect(ctx.mailer.last?.url).toContain('/api/auth/callback?token=')
    })
  })

  it('answers identically for an unknown address and sends nothing', async () => {
    await buildTestApp(async (app, ctx) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'stranger@example.com' },
      })
      expect(res.statusCode).toBe(202)
      expect(res.json()).toEqual({ status: 'sent' })
      expect(ctx.mailer.sent).toHaveLength(0)
    })
  })

  it('sends nothing to a removed member', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'ex@example.com', status: 'removed' }).execute()
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'ex@example.com' },
      })
      expect(res.statusCode).toBe(202)
      expect(ctx.mailer.sent).toHaveLength(0)
    })
  })

  it('matches the address case-insensitively', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'Mixed.Case@Example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'mixed.case@example.com' },
      })
      expect(ctx.mailer.sent).toHaveLength(1)
    })
  })

  it('rejects a malformed email with a 400 before ever touching the mailer', async () => {
    await buildTestApp(async (app, ctx) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'not-an-email-address' },
      })
      expect(res.statusCode).toBe(400)
      expect(ctx.mailer.sent).toHaveLength(0)
    })
  })

  it('signs in an invited member, activates them, and redirects to setup', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'new@example.com', status: 'invited' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'new@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!

      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/setup')
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.httpOnly).toBe(true)

      const member = await ctx.db
        .selectFrom('members')
        .select('status')
        .where('email', '=', 'new@example.com')
        .executeTakeFirstOrThrow()
      expect(member.status).toBe('active')
    })
  })

  it('redirects an existing member with a profile to the roster', async () => {
    await buildTestApp(async (app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'old@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()
      await ctx.db.insertInto('player_profiles').values({ member_id: m.id, display_name: 'Old' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'old@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.headers.location).toBe('/')
    })
  })

  it('refuses to reuse a consumed token, and the second attempt mints no session', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'once@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'once@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!

      const first = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(first.statusCode).toBe(302)
      expect(first.headers.location).toBe('/setup')

      const second = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(second.statusCode).toBe(302)
      expect(second.headers.location).toBe('/login?error=link_invalid')
      // The reused token must not mint a second, independent session.
      expect(second.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined()

      const sessionCount = await ctx.db
        .selectFrom('sessions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
      expect(Number(sessionCount.n)).toBe(1)
    })
  })

  it('refuses an expired token', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'slow@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'slow@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      ctx.clock.now = new Date('2026-08-21T10:16:00Z') // 16 minutes later

      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.headers.location).toBe('/login?error=link_invalid')
    })
  })

  it('sends an invalid-token callback to the same place as any other bad token', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/callback?token=totally-made-up-token-value-1234567890',
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/login?error=link_invalid')
    })
  })

  it('returns the current member and clears the session on logout', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'me@example.com', status: 'active', role: 'admin' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'me@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const cb = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: session } })
      expect(me.json()).toMatchObject({ email: 'me@example.com', role: 'admin', hasProfile: false })

      const out = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: ORIGIN,
        cookies: { [SESSION_COOKIE]: session },
      })
      expect(out.statusCode).toBe(204)

      const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: session } })
      expect(after.statusCode).toBe(401)
    })
  })

  it('requires authentication for me', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
      expect(res.statusCode).toBe(401)
    })
  })

  it('requires authentication for logout', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: ORIGIN })
      expect(res.statusCode).toBe(401)
    })
  })

  it('rate-limits request-link after 5 requests for the same address in the window', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'flooded@example.com', status: 'active' }).execute()
      let last
      for (let i = 0; i < 5; i++) {
        last = await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          headers: ORIGIN,
          payload: { email: 'flooded@example.com' },
        })
      }
      expect(last!.statusCode).toBe(202)
      expect(ctx.mailer.sent).toHaveLength(5)

      const sixth = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'flooded@example.com' },
      })
      expect(sixth.statusCode).toBe(429)
      expect(sixth.json()).toMatchObject({ error: { code: 'rate_limited' } })
      // The limiter engaged instead of failing open: still only 5 mails sent.
      expect(ctx.mailer.sent).toHaveLength(5)
    })
  })
})
