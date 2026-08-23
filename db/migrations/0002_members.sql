create table members (
  id            bigint generated always as identity primary key,
  email         citext not null unique,
  role          text   not null default 'player' check (role in ('admin','player')),
  status        text   not null default 'invited' check (status in ('invited','active','removed')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create index members_status_idx on members (status);
