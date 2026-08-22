import { describe, expect, it } from 'vitest'
import { buildTestApp } from './setup/harness.js'
import { sweepExpired } from '../src/jobs/cleanup.js'
import { hashToken } from '../src/auth/tokens.js'

describe('sweepExpired', () => {
  it('deletes expired sessions and leaves live ones alone', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'sweep@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await ctx.db
        .insertInto('sessions')
        .values([
          { member_id: m.id, token_hash: hashToken('dead'), expires_at: new Date('2026-08-01T00:00:00Z') },
          { member_id: m.id, token_hash: hashToken('alive'), expires_at: new Date('2026-09-30T00:00:00Z') },
        ])
        .execute()

      const result = await sweepExpired({ db: ctx.db, now: () => ctx.clock.now })
      expect(result.sessions).toBe(1)

      const left = await ctx.db.selectFrom('sessions').select('token_hash').execute()
      expect(left).toHaveLength(1)
      expect(left[0]!.token_hash).toEqual(hashToken('alive'))
    })
  })

  it('deletes consumed tokens older than seven days but keeps recent ones', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'tok@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await ctx.db
        .insertInto('login_tokens')
        .values([
          {
            member_id: m.id,
            token_hash: hashToken('old'),
            expires_at: new Date('2026-08-01T00:00:00Z'),
            consumed_at: new Date('2026-08-01T00:00:00Z'),
            created_at: new Date('2026-08-01T00:00:00Z'),
          },
          {
            member_id: m.id,
            token_hash: hashToken('recent'),
            expires_at: new Date('2026-08-21T09:00:00Z'),
            consumed_at: new Date('2026-08-21T09:00:00Z'),
            created_at: new Date('2026-08-21T09:00:00Z'),
          },
        ])
        .execute()

      const result = await sweepExpired({ db: ctx.db, now: () => ctx.clock.now })
      expect(result.tokens).toBe(1)
      expect(await ctx.db.selectFrom('login_tokens').select('id').execute()).toHaveLength(1)
    })
  })

  it('is safe to run twice', async () => {
    await buildTestApp(async (_app, ctx) => {
      const deps = { db: ctx.db, now: () => ctx.clock.now }
      await sweepExpired(deps)
      const second = await sweepExpired(deps)
      expect(second).toEqual({ sessions: 0, tokens: 0 })
    })
  })

  // Added beyond the brief's three tests: the brief's own "old vs recent" case
  // (17 days old vs 9 hours old) never comes near the 7-day cutoff, so it
  // can't tell a `<` from a `<=` or catch an accidental `now()` call inside
  // the query construction. This pins the exact edge: a token created
  // *precisely* seven days before `now` must be treated consistently on
  // every run because both `now` and the cutoff are derived from the same
  // injected clock value, not from wall-clock time re-read mid-sweep.
  it('treats a token created exactly seven days before now as still within retention', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'edge@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const now = ctx.clock.now
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      const exactlyAtCutoff = new Date(now.getTime() - sevenDaysMs)
      const oneMsPastCutoff = new Date(now.getTime() - sevenDaysMs - 1)

      await ctx.db
        .insertInto('login_tokens')
        .values([
          {
            member_id: m.id,
            token_hash: hashToken('at-cutoff'),
            expires_at: exactlyAtCutoff,
            consumed_at: exactlyAtCutoff,
            created_at: exactlyAtCutoff,
          },
          {
            member_id: m.id,
            token_hash: hashToken('past-cutoff'),
            expires_at: oneMsPastCutoff,
            consumed_at: oneMsPastCutoff,
            created_at: oneMsPastCutoff,
          },
        ])
        .execute()

      const result = await sweepExpired({ db: ctx.db, now: () => ctx.clock.now })
      expect(result.tokens).toBe(1)

      const left = await ctx.db.selectFrom('login_tokens').select('token_hash').execute()
      expect(left).toHaveLength(1)
      expect(left[0]!.token_hash).toEqual(hashToken('at-cutoff'))
    })
  })
})
