import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
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
import { requireAuth } from '../plugins/session.js'

/**
 * Deletes and re-inserts the member's whole availability set on `trx`.
 *
 * Takes the connection to run on rather than always opening its own
 * transaction, for the same reason `activateAndCreateSession` in
 * `routes/auth.ts` and `guardedAdminWrite` in `routes/members.ts` do:
 * `db.transaction()` throws ("calling the transaction method for a
 * Transaction is not supported") when `db` is already inside one — which it
 * always is under this repo's test harness, since every test runs inside
 * one outer, always-rolled-back transaction. The call site below picks the
 * right thing for each case via `deps.db.isTransaction`: wrap in a real
 * transaction in production, reuse the existing one in tests.
 */
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

  app.get(
    '/api/players/:id/availability',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: AvailabilityGrid } } },
    async (req) => load((req.params as MemberIdParams).id),
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
      // leave availability half-saved.
      await (deps.db.isTransaction
        ? replaceAvailability(deps.db, memberId, slots)
        : deps.db.transaction().execute((trx) => replaceAvailability(trx, memberId, slots)))

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
        .innerJoin('player_profiles as p', 'p.member_id', 'm.id')
        .select(['m.id', 'p.display_name', 'p.photo_key'])
        .where('a.weekday', '=', weekday)
        .where('a.block', '=', block)
        .where('m.status', '=', 'active')
        .orderBy('p.display_name')
        .execute()

      return rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        photoUrl: r.photo_key ? deps.storage.publicUrl(r.photo_key) : null,
      }))
    },
  )
}
