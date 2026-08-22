import type { FastifyInstance } from 'fastify'
import { sql, type Kysely } from 'kysely'
import {
  AvailabilityGrid,
  MemberIdParams,
  ReplaceAvailabilityBody,
  WhoIsFreeQuery,
  WhoIsFreeResponse,
} from '@tennis/contracts'
import type { Slot } from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { Database } from '../db/schema.js'
import { withTransaction } from '../db/transaction.js'
import { notFound } from '../plugins/error-handler.js'
import { requireAuth } from '../plugins/session.js'

/** Deletes and re-inserts the member's whole availability set on `trx`, atomically — see `withTransaction`. */
async function replaceAvailability(trx: Kysely<Database>, memberId: number, slots: Slot[]): Promise<void> {
  // Deduplicate: the grid is a set, and a double-tapped cell must not 23505.
  const unique = new Map(slots.map((s) => [`${s.weekday}:${s.block}`, s]))

  await trx.deleteFrom('availability').where('member_id', '=', memberId).execute()
  if (unique.size > 0) {
    await trx
      .insertInto('availability')
      .values([...unique.values()].map((s) => ({ member_id: memberId, weekday: s.weekday, block: s.block })))
      .execute()
  }
}

export async function availabilityRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  async function load(memberId: number) {
    return deps.db
      .selectFrom('availability')
      .select(['weekday', 'block'])
      .where('member_id', '=', memberId)
      .orderBy('weekday')
      .orderBy('block')
      .execute()
  }

  /** Mirrors `profiles.ts`'s `loadDetail`: removed (or nonexistent) members are gone from every surface. */
  async function assertVisibleMember(memberId: number): Promise<void> {
    const member = await deps.db
      .selectFrom('members')
      .select('id')
      .where('id', '=', memberId)
      .where('status', '<>', 'removed')
      .executeTakeFirst()
    if (!member) throw notFound('No such player')
  }

  app.get(
    '/api/players/:id/availability',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: AvailabilityGrid } } },
    async (req) => {
      const memberId = (req.params as MemberIdParams).id
      await assertVisibleMember(memberId)
      return load(memberId)
    },
  )

  app.put(
    '/api/players/me/availability',
    {
      preHandler: requireAuth,
      schema: { body: ReplaceAvailabilityBody, response: { 200: AvailabilityGrid } },
    },
    async (req) => {
      const { slots } = req.body as ReplaceAvailabilityBody
      const memberId = req.member.id

      // Whole-set replacement in one transaction: a dropped connection can never
      // leave availability half-saved. See `withTransaction`.
      await withTransaction(deps.db, (trx) => replaceAvailability(trx, memberId, slots))

      return load(memberId)
    },
  )

  app.get(
    '/api/availability',
    { preHandler: requireAuth, schema: { querystring: WhoIsFreeQuery, response: { 200: WhoIsFreeResponse } } },
    async (req) => {
      const { weekday, block } = req.query as WhoIsFreeQuery
      const rows = await deps.db
        .selectFrom('availability as a')
        .innerJoin('members as m', 'm.id', 'a.member_id')
        // `leftJoin`, not `innerJoin`: a profile row is only created lazily
        // on the first `PUT /api/players/me`, and nothing requires profile
        // setup before a member can set their availability. An `innerJoin`
        // here would silently drop an active member from every planning
        // query just because they set their grid before touching their
        // profile page. `p.display_name ?? m.email` below covers the gap.
        .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
        .select(['m.id', 'm.email', 'p.display_name', 'p.photo_key'])
        .where('a.weekday', '=', weekday)
        .where('a.block', '=', block)
        .where('m.status', '=', 'active')
        .orderBy(sql`coalesce(p.display_name, m.email)`)
        .execute()

      return rows.map((r) => ({
        id: r.id,
        displayName: r.display_name ?? r.email,
        photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
      }))
    },
  )
}
