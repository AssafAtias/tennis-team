import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import type * as ReactRouter from 'react-router'
import { Component as Roster } from '../src/screens/Roster.js'

const ME = { id: 1, email: 'me@example.com', role: 'player', hasProfile: true }

const ROSTER = [
  { id: 1, email: 'me@example.com', role: 'player', status: 'active', displayName: 'Me', nickname: null, photoUrl: null, preferredFormat: 'singles', ratingSystem: 'ntrp', ratingValue: '4.0' },
  { id: 2, email: 'pending@example.com', role: 'player', status: 'invited', displayName: null, nickname: null, photoUrl: null, preferredFormat: null, ratingSystem: 'none', ratingValue: null },
]

const renderRoster = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet />}>
            <Route path="*" element={<Roster />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

afterEach(() => vi.restoreAllMocks())

function mockApi(roster = ROSTER) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const body = url.includes('/api/members') ? roster : ME
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof ReactRouter>()
  return { ...actual, useOutletContext: () => ME }
})

describe('Roster', () => {
  it('lists teammates with their rating', async () => {
    mockApi()
    renderRoster()
    // Scoped to the roster list: AppShell's own nav also renders a "Me" tab
    // label (sidebar + bottom tabs), so an unscoped query is ambiguous.
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Me')).toBeTruthy()
    expect(within(list).getByText(/NTRP 4\.0/i)).toBeTruthy()
  })

  it('marks a member who has not signed in yet as pending', async () => {
    mockApi()
    renderRoster()
    // Exact text, not a case-insensitive /pending/i regex: the test's own
    // fixture email is "pending@example.com", so a loose match against
    // "pending" hits both the status badge and the email address and throws
    // on multiple matches instead of asserting either one.
    expect(await screen.findByText('Pending')).toBeTruthy()
    // Falls back to the address when no display name exists yet.
    expect(screen.getByText('pending@example.com')).toBeTruthy()
  })

  it('filters as you type', async () => {
    mockApi()
    renderRoster()
    await screen.findByRole('list')
    expect(within(screen.getByRole('list')).getByText('Me')).toBeTruthy()
    await userEvent.type(screen.getByLabelText(/search/i), 'pending')
    expect(within(screen.getByRole('list')).queryByText('Me')).toBeNull()
    expect(within(screen.getByRole('list')).getByText('pending@example.com')).toBeTruthy()
  })

  it('reports an empty roster rather than showing a blank page', async () => {
    mockApi([])
    renderRoster()
    expect(await screen.findByText(/no teammates yet/i)).toBeTruthy()
  })
})
