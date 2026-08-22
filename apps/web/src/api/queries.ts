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

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.clear(),
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
  return useMutation({
    mutationFn: (slots: AvailabilityGrid) =>
      apiFetch<AvailabilityGrid>('/api/players/me/availability', {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      }),
    onSuccess: (grid) => qc.setQueryData(keys.availability(memberId), grid),
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
