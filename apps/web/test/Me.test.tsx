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

/** Lets a test control exactly when each `PUT .../availability` call's response arrives, and count how many are in flight at once. */
function apiWithControlledAvailabilitySaves() {
  const putCalls: unknown[] = []
  const resolvers: ((r: Response) => void)[] = []
  let inFlight = 0
  let maxInFlight = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/players/me/availability') && method === 'PUT') {
      putCalls.push(url)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise<Response>((resolve) => {
        resolvers.push((r) => {
          inFlight -= 1
          resolve(r)
        })
      })
    }
    const body = url.includes('/availability') ? [] : url.includes('/players/') ? PROFILE : ME
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { putCalls, resolvers, maxInFlight: () => maxInFlight }
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

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

  it('keeps the user\'s toggles and shows the error when a trailing resend fails after the original (now-superseded) save succeeded', async () => {
    // "Older save succeeds, newest save fails" under single-flight: the
    // FIRST dispatch (an older, now-superseded draft) is the one that
    // succeeds; that success triggers a trailing resend of whatever the
    // draft has since become, and it's THAT resend -- the newest one --
    // that fails. A prior (now-fixed) bug let the older success clear the
    // draft and reset the error state regardless of what had happened
    // since, silently reverting the user's second toggle.
    const { putCalls, resolvers } = apiWithControlledAvailabilitySaves()
    renderMe()

    await userEvent.click(await screen.findByRole('switch', { name: /sat morning/i }))
    await vi.waitFor(() => expect(putCalls).toHaveLength(1))

    // A second toggle while the first save is still in flight: with
    // single-flight this must only update the local draft, not dispatch a
    // second request yet (the grid must stay interactive, not disabled).
    await userEvent.click(screen.getByRole('switch', { name: /sun morning/i }))
    expect(putCalls).toHaveLength(1)

    // The OLDER save (Sat morning alone) succeeds...
    resolvers[0]!(jsonResponse([{ weekday: 6, block: 'morning' }]))

    // ...which triggers exactly one trailing resend carrying the NEWER
    // draft (both toggles), now that the wire is free.
    await vi.waitFor(() => expect(putCalls).toHaveLength(2))

    // The NEWEST save (the resend) fails.
    resolvers[1]!(
      new Response(JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save/i)
    // Both toggles are still visibly on -- the older success did not
    // silently revert the newer, still-unsaved state.
    expect(screen.getByRole('switch', { name: /sat morning/i }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /sun morning/i }).getAttribute('aria-checked')).toBe('true')
  })

  it('issues at most one in-flight save for a burst of three toggles, and persists the final combined state', async () => {
    const { putCalls, resolvers, maxInFlight } = apiWithControlledAvailabilitySaves()
    renderMe()

    await userEvent.click(await screen.findByRole('switch', { name: /sat morning/i }))
    await vi.waitFor(() => expect(putCalls).toHaveLength(1))

    // Two more toggles while the first save is in flight -- both must land
    // on the local draft only; no second (let alone third) request yet.
    await userEvent.click(screen.getByRole('switch', { name: /sun morning/i }))
    await userEvent.click(screen.getByRole('switch', { name: /mon evening/i }))
    expect(putCalls).toHaveLength(1)
    expect(maxInFlight()).toBe(1)

    // Resolve the in-flight save, echoing back exactly what it was sent
    // (Sat morning alone) -- realistic, since the server only knows about
    // the request it actually received.
    resolvers[0]!(jsonResponse([{ weekday: 6, block: 'morning' }]))

    // Exactly one trailing resend, carrying the combined final state.
    await vi.waitFor(() => expect(putCalls).toHaveLength(2))
    expect(maxInFlight()).toBe(1)

    resolvers[1]!(
      jsonResponse([
        { weekday: 6, block: 'morning' },
        { weekday: 0, block: 'morning' },
        { weekday: 1, block: 'evening' },
      ]),
    )

    await screen.findByText(/saved/i)
    // No further requests beyond the original dispatch and its one resend.
    expect(putCalls).toHaveLength(2)
    expect(screen.getByRole('switch', { name: /sat morning/i }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /sun morning/i }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /mon evening/i }).getAttribute('aria-checked')).toBe('true')
  })
})
