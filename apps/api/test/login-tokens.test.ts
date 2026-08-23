import { describe, expect, it } from 'vitest'
import { withTx } from './setup/harness.js'
import { consumeLoginToken } from '../src/auth/sessions.js'
import { newToken } from '../src/auth/tokens.js'

const NOW = new Date('2026-08-21T10:00:00Z')

describe('consumeLoginToken', () => {
  it('redeems a valid token exactly once', async () => {
    await withTx(async (db) => {
      const member = await db
        .insertInto('members')
        .values({ email: 'redeem@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const { token, hash } = newToken()
      await db
        .insertInto('login_tokens')
        .values({ member_id: member.id, token_hash: hash, expires_at: new Date(NOW.getTime() + 60_000) })
        .execute()

      const deps = { db, now: () => NOW }
      const first = await consumeLoginToken(deps, token)
      expect(first).toBe(member.id)

      // A concurrent second redemption of the same link must not succeed.
      const second = await consumeLoginToken(deps, token)
      expect(second).toBeNull()
    })
  })

  it('rejects an expired token', async () => {
    await withTx(async (db) => {
      const member = await db
        .insertInto('members')
        .values({ email: 'expired@example.com' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const { token, hash } = newToken()
      await db
        .insertInto('login_tokens')
        .values({ member_id: member.id, token_hash: hash, expires_at: new Date(NOW.getTime() - 1000) })
        .execute()

      const result = await consumeLoginToken({ db, now: () => NOW }, token)
      expect(result).toBeNull()
    })
  })

  it('rejects an unknown token', async () => {
    await withTx(async (db) => {
      const { token } = newToken()
      const result = await consumeLoginToken({ db, now: () => NOW }, token)
      expect(result).toBeNull()
    })
  })
})
