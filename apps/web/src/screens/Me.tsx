import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { AvailabilityGrid as Grid, MeResponse } from '@tennis/contracts'
import { useAvailability, useLogout, usePlayer, useSaveAvailability } from '../api/queries.js'
import { AppShell } from '../components/AppShell.js'
import { AvailabilityGrid } from '../components/AvailabilityGrid.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { ErrorState } from '../components/ErrorState.js'
import { PhotoPicker } from '../components/PhotoPicker.js'
import { ProfileForm } from '../components/ProfileForm.js'
import { Spinner } from '../components/Spinner.js'

function AvailabilityCard({ memberId }: { memberId: number }) {
  const query = useAvailability(memberId)
  const save = useSaveAvailability(memberId)
  // Optimistic local copy so the grid responds instantly on a slow connection
  // at a court. Cleared on success; kept (with the failed alert below) on
  // failure, so a network blip never silently discards what was tapped.
  const [draft, setDraft] = useState<Grid | null>(null)
  const slots = draft ?? query.data ?? []

  function onChange(next: Grid) {
    setDraft(next)
    save.mutate(next, { onSuccess: () => setDraft(null) })
  }

  return (
    <Card>
      <h2 className="font-display text-lg">When you can usually play</h2>
      <p className="mt-1 text-xs text-night-700/70">Tap a slot to toggle it. Saves as you go.</p>
      <div className="mt-3">
        {query.isPending ? (
          <Spinner label="Loading your availability" />
        ) : (
          <AvailabilityGrid slots={slots} onChange={onChange} disabled={save.isPending} />
        )}
      </div>
      {/* aria-live="polite" so a screen reader hears "Saving…" / "Saved"
          without stealing focus from whatever the player is doing next. */}
      <p className="mt-2 min-h-4 text-xs" aria-live="polite">
        {save.isPending ? 'Saving…' : save.isSuccess && !draft ? 'Saved' : ''}
      </p>
      {save.isError ? (
        <p role="alert" className="text-xs font-medium text-clay-600">
          Could not save your availability. It will still be here when you try again.
        </p>
      ) : null}
    </Card>
  )
}

export function Component() {
  const me = useOutletContext<MeResponse>()
  const navigate = useNavigate()
  const profile = usePlayer(me.id)
  const logout = useLogout()

  if (profile.isPending) {
    return (
      <AppShell title="You">
        <Spinner label="Loading your profile" />
      </AppShell>
    )
  }
  if (profile.isError || !profile.data) {
    return (
      <AppShell title="You">
        <ErrorState message="Could not load your profile." onRetry={() => void profile.refetch()} />
      </AppShell>
    )
  }

  const p = profile.data

  return (
    <AppShell title="You">
      <div className="flex flex-col gap-4">
        <Card>
          <PhotoPicker name={p.displayName} currentUrl={p.photoUrl} />
        </Card>

        <AvailabilityCard memberId={me.id} />

        <Card>
          <h2 className="font-display text-lg">Your details</h2>
          <div className="mt-3">
            <ProfileForm
              mode="update"
              submitLabel="Save changes"
              onSaved={() => void profile.refetch()}
              defaultValues={{
                displayName: p.displayName,
                // PlayerDetail's nullable fields (string | null, always present)
                // line up directly with ProfileBody's optional-and-nullable
                // fields (string | null, when present) -- no `?? undefined`
                // needed, and with `exactOptionalPropertyTypes` on, adding one
                // would actually break the assignment instead of widening it.
                nickname: p.nickname,
                phone: p.phone,
                dominantHand: p.dominantHand,
                backhand: p.backhand,
                preferredFormat: p.preferredFormat,
                ratingSystem: p.ratingSystem,
                ratingValue: p.ratingValue,
                racquet: p.racquet,
                bio: p.bio,
              }}
            />
          </div>
        </Card>

        <Button
          variant="danger"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })}
        >
          Sign out
        </Button>
      </div>
    </AppShell>
  )
}
