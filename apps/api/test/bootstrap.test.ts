import { describe, expect, it } from 'vitest'
import { withTx } from './setup/harness.js'
import { bootstrapAdmin, resolveBootstrapEmail } from '../src/db/bootstrap.js'

describe('bootstrapAdmin', () => {
  it('creates the first admin as active', async () => {
    await withTx(async (db) => {
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('created')
      const row = await db
        .selectFrom('members')
        .select(['role', 'status'])
        .where('email', '=', 'boss@example.com')
        .executeTakeFirstOrThrow()
      expect(row).toMatchObject({ role: 'admin', status: 'active' })
    })
  })

  it('is idempotent when an admin already exists', async () => {
    await withTx(async (db) => {
      await bootstrapAdmin(db, 'boss@example.com')
      expect(await bootstrapAdmin(db, 'someone.else@example.com')).toBe('skipped')
      const count = await db
        .selectFrom('members')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
      expect(count.n).toBe(1)
    })
  })

  it('promotes an existing invited member rather than duplicating the address', async () => {
    await withTx(async (db) => {
      await db.insertInto('members').values({ email: 'boss@example.com', status: 'invited' }).execute()
      // Widened from the original 'created' expectation: the outcome now
      // distinguishes "a brand-new row was inserted" from "an existing,
      // non-removed row was upgraded" — see bootstrapAdmin's doc comment.
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('promoted')
      const rows = await db.selectFrom('members').select(['role', 'status']).execute()
      expect(rows).toEqual([{ role: 'admin', status: 'active' }])
    })
  })

  it('does nothing when no bootstrap address is configured', async () => {
    await withTx(async (db) => {
      expect(await bootstrapAdmin(db, undefined)).toBe('no-email')
    })
  })

  // Neither of these existed before: the four cases above never exercise
  // `.where('status', '<>', 'removed')` in the existing-admin lookup, which
  // is exactly what stops a deployment from reporting 'skipped' — as though
  // everything were fine — while actually being permanently locked out.

  it('creates a new admin when the sole existing admin is removed', async () => {
    await withTx(async (db) => {
      await db.insertInto('members').values({ email: 'gone@example.com', role: 'admin', status: 'removed' }).execute()
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('created')
      const rows = await db.selectFrom('members').select(['email', 'role', 'status']).execute()
      expect(rows).toEqual(
        expect.arrayContaining([
          { email: 'gone@example.com', role: 'admin', status: 'removed' },
          { email: 'boss@example.com', role: 'admin', status: 'active' },
        ]),
      )
    })
  })

  it('resurrects the bootstrap address when it is a removed member and no other admin exists', async () => {
    await withTx(async (db) => {
      await db
        .insertInto('members')
        .values({ email: 'boss@example.com', role: 'player', status: 'removed' })
        .execute()
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('resurrected')
      const row = await db
        .selectFrom('members')
        .select(['role', 'status'])
        .where('email', '=', 'boss@example.com')
        .executeTakeFirstOrThrow()
      expect(row).toEqual({ role: 'admin', status: 'active' })
    })
  })

  it('leaves a removed member untouched when another active admin already exists', async () => {
    await withTx(async (db) => {
      await db
        .insertInto('members')
        .values({ email: 'admin@example.com', role: 'admin', status: 'active' })
        .execute()
      await db
        .insertInto('members')
        .values({ email: 'boss@example.com', role: 'player', status: 'removed' })
        .execute()
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('skipped')
      const row = await db
        .selectFrom('members')
        .select(['role', 'status'])
        .where('email', '=', 'boss@example.com')
        .executeTakeFirstOrThrow()
      expect(row).toEqual({ role: 'player', status: 'removed' })
    })
  })
})

describe('resolveBootstrapEmail', () => {
  it('rejects a malformed address', () => {
    expect(() => resolveBootstrapEmail('not-an-email')).toThrow(/valid email/i)
  })

  it('treats a whitespace-only value as not configured', () => {
    expect(resolveBootstrapEmail('   ')).toBeUndefined()
  })

  it('accepts and trims a valid address', () => {
    expect(resolveBootstrapEmail('  boss@example.com  ')).toBe('boss@example.com')
  })
})
