import { Type, type Static } from '@sinclair/typebox'
import { Id, IsoDate } from './common.js'

export const MatchFormat = Type.Union([Type.Literal('singles'), Type.Literal('doubles')])
export type MatchFormat = Static<typeof MatchFormat>

export const SideNumber = Type.Union([Type.Literal(1), Type.Literal(2)])

/** Exactly one of memberId or guestName, matching the DB check constraint. */
export const MatchPlayerInput = Type.Union([
  Type.Object({ memberId: Id }, { additionalProperties: false }),
  Type.Object({ guestName: Type.String({ minLength: 1, maxLength: 80 }) }, { additionalProperties: false }),
])
export type MatchPlayerInput = Static<typeof MatchPlayerInput>

export const MatchSetInput = Type.Object(
  {
    side1Games: Type.Integer({ minimum: 0, maximum: 99 }),
    side2Games: Type.Integer({ minimum: 0, maximum: 99 }),
  },
  { additionalProperties: false },
)
export type MatchSetInput = Static<typeof MatchSetInput>

export const CreateMatchBody = Type.Object(
  {
    playedOn: IsoDate,
    format: MatchFormat,
    venue: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
    notes: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    winnerSide: SideNumber,
    side1: Type.Array(MatchPlayerInput, { minItems: 1, maxItems: 2 }),
    side2: Type.Array(MatchPlayerInput, { minItems: 1, maxItems: 2 }),
    sets: Type.Array(MatchSetInput, { minItems: 1, maxItems: 5 }),
  },
  { additionalProperties: false },
)
export type CreateMatchBody = Static<typeof CreateMatchBody>

export const PatchMatchBody = Type.Partial(CreateMatchBody)
export type PatchMatchBody = Static<typeof PatchMatchBody>

export const MatchPlayerOut = Type.Object({
  memberId: Type.Union([Id, Type.Null()]),
  guestName: Type.Union([Type.String(), Type.Null()]),
  displayName: Type.String(),
})
export type MatchPlayerOut = Static<typeof MatchPlayerOut>

export const MatchDetail = Type.Object({
  id: Id,
  playedOn: IsoDate,
  format: MatchFormat,
  venue: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  winnerSide: SideNumber,
  recordedBy: Id,
  side1: Type.Array(MatchPlayerOut),
  side2: Type.Array(MatchPlayerOut),
  sets: Type.Array(MatchSetInput),
})
export type MatchDetail = Static<typeof MatchDetail>

export const MatchList = Type.Object({
  items: Type.Array(MatchDetail),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})
export type MatchList = Static<typeof MatchList>

export const MatchListQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}_\\d+$' })),
})
export type MatchListQuery = Static<typeof MatchListQuery>

export const PlayerRecord = Type.Object({
  memberId: Id,
  matchesPlayed: Type.Integer(),
  wins: Type.Integer(),
  losses: Type.Integer(),
})
export type PlayerRecord = Static<typeof PlayerRecord>
