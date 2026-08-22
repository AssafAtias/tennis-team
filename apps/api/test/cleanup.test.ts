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

  // Rewritten in fix round 1: the original version (verbatim from the brief)
  // inserted nothing before calling sweepExpired twice, so it returned
  // { sessions: 0, tokens: 0 } both times regardless of whether the delete
  // logic worked at all -- it would have passed against a completely broken
  // sweep. This version inserts one already-expired session and one spent
  // token, asserts the first sweep actually reports non-zero counts for
  // both (the number that proves it is not vacuous), then re-runs the sweep
  // over the now-empty tables and asserts it reports zero -- idempotency
  // genuinely exercised, not assumed.
  it('is safe to run twice', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'twice@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await ctx.db
        .insertInto('sessions')
        .values({
          member_id: m.id,
          token_hash: hashToken('twice-dead'),
          expires_at: new Date('2026-08-01T00:00:00Z'),
        })
        .execute()

      await ctx.db
        .insertInto('login_tokens')
        .values({
          member_id: m.id,
          token_hash: hashToken('twice-spent'),
          expires_at: new Date('2026-08-01T00:00:00Z'),
          consumed_at: new Date('2026-08-01T00:00:00Z'),
          created_at: new Date('2026-08-01T00:00:00Z'),
        })
        .execute()

      const deps = { db: ctx.db, now: () => ctx.clock.now }
      const first = await sweepExpired(deps)
      expect(first).toEqual({ sessions: 1, tokens: 1 })

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

  // Added in fix round 1: pins the invariant the OR-grouping exists to
  // protect -- "an unconsumed, unexpired token must survive regardless of
  // age" -- with a row inserted directly against the DB rather than via the
  // real sign-in flow. In production this shape is nearly unreachable
  // (TOKEN_TTL_MS is 15 minutes, so an unconsumed token is always long
  // expired well before it turns 7 days old), which is exactly why it needs
  // a direct-insert regression test: a future change to the TTL, or to the
  // predicate's OR-grouping, could silently start deleting live,
  // not-yet-used tokens without any real-flow test ever noticing.
  it('keeps an unconsumed, unexpired token no matter how old it is', async () => {
    await buildTestApp(async (_app, ctx) => {
      const m = await ctx.db
        .insertInto('members')
        .values({ email: 'unconsumed@example.com', status: 'active' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const now = ctx.clock.now
      const wellPastRetention = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days old
      const futureExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000) // expires tomorrow

      await ctx.db
        .insertInto('login_tokens')
        .values({
          member_id: m.id,
          token_hash: hashToken('unconsumed-old'),
          expires_at: futureExpiry,
          consumed_at: null,
          created_at: wellPastRetention,
        })
        .execute()

      const result = await sweepExpired({ db: ctx.db, now: () => ctx.clock.now })
      expect(result.tokens).toBe(0)

      const left = await ctx.db.selectFrom('login_tokens').select('token_hash').execute()
      expect(left).toHaveLength(1)
      expect(left[0]!.token_hash).toEqual(hashToken('unconsumed-old'))
    })
  })
})
