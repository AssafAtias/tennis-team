import { Type, type Static } from '@sinclair/typebox'
import { Email } from './auth.js'
import { Id } from './common.js'

export const MemberRole = Type.Union([Type.Literal('admin'), Type.Literal('player')])
export const MemberStatus = Type.Union([
  Type.Literal('invited'),
  Type.Literal('active'),
  Type.Literal('removed'),
])

export const RosterEntry = Type.Object({
  id: Id,
  email: Email,
  role: MemberRole,
  status: MemberStatus,
  displayName: Type.Union([Type.String(), Type.Null()]),
  nickname: Type.Union([Type.String(), Type.Null()]),
  photoUrl: Type.Union([Type.String(), Type.Null()]),
  preferredFormat: Type.Union([Type.String(), Type.Null()]),
  ratingSystem: Type.String(),
  ratingValue: Type.Union([Type.String(), Type.Null()]),
})
export type RosterEntry = Static<typeof RosterEntry>

export const Roster = Type.Array(RosterEntry)

export const InviteBody = Type.Object({ email: Email }, { additionalProperties: false })
export type InviteBody = Static<typeof InviteBody>

export const PatchMemberBody = Type.Object({ role: MemberRole }, { additionalProperties: false })
export type PatchMemberBody = Static<typeof PatchMemberBody>

export const MemberIdParams = Type.Object({ id: Id })
export type MemberIdParams = Static<typeof MemberIdParams>
