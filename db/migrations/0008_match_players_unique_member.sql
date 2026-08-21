create unique index match_players_unique_member_idx
  on match_players (match_id, member_id) where member_id is not null;
