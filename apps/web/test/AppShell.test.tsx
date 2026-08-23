import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import type { MeResponse } from '@tennis/contracts'
import { AppShell } from '../src/components/AppShell.js'

const admin: MeResponse = { id: 1, email: 'coach@club.example', role: 'admin', hasProfile: true }

describe('AppShell', () => {
  it('shows the admin link when the outlet context is an admin', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          {/* Mirrors SessionGate, which renders <Outlet context={me} /> for its children. */}
          <Route element={<Outlet context={admin} />}>
            <Route path="/" element={<AppShell title="Roster">content</AppShell>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy()
  })

  it('renders without crashing and hides the admin link with no outlet context', () => {
    // Mirrors the top-level `*` catch-all route, which renders <AppShell> directly
    // with no SessionGate (and therefore no <Outlet context>) above it.
    render(
      <MemoryRouter initialEntries={['/missing']}>
        <Routes>
          <Route path="/missing" element={<AppShell title="Not found">That page does not exist.</AppShell>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Not found')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })
})
