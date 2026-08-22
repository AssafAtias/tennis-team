import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PHOTO_MAX_BYTES } from '@tennis/contracts'
import { PhotoPicker } from '../src/components/PhotoPicker.js'

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <PhotoPicker name="Ace" currentUrl={null} />
    </QueryClientProvider>,
  )

const file = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

afterEach(() => vi.restoreAllMocks())

describe('PhotoPicker', () => {
  it('rejects an oversized file locally, before any request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    wrap()
    await userEvent.upload(screen.getByLabelText(/photo/i), file('big.jpg', 'image/jpeg', PHOTO_MAX_BYTES + 1))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/5 ?MB/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an unsupported type locally', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    wrap()
    await userEvent.upload(screen.getByLabelText(/photo/i), file('anim.gif', 'image/gif', 1000))
    expect((await screen.findByRole('alert')).textContent).toMatch(/jpeg, png or webp/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('runs presign, upload, and confirm in order', async () => {
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/photo')) {
        return new Response(
          JSON.stringify({ uploadUrl: 'https://store.local/up', key: 'photos/1/upload-x', maxBytes: PHOTO_MAX_BYTES }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ id: 1, displayName: 'Ace', photoUrl: 'https://store.local/final' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    wrap()
    await userEvent.upload(screen.getByLabelText(/photo/i), file('me.jpg', 'image/jpeg', 5000))
    await vi.waitFor(() =>
      expect(calls).toEqual([
        'POST /api/players/me/photo',
        'PUT https://store.local/up',
        'PUT /api/players/me/photo/confirm',
      ]),
    )
  })
})
