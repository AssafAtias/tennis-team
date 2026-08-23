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
    // The input carries a real `accept` attribute (a load-bearing native
    // picker hint, not redundant with this JS check -- see PhotoPicker.tsx),
    // and user-event's `upload()` honours it by default, silently dropping a
    // non-matching file before `onChange` ever fires. `applyAccept: false`
    // is user-event's own documented escape hatch for exercising the JS
    // fallback path anyway, for exactly this kind of test.
    await userEvent.upload(screen.getByLabelText(/photo/i), file('anim.gif', 'image/gif', 1000), {
      applyAccept: false,
    })
    expect((await screen.findByRole('alert')).textContent).toMatch(/jpeg, png or webp/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('leaves the file input re-pickable after a local rejection', async () => {
    wrap()
    const input = screen.getByLabelText(/photo/i) as HTMLInputElement
    const big = file('big.jpg', 'image/jpeg', PHOTO_MAX_BYTES + 1)
    await userEvent.upload(input, big)
    expect(await screen.findByRole('alert')).toBeTruthy()
    // The installed user-event's own `upload()` skips re-dispatching `change`
    // whenever `input.files` already equals the files being set (see
    // dist/cjs/utility/upload.js's `fileDialog` early-return) -- the same
    // dedup real browsers apply to an unchanged file input. A second
    // `userEvent.upload()` with the identical File object would render an
    // outwardly IDENTICAL alert whether or not the handler actually re-ran,
    // so that alone can't distinguish the fixed and broken versions.
    // Asserting the input is actually empty right after the first rejection
    // is what proves `onPick` resets it on every path -- including a local
    // rejection -- not just in `onSettled`.
    expect(input.files).toHaveLength(0)

    // With the input cleared, re-picking the very same File object is no
    // longer a no-op for user-event's dedup check, and genuinely re-fires
    // the handler.
    await userEvent.upload(input, big)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(input.files).toHaveLength(0)
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
