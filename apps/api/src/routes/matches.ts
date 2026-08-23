import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import {
  CreateMatchBody,
  MatchDetail,
  MatchList,
  MatchListQuery,
  MemberIdParams,
  PatchMatchBody,
  PlayerRecord,
  type MatchPlayerInput,
} from '@tennis/contracts'
import type { Deps } from '../app.js'
import type { Database } from '../db/schema.js'
import { withTransaction } from '../db/transaction.js'
import { badRequest, forbidden, notFound } from '../plugins/error-handler.js'
import { requireAuth, requireRole } from '../plugins/session.js'

const memberIdsOf = (side: MatchPlayerInput[]): number[] =>
  side.flatMap((p) => ('memberId' in p ? [p.memberId] : []))

function assertShape(body: CreateMatchBody): void {
  const expected = body.format === 'singles' ? 1 : 2
  for (const [name, side] of [
    ['side1', body.side1],
    ['side2', body.side2],
  ] as const) {
    if (side.length !== expected) {
      throw badRequest(`A ${body.format} match needs exactly ${expected} player(s) on each side`, {
        fields: [{ path: `/${name}`, message: `Expected ${expected}, got ${side.length}` }],
      })
    }
  }
  const ids = [...memberIdsOf(body.side1), ...memberIdsOf(body.side2)]
  if (new Set(ids).size !== ids.length) {
    throw badRequest('A player cannot appear twice in the same match')
  }
}

type MatchRow = {
  id: number
  played_on: string
  format: 'singles' | 'doubles'
  venue: string | null
  notes: string | null
  winner_side: 1 | 2
  recorded_by: number
}

type PlayerRow = {
  match_id: number
  side: 1 | 2
  member_id: number | null
  guest_name: string | null
  display_name: string | null
}

type SetRow = {
  match_id: number
  side1_games: number
  side2_games: number
}

/** Assembles one MatchDetail from a match row plus its already-fetched players/sets. */
function assemble(m: MatchRow, players: PlayerRow[], sets: SetRow[]): MatchDetail {
  const side = (n: 1 | 2) =>
    players
      .filter((p) => p.match_id === m.id && p.side === n)
      .map((p) => ({
        memberId: p.member_id,
        guestName: p.guest_name,
        displayName: p.display_name ?? p.guest_name ?? 'Unknown',
      }))

  return {
    id: m.id,
    playedOn: m.played_on,
    format: m.format,
    venue: m.venue,
    notes: m.notes,
    winnerSide: m.winner_side,
    recordedBy: m.recorded_by,
    side1: side(1),
    side2: side(2),
    sets: sets.filter((s) => s.match_id === m.id).map((s) => ({ side1Games: s.side1_games, side2Games: s.side2_games })),
  }
}

async function loadMatch(deps: Deps, id: number): Promise<MatchDetail> {
  const m = await deps.db.selectFrom('matches').selectAll().where('id', '=', id).executeTakeFirst()
  if (!m) throw notFound('No such match')

  const [players, sets] = await Promise.all([
    deps.db
      .selectFrom('match_players as mp')
      .leftJoin('player_profiles as p', 'p.member_id', 'mp.member_id')
      .select(['mp.match_id', 'mp.side', 'mp.member_id', 'mp.guest_name', 'p.display_name'])
      .where('mp.match_id', '=', id)
      .orderBy('mp.id')
      .execute(),
    deps.db
      .selectFrom('match_sets')
      .select(['match_id', 'side1_games', 'side2_games'])
      .where('match_id', '=', id)
      .orderBy('set_number')
      .execute(),
  ])

  return assemble(m, players, sets)
}

/**
 * Loads a page of already-fetched match rows' players and sets in exactly two
 * queries (`where match_id in (...)`), then assembles each MatchDetail from
 * the in-memory groups. The brief's version calls `loadMatch` per row via
 * `Promise.all`, which is two extra round trips per match — 50 for a
 * 25-match page. This keeps it at two round trips total for the whole page.
 */
async function loadMatchesFor(deps: Deps, rows: MatchRow[]): Promise<MatchDetail[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const [players, sets] = await Promise.all([
    deps.db
      .selectFrom('match_players as mp')
      .leftJoin('player_profiles as p', 'p.member_id', 'mp.member_id')
      .select(['mp.match_id', 'mp.side', 'mp.member_id', 'mp.guest_name', 'p.display_name'])
      .where('mp.match_id', 'in', ids)
      .orderBy('mp.id')
      .execute(),
    deps.db
      .selectFrom('match_sets')
      .select(['match_id', 'side1_games', 'side2_games'])
      .where('match_id', 'in', ids)
      .orderBy('set_number')
      .execute(),
  ])

  return rows.map((m) => assemble(m, players, sets))
}

async function writeChildren(
  tx: Kysely<Database>,
  matchId: number,
  body: Pick<CreateMatchBody, 'side1' | 'side2' | 'sets'>,
): Promise<void> {
  await tx.deleteFrom('match_players').where('match_id', '=', matchId).execute()
  await tx.deleteFrom('match_sets').where('match_id', '=', matchId).execute()
  await tx
    .insertInto('match_players')
    .values(
      [
        ...body.side1.map((p) => ({ side: 1 as const, p })),
        ...body.side2.map((p) => ({ side: 2 as const, p })),
      ].map(({ side, p }) => ({
        match_id: matchId,
        side,
        member_id: 'memberId' in p ? p.memberId : null,
        guest_name: 'guestName' in p ? p.guestName : null,
      })),
    )
    .execute()
  await tx
    .insertInto('match_sets')
    .values(
      body.sets.map((s, i) => ({
        match_id: matchId,
        set_number: i + 1,
        side1_games: s.side1Games,
        side2_games: s.side2Games,
      })),
    )
    .execute()
}

export async function matchRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(
    '/api/matches',
    { preHandler: requireAuth, schema: { querystring: MatchListQuery, response: { 200: MatchList } } },
    async (req) => {
      const { limit = 20, cursor } = req.query as MatchListQuery
      let q = deps.db.selectFrom('matches').selectAll()
      if (cursor) {
        const [day, rawId] = cursor.split('_')
        // Keyset pagination on (played_on, id) so a new match cannot shift a page.
        q = q.where((eb) =>
          eb.or([eb('played_on', '<', day!), eb.and([eb('played_on', '=', day!), eb('id', '<', Number(rawId))])]),
        )
      }
      const rows = await q.orderBy('played_on', 'desc').orderBy('id', 'desc').limit(limit + 1).execute()

      const page = rows.slice(0, limit)
      const last = page.at(-1)
      const items = await loadMatchesFor(deps, page)
      return {
        items,
        nextCursor: rows.length > limit && last ? `${last.played_on}_${last.id}` : null,
      }
    },
  )

  app.get(
    '/api/matches/:id',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: MatchDetail } } },
    async (req) => loadMatch(deps, (req.params as MemberIdParams).id),
  )

  app.post(
    '/api/matches',
    { preHandler: requireAuth, schema: { body: CreateMatchBody, response: { 201: MatchDetail } } },
    async (req, reply) => {
      const body = req.body as CreateMatchBody
      assertShape(body)

      const participants = new Set([...memberIdsOf(body.side1), ...memberIdsOf(body.side2)])
      if (req.member.role !== 'admin' && !participants.has(req.member.id)) {
        throw forbidden('You can only record matches you played in')
      }

      const id = await withTransaction(deps.db, async (tx) => {
        const match = await tx
          .insertInto('matches')
          .values({
            played_on: body.playedOn,
            format: body.format,
            venue: body.venue ?? null,
            notes: body.notes ?? null,
            winner_side: body.winnerSide,
            recorded_by: req.member.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        await writeChildren(tx, match.id, body)
        return match.id
      })

      req.log.info({ matchId: id, by: req.member.id }, 'match recorded')
      return reply.code(201).send(await loadMatch(deps, id))
    },
  )

  app.patch(
    '/api/matches/:id',
    {
      preHandler: requireAuth,
      schema: { params: MemberIdParams, body: PatchMatchBody, response: { 200: MatchDetail } },
    },
    async (req) => {
      const { id } = req.params as MemberIdParams
      const patch = req.body as PatchMatchBody

      const existing = await loadMatch(deps, id)
      if (req.member.role !== 'admin' && existing.recordedBy !== req.member.id) {
        throw forbidden('Only the member who recorded this match, or an admin, can change it')
      }

      // Validate the POST-SHAPED result, so a patch cannot sneak past assertShape.
      const merged: CreateMatchBody = {
        playedOn: patch.playedOn ?? existing.playedOn,
        format: patch.format ?? existing.format,
        venue: 'venue' in patch ? (patch.venue ?? null) : existing.venue,
        notes: 'notes' in patch ? (patch.notes ?? null) : existing.notes,
        winnerSide: patch.winnerSide ?? existing.winnerSide,
        side1:
          patch.side1 ??
          existing.side1.map((p) => (p.memberId ? { memberId: p.memberId } : { guestName: p.guestName! })),
        side2:
          patch.side2 ??
          existing.side2.map((p) => (p.memberId ? { memberId: p.memberId } : { guestName: p.guestName! })),
        sets: patch.sets ?? existing.sets,
      }
      assertShape(merged)

      await withTransaction(deps.db, async (tx) => {
        await tx
          .updateTable('matches')
          .set({
            played_on: merged.playedOn,
            format: merged.format,
            venue: merged.venue ?? null,
            notes: merged.notes ?? null,
            winner_side: merged.winnerSide,
            updated_at: deps.now(),
          })
          .where('id', '=', id)
          .execute()
        await writeChildren(tx, id, merged)
      })

      return loadMatch(deps, id)
    },
  )

  app.delete(
    '/api/matches/:id',
    { preHandler: requireRole('admin'), schema: { params: MemberIdParams } },
    async (req, reply) => {
      const { id } = req.params as MemberIdParams
      const gone = await deps.db.deleteFrom('matches').where('id', '=', id).returning('id').executeTakeFirst()
      if (!gone) throw notFound('No such match')
      return reply.code(204).send()
    },
  )

  app.get(
    '/api/players/:id/record',
    { preHandler: requireAuth, schema: { params: MemberIdParams, response: { 200: PlayerRecord } } },
    async (req) => {
      const { id } = req.params as MemberIdParams
      const row = await deps.db
        .selectFrom('player_records')
        .selectAll()
        .where('member_id', '=', id)
        .executeTakeFirst()
      if (!row) throw notFound('No such player')
      return {
        memberId: row.member_id,
        matchesPlayed: row.matches_played,
        wins: row.wins,
        losses: row.losses,
      }
    },
  )
}
