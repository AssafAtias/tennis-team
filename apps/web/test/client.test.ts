import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../src/api/client.js'

const mockFetch = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

afterEach(() => vi.restoreAllMocks())

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(200, { id: 1 })
    await expect(apiFetch('/api/auth/me')).resolves.toEqual({ id: 1 })
  })

  it('returns undefined for 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('throws an ApiError carrying the code', async () => {
    mockFetch(403, { error: { code: 'forbidden', message: 'Not permitted' } })
    await expect(apiFetch('/api/members')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('exposes field errors keyed by form field name', async () => {
    mockFetch(400, {
      error: {
        code: 'validation_failed',
        message: 'bad',
        details: { fields: [{ path: '/displayName', message: 'Required' }] },
      },
    })
    try {
      await apiFetch('/api/players/me', { method: 'PUT', body: '{}' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).fields).toEqual({ displayName: 'Required' })
    }
  })

  it('sends json content-type and same-origin credentials on a mutation', async () => {
    const spy = mockFetch(200, {})
    await apiFetch('/api/members', { method: 'POST', body: JSON.stringify({ email: 'a@b.c' }) })
    const init = spy.mock.calls[0]![1]!
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })
})
