create table availability (
  member_id bigint not null references members(id) on delete cascade,
  weekday   smallint not null check (weekday between 0 and 6),
  block     text not null check (block in ('morning','afternoon','evening')),
  primary key (member_id, weekday, block)
);
create index availability_slot_idx on availability (weekday, block);
