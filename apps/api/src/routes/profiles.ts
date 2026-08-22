import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Insertable, Updateable } from 'kysely'
import {
  ConfirmPhotoBody,
  MemberIdParams,
  PatchProfileBody,
  PHOTO_MAX_BYTES,
  PlayerDetail,
  PresignBody,
  PresignResponse,
  ProfileBody,
} from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { PlayerProfilesTable } from '../db/schema.js'
import { badRequest, forbidden, notFound } from '../plugins/error-handler.js'
import { requireAuth } from '../plugins/session.js'
import { normalisePhoto } from '../storage/images.js'

type Row = {
  id: number
  role: 'admin' | 'player'
  display_name: string
  nickname: string | null
  phone: string | null
  photo_key: string | null
  dominant_hand: 'left' | 'right' | null
  backhand: 'one' | 'two' | null
  preferred_format: 'singles' | 'doubles' | 'both' | null
  rating_system: 'utr' | 'ntrp' | 'club' | 'none'
  rating_value: string | null
  racquet: string | null
  bio: string | null
  matches_played: number
  wins: number
  losses: number
}

function toDetail(deps: Deps, r: Row): PlayerDetail {
  return {
    id: r.id,
    role: r.role,
    displayName: r.display_name,
    nickname: r.nickname,
    phone: r.phone,
    photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
    dominantHand: r.dominant_hand,
    backhand: r.backhand,
    preferredFormat: r.preferred_format,
    ratingSystem: r.rating_system,
    ratingValue: r.rating_value,
    racquet: r.racquet,
    bio: r.bio,
    record: { matchesPlayed: r.matches_played, wins: r.wins, losses: r.losses },
  }
}

async function loadDetail(deps: Deps, memberId: number): Promise<PlayerDetail> {
  const row = await deps.db
    .selectFrom('members as m')
    .innerJoin('player_profiles as p', 'p.member_id', 'm.id')
    .innerJoin('player_records as r', 'r.member_id', 'm.id')
    .select([
      'm.id',
      'm.role',
      'p.display_name',
      'p.nickname',
      'p.phone',
      'p.photo_key',
      'p.dominant_hand',
      'p.backhand',
      'p.preferred_format',
      'p.rating_system',
      'p.rating_value',
      'p.racquet',
      'p.bio',
      'r.matches_played',
      'r.wins',
      'r.losses',
    ])
    .where('m.id', '=', memberId)
    .where('m.status', '<>', 'removed')
    .executeTakeFirst()
  if (!row) throw notFound('No such player')
  return toDetail(deps, row as Row)
}

/** The DB enforces this too (rating_value_requires_system); checking here yields a 400 with a useful message. */
function assertRatingCoherent(ratingSystem: string, ratingValue: unknown): void {
  if (ratingSystem === 'none' && ratingValue != null) {
    throw badRequest('A rating value requires a rating system', {
      fields: [{ path: '/ratingValue', message: 'Choose a rating system, or leave the value blank' }],
    })
  }
}

/**
 * Maps the camelCase wire body onto the table's snake_case columns, one field
 * at a time. Each field's presence is tested with `key in body` (never a
 * truthiness or `!== undefined` check): that is what lets an explicit `null`
 * in a PATCH clear a column while an absent key leaves it untouched. Typed
 * directly against `Updateable<PlayerProfilesTable>` (all columns optional)
 * so every assignment is checked against the real column type — no `as
 * never` anywhere here, unlike the brief's version, which cast both the
 * insert `.values()` and the update `.doUpdateSet()`/`.set()` calls instead.
 *
 * PATCH-only. PUT must NOT use this: gating on `key in body` is exactly
 * what makes a merge a merge, but `PUT` is supposed to create-or-REPLACE —
 * see `toReplaceColumns` below for that path.
 */
function toColumns(body: Partial<ProfileBody>): Partial<Updateable<PlayerProfilesTable>> {
  const out: Partial<Updateable<PlayerProfilesTable>> = {}
  if ('displayName' in body) out.display_name = body.displayName
  if ('nickname' in body) out.nickname = body.nickname
  if ('phone' in body) out.phone = body.phone
  if ('dominantHand' in body) out.dominant_hand = body.dominantHand
  if ('backhand' in body) out.backhand = body.backhand
  if ('preferredFormat' in body) out.preferred_format = body.preferredFormat
  if ('ratingSystem' in body) out.rating_system = body.ratingSystem
  if ('ratingValue' in body) out.rating_value = body.ratingValue
  if ('racquet' in body) out.racquet = body.racquet
  if ('bio' in body) out.bio = body.bio
  return out
}

/**
 * Builds the full optional-column set for a `PUT` create-or-REPLACE,
 * unconditionally — every optional field defaults to `null` (or, for
 * `rating_system`, the column's own DB default `'none'`) whether it was
 * sent as an explicit `null` or simply omitted from the body. `member_id`
 * and `display_name` are deliberately NOT included here; the route supplies
 * both explicitly, since `display_name` needs its trimmed value and
 * `member_id` comes from the session, not the body.
 *
 * This is what makes `PUT` actually replace rather than merge: `toColumns`
 * above is gated on `key in body`, so a second `PUT` that simply omits a
 * previously-set optional field would leave the OLD value in place via
 * Postgres's `ON CONFLICT ... DO UPDATE` only touching the columns listed —
 * silently turning "replace" into "merge" for exactly the fields a caller
 * left out. Since every field here is always present in the returned
 * object, that can't happen.
 */
// WARNING: never add `photo_key` to this object literal. It is safe today
// only because `ProfileBody` happens not to carry a photo field, so a PUT
// leaves the column untouched via the DB's ON CONFLICT column list — if
// `ProfileBody` ever grows a photo field, a naive addition here would make
// every profile PUT silently delete the member's uploaded photo.
function toReplaceColumns(body: ProfileBody): Omit<Insertable<PlayerProfilesTable>, 'member_id' | 'display_name'> {
  return {
    nickname: body.nickname ?? null,
    phone: body.phone ?? null,
    dominant_hand: body.dominantHand ?? null,
    backhand: body.backhand ?? null,
    preferred_format: body.preferredFormat ?? null,
    rating_system: body.ratingSystem ?? 'none',
    rating_value: body.ratingValue ?? null,
    racquet: body.racquet ?? null,
    bio: body.bio ?? null,
  }
}

/** Trims and validates a display name, shared by the PUT (always present) and PATCH (only if sent) paths. */
function requireNonBlankName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw badRequest('A display name is required', {
      fields: [{ path: '/displayName', message: 'Enter the name your teammates know you by' }],
    })
  }
  return trimmed
}

export async function profileRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(
    '/api/players/:id',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: PlayerDetail } } },
    async (req) => loadDetail(deps, (req.params as MemberIdParams).id),
  )

  app.put(
    '/api/players/me',
    { preHandler: requireAuth, schema: { body: ProfileBody, response: { 200: PlayerDetail } } },
    async (req) => {
      const body = req.body as ProfileBody
      const displayName = requireNonBlankName(body.displayName)
      // Default to 'none' to mirror the column's own default: an omitted
      // `ratingSystem` on a fresh insert lands as 'none' in the DB, so the
      // coherence check must see it that way too, or a `ratingValue` sent
      // without a `ratingSystem` would sail past this check only to hit the
      // DB's `rating_value_requires_system` constraint as an ugly 500.
      assertRatingCoherent(body.ratingSystem ?? 'none', body.ratingValue)

      const columns = toReplaceColumns(body)
      const values: Insertable<PlayerProfilesTable> = {
        ...columns,
        member_id: req.member.id,
        display_name: displayName,
      }
      await deps.db
        .insertInto('player_profiles')
        .values(values)
        .onConflict((oc) =>
          oc.column('member_id').doUpdateSet({ ...columns, display_name: displayName, updated_at: deps.now() }),
        )
        .execute()

      return loadDetail(deps, req.member.id)
    },
  )

  app.patch(
    '/api/players/me',
    { preHandler: requireAuth, schema: { body: PatchProfileBody, response: { 200: PlayerDetail } } },
    async (req) => {
      const body = req.body as PatchProfileBody
      const existing = await deps.db
        .selectFrom('player_profiles')
        .select(['rating_system', 'rating_value'])
        .where('member_id', '=', req.member.id)
        .executeTakeFirst()
      if (!existing) throw notFound('Set up your profile first')

      // Both halves of the coherence check must reflect what the row will
      // actually look like AFTER this patch, not just the incoming body in
      // isolation: a patch that only touches `ratingSystem` (e.g. flipping
      // it to 'none' from a UI dropdown) leaves `rating_value` untouched in
      // the database — if the check only looked at `body.ratingValue`
      // (`undefined` here), it would wrongly conclude there's no
      // coherence problem, and the `UPDATE` below would then trip the DB's
      // `rating_value_requires_system` constraint as an unhandled 500.
      const effectiveSystem = body.ratingSystem ?? existing.rating_system
      const effectiveValue = 'ratingValue' in body ? body.ratingValue : existing.rating_value
      assertRatingCoherent(effectiveSystem, effectiveValue)

      const values = toColumns(body)
      if ('displayName' in body) values.display_name = requireNonBlankName(body.displayName)

      if (Object.keys(values).length > 0) {
        await deps.db
          .updateTable('player_profiles')
          .set({ ...values, updated_at: deps.now() })
          .where('member_id', '=', req.member.id)
          .execute()
      }
      return loadDetail(deps, req.member.id)
    },
  )

  app.post(
    '/api/players/me/photo',
    { preHandler: requireAuth, schema: { body: PresignBody, response: { 200: PresignResponse } } },
    async (req) => {
      const { contentType, sizeBytes } = req.body as PresignBody
      const key = `photos/${req.member.id}/upload-${randomUUID()}`
      const uploadUrl = await deps.storage.presignPut(key, contentType, sizeBytes)
      return { uploadUrl, key, maxBytes: PHOTO_MAX_BYTES }
    },
  )

  app.put(
    '/api/players/me/photo/confirm',
    { preHandler: requireAuth, schema: { body: ConfirmPhotoBody, response: { 200: PlayerDetail } } },
    async (req) => {
      const { key } = req.body as ConfirmPhotoBody

      // The key is client-supplied, so prove it is one we issued to THIS member.
      if (!key.startsWith(`photos/${req.member.id}/upload-`)) {
        throw forbidden('That upload does not belong to you')
      }

      // Both failures below are ordinary client-input situations (a stale or
      // already-consumed key, a non-image file), not server faults -- they
      // must not fall through to the catch-all 500 handler.
      let raw: Buffer
      try {
        raw = await deps.storage.get(key)
      } catch {
        throw notFound('That upload could not be found. Try choosing the photo again.')
      }

      let normalised: Buffer
      try {
        normalised = await normalisePhoto(raw)
      } catch {
        throw badRequest('That file is not an image we can read.')
      }

      const finalKey = `photos/${req.member.id}/${randomUUID()}.webp`
      await deps.storage.put(finalKey, normalised, 'image/webp')
      await deps.storage.delete(key)

      const previous = await deps.db
        .selectFrom('player_profiles')
        .select('photo_key')
        .where('member_id', '=', req.member.id)
        .executeTakeFirst()
      if (!previous) throw notFound('Set up your profile first')

      await deps.db
        .updateTable('player_profiles')
        .set({ photo_key: finalKey, updated_at: deps.now() })
        .where('member_id', '=', req.member.id)
        .execute()

      // Best effort: a stale photo left behind is untidy, not broken.
      if (previous.photo_key) {
        await deps.storage.delete(previous.photo_key).catch((err) => {
          req.log.warn({ err, memberId: req.member.id }, 'failed to delete replaced photo')
        })
      }

      return loadDetail(deps, req.member.id)
    },
  )
}
