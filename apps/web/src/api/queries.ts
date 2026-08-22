import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PHOTO_CONTENT_TYPES } from '@tennis/contracts'
import type {
  AvailabilityGrid,
  InviteBody,
  MatchList,
  MeResponse,
  PatchProfileBody,
  PlayerDetail,
  PresignBody,
  PresignResponse,
  RosterEntry,
  CreateMatchBody,
  ProfileBody,
} from '@tennis/contracts'
import { apiFetch } from './client.js'

export const keys = {
  me: ['me'] as const,
  roster: ['roster'] as const,
  player: (id: number) => ['player', id] as const,
  availability: (id: number) => ['availability', id] as const,
  matches: ['matches'] as const,
}

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: () => apiFetch<MeResponse>('/api/auth/me'),
    // A 401 is the answer, not a failure to retry.
    retry: false,
    staleTime: 60_000,
  })

export const useRoster = () =>
  useQuery({ queryKey: keys.roster, queryFn: () => apiFetch<RosterEntry[]>('/api/members') })

export const usePlayer = (id: number) =>
  useQuery({ queryKey: keys.player(id), queryFn: () => apiFetch<PlayerDetail>(`/api/players/${id}`) })

export const useAvailability = (id: number) =>
  useQuery({
    queryKey: keys.availability(id),
    queryFn: () => apiFetch<AvailabilityGrid>(`/api/players/${id}/availability`),
  })

export const useMatches = () =>
  useQuery({ queryKey: keys.matches, queryFn: () => apiFetch<MatchList>('/api/matches?limit=25') })

export const useRequestLink = () =>
  useMutation({
    mutationFn: (body: { email: string }) =>
      apiFetch('/api/auth/request-link', { method: 'POST', body: JSON.stringify(body) }),
  })

// Deliberately does NOT clear the query cache itself. TanStack Query always
// runs a mutation's own (hook-level) `onSuccess` before any `onSuccess`
// passed to a specific `.mutate()` call -- there is no way, from inside a
// single `mutate()` call, for a caller-supplied callback to run before a
// clear registered here. `Me.tsx`'s sign-out handler needs to `navigate()`
// away BEFORE the cache clears (so components already about to unmount
// aren't still-subscribed observers when their data disappears), so
// clearing is left to the caller, ordered after the navigation.
export function useLogout() {
  return useMutation({
    mutationFn: () => apiFetch('/api/auth/logout', { method: 'POST' }),
  })
}

export function useSaveProfile(mode: 'create' | 'update') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProfileBody | PatchProfileBody) =>
      apiFetch<PlayerDetail>('/api/players/me', {
        method: mode === 'create' ? 'PUT' : 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (p) => {
      qc.setQueryData(keys.player(p.id), p)
      // Eager, synchronous patch -- not just the invalidation below -- because
      // Setup's `onSaved` navigates to `/` immediately after this resolves,
      // before an invalidated refetch has a chance to complete. Without this,
      // SessionGate re-renders against the still-stale cached
      // `hasProfile: false`, sees path `/` with no profile, and bounces back
      // to `/setup` (remounting a blank ProfileForm) even though the save
      // just succeeded. Verified directly: without this line, submitting the
      // create-profile form saves correctly but strands the user on a blank
      // `/setup` instead of reaching Roster.
      qc.setQueryData(keys.me, (old: MeResponse | undefined) => (old ? { ...old, hasProfile: true } : old))
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: keys.roster })
    },
  })
}

export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<PlayerDetail> => {
      // `File#type` is DOM's plain `string`, not PresignBody's content-type union,
      // so this can't satisfy the contract type as-is. Checking against the
      // contract's own PHOTO_CONTENT_TYPES first turns an unsupported file into a
      // friendly client-side error instead of a round trip that fails server-side,
      // and only after that check do we know the narrow assertion below is honest.
      const contentType = file.type
      if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        throw new Error('Please choose a JPEG, PNG, or WEBP image.')
      }
      const presign = await apiFetch<PresignResponse>('/api/players/me/photo', {
        method: 'POST',
        body: JSON.stringify({
          contentType: contentType as PresignBody['contentType'],
          sizeBytes: file.size,
        } satisfies PresignBody),
      })
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      })
      if (!put.ok) throw new Error('Upload failed. Check your connection and try again.')
      return apiFetch<PlayerDetail>('/api/players/me/photo/confirm', {
        method: 'PUT',
        body: JSON.stringify({ key: presign.key }),
      })
    },
    onSuccess: (p) => {
      qc.setQueryData(keys.player(p.id), p)
      void qc.invalidateQueries({ queryKey: keys.roster })
    },
  })
}

export function useSaveAvailability(memberId: number) {
  const qc = useQueryClient()
  // Tracks the most recently DISPATCHED call, not the most recently
  // SETTLED one. The grid saves on every toggle with no debounce, so two
  // calls routinely overlap on a slow connection -- if the user toggles A
  // then quickly toggles B, there is no guarantee A's response arrives
  // first. Without this guard, an unconditional `onSuccess` cache write
  // means whichever call happens to *resolve* last wins the cache, so an
  // out-of-order response for A (dispatched first, but resolving after B)
  // would silently overwrite B's already-applied result with a grid that
  // is missing the user's second toggle -- exactly the "slow connection"
  // case the optimistic draft exists to protect against, not a rare edge
  // case. A ref (not state) is correct here: this is bookkeeping for
  // deciding whether to write the query cache, not something that should
  // ever trigger a re-render on its own.
  const latestId = useRef(0)
  return useMutation({
    mutationFn: (slots: AvailabilityGrid) =>
      apiFetch<AvailabilityGrid>('/api/players/me/availability', {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      }),
    // Runs synchronously at dispatch time (before the request is even sent),
    // so two calls fired back-to-back get their ids assigned in dispatch
    // order regardless of how their responses later resolve.
    onMutate: () => ({ id: ++latestId.current }),
    onSuccess: (grid, _slots, context) => {
      // Only the call that is STILL the latest-dispatched one by the time it
      // settles may write the cache. A call superseded by a newer dispatch
      // before it resolved lost the race on purpose -- its result is stale
      // by definition, even if it happens to arrive first.
      if (context.id === latestId.current) {
        qc.setQueryData(keys.availability(memberId), grid)
      }
    },
  })
}

export function useRecordMatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateMatchBody) =>
      apiFetch('/api/matches', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.matches })
      void qc.invalidateQueries({ queryKey: ['player'] })
    },
  })
}

function useRosterMutation<T>(fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.roster }),
  })
}

export const useInviteMember = () =>
  useRosterMutation((body: InviteBody) =>
    apiFetch('/api/members', { method: 'POST', body: JSON.stringify(body) }),
  )

export const useSetRole = () =>
  useRosterMutation(({ id, role }: { id: number; role: 'admin' | 'player' }) =>
    apiFetch(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  )

export const useRemoveMember = () =>
  useRosterMutation((id: number) => apiFetch(`/api/members/${id}`, { method: 'DELETE' }))

export const useResendInvite = () =>
  useRosterMutation((id: number) => apiFetch(`/api/members/${id}/resend-invite`, { method: 'POST' }))
