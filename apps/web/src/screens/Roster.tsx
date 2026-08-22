import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { RosterEntry } from '@tennis/contracts'
import { useRoster } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Avatar } from '../components/Avatar.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { Field } from '../components/Field.js'
import { Spinner } from '../components/Spinner.js'

const nameOf = (m: RosterEntry) => m.displayName ?? m.email
const ratingOf = (m: RosterEntry) =>
  m.ratingSystem !== 'none' && m.ratingValue ? `${m.ratingSystem.toUpperCase()} ${m.ratingValue}` : null

function RosterRow({ member }: { member: RosterEntry }) {
  const rating = ratingOf(member)
  const detail = [rating, member.preferredFormat].filter(Boolean).join(' · ')
  // A completed profile can never have a null display name (ProfileBody
  // requires a non-empty one), so `displayName === null` means this member
  // has never finished Setup -- there is no player to navigate to yet.
  // `GET /api/players/:id` 404s for exactly this member, so linking there
  // would tell an admin "That player could not be found" about someone who
  // is plainly right there on the roster. The row already shows everything
  // there is to show (avatar, email, Pending badge), so a non-interactive
  // row -- not a dedicated "no profile yet" page -- is the correct target.
  const hasProfile = member.displayName != null

  const content = (
    <>
      <Avatar name={nameOf(member)} url={member.photoUrl} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{nameOf(member)}</span>
          {member.nickname ? (
            <span className="truncate text-xs text-night-700/60">“{member.nickname}”</span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-night-700/70">{detail || 'No details yet'}</span>
      </span>
      {member.status === 'invited' ? (
        <span className="rounded-full bg-clay-100 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-clay-600">
          Pending
        </span>
      ) : null}
    </>
  )

  if (!hasProfile) {
    return (
      <li>
        <div className="flex items-center gap-3 rounded-card p-3">{content}</div>
      </li>
    )
  }

  return (
    <li>
      <Link
        to={`/players/${member.id}`}
        className="flex items-center gap-3 rounded-card p-3 hover:bg-clay-50"
      >
        {content}
      </Link>
    </li>
  )
}

export function Component() {
  const { data, isPending, isError, refetch } = useRoster()
  const [term, setTerm] = useState('')

  const visible = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((m) =>
      [m.displayName, m.nickname, m.email].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [data, term])

  return (
    <AppShell title="Roster">
      {isPending ? <Spinner label="Loading the roster" /> : null}
      {isError ? <ErrorState message="Could not load the roster." onRetry={() => void refetch()} /> : null}

      {data ? (
        data.length === 0 ? (
          <Card>
            <p className="text-sm">No teammates yet. Ask an admin to send some invitations.</p>
          </Card>
        ) : (
          <>
            <Field
              label="Search"
              type="search"
              placeholder="Name or email"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <p className="mt-4 text-xs text-night-700/60">
              {visible.length} of {data.length}
            </p>
            <ul className="mt-1 divide-y divide-line">
              {visible.map((m) => (
                <RosterRow key={m.id} member={m} />
              ))}
            </ul>
          </>
        )
      ) : null}
    </AppShell>
  )
}
