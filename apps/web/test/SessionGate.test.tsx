import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SessionGate } from '../src/auth/SessionGate.js'

const wrap = (initial: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<SessionGate />}>
            <Route path="/" element={<p>Roster</p>} />
            <Route path="/setup" element={<p>Setup</p>} />
          </Route>
          <Route path="/login" element={<p>Login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

afterEach(() => vi.restoreAllMocks())

describe('SessionGate', () => {
  it('sends an unauthenticated visitor to login', async () => {
    respond(401, { error: { code: 'unauthorized', message: 'Sign in required' } })
    wrap('/')
    expect(await screen.findByText('Login')).toBeTruthy()
  })

  it('sends a signed-in member with no profile to setup', async () => {
    respond(200, { id: 1, email: 'a@b.c', role: 'player', hasProfile: false })
    wrap('/')
    expect(await screen.findByText('Setup')).toBeTruthy()
  })

  it('lets a fully set-up member through', async () => {
    respond(200, { id: 1, email: 'a@b.c', role: 'player', hasProfile: true })
    wrap('/')
    expect(await screen.findByText('Roster')).toBeTruthy()
  })

  it('does not bounce a member who is already on setup', async () => {
    respond(200, { id: 1, email: 'a@b.c', role: 'player', hasProfile: false })
    wrap('/setup')
    expect(await screen.findByText('Setup')).toBeTruthy()
  })
})
