import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'

describe('app', () => {
  it('reports healthy when the database answers', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ status: 'ok' })
    })
  })

  it('returns the error envelope for an unknown route', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/nope' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: { code: 'not_found' } })
    })
  })

  it('hides internal detail behind a request id on an unexpected error', async () => {
    await buildTestApp(async (app) => {
      // `public: true`: this route exercises the error envelope, not auth —
      // Task 4's default-deny `onRoute` hook otherwise refuses to register
      // any `/api/` route with no auth `preHandler`.
      app.get('/api/boom', { config: { public: true } }, () => {
        throw new Error('secret internal detail')
      })
      const res = await app.inject({ method: 'GET', url: '/api/boom' })
      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(JSON.stringify(body)).not.toContain('secret internal detail')
      expect(body.error.details).toHaveProperty('requestId')
    })
  })

  it('rejects a state-changing request with a foreign Origin', async () => {
    await buildTestApp(async (app) => {
      // `public: true`: this route exercises the origin guard, not auth —
      // see the note on `/api/boom` above.
      app.post('/api/echo', { config: { public: true } }, () => ({ ok: true }))
      const res = await app.inject({
        method: 'POST',
        url: '/api/echo',
        headers: { origin: 'https://evil.example' },
        payload: {},
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: { code: 'bad_origin' } })
    })
  })

  it('allows a state-changing request from the app origin', async () => {
    await buildTestApp(async (app) => {
      // `public: true`: this route exercises the origin guard, not auth —
      // see the note on `/api/boom` above.
      app.post('/api/echo', { config: { public: true } }, () => ({ ok: true }))
      const res = await app.inject({
        method: 'POST',
        url: '/api/echo',
        headers: { origin: 'http://localhost:3000' },
        payload: {},
      })
      expect(res.statusCode).toBe(200)
    })
  })

  it('allows a GET with no Origin header', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    })
  })

  it('allows a state-changing request with no Origin header (non-browser client)', async () => {
    await buildTestApp(async (app) => {
      // `public: true`: this route exercises the origin guard, not auth —
      // see the note on `/api/boom` above.
      app.post('/api/echo', { config: { public: true } }, () => ({ ok: true }))
      const res = await app.inject({ method: 'POST', url: '/api/echo', payload: {} })
      expect(res.statusCode).toBe(200)
    })
  })

  it('still returns the error envelope when a route throws a non-object value', async () => {
    // Fastify hands the error handler whatever was actually thrown. A bare
    // string (or null, etc.) must not bypass the envelope: the `in` operator
    // throws TypeError on a non-object right operand, so the handler has to
    // guard for this rather than assume every thrown value is Error-like.
    await buildTestApp(async (app) => {
      // `public: true`: see the note on `/api/boom` above.
      app.get('/api/oops', { config: { public: true } }, () => {
        // Deliberately throwing a non-Error value to exercise the guard.
        throw 'a bare string, not an Error'
      })
      const res = await app.inject({ method: 'GET', url: '/api/oops' })
      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ error: { code: 'internal_error' } })
    })
  })

  it('refuses to register an /api/ route with no auth preHandler and no public flag', async () => {
    await buildTestApp(async (app) => {
      expect(() => app.get('/api/unguarded', () => ({ ok: true }))).toThrow(
        /declares no auth preHandler and is not marked public/,
      )
    })
  })

  it('allows an /api/ route explicitly marked public, and one with an auth preHandler', async () => {
    await buildTestApp(async (app) => {
      expect(() => app.get('/api/public-thing', { config: { public: true } }, () => ({ ok: true }))).not.toThrow()
      expect(() => app.get('/api/guarded', { preHandler: async () => {} }, () => ({ ok: true }))).not.toThrow()
    })
  })
})
