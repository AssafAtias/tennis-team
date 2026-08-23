import { createBrowserRouter } from 'react-router'
import { SessionGate } from './auth/SessionGate.js'
import { AppShell } from './components/AppShell.js'

export const router = createBrowserRouter([
  { path: '/login', lazy: () => import('./screens/Login.js') },
  {
    element: <SessionGate />,
    children: [
      { path: '/setup', lazy: () => import('./screens/Setup.js') },
      { path: '/', lazy: () => import('./screens/Roster.js') },
      { path: '/players/:id', lazy: () => import('./screens/Player.js') },
      { path: '/me', lazy: () => import('./screens/Me.js') },
      { path: '/matches', lazy: () => import('./screens/Matches.js') },
      { path: '/matches/new', lazy: () => import('./screens/RecordMatch.js') },
      { path: '/admin', lazy: () => import('./screens/Admin.js') },
    ],
  },
  { path: '*', element: <AppShell title="Not found">That page does not exist.</AppShell> },
])
