import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUploadPhoto } from '../src/api/queries.js'

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

// `useSaveAvailability` no longer guards against overlapping calls itself --
// as of Task 16 fix round 2, `AvailabilityCard` (apps/web/src/screens/Me.tsx)
// enforces single-flight (at most one save in flight, with a trailing resend
// if the draft moved on while it was in flight), so the hook can never
// actually have two of its own calls in the air at once in practice. The
// out-of-order-response scenario this file used to pin at the hook level is
// now covered end-to-end at the screen level instead -- see
// apps/web/test/Me.test.tsx's "keeps the user's toggles..." and "a burst of
// three toggles..." cases, which exercise the real sequencing logic rather
// than a hook used in a way the app no longer uses it.
