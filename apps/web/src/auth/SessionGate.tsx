import { Navigate, Outlet, useLocation } from 'react-router'
import { useMe } from '../api/queries.js'
import { Spinner } from '../components/Spinner.js'

export function SessionGate() {
  const { data: me, isPending, isError } = useMe()
  const { pathname } = useLocation()

  if (isPending) return <Spinner label="Checking your session" />
  if (isError || !me) return <Navigate to="/login" replace />
  if (!me.hasProfile && pathname !== '/setup') return <Navigate to="/setup" replace />
  return <Outlet context={me} />
}
