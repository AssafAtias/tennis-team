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
