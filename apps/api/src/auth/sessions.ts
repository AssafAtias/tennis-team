import type { ColumnType, Kysely } from 'kysely'
import type { Database } from '../db/schema.js'
import { hashToken, newToken } from './tokens.js'

// Mirrors the un-exported `Ts` alias in db/schema.ts. `sessions.last_used_at`
// is typed `Generated<Ts>` there; Kysely's `UpdateType<T>` helper only
// unwraps one level of `ColumnType`, so nesting the `Ts` alias inside
// `Generated<>` leaves the column's update type as the opaque `Ts` marker
// object instead of `Date | string`. The cast below is compile-time only —
// this type is structurally identical to that marker, so it satisfies the
// checker without changing the plain `Date` value actually sent to postgres.
type SchemaTs = ColumnType<Date, Date | string | undefined, Date | string>

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
  await deps.db
    .insertInto('sessions')
    .values({
      member_id: memberId,
      token_hash: hash,
      expires_at: new Date(deps.now().getTime() + SESSION_TTL_MS),
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
      'm.status as status',
      'p.member_id as profile_id',
    ])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    .executeTakeFirst()

  if (!row || row.status !== 'active') return null

  // Sliding expiry: every use pushes the window out, capped at SESSION_TTL_MS.
  await deps.db
    .updateTable('sessions')
    .set({ last_used_at: now as unknown as SchemaTs, expires_at: new Date(now.getTime() + SESSION_TTL_MS) })
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
