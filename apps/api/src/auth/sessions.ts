import type { Kysely } from 'kysely'
import type { Database } from '../db/schema.js'
import { hashToken, newToken } from './tokens.js'

export const SESSION_COOKIE = 'tt_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionMember {
  id: number
  email: string
  role: 'admin' | 'player'
  hasProfile: boolean
}

/** Minimal slice of Deps these functions need, so tests can pass a bare object. */
export interface SessionDeps {
  db: Kysely<Database>
  now: () => Date
}

export async function createSession(
  deps: SessionDeps,
  memberId: number,
  userAgent: string | undefined,
): Promise<string> {
  const { token, hash } = newToken()
  const now = deps.now()
  await deps.db
    .insertInto('sessions')
    .values({
      member_id: memberId,
      token_hash: hash,
      // Written explicitly from the injected clock rather than left to
      // Postgres's `default now()`: a frozen test clock cannot control a DB
      // default, and later cleanup-job tests need sessions created at exact,
      // controlled times.
      created_at: now,
      last_used_at: now,
      expires_at: new Date(now.getTime() + SESSION_TTL_MS),
      user_agent: userAgent?.slice(0, 255) ?? null,
    })
    .execute()
  return token
}

export async function resolveSession(deps: SessionDeps, token: string): Promise<SessionMember | null> {
  const now = deps.now()
  const row = await deps.db
    .selectFrom('sessions as s')
    .innerJoin('members as m', 'm.id', 's.member_id')
    .leftJoin('player_profiles as p', 'p.member_id', 'm.id')
    .select([
      's.id as session_id',
      'm.id as id',
      'm.email as email',
      'm.role as role',
      'p.member_id as profile_id',
    ])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    // Filtered in SQL, not just in JS below: a non-active member's row never
    // leaves the database. Removing a member must end their access
    // immediately, so this is the query that makes that true.
    .where('m.status', '=', 'active')
    .executeTakeFirst()

  if (!row) return null

  // Sliding expiry: every use pushes the window out, capped at SESSION_TTL_MS.
  await deps.db
    .updateTable('sessions')
    .set({ last_used_at: now, expires_at: new Date(now.getTime() + SESSION_TTL_MS) })
    .where('id', '=', row.session_id)
    .execute()
  await deps.db.updateTable('members').set({ last_seen_at: now }).where('id', '=', row.id).execute()

  return { id: row.id, email: row.email, role: row.role, hasProfile: row.profile_id !== null }
}

export async function revokeSession(deps: SessionDeps, token: string): Promise<void> {
  await deps.db.deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute()
}

export async function revokeAllForMember(deps: SessionDeps, memberId: number): Promise<void> {
  await deps.db.deleteFrom('sessions').where('member_id', '=', memberId).execute()
}

/**
 * Redeems a login token atomically: one UPDATE, guarded by both
 * `consumed_at is null` and `expires_at > now`, so two concurrent requests
 * racing on the same emailed link can mint at most one session between them
 * — the loser gets `null` back rather than a second valid session.
 */
export async function consumeLoginToken(deps: SessionDeps, token: string): Promise<number | null> {
  const now = deps.now()
  const row = await deps.db
    .updateTable('login_tokens')
    .set({ consumed_at: now })
    .where('token_hash', '=', hashToken(token))
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', now)
    .returning(['member_id'])
    .executeTakeFirst()
  return row?.member_id ?? null
}
