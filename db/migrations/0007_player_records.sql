create view player_records as
select
  m.id as member_id,
  count(mp.id) as matches_played,
  count(*) filter (where mp.side = mt.winner_side) as wins,
  count(*) filter (where mp.id is not null and mp.side <> mt.winner_side) as losses
from members m
left join match_players mp on mp.member_id = m.id
left join matches mt on mt.id = mp.match_id
group by m.id;
