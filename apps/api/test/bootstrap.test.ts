import { describe, expect, it } from 'vitest'
import { withTx } from './setup/harness.js'
import { bootstrapAdmin } from '../src/db/bootstrap.js'

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
      expect(await bootstrapAdmin(db, 'boss@example.com')).toBe('created')
      const rows = await db.selectFrom('members').select(['role', 'status']).execute()
      expect(rows).toEqual([{ role: 'admin', status: 'active' }])
    })
  })

  it('does nothing when no bootstrap address is configured', async () => {
    await withTx(async (db) => {
      expect(await bootstrapAdmin(db, undefined)).toBe('no-email')
    })
  })
})
