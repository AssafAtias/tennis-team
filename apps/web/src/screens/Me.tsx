import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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

const slotKey = (weekday: number, block: string) => `${weekday}:${block}`

/** Order-independent equality: `AvailabilityGrid` always rebuilds the whole array, so two grids representing the same selection can still differ in element order. */
function sameSlots(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false
  const bKeys = new Set(b.map((s) => slotKey(s.weekday, s.block)))
  return a.every((s) => bKeys.has(slotKey(s.weekday, s.block)))
}

function AvailabilityCard({ memberId }: { memberId: number }) {
  const query = useAvailability(memberId)
  const save = useSaveAvailability(memberId)
  // Optimistic local copy so the grid responds instantly on a slow connection
  // at a court. Cleared only once a save both succeeds AND still matches
  // what's currently on screen -- see `settle` below.
  const [draft, setDraft] = useState<Grid | null>(null)
  const slots = draft ?? query.data ?? []

  // Single-flight with a trailing resend, rather than letting saves overlap
  // and reconciling afterward. The grid is an idempotent whole-set
  // replacement, so "send whatever the draft currently is once the wire is
  // free" is exactly right for this domain, and it makes the overlap bugs
  // (an older response landing after a newer one, or a stale success
  // silently clearing a newer failed toggle) structurally impossible rather
  // than something to detect and paper over after the fact.
  //
  // `draftRef` mirrors `draft` state synchronously (updated in the same
  // call that updates state) so `settle`, which can run an arbitrary tick
  // after it was scheduled, always reads the true latest draft rather than
  // whatever its own closure captured at dispatch time.
  const draftRef = useRef<Grid | null>(null)
  const inFlightRef = useRef<Grid | null>(null)

  function setDraftEverywhere(next: Grid | null) {
    draftRef.current = next
    setDraft(next)
  }

  function dispatch(grid: Grid) {
    inFlightRef.current = grid
    save.mutate(grid, {
      onSuccess: () => settle(grid, true),
      onError: () => settle(grid, false),
    })
  }

  function settle(sent: Grid, ok: boolean) {
    inFlightRef.current = null
    const current = draftRef.current
    const caughtUp = current !== null && sameSlots(current, sent)
    if (ok) {
      if (caughtUp) {
        // Nothing has changed locally since exactly this grid was sent --
        // the server now matches what's on screen, so there is nothing left
        // to show as unsaved.
        setDraftEverywhere(null)
      } else if (current) {
        // The draft moved on while this save was in flight. Resend the
        // current state now that the wire is free, rather than leaving an
        // unsaved toggle sitting there until the next unrelated interaction.
        dispatch(current)
      }
    } else if (!caughtUp && current) {
      // This failed attempt is already stale -- a newer toggle happened
      // while it was in flight. Try the newer state instead of leaving a
      // failed, superseded attempt as the last word. If the draft is
      // unchanged (`caughtUp`), we deliberately do NOT resend: the failure
      // below stays visible and the draft stays exactly as the user left
      // it, until they act again.
      dispatch(current)
    }
  }

  function onChange(next: Grid) {
    setDraftEverywhere(next)
    if (!inFlightRef.current) {
      dispatch(next)
    }
    // else: a save is already in flight. Its `settle` call will pick up
    // this newer draft (via `draftRef`) once it completes -- no need to
    // dispatch anything here.
  }

  return (
    <Card>
      <h2 className="font-display text-lg">When you can usually play</h2>
      <p className="mt-1 text-xs text-night-700/70">Tap a slot to toggle it. Saves as you go.</p>
      <div className="mt-3">
        {query.isPending ? (
          <Spinner label="Loading your availability" />
        ) : (
          // No `disabled` here: with single-flight, a toggle made while a
          // save is in flight is exactly what should still register --
          // it updates the draft and rides along on the trailing resend --
          // rather than being blocked at the UI.
          <AvailabilityGrid slots={slots} onChange={onChange} />
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
  const qc = useQueryClient()
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
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => {
                // navigate() first, THEN clear the cache: clearing first left
                // this screen's still-mounted queries (usePlayer/useAvailability)
                // as active observers for one more tick, so they'd refetch
                // against an already-invalidated session and log a stray 401.
                navigate('/login', { replace: true })
                qc.clear()
              },
            })
          }
        >
          Sign out
        </Button>
      </div>
    </AppShell>
  )
}
