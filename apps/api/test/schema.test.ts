import { describe, expect, it } from 'vitest'
import { expectViolation, withTx } from './setup/harness.js'

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

      // citext: uniqueness is also case-insensitive — one account per human.
      // This also proves the transaction survives a mid-body violation: the
      // insert/select below would fail with "current transaction is aborted"
      // if expectViolation didn't wrap the attempt in a savepoint.
      await expectViolation(db, /duplicate key value violates unique constraint/, () =>
        db.insertInto('members').values({ email: 'a.player@example.com' }).execute(),
      )

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

      await expectViolation(db, /rating_value_requires_system/, () =>
        db
          .insertInto('player_profiles')
          .values({ member_id: m.id, display_name: 'R', rating_system: 'none', rating_value: '4.0' })
          .execute(),
      )

      // Confirms nothing was written — only reachable if the transaction is
      // still usable after the violation above.
      const profile = await db
        .selectFrom('player_profiles')
        .selectAll()
        .where('member_id', '=', m.id)
        .executeTakeFirst()
      expect(profile).toBeUndefined()
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

      await expectViolation(db, /exactly_one_identity/, () =>
        db
          .insertInto('match_players')
          .values({ match_id: match.id, side: 1, member_id: m.id, guest_name: 'Nope' })
          .execute(),
      )

      const rows = await db.selectFrom('match_players').selectAll().where('match_id', '=', match.id).execute()
      expect(rows).toHaveLength(0)
    })
  })

  it('rejects the same member recorded twice in one match', async () => {
    await withTx(async (db) => {
      const m = await db
        .insertInto('members')
        .values({ email: 'dup@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const match = await db
        .insertInto('matches')
        .values({ played_on: '2026-08-03', format: 'singles', winner_side: 1, recorded_by: m.id })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db.insertInto('match_players').values({ match_id: match.id, side: 1, member_id: m.id }).execute()

      await expectViolation(db, /match_players_unique_member_idx/, () =>
        db.insertInto('match_players').values({ match_id: match.id, side: 2, member_id: m.id }).execute(),
      )

      const rows = await db.selectFrom('match_players').selectAll().where('match_id', '=', match.id).execute()
      expect(rows).toHaveLength(1)
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

  it('rolls back every row written inside withTx', async () => {
    const email = `rollback-probe-${Date.now()}@example.com`
    await withTx(async (db) => {
      await db.insertInto('members').values({ email }).execute()
    })
    await withTx(async (db) => {
      const found = await db.selectFrom('members').selectAll().where('email', '=', email).executeTakeFirst()
      expect(found).toBeUndefined()
    })
  })

  it('propagates an error thrown by the test body', async () => {
    await expect(
      withTx(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})
