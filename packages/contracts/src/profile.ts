import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Id } from './common.js'

// `Type.Null()` listed FIRST, not `t` first, and this must hold for EVERY
// nullable field on the wire -- not just the string-typed ones -- which is
// why this is generic over `TSchema` rather than constrained to string
// schemas: a hand-rolled `Type.Union([EnumSchema, Type.Null()])` for e.g.
// `dominantHand` would carry the exact same bug as a hand-rolled string
// union, and nothing would stop a future field from being added with the
// order flipped by "tidying."
//
// Fastify's default AJV compiler options (`@fastify/ajv-compiler`'s
// `default-ajv-options.js`) set `coerceTypes: 'array'`, which is a superset
// of `coerceTypes: true` and therefore still applies AJV's ordinary scalar
// coercion rules (only ADDING array<->scalar coercion on top). For an
// `anyOf` union, AJV evaluates branches in order and stops at the first one
// that validates; with coercion on, a `null` value tried against a
// `{ type: 'string' }` (or `{ enum: [...] }`, which AJV also type-checks by
// the underlying JSON type) branch doesn't just fail -- AJV coerces it in
// place (to `''` for a string branch) to make that branch pass, and never
// reaches the `{ type: 'null' }` branch at all. Confirmed by hand, with a
// standalone AJV script reproducing this exact `coerceTypes: 'array'`
// config against `anyOf: [{type:'string'}, {type:'null'}]`: an input of
// `null` validates `true` and the data is silently rewritten to `''`.
// Reordering to `anyOf: [{type:'null'}, {type:'string'}]` against the same
// input validates `true` and leaves the data untouched as `null`. Without
// this ordering, `PATCH /api/players/me` would be unable to ever clear a
// field with an explicit `null` -- the whole point of a PATCH-clears-fields
// contract. Listing `Type.Null()` first means AJV's very first branch check
// (`value === null`) already succeeds for an actual `null`, so it
// short-circuits there and the later branch (and its coercion) is never
// attempted.
const Nullable = <T extends TSchema>(t: T) => Type.Union([Type.Null(), t])

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
    dominantHand: Type.Optional(Nullable(DominantHand)),
    backhand: Type.Optional(Nullable(Backhand)),
    preferredFormat: Type.Optional(Nullable(PreferredFormat)),
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
  dominantHand: Nullable(DominantHand),
  backhand: Nullable(Backhand),
  preferredFormat: Nullable(PreferredFormat),
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
