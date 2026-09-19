-- Frameup NFL Pick'em -- seed the 32 real NFL teams.
--
-- Team names/cities/abbreviations are public facts, not provider-owned
-- data, so seeding them directly (rather than waiting on a chosen NFL
-- data provider) is what makes the admin "create a game" flow usable at
-- all in V1 -- otherwise every game would need its two teams typed in by
-- hand first. provider='manual' matches pickem_admin_create_game's own
-- provider tag; provider_team_id is just the lowercase abbreviation,
-- unique and stable enough to re-run this file safely (ON CONFLICT DO
-- NOTHING). logo_url/colors are left null -- PRD 20.3 requires the UI to
-- be able to fall back to plain team name/abbreviation when logo usage
-- isn't cleared, so this is a valid starting state, not a gap to block on.

insert into public.pickem_teams (provider, provider_team_id, abbreviation, city, name) values
  ('manual', 'ari', 'ARI', 'Arizona', 'Cardinals'),
  ('manual', 'atl', 'ATL', 'Atlanta', 'Falcons'),
  ('manual', 'bal', 'BAL', 'Baltimore', 'Ravens'),
  ('manual', 'buf', 'BUF', 'Buffalo', 'Bills'),
  ('manual', 'car', 'CAR', 'Carolina', 'Panthers'),
  ('manual', 'chi', 'CHI', 'Chicago', 'Bears'),
  ('manual', 'cin', 'CIN', 'Cincinnati', 'Bengals'),
  ('manual', 'cle', 'CLE', 'Cleveland', 'Browns'),
  ('manual', 'dal', 'DAL', 'Dallas', 'Cowboys'),
  ('manual', 'den', 'DEN', 'Denver', 'Broncos'),
  ('manual', 'det', 'DET', 'Detroit', 'Lions'),
  ('manual', 'gb', 'GB', 'Green Bay', 'Packers'),
  ('manual', 'hou', 'HOU', 'Houston', 'Texans'),
  ('manual', 'ind', 'IND', 'Indianapolis', 'Colts'),
  ('manual', 'jax', 'JAX', 'Jacksonville', 'Jaguars'),
  ('manual', 'kc', 'KC', 'Kansas City', 'Chiefs'),
  ('manual', 'lv', 'LV', 'Las Vegas', 'Raiders'),
  ('manual', 'lac', 'LAC', 'Los Angeles', 'Chargers'),
  ('manual', 'lar', 'LAR', 'Los Angeles', 'Rams'),
  ('manual', 'mia', 'MIA', 'Miami', 'Dolphins'),
  ('manual', 'min', 'MIN', 'Minnesota', 'Vikings'),
  ('manual', 'ne', 'NE', 'New England', 'Patriots'),
  ('manual', 'no', 'NO', 'New Orleans', 'Saints'),
  ('manual', 'nyg', 'NYG', 'New York', 'Giants'),
  ('manual', 'nyj', 'NYJ', 'New York', 'Jets'),
  ('manual', 'phi', 'PHI', 'Philadelphia', 'Eagles'),
  ('manual', 'pit', 'PIT', 'Pittsburgh', 'Steelers'),
  ('manual', 'sf', 'SF', 'San Francisco', '49ers'),
  ('manual', 'sea', 'SEA', 'Seattle', 'Seahawks'),
  ('manual', 'tb', 'TB', 'Tampa Bay', 'Buccaneers'),
  ('manual', 'ten', 'TEN', 'Tennessee', 'Titans'),
  ('manual', 'was', 'WAS', 'Washington', 'Commanders')
on conflict (provider, provider_team_id) do nothing;
