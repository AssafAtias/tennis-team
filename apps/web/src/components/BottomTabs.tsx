import { NavLink } from 'react-router'

const TABS = [
  { to: '/', label: 'Roster' },
  { to: '/matches', label: 'Matches' },
  { to: '/me', label: 'Me' },
] as const

export function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-chalk/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `tap-target flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold ${
              isActive ? 'text-clay-500' : 'text-night-700/60'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {/* The signature "here mark" -- same motif as the sidebar's, so the
                  sense of place survives the switch to desktop layout at `lg`. */}
              <span className={`here-mark ${isActive ? '' : 'opacity-0'}`} aria-hidden="true" />
              {t.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
