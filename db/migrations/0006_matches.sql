create table matches (
  id           bigint generated always as identity primary key,
  played_on    date not null,
  format       text not null check (format in ('singles','doubles')),
  venue        text check (length(venue) <= 120),
  notes        text check (length(notes) <= 500),
  winner_side  smallint not null check (winner_side in (1,2)),
  recorded_by  bigint not null references members(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index matches_recent_idx on matches (played_on desc, id desc);

create table match_players (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references matches(id) on delete cascade,
  side       smallint not null check (side in (1,2)),
  member_id  bigint references members(id),
  guest_name text check (length(guest_name) <= 80),
  constraint exactly_one_identity check (
    (member_id is not null and guest_name is null) or
    (member_id is null and guest_name is not null)
  )
);
create index match_players_match_idx on match_players (match_id);
create index match_players_member_idx on match_players (member_id);

create table match_sets (
  id           bigint generated always as identity primary key,
  match_id     bigint not null references matches(id) on delete cascade,
  set_number   smallint not null check (set_number between 1 and 5),
  side1_games  smallint not null check (side1_games between 0 and 99),
  side2_games  smallint not null check (side2_games between 0 and 99),
  unique (match_id, set_number)
);
