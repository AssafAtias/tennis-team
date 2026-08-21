create table player_profiles (
  member_id        bigint primary key references members(id) on delete cascade,
  display_name     text not null check (length(trim(display_name)) between 1 and 60),
  nickname         text check (length(nickname) <= 40),
  phone            text check (length(phone) <= 32),
  photo_key        text,
  dominant_hand    text check (dominant_hand in ('left','right')),
  backhand         text check (backhand in ('one','two')),
  preferred_format text check (preferred_format in ('singles','doubles','both')),
  rating_system    text not null default 'none' check (rating_system in ('utr','ntrp','club','none')),
  rating_value     text check (length(rating_value) <= 16),
  racquet          text check (length(racquet) <= 80),
  bio              text check (length(bio) <= 500),
  updated_at       timestamptz not null default now(),
  constraint rating_value_requires_system
    check (rating_system <> 'none' or rating_value is null)
);
