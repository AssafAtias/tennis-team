import { Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

// `Type.Null()` listed FIRST, not `t` first: Fastify's default AJV compiler
// options (`@fastify/ajv-compiler`'s `default-ajv-options.js`) set
// `coerceTypes: 'array'`, which is a superset of `coerceTypes: true` and
// therefore still applies AJV's ordinary scalar coercion rules (only ADDING
// array<->scalar coercion on top). For an `anyOf` union, AJV evaluates
// branches in order and stops at the first one that validates; with
// coercion on, a `null` value tried against a `{ type: 'string' }` branch
// doesn't just fail — AJV coerces it in place to `''` to make that branch
// pass, and never reaches the `{ type: 'null' }` branch at all. Confirmed by
// hand: `Type.Union([Type.String(), Type.Null()])` silently rewrites an
// explicit PATCH `null` into `''` before the route handler ever sees it,
// which would have made `PATCH /api/players/me` unable to ever clear a
// field. Listing `Type.Null()` first means AJV's very first branch check
// (`typeof value === 'object' && value === null`) already succeeds for an
// actual `null`, so it short-circuits there and the string branch (and its
// coercion) is never attempted.
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([Type.Null(), t])

export const DominantHand = Type.Union([Type.Literal('left'), Type.Literal('right')])
export const Backhand = Type.Union([Type.Literal('one'), Type.Literal('two')])
export const PreferredFormat = Type.Union([
  Type.Literal('singles'),
  Type.Literal('doubles'),
  Type.Literal('both'),
])
export const RatingSystem = Type.Union([
  Type.Literal('utr'),
  Type.Literal('ntrp'),
  Type.Literal('club'),
  Type.Literal('none'),
])

export const ProfileBody = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 60 }),
    nickname: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
    phone: Type.Optional(Nullable(Type.String({ maxLength: 32 }))),
    // Null listed first here too — see the comment on `Nullable` above.
    dominantHand: Type.Optional(Type.Union([Type.Null(), DominantHand])),
    backhand: Type.Optional(Type.Union([Type.Null(), Backhand])),
    preferredFormat: Type.Optional(Type.Union([Type.Null(), PreferredFormat])),
    ratingSystem: Type.Optional(RatingSystem),
    ratingValue: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
    racquet: Type.Optional(Nullable(Type.String({ maxLength: 80 }))),
    bio: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  },
  { additionalProperties: false },
)
export type ProfileBody = Static<typeof ProfileBody>

export const PatchProfileBody = Type.Partial(ProfileBody)
export type PatchProfileBody = Static<typeof PatchProfileBody>

export const PlayerDetail = Type.Object({
  id: Id,
  role: Type.Union([Type.Literal('admin'), Type.Literal('player')]),
  displayName: Type.String(),
  nickname: Nullable(Type.String()),
  phone: Nullable(Type.String()),
  photoUrl: Nullable(Type.String()),
  dominantHand: Type.Union([DominantHand, Type.Null()]),
  backhand: Type.Union([Backhand, Type.Null()]),
  preferredFormat: Type.Union([PreferredFormat, Type.Null()]),
  ratingSystem: RatingSystem,
  ratingValue: Nullable(Type.String()),
  racquet: Nullable(Type.String()),
  bio: Nullable(Type.String()),
  record: Type.Object({
    matchesPlayed: Type.Integer(),
    wins: Type.Integer(),
    losses: Type.Integer(),
  }),
})
export type PlayerDetail = Static<typeof PlayerDetail>
