import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { MeResponse } from '@tennis/contracts'
import { buildTestApp, FakeMailer, FakeStore, testConfig, withTx } from './setup/harness.js'
import { buildApp } from '../src/app.js'
import { SESSION_COOKIE } from '../src/auth/sessions.js'
import { requireAuth } from '../src/plugins/session.js'
import { ipBudgetKey } from '../src/routes/auth.js'

const ORIGIN = { origin: 'http://localhost:3000' }

/** Captures every chunk written to it, for asserting on what a test app actually logged. */
class CapturingStream extends Writable {
  readonly lines: string[] = []
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString())
    callback()
  }
}

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

  // --- Fix round 1 coverage -------------------------------------------------

  it('never logs the raw callback token, even with request logging turned on', async () => {
    await withTx(async (db) => {
      const stream = new CapturingStream()
      const mailer = new FakeMailer()
      const app = await buildApp({
        db,
        // nodeEnv !== 'test' is deliberate: that's what turns request
        // logging on in the first place (see app.ts) — the point of this
        // test is that the token still doesn't show up once logging is on.
        config: { ...testConfig, nodeEnv: 'development' },
        mailer,
        storage: new FakeStore(),
        now: () => new Date('2026-08-21T10:00:00Z'),
        logDestination: stream,
      })
      try {
        await db.insertInto('members').values({ email: 'logged@example.com', status: 'active' }).execute()
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          headers: ORIGIN,
          payload: { email: 'logged@example.com' },
        })
        const token = new URL(mailer.last!.url).searchParams.get('token')!
        await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })

        const logged = stream.lines.join('')
        // Logging is genuinely on (otherwise this assertion would pass for
        // the wrong reason): the path is there...
        expect(logged).toContain('/api/auth/callback')
        // ...but the token that made this a bearer credential is not.
        expect(logged).not.toContain(token)
      } finally {
        await app.close()
      }
    })
  })

  it('a mail-provider failure still returns 202 immediately, not a 500 that would out a known address', async () => {
    await withTx(async (db) => {
      class FailingMailer {
        calls = 0
        async sendSignInLink(): Promise<void> {
          this.calls += 1
          throw new Error('mail provider down')
        }
      }
      const mailer = new FailingMailer()
      const app = await buildApp({
        db,
        config: testConfig,
        mailer,
        storage: new FakeStore(),
        now: () => new Date('2026-08-21T10:00:00Z'),
      })
      try {
        await db.insertInto('members').values({ email: 'flaky@example.com', status: 'active' }).execute()
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          headers: ORIGIN,
          payload: { email: 'flaky@example.com' },
        })
        expect(res.statusCode).toBe(202)
        expect(res.json()).toEqual({ status: 'sent' })
        // Give the fire-and-forget send a tick to actually run (and fail),
        // proving the 202 above did not come from the send having already
        // quietly succeeded before this assertion.
        await new Promise((resolve) => setImmediate(resolve))
        expect(mailer.calls).toBe(1)
      } finally {
        await app.close()
      }
    })
  })

  it('rate-limits request-link per IP once 20 distinct addresses have been probed', async () => {
    await buildTestApp(async (app) => {
      let last
      for (let i = 0; i < 20; i++) {
        last = await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          headers: ORIGIN,
          payload: { email: `enum-probe-${i}@example.com` },
        })
      }
      expect(last!.statusCode).toBe(202)

      const res21 = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'enum-probe-20@example.com' },
      })
      expect(res21.statusCode).toBe(429)
      expect(res21.json()).toMatchObject({ error: { code: 'rate_limited' } })
    })
  })

  it('a token redeemed after its member was removed lands on the invalid destination and mints no session', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'goneafter@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'goneafter@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!

      // Removed after the link was sent, before it was redeemed.
      await ctx.db
        .updateTable('members')
        .set({ status: 'removed' })
        .where('email', '=', 'goneafter@example.com')
        .execute()

      const res = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/login?error=link_invalid')
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined()

      const sessionCount = await ctx.db
        .selectFrom('sessions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
      expect(Number(sessionCount.n)).toBe(0)
    })
  })

  it('a stale session cookie is cleared by requireAuth, not just rejected', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'wentaway@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'wentaway@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const cb = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value

      // The member is removed after the session was minted: `resolveSession`
      // filters on `status = 'active'`, so this cookie can no longer resolve
      // — but without the fix, it would also never be cleared, since
      // `requireAuth` used to 401 without touching the cookie.
      await ctx.db.updateTable('members').set({ status: 'removed' }).where('email', '=', 'wentaway@example.com').execute()

      const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: session } })
      expect(res.statusCode).toBe(401)
      const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE)
      expect(cleared?.value).toBe('')
    })
  })

  it('me responses are marked no-store', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'nostore@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'nostore@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const cb = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value

      const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: session } })
      expect(res.headers['cache-control']).toBe('no-store')
    })
  })

  it('the response schema strips fields outside MeResponse, even if request.member somehow carried one', async () => {
    await buildTestApp(async (app, ctx) => {
      // Registered before any inject() on this app — Fastify refuses new
      // routes once an instance has started, which any earlier inject()
      // would trigger.
      app.get(
        '/api/test-me-leak',
        { preHandler: requireAuth, schema: { response: { 200: MeResponse } } },
        (req) => ({ ...req.member, secretInternalField: 'should-not-appear' }),
      )

      await ctx.db.insertInto('members').values({ email: 'leak@example.com', status: 'active' }).execute()
      await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'leak@example.com' },
      })
      const token = new URL(ctx.mailer.last!.url).searchParams.get('token')!
      const cb = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` })
      const session = cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value

      const res = await app.inject({
        method: 'GET',
        url: '/api/test-me-leak',
        cookies: { [SESSION_COOKIE]: session },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).not.toHaveProperty('secretInternalField')
    })
  })

  it('enumeration: a known and an unknown address get statuswise, bytewise, and header-wise identical responses', async () => {
    await buildTestApp(async (app, ctx) => {
      await ctx.db.insertInto('members').values({ email: 'sym-known@example.com', status: 'active' }).execute()

      const known = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'sym-known@example.com' },
      })
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'sym-unknown@example.com' },
      })

      expect(known.statusCode).toBe(unknown.statusCode)
      expect(known.json()).toEqual(unknown.json())
      expect(Object.keys(known.headers).sort()).toEqual(Object.keys(unknown.headers).sort())
    })
  })

  it('rate-limits request-link per /64 even when each request comes from a different address in that /64', async () => {
    await buildTestApp(async (app) => {
      // All addresses below live in the same 2001:db8:f00d::/64 — an ISP
      // handing a customer that whole /64 could pick any of them per
      // request. If the budget were keyed on the raw address (pre-fix),
      // none of these would ever collide and all 21 would return 202.
      let last
      for (let i = 0; i < 20; i++) {
        last = await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          headers: ORIGIN,
          payload: { email: `same-64-${i}@example.com` },
          remoteAddress: `2001:db8:f00d::${(i + 1).toString(16)}`,
        })
      }
      expect(last!.statusCode).toBe(202)

      const res21 = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: 'same-64-20@example.com' },
        remoteAddress: '2001:db8:f00d::ffff',
      })
      expect(res21.statusCode).toBe(429)
      expect(res21.json()).toMatchObject({ error: { code: 'rate_limited' } })
    })
  })
})

describe('ipBudgetKey', () => {
  it('collapses two different addresses in the same /64 to the same key', () => {
    expect(ipBudgetKey('2001:db8::1')).toBe(ipBudgetKey('2001:db8::dead:beef'))
  })

  it('gives addresses in different /64s different keys', () => {
    expect(ipBudgetKey('2001:db8::1')).not.toBe(ipBudgetKey('2001:db8:1::1'))
  })

  it('parses :: and a ::-prefixed loopback without throwing', () => {
    expect(() => ipBudgetKey('::')).not.toThrow()
    expect(() => ipBudgetKey('::1')).not.toThrow()
  })

  it('passes an IPv4 address through unchanged', () => {
    expect(ipBudgetKey('203.0.113.5')).toBe('203.0.113.5')
  })

  it('does not break on an address carrying a zone index', () => {
    expect(() => ipBudgetKey('fe80::1%eth0')).not.toThrow()
  })
})
