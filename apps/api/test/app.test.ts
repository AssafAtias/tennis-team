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
      app.get('/api/boom', () => {
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
      app.post('/api/echo', () => ({ ok: true }))
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
      app.post('/api/echo', () => ({ ok: true }))
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
})
