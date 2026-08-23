import type { ColumnType, Generated } from 'kysely'

type Ts = ColumnType<Date, Date | string | undefined, Date | string>

export interface MembersTable {
  id: Generated<number>
  email: string
  // `default 'player'` / `default 'invited'` in the DB — Generated so inserts
  // may omit them (as some tests do), matching id below.
  role: Generated<'admin' | 'player'>
  status: Generated<'invited' | 'active' | 'removed'>
  // Not `Generated<Ts>`: `Ts` is itself a `ColumnType` alias, and Kysely's
  // `SelectType`/`InsertType`/`UpdateType` helpers only unwrap one level of
  // `ColumnType`. Wrapping it in `Generated<>` leaves selects/updates typed
  // as the opaque `Ts` marker object instead of `Date`/`Date | string`. `Ts`
  // already has `| undefined` in its insert position, so the column stays
  // optional on insert without the `Generated<>` wrapper.
  created_at: Ts
  last_seen_at: Ts | null
}

export interface PlayerProfilesTable {
  member_id: number
  display_name: string
  nickname: string | null
  phone: string | null
  photo_key: string | null
  dominant_hand: 'left' | 'right' | null
  backhand: 'one' | 'two' | null
  preferred_format: 'singles' | 'doubles' | 'both' | null
  // `default 'none'` in the DB — Generated so inserts may omit it.
  rating_system: Generated<'utr' | 'ntrp' | 'club' | 'none'>
  rating_value: string | null
  racquet: string | null
  bio: string | null
  updated_at: Ts // see the note on MembersTable.created_at above
}

export interface LoginTokensTable {
  id: Generated<number>
  member_id: number
  token_hash: Buffer
  expires_at: Ts
  consumed_at: Ts | null
  created_at: Ts // see the note on MembersTable.created_at above
}

export interface SessionsTable {
  id: Generated<number>
  member_id: number
  token_hash: Buffer
  expires_at: Ts
  created_at: Ts // see the note on MembersTable.created_at above
  last_used_at: Ts // see the note on MembersTable.created_at above
  user_agent: string | null
}

export interface AvailabilityTable {
  member_id: number
  weekday: number
  block: 'morning' | 'afternoon' | 'evening'
}

export interface MatchesTable {
  id: Generated<number>
  played_on: ColumnType<string, string, string>
  format: 'singles' | 'doubles'
  venue: string | null
  notes: string | null
  winner_side: 1 | 2
  recorded_by: number
  created_at: Ts // see the note on MembersTable.created_at above
  updated_at: Ts // see the note on MembersTable.created_at above
}

export interface MatchPlayersTable {
  id: Generated<number>
  match_id: number
  side: 1 | 2
  member_id: number | null
  guest_name: string | null
}

export interface MatchSetsTable {
  id: Generated<number>
  match_id: number
  set_number: number
  side1_games: number
  side2_games: number
}

export interface PlayerRecordsView {
  member_id: number
  matches_played: number
  wins: number
  losses: number
}

export interface Database {
  members: MembersTable
  player_profiles: PlayerProfilesTable
  login_tokens: LoginTokensTable
  sessions: SessionsTable
  availability: AvailabilityTable
  matches: MatchesTable
  match_players: MatchPlayersTable
  match_sets: MatchSetsTable
  player_records: PlayerRecordsView
}
