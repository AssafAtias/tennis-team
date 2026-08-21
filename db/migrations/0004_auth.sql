create table login_tokens (
  id          bigint generated always as identity primary key,
  member_id   bigint not null references members(id) on delete cascade,
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index login_tokens_member_idx on login_tokens (member_id, created_at desc);

create table sessions (
  id           bigint generated always as identity primary key,
  member_id    bigint not null references members(id) on delete cascade,
  token_hash   bytea not null unique,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  user_agent   text
);
create index sessions_member_idx on sessions (member_id);
create index sessions_expiry_idx on sessions (expires_at);
