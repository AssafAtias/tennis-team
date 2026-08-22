import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AvailabilityGrid } from '@tennis/contracts'
import { keys, useSaveAvailability, useUploadPhoto } from '../src/api/queries.js'

afterEach(() => vi.restoreAllMocks())

describe('useUploadPhoto', () => {
  it('rejects an unsupported content type before issuing any fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const { result } = renderHook(() => useUploadPhoto(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })

    const badFile = new File(['x'], 'photo.gif', { type: 'image/gif' })
    result.current.mutate(badFile)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ message: 'Please choose a JPEG, PNG, or WEBP image.' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/** Lets the test control exactly when a fetch call's response arrives. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('useSaveAvailability', () => {
  it('keeps the last-DISPATCHED grid in the cache even when its response arrives first, and an earlier dispatch resolves after it', async () => {
    // Two overlapping saves, deliberately resolved out of dispatch order:
    // the second call's (B's) response is made to land before the first
    // call's (A's). This is exactly the "toggle twice on a slow connection"
    // scenario -- a real, reachable race, not a contrived one -- since the
    // grid saves on every toggle with no debounce and nothing guarantees
    // in-flight requests settle in the order they were sent.
    const gridA: AvailabilityGrid = [{ weekday: 6, block: 'morning' }]
    const gridB: AvailabilityGrid = [
      { weekday: 6, block: 'morning' },
      { weekday: 1, block: 'evening' },
    ]
    const respA = deferred<Response>()
    const respB = deferred<Response>()
    let call = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1
      return call === 1 ? respA.promise : respB.promise
    })

    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const { result } = renderHook(() => useSaveAvailability(1), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })

    result.current.mutate(gridA)
    result.current.mutate(gridB)

    // B (dispatched second) resolves FIRST.
    respB.resolve(jsonResponse(gridB))
    await waitFor(() => expect(qc.getQueryData(keys.availability(1))).toEqual(gridB))

    // A (dispatched first) resolves LAST, out of order.
    respA.resolve(jsonResponse(gridA))
    // There is no positive state change to `waitFor` on for "A's stale
    // response was correctly ignored" -- the assertion is that the cache
    // does NOT change back to A. `apiFetch` awaits both `fetch` and
    // `res.json()` before the mutation settles, so a real macrotask tick
    // (not just a couple of microtask hops) is needed to let A's `onSuccess`
    // run to completion if it is going to run at all.
    await new Promise((r) => setTimeout(r, 10))

    expect(qc.getQueryData(keys.availability(1))).toEqual(gridB)
  })
})
