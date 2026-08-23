import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Component as Login } from '../src/screens/Login.js'

const renderLogin = (search = '') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  )

afterEach(() => vi.restoreAllMocks())

describe('Login', () => {
  it('shows a confirmation that does not reveal whether the address is on the team', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'sent' }), { status: 202, headers: { 'content-type': 'application/json' } }),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    const confirmation = await screen.findByRole('status')
    expect(confirmation.textContent).toMatch(/check your inbox/i)
    // Must NOT confirm membership either way.
    expect(confirmation.textContent).not.toMatch(/not a member|no account|unknown/i)
  })

  it('rejects a malformed address before calling the API', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText(/valid email/i)).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })

  it('explains an invalid or used link', () => {
    renderLogin('?error=link_invalid')
    expect(screen.getByRole('alert').textContent).toMatch(/expired|already been used/i)
  })
})
