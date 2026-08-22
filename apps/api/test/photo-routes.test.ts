import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { buildTestApp, signIn } from './setup/harness.js'

const ORIGIN = { origin: 'http://localhost:3000' }

const samplePhoto = () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: '#3f7d3f' } })
    // See images.test.ts: sharp's `Exif` type takes numbered IFD blocks, not a `GPS` key.
    .withExif({ IFD3: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer()

describe('photo routes', () => {
  it('issues a presigned url for an allowed content type', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'shot@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/jpeg', sizeBytes: 120_000 },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.uploadUrl).toContain('signed=1')
      expect(body.key).toMatch(new RegExp(`^photos/${me.id}/upload-`))
      expect(body.maxBytes).toBe(5 * 1024 * 1024)
    })
  })

  it('rejects a disallowed content type', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'gif@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/gif', sizeBytes: 100 },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('rejects a file over the size cap', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'huge@example.com' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/jpeg', sizeBytes: 9_000_000 },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it('normalises on confirm, stores the derived image, and deletes the upload', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'confirm@example.com' })
      const presign = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { contentType: 'image/jpeg', sizeBytes: 120_000 },
      })
      const { key } = presign.json()
      await ctx.storage.put(key, await samplePhoto(), 'image/jpeg')

      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/photo/confirm',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { key },
      })
      expect(res.statusCode).toBe(200)
      const finalKey = res.json().photoUrl.split('/').slice(-3).join('/')

      expect(ctx.storage.objects.has(key)).toBe(false) // raw upload cleaned up
      const stored = ctx.storage.objects.get(finalKey)!
      expect(stored.contentType).toBe('image/webp')
      expect((await sharp(stored.body).metadata()).exif).toBeUndefined()
    })
  })

  it('refuses to confirm a key belonging to another member', async () => {
    await buildTestApp(async (app, ctx) => {
      const me = await signIn(app, ctx, { email: 'thief@example.com' })
      const other = await signIn(app, ctx, { email: 'target@example.com' })
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/me/photo/confirm',
        headers: ORIGIN,
        cookies: me.cookies,
        payload: { key: `photos/${other.id}/upload-abc` },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  it('requires a session', async () => {
    await buildTestApp(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/players/me/photo',
        headers: ORIGIN,
        payload: { contentType: 'image/jpeg', sizeBytes: 100 },
      })
      expect(res.statusCode).toBe(401)
    })
  })
})
