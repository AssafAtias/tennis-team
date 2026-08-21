import { describe, expect, it } from 'vitest'
import { withTx } from './setup/harness.js'

describe('schema', () => {
  it('stores a member and cascades the profile on delete', async () => {
    await withTx(async (db) => {
      const member = await db
        .insertInto('members')
        .values({ email: 'A.Player@Example.com', role: 'player', status: 'invited' })
        .returning(['id', 'email'])
        .executeTakeFirstOrThrow()

      // citext: the stored address compares case-insensitively.
      const found = await db
        .selectFrom('members')
        .selectAll()
        .where('email', '=', 'a.player@example.com')
        .executeTakeFirst()
      expect(found?.id).toBe(member.id)

      await db
        .insertInto('player_profiles')
        .values({ member_id: member.id, display_name: 'A Player' })
        .execute()

      await db.deleteFrom('members').where('id', '=', member.id).execute()
      const orphan = await db
        .selectFrom('player_profiles')
        .selectAll()
        .where('member_id', '=', member.id)
        .executeTakeFirst()
      expect(orphan).toBeUndefined()
    })
  })

  it('rejects a rating value when the rating system is none', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'r@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await expect(
        db
          .insertInto('player_profiles')
          .values({ member_id: m.id, display_name: 'R', rating_system: 'none', rating_value: '4.0' })
          .execute(),
      ).rejects.toThrow(/rating_value_requires_system/)
    })
  })

  it('rejects a match player that is both a member and a guest', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'g@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const match = await db
        .insertInto('matches')
        .values({ played_on: '2026-08-01', format: 'singles', winner_side: 1, recorded_by: m.id })
        .returning('id')
        .executeTakeFirstOrThrow()

      await expect(
        db
          .insertInto('match_players')
          .values({ match_id: match.id, side: 1, member_id: m.id, guest_name: 'Nope' })
          .execute(),
      ).rejects.toThrow(/exactly_one_identity/)
    })
  })

  it('reports zero counts for a member who has played no matches', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'zero@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const rec = await db
        .selectFrom('player_records')
        .selectAll()
        .where('member_id', '=', m.id)
        .executeTakeFirstOrThrow()
      expect(rec).toMatchObject({ matches_played: 0, wins: 0, losses: 0 })
    })
  })

  it('counts a win for the member on the winning side', async () => {
    await withTx(async (db) => {
      const [winner, loser] = await Promise.all([
        db.insertInto('members').values({ email: 'w@example.com' }).returning('id').executeTakeFirstOrThrow(),
        db.insertInto('members').values({ email: 'l@example.com' }).returning('id').executeTakeFirstOrThrow(),
      ])
      const match = await db
        .insertInto('matches')
        .values({ played_on: '2026-08-02', format: 'singles', winner_side: 1, recorded_by: winner.id })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db
        .insertInto('match_players')
        .values([
          { match_id: match.id, side: 1, member_id: winner.id },
          { match_id: match.id, side: 2, member_id: loser.id },
        ])
        .execute()

      const rows = await db
        .selectFrom('player_records')
        .selectAll()
        .where('member_id', 'in', [winner.id, loser.id])
        .execute()
      expect(rows.find((r) => r.member_id === winner.id)).toMatchObject({ wins: 1, losses: 0, matches_played: 1 })
      expect(rows.find((r) => r.member_id === loser.id)).toMatchObject({ wins: 0, losses: 1, matches_played: 1 })
    })
  })
})
