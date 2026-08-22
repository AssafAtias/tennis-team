import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type * as ReactRouter from 'react-router'
import { Component as Me } from '../src/screens/Me.js'

const ME = { id: 1, email: 'me@example.com', role: 'player', hasProfile: true }
const PROFILE = {
  id: 1, role: 'player', displayName: 'Ace', nickname: null, phone: null, photoUrl: null,
  dominantHand: 'right', backhand: 'two', preferredFormat: 'singles', ratingSystem: 'none',
  ratingValue: null, racquet: null, bio: null, record: { matchesPlayed: 0, wins: 0, losses: 0 },
}

vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof ReactRouter>()
  return { ...actual, useOutletContext: () => ME }
})

const renderMe = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <Me />
      </MemoryRouter>
    </QueryClientProvider>,
  )

function api(overrides: (url: string, method: string) => Response | undefined = () => undefined) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const custom = overrides(url, method)
    if (custom) return custom
    const body = url.includes('/availability') ? [] : url.includes('/players/') ? PROFILE : ME
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Me', () => {
  it('saves availability when a slot is toggled', async () => {
    const saved: unknown[] = []
    api((url, method) => {
      if (url.endsWith('/api/players/me/availability') && method === 'PUT') {
        saved.push(url)
        return new Response(JSON.stringify([{ weekday: 6, block: 'morning' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return undefined
    })
    renderMe()
    await userEvent.click(await screen.findByRole('switch', { name: /sat morning/i }))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(await screen.findByText(/saved/i)).toBeTruthy()
  })

  it('reports a failed availability save', async () => {
    api((url, method) =>
      url.endsWith('/api/players/me/availability') && method === 'PUT'
        ? new Response(JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        : undefined,
    )
    renderMe()
    await userEvent.click(await screen.findByRole('switch', { name: /sat morning/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save/i)
  })
})
