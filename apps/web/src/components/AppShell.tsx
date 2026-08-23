import type { PropsWithChildren } from 'react'
import { NavLink, useOutletContext } from 'react-router'
import type { MeResponse } from '@tennis/contracts'
import { BottomTabs } from './BottomTabs.js'

const LINKS = [
  { to: '/', label: 'Roster', end: true },
  { to: '/matches', label: 'Matches', end: false },
  { to: '/me', label: 'Me', end: false },
]

export function AppShell({ children, title }: PropsWithChildren<{ title: string }>) {
  // Optional: the catch-all `*` route renders AppShell outside of SessionGate's
  // <Outlet context>, so there is no session to read there. Every route that
  // needs the admin link lives under SessionGate and gets a real `me`.
  const me = useOutletContext<MeResponse | undefined>()
  return (
    <div className="lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line p-6 lg:block">
        <p className="font-display text-lg text-clay-500">Tennis Team</p>
        <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `tap-target flex items-center gap-2 rounded-card px-3 text-sm font-semibold ${
                  isActive ? 'bg-clay-100 text-night-900' : 'text-night-700/70 hover:bg-line/50'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`here-mark ${isActive ? '' : 'opacity-0'}`} aria-hidden="true" />
                  {l.label}
                </>
              )}
            </NavLink>
          ))}
          {me?.role === 'admin' ? (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `tap-target flex items-center gap-2 rounded-card px-3 text-sm font-semibold ${
                  isActive ? 'bg-clay-100 text-night-900' : 'text-night-700/70 hover:bg-line/50'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`here-mark ${isActive ? '' : 'opacity-0'}`} aria-hidden="true" />
                  Admin
                </>
              )}
            </NavLink>
          ) : null}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 lg:pb-10 lg:px-6">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        <div className="mt-5">{children}</div>
      </main>

      <BottomTabs />
    </div>
  )
}
