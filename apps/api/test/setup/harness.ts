import { afterAll } from 'vitest'
import { sql, type Kysely } from 'kysely'
import type { FastifyInstance } from 'fastify'
import { createDb, createPool } from '../../src/db/client.js'
import type { Database } from '../../src/db/schema.js'
import { buildApp } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import type { Mailer, ObjectStore } from '../../src/app.js'
import { createSession, SESSION_COOKIE } from '../../src/auth/sessions.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required to run integration tests')

// vitest's default `isolate: true` re-evaluates this module per test FILE, so
// each file gets its own pool/`root`/`afterAll` here. That is what makes a
// module-scope pool safe: it is NOT shared across files. See vitest.config.ts.
const pool = createPool(testDatabaseUrl)
const root = createDb(pool)

afterAll(async () => {
  await root.destroy()
})

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, so tests within
 * one file share a migrated database without leaking rows into each other.
 * (Each test file gets its own pool/connection — see the `isolate` note above
 * — so this does not coordinate rollback across files, only within one.)
 *
 * If `fn` needs to assert that a statement violates a constraint, use
 * `expectViolation` below rather than a bare `rejects.toThrow`: a failed
 * statement aborts the surrounding Postgres transaction (error 25P02), and
 * every following statement in the same `withTx` body — including any
 * "confirm nothing was written" query — would fail with a confusing
 * "current transaction is aborted" error instead of running.
 */
export async function withTx(fn: (db: Kysely<Database>) => Promise<void>): Promise<void> {
  const sentinel = new Error('rollback')
  try {
    await root.transaction().execute(async (tx) => {
      await fn(tx)
      throw sentinel
    })
  } catch (err) {
    if (err !== sentinel) throw err
  }
}

/** Asserts `run` violates a constraint WITHOUT aborting the surrounding withTx. */
export async function expectViolation(
  tx: Kysely<Database>,
  match: RegExp,
  run: () => Promise<unknown>,
): Promise<void> {
  await sql`savepoint expect_violation`.execute(tx)
  let err: unknown
  try {
    await run()
  } catch (e) {
    err = e
  }
  await sql`rollback to savepoint expect_violation`.execute(tx)
  if (err === undefined) throw new Error(`expected a violation matching ${match}`)
  if (!match.test(String(err))) throw err
}

// `testDatabaseUrl` above is already checked non-undefined at module load, so
// reuse it here instead of re-asserting `process.env.TEST_DATABASE_URL!`.
export const testConfig: Config = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: testDatabaseUrl,
  sessionSecret: 'test-secret-value-that-is-long-enough-ok',
  appOrigin: 'http://localhost:3000',
  bootstrapAdminEmail: undefined,
  mail: { apiKey: undefined, from: 'Tennis Team <noreply@localhost>' },
  storage: { endpoint: undefined, bucket: undefined, accessKeyId: undefined, secretAccessKey: undefined },
}

export interface SentMail {
  to: string
  url: string
  kind: 'invite' | 'signin'
}

export class FakeMailer implements Mailer {
  readonly sent: SentMail[] = []
  async sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    this.sent.push({ to, url, kind })
  }
  get last(): SentMail | undefined {
    return this.sent.at(-1)
  }
}

export class FakeStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()
  // Widened to match `ObjectStore.presignPut`'s three-parameter signature;
  // contentType/maxBytes are unused here, so left off entirely (TypeScript
  // allows an implementing method to declare fewer parameters) rather than
  // naming them and tripping no-unused-vars.
  async presignPut(key: string): Promise<string> {
    return `https://fake-storage.local/${key}?signed=1`
  }
  async get(key: string): Promise<Buffer> {
    const o = this.objects.get(key)
    if (!o) throw new Error(`no such object: ${key}`)
    return o.body
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType })
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
  publicUrl(key: string): string {
    return `https://fake-storage.local/${key}`
  }
}

export interface TestCtx {
  db: Kysely<Database>
  mailer: FakeMailer
  storage: FakeStore
  clock: { now: Date }
}

/**
 * Builds an app bound to a rolled-back transaction, with fake mailer and storage.
 * The clock is mutable so tests can advance time to expire tokens and sessions.
 */
export async function buildTestApp(
  fn: (app: FastifyInstance, ctx: TestCtx) => Promise<void>,
): Promise<void> {
  await withTx(async (db) => {
    const ctx: TestCtx = {
      db,
      mailer: new FakeMailer(),
      storage: new FakeStore(),
      clock: { now: new Date('2026-08-21T10:00:00Z') },
    }
    const app = await buildApp({
      db,
      config: testConfig,
      mailer: ctx.mailer,
      storage: ctx.storage,
      now: () => ctx.clock.now,
    })
    try {
      await fn(app, ctx)
    } finally {
      await app.close()
    }
  })
}

export interface SignedIn {
  id: number
  email: string
  cookies: Record<string, string>
}

/**
 * Seeds a member and returns cookies for an authenticated session, so route
 * tests do not each re-run the magic-link dance.
 */
export async function signIn(
  app: FastifyInstance,
  ctx: TestCtx,
  opts: {
    email: string
    role?: 'admin' | 'player'
    status?: 'invited' | 'active' | 'removed'
    profile?: boolean
  },
): Promise<SignedIn> {
  const { email, role = 'player', status = 'active', profile = true } = opts
  const m = await ctx.db
    .insertInto('members')
    .values({ email, role, status })
    .returning('id')
    .executeTakeFirstOrThrow()
  if (profile) {
    await ctx.db
      .insertInto('player_profiles')
      .values({ member_id: m.id, display_name: email.split('@')[0]! })
      .execute()
  }
  const token = await createSession({ db: ctx.db, now: () => ctx.clock.now }, m.id, 'vitest')
  return { id: m.id, email, cookies: { [SESSION_COOKIE]: token } }
}
