import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfileForm } from '../src/components/ProfileForm.js'

const setup = (onSaved = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ProfileForm mode="create" submitLabel="Save profile" onSaved={onSaved} />
    </QueryClientProvider>,
  )
  return onSaved
}

afterEach(() => vi.restoreAllMocks())

describe('ProfileForm', () => {
  it('requires a display name', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    setup()
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText(/name your teammates/i)).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })

  it('hides the rating value until a rating system is chosen', async () => {
    setup()
    expect(screen.queryByLabelText(/rating value/i)).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText(/rating system/i), 'ntrp')
    expect(screen.getByLabelText(/rating value/i)).toBeTruthy()
  })

  it('submits and reports success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1, displayName: 'Ace' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const onSaved = setup()
    await userEvent.type(screen.getByLabelText(/display name/i), 'Ace')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('maps a server field error back onto its input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'bad_request',
            message: 'nope',
            details: { fields: [{ path: '/displayName', message: 'Already taken' }] },
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )
    setup()
    await userEvent.type(screen.getByLabelText(/display name/i), 'Ace')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText('Already taken')).toBeTruthy()
  })
})
