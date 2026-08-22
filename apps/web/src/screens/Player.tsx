import { useParams } from 'react-router'
import { useAvailability, usePlayer } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { Avatar } from '../components/Avatar.js'
import { AvailabilityGrid } from '../components/AvailabilityGrid.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { Spinner } from '../components/Spinner.js'

const HAND = { left: 'Left-handed', right: 'Right-handed' } as const
const BACK = { one: 'One-handed backhand', two: 'Two-handed backhand' } as const

export function Component() {
  const id = Number(useParams().id)
  const player = usePlayer(id)
  const availability = useAvailability(id)

  if (player.isPending) {
    return (
      <AppShell title="Player">
        <Spinner label="Loading player" />
      </AppShell>
    )
  }
  if (player.isError || !player.data) {
    return (
      <AppShell title="Player">
        <ErrorState message="That player could not be found." onRetry={() => void player.refetch()} />
      </AppShell>
    )
  }

  const p = player.data
  const facts = [
    p.dominantHand ? HAND[p.dominantHand] : null,
    p.backhand ? BACK[p.backhand] : null,
    p.preferredFormat ? `Prefers ${p.preferredFormat}` : null,
    p.ratingSystem !== 'none' && p.ratingValue ? `${p.ratingSystem.toUpperCase()} ${p.ratingValue}` : null,
    p.racquet,
  ].filter(Boolean) as string[]

  return (
    <AppShell title={p.displayName}>
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={p.displayName} url={p.photoUrl} size={72} />
            <div className="min-w-0">
              <p className="font-display text-xl">{p.displayName}</p>
              {p.nickname ? <p className="text-sm text-night-700/70">“{p.nickname}”</p> : null}
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="mt-1 inline-block text-sm text-clay-600 underline">
                  {p.phone}
                </a>
              ) : null}
            </div>
          </div>
          {p.bio ? <p className="mt-4 text-sm leading-relaxed">{p.bio}</p> : null}
        </Card>

        <Card>
          <h2 className="font-display text-lg">Record</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            {[
              ['Played', p.record.matchesPlayed],
              ['Won', p.record.wins],
              ['Lost', p.record.losses],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-card bg-clay-50 py-3">
                <dt className="text-xs uppercase tracking-wide text-night-700/60">{label}</dt>
                <dd className="font-display text-2xl">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {facts.length > 0 ? (
          <Card>
            <h2 className="font-display text-lg">Game</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {facts.map((f) => (
                <li key={f} className="rounded-full bg-line/60 px-3 py-1 text-xs font-medium">
                  {f}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="font-display text-lg">Usually available</h2>
          <div className="mt-3">
            {availability.isPending ? (
              <Spinner label="Loading availability" />
            ) : (
              <AvailabilityGrid slots={availability.data ?? []} />
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
