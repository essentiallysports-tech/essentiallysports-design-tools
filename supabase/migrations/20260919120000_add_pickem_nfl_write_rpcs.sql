-- Frameup NFL Pick'em -- Phase 2/3 (lean): secure picking + scoring + admin
-- schedule management, all in one migration so the game is actually
-- playable end-to-end without a live NFL data provider yet.
--
-- No provider integration exists (PRD's own "HANDOFF NOTE": the provider
-- choice is the one external decision still open). Rather than block the
-- whole game on that decision, this migration implements the PRD's own
-- documented fallback path (15.4: "Provider unavailable for schedule
-- import | Admin can manually create/update a game", "...at final | Admin
-- can enter score + status manually") as the *only* path for V1: admin
-- RPCs create seasons/weeks/games and enter final scores by hand. When a
-- real provider is chosen later, its Edge Function can write to the same
-- tables (pickem_games etc.) and none of this changes.
--
-- Display names: no public consumer profile table exists yet (see the
-- previous migration's header note). Leaderboard functions below derive a
-- display name from auth.users.email (the part before '@'), the same
-- fallback pattern already used in handle_es_designer_user_created(). This
-- is a V1 stopgap, not a design decision -- swap it for a real profile
-- join whenever Frameup gets a public profile table.
--
-- All functions are `security definer` with `search_path` pinned, per PRD
-- 13.6 and this repo's existing convention.

-- =====================================================================
-- 1) Entry-progress helper (shared by the pick RPC, the week-payload read,
--    and pickem_complete_week so "complete" means the same thing in all
--    three places)
-- =====================================================================

create or replace function public.pickem_get_entry_progress(p_user_id uuid, p_week_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_available_total int;
  v_picked_available int;
  v_missed int;
  v_primary_game_id uuid;
  v_secondary_game_id uuid;
  v_primary_needed boolean := false;
  v_primary_present boolean := false;
  v_complete boolean;
begin
  -- "Available" = games not yet locked, regardless of pick status (PRD's
  -- LATE JOINER RULE: completion is measured against what's still
  -- available *right now*, not the original full slate).
  select count(*) into v_available_total
  from public.pickem_games g
  where g.week_id = p_week_id
    and g.status not in ('canceled', 'no_contest')
    and g.kickoff_at > now();

  select count(*) into v_picked_available
  from public.pickem_games g
  join public.pickem_picks pk on pk.game_id = g.id and pk.user_id = p_user_id
  where g.week_id = p_week_id
    and g.status not in ('canceled', 'no_contest')
    and g.kickoff_at > now();

  select count(*) into v_missed
  from public.pickem_games g
  left join public.pickem_picks pk on pk.game_id = g.id and pk.user_id = p_user_id
  where g.week_id = p_week_id
    and g.status not in ('canceled', 'no_contest')
    and g.kickoff_at <= now()
    and pk.id is null;

  select primary_tiebreak_game_id into v_primary_game_id
  from public.pickem_weeks where id = p_week_id;

  if v_primary_game_id is not null then
    select (kickoff_at > now()) into v_primary_needed
    from public.pickem_games where id = v_primary_game_id;
  end if;

  if v_primary_needed then
    select (primary_home_prediction is not null and primary_away_prediction is not null)
      into v_primary_present
    from public.pickem_entries
    where user_id = p_user_id and week_id = p_week_id;
    v_primary_present := coalesce(v_primary_present, false);
  end if;

  v_complete := (v_picked_available = v_available_total) and (not v_primary_needed or v_primary_present);

  return jsonb_build_object(
    'available_total', v_available_total,
    'picked_available', v_picked_available,
    'missed', v_missed,
    'complete', v_complete,
    'tiebreaker_needed', v_primary_needed,
    'tiebreaker_present', v_primary_present
  );
end;
$function$;

-- =====================================================================
-- 2) Pick RPC (PRD Appendix A.5 / 13.3)
-- =====================================================================

create or replace function public.pickem_set_pick(p_game_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_game record;
  v_entry_id uuid;
  v_old_team_id uuid;
  v_progress jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'code', 'AUTH_REQUIRED', 'message', 'Sign in to save your picks and join the leaderboard.');
  end if;

  select id, week_id, home_team_id, away_team_id, kickoff_at, status
    into v_game
  from public.pickem_games
  where id = p_game_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'GAME_NOT_FOUND', 'message', 'That game does not exist.');
  end if;

  if v_game.status in ('canceled', 'no_contest') then
    return jsonb_build_object('success', false, 'code', 'GAME_VOID', 'message', 'This game is not scored. Picks are disabled.');
  end if;

  if p_team_id not in (v_game.home_team_id, v_game.away_team_id) then
    return jsonb_build_object('success', false, 'code', 'INVALID_TEAM', 'message', 'That team is not in this game.');
  end if;

  if now() >= v_game.kickoff_at then
    return jsonb_build_object(
      'success', false, 'code', 'GAME_LOCKED',
      'message', 'This game has already started. Your pick is locked.',
      'server_time', now(), 'lock_at', v_game.kickoff_at
    );
  end if;

  insert into public.pickem_entries (user_id, week_id)
  values (v_uid, v_game.week_id)
  on conflict (user_id, week_id) do nothing;

  select id into v_entry_id
  from public.pickem_entries
  where user_id = v_uid and week_id = v_game.week_id;

  select selected_team_id into v_old_team_id
  from public.pickem_picks
  where user_id = v_uid and game_id = p_game_id;

  if v_old_team_id is not null and v_old_team_id <> p_team_id then
    insert into public.pickem_pick_history (user_id, game_id, old_team_id, new_team_id)
    values (v_uid, p_game_id, v_old_team_id, p_team_id);
  elsif v_old_team_id is null then
    insert into public.pickem_pick_history (user_id, game_id, old_team_id, new_team_id)
    values (v_uid, p_game_id, null, p_team_id);
  end if;

  insert into public.pickem_picks (entry_id, user_id, game_id, selected_team_id, updated_at)
  values (v_entry_id, v_uid, p_game_id, p_team_id, now())
  on conflict (user_id, game_id)
  do update set selected_team_id = excluded.selected_team_id, updated_at = now();

  update public.pickem_entries
  set status = case when status = 'not_started' then 'in_progress' else status end,
      updated_at = now()
  where id = v_entry_id;

  v_progress := public.pickem_get_entry_progress(v_uid, v_game.week_id);

  return jsonb_build_object(
    'success', true,
    'pick', jsonb_build_object('game_id', p_game_id, 'selected_team_id', p_team_id, 'result', 'pending'),
    'server_time', now(),
    'lock_at', v_game.kickoff_at,
    'entry', v_progress
  );
end;
$function$;

-- =====================================================================
-- 3) Tiebreaker RPC
-- =====================================================================

create or replace function public.pickem_set_tiebreaker(
  p_week_id uuid,
  p_primary_home int default null,
  p_primary_away int default null,
  p_secondary_home int default null,
  p_secondary_away int default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_week record;
  v_primary_kickoff timestamptz;
  v_secondary_kickoff timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'code', 'AUTH_REQUIRED', 'message', 'Sign in to save your tiebreaker.');
  end if;

  select id, primary_tiebreak_game_id, secondary_tiebreak_game_id
    into v_week
  from public.pickem_weeks
  where id = p_week_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'WEEK_NOT_FOUND', 'message', 'That week does not exist.');
  end if;

  if (p_primary_home is not null or p_primary_away is not null) then
    if v_week.primary_tiebreak_game_id is null then
      return jsonb_build_object('success', false, 'code', 'NO_TIEBREAK_GAME', 'message', 'No primary tiebreaker game is set for this week yet.');
    end if;
    select kickoff_at into v_primary_kickoff from public.pickem_games where id = v_week.primary_tiebreak_game_id;
    if now() >= v_primary_kickoff then
      return jsonb_build_object('success', false, 'code', 'GAME_LOCKED', 'message', 'The primary tiebreaker game has already started.');
    end if;
    if p_primary_home not between 0 and 99 or p_primary_away not between 0 and 99 then
      return jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'Enter a score between 0 and 99.');
    end if;
  end if;

  if (p_secondary_home is not null or p_secondary_away is not null) then
    if v_week.secondary_tiebreak_game_id is null then
      return jsonb_build_object('success', false, 'code', 'NO_TIEBREAK_GAME', 'message', 'No backup tiebreaker game is set for this week yet.');
    end if;
    select kickoff_at into v_secondary_kickoff from public.pickem_games where id = v_week.secondary_tiebreak_game_id;
    if now() >= v_secondary_kickoff then
      return jsonb_build_object('success', false, 'code', 'GAME_LOCKED', 'message', 'The backup tiebreaker game has already started.');
    end if;
    if p_secondary_home not between 0 and 99 or p_secondary_away not between 0 and 99 then
      return jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'Enter a score between 0 and 99.');
    end if;
  end if;

  insert into public.pickem_entries (user_id, week_id, primary_home_prediction, primary_away_prediction, secondary_home_prediction, secondary_away_prediction)
  values (v_uid, p_week_id, p_primary_home, p_primary_away, p_secondary_home, p_secondary_away)
  on conflict (user_id, week_id) do update
  set primary_home_prediction = coalesce(excluded.primary_home_prediction, public.pickem_entries.primary_home_prediction),
      primary_away_prediction = coalesce(excluded.primary_away_prediction, public.pickem_entries.primary_away_prediction),
      secondary_home_prediction = coalesce(excluded.secondary_home_prediction, public.pickem_entries.secondary_home_prediction),
      secondary_away_prediction = coalesce(excluded.secondary_away_prediction, public.pickem_entries.secondary_away_prediction),
      updated_at = now();

  return jsonb_build_object('success', true, 'entry', public.pickem_get_entry_progress(v_uid, p_week_id));
end;
$function$;

-- =====================================================================
-- 4) Complete-week RPC
-- =====================================================================

create or replace function public.pickem_complete_week(p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_progress jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'code', 'AUTH_REQUIRED', 'message', 'Sign in to complete your week.');
  end if;

  v_progress := public.pickem_get_entry_progress(v_uid, p_week_id);

  if not (v_progress->>'complete')::boolean then
    return jsonb_build_object('success', false, 'code', 'INCOMPLETE', 'message', 'Finish your available picks first.', 'entry', v_progress);
  end if;

  update public.pickem_entries
  set status = 'complete', completed_at = now(), updated_at = now()
  where user_id = v_uid and week_id = p_week_id;

  return jsonb_build_object('success', true, 'entry', v_progress);
end;
$function$;

-- =====================================================================
-- 5) Lock trigger -- defense in depth (PRD A.6). The RPC above already
--    enforces the lock; this makes the invariant true even for a future
--    privileged code path that writes pickem_picks directly.
-- =====================================================================

create or replace function public.pickem_enforce_pick_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_game record;
begin
  select home_team_id, away_team_id, kickoff_at, status into v_game
  from public.pickem_games where id = new.game_id;

  if not found then
    raise exception 'pickem: unknown game_id %', new.game_id;
  end if;

  if now() >= v_game.kickoff_at then
    raise exception 'pickem: game % is locked (kickoff %)', new.game_id, v_game.kickoff_at;
  end if;

  if new.selected_team_id not in (v_game.home_team_id, v_game.away_team_id) then
    raise exception 'pickem: team % is not in game %', new.selected_team_id, new.game_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists pickem_picks_enforce_lock on public.pickem_picks;
create trigger pickem_picks_enforce_lock
before insert or update on public.pickem_picks
for each row execute function public.pickem_enforce_pick_lock();

-- =====================================================================
-- 6) Scoring
-- =====================================================================

create or replace function public.pickem_finalize_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_game record;
begin
  select status, home_score, away_score, winner_team_id into v_game
  from public.pickem_games where id = p_game_id;

  if not found then
    raise exception 'pickem: unknown game_id %', p_game_id;
  end if;

  if v_game.status in ('canceled', 'no_contest') or (v_game.home_score is not null and v_game.home_score = v_game.away_score) then
    update public.pickem_picks set result = 'void', points = 0, updated_at = now() where game_id = p_game_id;
    return;
  end if;

  if v_game.status <> 'final' or v_game.winner_team_id is null then
    return;
  end if;

  update public.pickem_picks
  set result = case when selected_team_id = v_game.winner_team_id then 'correct' else 'incorrect' end,
      points = case when selected_team_id = v_game.winner_team_id then 1 else 0 end,
      updated_at = now()
  where game_id = p_game_id;
end;
$function$;

create or replace function public.pickem_recalculate_week(p_week_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_primary_game_id uuid;
  v_secondary_game_id uuid;
begin
  select primary_tiebreak_game_id, secondary_tiebreak_game_id
    into v_primary_game_id, v_secondary_game_id
  from public.pickem_weeks where id = p_week_id;

  with primary_game as (
    select home_score, away_score from public.pickem_games
    where id = v_primary_game_id and status = 'final' and home_score is not null
  ),
  secondary_game as (
    select home_score, away_score from public.pickem_games
    where id = v_secondary_game_id and status = 'final' and home_score is not null
  ),
  entry_rows as (
    select
      e.user_id,
      e.primary_home_prediction, e.primary_away_prediction,
      e.secondary_home_prediction, e.secondary_away_prediction,
      coalesce((select count(*) from public.pickem_picks pk where pk.user_id = e.user_id and pk.result = 'correct'
                and pk.game_id in (select id from public.pickem_games where week_id = p_week_id)), 0) as correct_count,
      coalesce((select count(*) from public.pickem_picks pk where pk.user_id = e.user_id and pk.result = 'incorrect'
                and pk.game_id in (select id from public.pickem_games where week_id = p_week_id)), 0) as incorrect_count,
      coalesce((select count(*) from public.pickem_picks pk where pk.user_id = e.user_id and pk.result = 'pending'
                and pk.game_id in (select id from public.pickem_games where week_id = p_week_id)), 0) as pending_count,
      coalesce((select count(*) from public.pickem_picks pk where pk.user_id = e.user_id and pk.result = 'void'
                and pk.game_id in (select id from public.pickem_games where week_id = p_week_id)), 0) as void_count,
      coalesce((select count(*) from public.pickem_picks pk where pk.user_id = e.user_id
                and pk.game_id in (select id from public.pickem_games where week_id = p_week_id)), 0) as picks_made,
      coalesce((select count(*) from public.pickem_games g
                left join public.pickem_picks pk on pk.game_id = g.id and pk.user_id = e.user_id
                where g.week_id = p_week_id and g.status not in ('canceled', 'no_contest')
                  and g.kickoff_at <= now() and pk.id is null), 0) as missed_count
    from public.pickem_entries e
    where e.week_id = p_week_id
  ),
  scored as (
    select
      er.*,
      case when (select home_score from primary_game) is not null then
        abs((coalesce(er.primary_home_prediction, 0) + coalesce(er.primary_away_prediction, 0))
          - ((select home_score from primary_game) + (select away_score from primary_game)))
      end as primary_total_error,
      case when (select home_score from primary_game) is not null then
        abs(coalesce(er.primary_home_prediction, 0) - (select home_score from primary_game))
        + abs(coalesce(er.primary_away_prediction, 0) - (select away_score from primary_game))
      end as primary_team_error,
      case when (select home_score from secondary_game) is not null then
        abs((coalesce(er.secondary_home_prediction, 0) + coalesce(er.secondary_away_prediction, 0))
          - ((select home_score from secondary_game) + (select away_score from secondary_game)))
      end as secondary_total_error,
      case when (select home_score from secondary_game) is not null then
        abs(coalesce(er.secondary_home_prediction, 0) - (select home_score from secondary_game))
        + abs(coalesce(er.secondary_away_prediction, 0) - (select away_score from secondary_game))
      end as secondary_team_error
    from entry_rows er
  ),
  ranked as (
    select
      *,
      rank() over (
        order by correct_count desc,
          -- Users with no valid tiebreaker rank behind users who have one,
          -- but still score normally (PRD 5.3) -- nulls last achieves that
          -- since a real error value beats "no prediction" on a tie.
          primary_total_error asc nulls last,
          primary_team_error asc nulls last,
          secondary_total_error asc nulls last,
          secondary_team_error asc nulls last
      ) as rnk
    from scored
  )
  insert into public.pickem_weekly_stats (
    week_id, user_id, correct_count, incorrect_count, pending_count, missed_count, void_count,
    picks_made, rank, primary_total_error, primary_team_error, secondary_total_error, secondary_team_error, updated_at
  )
  select
    p_week_id, user_id, correct_count, incorrect_count, pending_count, missed_count, void_count,
    picks_made, rnk, primary_total_error, primary_team_error, secondary_total_error, secondary_team_error, now()
  from ranked
  on conflict (week_id, user_id) do update set
    correct_count = excluded.correct_count,
    incorrect_count = excluded.incorrect_count,
    pending_count = excluded.pending_count,
    missed_count = excluded.missed_count,
    void_count = excluded.void_count,
    picks_made = excluded.picks_made,
    rank = excluded.rank,
    primary_total_error = excluded.primary_total_error,
    primary_team_error = excluded.primary_team_error,
    secondary_total_error = excluded.secondary_total_error,
    secondary_team_error = excluded.secondary_team_error,
    updated_at = now();

  -- Season aggregate: correct_count/picks_made summed across every week in
  -- the season, ranked the same "competition ranking" way (ties share
  -- rank). Season ties are decided by correct picks only (PRD 5.4) -- no
  -- tiebreaker error carries over between weeks.
  insert into public.pickem_season_stats (season_id, user_id, correct_count, picks_made, resolved_picks, weekly_wins, rank, updated_at)
  select
    w.season_id,
    ws.user_id,
    sum(ws.correct_count),
    sum(ws.picks_made),
    sum(ws.correct_count + ws.incorrect_count),
    sum(case when ws.rank = 1 then 1 else 0 end),
    rank() over (order by sum(ws.correct_count) desc),
    now()
  from public.pickem_weekly_stats ws
  join public.pickem_weeks w on w.id = ws.week_id
  where w.season_id = (select season_id from public.pickem_weeks where id = p_week_id)
  group by w.season_id, ws.user_id
  on conflict (season_id, user_id) do update set
    correct_count = excluded.correct_count,
    picks_made = excluded.picks_made,
    resolved_picks = excluded.resolved_picks,
    weekly_wins = excluded.weekly_wins,
    rank = excluded.rank,
    updated_at = now();
end;
$function$;

-- =====================================================================
-- 7) Admin schedule/score management (replaces the not-yet-chosen
--    provider's Edge Function for V1 -- see header note)
-- =====================================================================

create or replace function public.pickem_admin_create_season(p_year int, p_season_type text default 'REGULAR')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_pickem_admin() then
    return jsonb_build_object('success', false, 'code', 'ADMIN_REQUIRED', 'message', 'Admin access required.');
  end if;

  insert into public.pickem_seasons (league, year, season_type, status)
  values ('NFL', p_year, p_season_type, 'open')
  on conflict (league, year, season_type) do update set status = public.pickem_seasons.status
  returning id into v_id;

  return jsonb_build_object('success', true, 'season_id', v_id);
end;
$function$;

create or replace function public.pickem_admin_create_week(p_season_id uuid, p_week_number int, p_label text default null, p_opens_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_pickem_admin() then
    return jsonb_build_object('success', false, 'code', 'ADMIN_REQUIRED', 'message', 'Admin access required.');
  end if;

  insert into public.pickem_weeks (season_id, week_number, label, status, opens_at)
  values (p_season_id, p_week_number, p_label, 'open', p_opens_at)
  on conflict (season_id, week_number) do update set label = excluded.label
  returning id into v_id;

  perform public.pickem_admin_log('create_week', 'pickem_weeks', v_id::text, null, jsonb_build_object('week_number', p_week_number, 'label', p_label), 'Week created/opened by admin');

  return jsonb_build_object('success', true, 'week_id', v_id);
end;
$function$;

create or replace function public.pickem_admin_create_game(p_week_id uuid, p_home_team_id uuid, p_away_team_id uuid, p_kickoff_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_pickem_admin() then
    return jsonb_build_object('success', false, 'code', 'ADMIN_REQUIRED', 'message', 'Admin access required.');
  end if;

  if p_home_team_id = p_away_team_id then
    return jsonb_build_object('success', false, 'code', 'INVALID_TEAMS', 'message', 'Home and away team must differ.');
  end if;

  insert into public.pickem_games (week_id, provider, provider_game_id, home_team_id, away_team_id, kickoff_at, status)
  values (p_week_id, 'manual', gen_random_uuid()::text, p_home_team_id, p_away_team_id, p_kickoff_at, 'scheduled')
  returning id into v_id;

  perform public.pickem_admin_log('create_game', 'pickem_games', v_id::text, null, jsonb_build_object('week_id', p_week_id, 'kickoff_at', p_kickoff_at), 'Game manually created by admin');

  return jsonb_build_object('success', true, 'game_id', v_id);
end;
$function$;

create or replace function public.pickem_admin_set_tiebreak_games(p_week_id uuid, p_primary_game_id uuid, p_secondary_game_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_pickem_admin() then
    return jsonb_build_object('success', false, 'code', 'ADMIN_REQUIRED', 'message', 'Admin access required.');
  end if;

  update public.pickem_weeks
  set primary_tiebreak_game_id = p_primary_game_id,
      secondary_tiebreak_game_id = p_secondary_game_id
  where id = p_week_id;

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.pickem_admin_set_final_score(p_game_id uuid, p_home_score int, p_away_score int, p_status text default 'final', p_reason text default 'Admin score entry')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_week_id uuid;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_winner uuid;
  v_old jsonb;
begin
  if not public.is_pickem_admin() then
    return jsonb_build_object('success', false, 'code', 'ADMIN_REQUIRED', 'message', 'Admin access required.');
  end if;

  select week_id, home_team_id, away_team_id, to_jsonb(g) into v_week_id, v_home_team_id, v_away_team_id, v_old
  from public.pickem_games g where id = p_game_id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'GAME_NOT_FOUND', 'message', 'That game does not exist.');
  end if;

  if p_status = 'final' and p_home_score is not null and p_away_score is not null and p_home_score <> p_away_score then
    v_winner := case when p_home_score > p_away_score then v_home_team_id else v_away_team_id end;
  else
    v_winner := null;
  end if;

  update public.pickem_games
  set home_score = p_home_score,
      away_score = p_away_score,
      status = p_status,
      winner_team_id = v_winner,
      scoring_status = case when p_status = 'final' then 'confirmed' else scoring_status end,
      result_confirmed_at = case when p_status = 'final' then now() else result_confirmed_at end,
      needs_admin_review = false,
      updated_at = now()
  where id = p_game_id;

  perform public.pickem_finalize_game(p_game_id);
  perform public.pickem_recalculate_week(v_week_id);

  perform public.pickem_admin_log(
    'set_final_score', 'pickem_games', p_game_id::text, v_old,
    jsonb_build_object('home_score', p_home_score, 'away_score', p_away_score, 'status', p_status),
    p_reason
  );

  return jsonb_build_object('success', true, 'game_id', p_game_id, 'winner_team_id', v_winner);
end;
$function$;

create or replace function public.pickem_admin_void_game(p_game_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_week_id uuid;
  v_old jsonb;
begin
  if not public.is_pickem_admin() then
    return jsonb_build_object('success', false, 'code', 'ADMIN_REQUIRED', 'message', 'Admin access required.');
  end if;

  select week_id, to_jsonb(g) into v_week_id, v_old from public.pickem_games g where id = p_game_id;
  if not found then
    return jsonb_build_object('success', false, 'code', 'GAME_NOT_FOUND', 'message', 'That game does not exist.');
  end if;

  update public.pickem_games
  set status = 'no_contest', winner_team_id = null, scoring_status = 'void', updated_at = now()
  where id = p_game_id;

  perform public.pickem_finalize_game(p_game_id);
  perform public.pickem_recalculate_week(v_week_id);
  perform public.pickem_admin_log('void_game', 'pickem_games', p_game_id::text, v_old, jsonb_build_object('status', 'no_contest'), p_reason);

  return jsonb_build_object('success', true);
end;
$function$;

-- Small helper so every admin action logs consistently (PRD 16.3/16.4:
-- every destructive action needs an audited reason).
create or replace function public.pickem_admin_log(p_action text, p_entity_type text, p_entity_id text, p_old jsonb, p_new jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.pickem_admin_audit_log (actor_user_id, action_type, entity_type, entity_id, old_value, new_value, reason)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, p_old, p_new, p_reason);
end;
$function$;

-- =====================================================================
-- 8) Reads: current-week payload + leaderboards
-- =====================================================================

create or replace function public.pickem_get_week_payload(p_week_id uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_week record;
  v_season record;
  v_games jsonb;
  v_entry jsonb;
begin
  if p_week_id is null then
    select * into v_week from public.pickem_weeks
    where status in ('open', 'in_progress', 'provisional')
    order by week_number desc limit 1;
  else
    select * into v_week from public.pickem_weeks where id = p_week_id;
  end if;

  if not found or v_week.id is null then
    return jsonb_build_object('season', null, 'week', null, 'entry', null, 'games', '[]'::jsonb);
  end if;

  select * into v_season from public.pickem_seasons where id = v_week.season_id;

  select jsonb_agg(jsonb_build_object(
    'id', g.id,
    'kickoff_at', g.kickoff_at,
    'status', g.status,
    'home', jsonb_build_object('id', ht.id, 'abbr', ht.abbreviation, 'name', ht.name, 'logo_url', ht.logo_url, 'score', g.home_score),
    'away', jsonb_build_object('id', awt.id, 'abbr', awt.abbreviation, 'name', awt.name, 'logo_url', awt.logo_url, 'score', g.away_score),
    'winner_team_id', g.winner_team_id,
    'my_pick_team_id', (select pk.selected_team_id from public.pickem_picks pk where pk.game_id = g.id and pk.user_id = v_uid),
    'my_pick_result', (select pk.result from public.pickem_picks pk where pk.game_id = g.id and pk.user_id = v_uid),
    'locked', (now() >= g.kickoff_at),
    'is_primary_tiebreak', (g.id = v_week.primary_tiebreak_game_id),
    'is_secondary_tiebreak', (g.id = v_week.secondary_tiebreak_game_id)
  ) order by g.kickoff_at)
  into v_games
  from public.pickem_games g
  join public.pickem_teams ht on ht.id = g.home_team_id
  join public.pickem_teams awt on awt.id = g.away_team_id
  where g.week_id = v_week.id;

  if v_uid is not null then
    select jsonb_build_object(
      'status', e.status,
      'primary_home_prediction', e.primary_home_prediction,
      'primary_away_prediction', e.primary_away_prediction,
      'secondary_home_prediction', e.secondary_home_prediction,
      'secondary_away_prediction', e.secondary_away_prediction
    ) || public.pickem_get_entry_progress(v_uid, v_week.id)
    into v_entry
    from public.pickem_entries e
    where e.user_id = v_uid and e.week_id = v_week.id;

    if v_entry is null then
      v_entry := jsonb_build_object('status', 'not_started') || public.pickem_get_entry_progress(v_uid, v_week.id);
    end if;
  end if;

  return jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'year', v_season.year, 'league', v_season.league),
    'week', jsonb_build_object('id', v_week.id, 'number', v_week.week_number, 'label', v_week.label, 'status', v_week.status,
      'primary_tiebreak_game_id', v_week.primary_tiebreak_game_id, 'secondary_tiebreak_game_id', v_week.secondary_tiebreak_game_id),
    'entry', v_entry,
    'games', coalesce(v_games, '[]'::jsonb)
  );
end;
$function$;

create or replace function public.pickem_get_weekly_leaderboard(p_week_id uuid, p_limit int default 50)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select
      ws.rank,
      ws.user_id,
      split_part(coalesce(u.email, ''), '@', 1) as display_name,
      ws.correct_count,
      ws.picks_made,
      ws.missed_count,
      (ws.user_id = (select auth.uid())) as is_current_user
    from public.pickem_weekly_stats ws
    join auth.users u on u.id = ws.user_id
    where ws.week_id = p_week_id
    order by ws.rank asc nulls last, ws.correct_count desc
    limit p_limit
  ) t;
$function$;

create or replace function public.pickem_get_season_leaderboard(p_season_id uuid, p_limit int default 50)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select
      ss.rank,
      ss.user_id,
      split_part(coalesce(u.email, ''), '@', 1) as display_name,
      ss.correct_count,
      ss.picks_made,
      ss.weekly_wins,
      (ss.user_id = (select auth.uid())) as is_current_user
    from public.pickem_season_stats ss
    join auth.users u on u.id = ss.user_id
    where ss.season_id = p_season_id
    order by ss.rank asc nulls last, ss.correct_count desc
    limit p_limit
  ) t;
$function$;

-- =====================================================================
-- 9) Grants -- execute on the RPCs. No table-level write grant is added
--    for pickem_entries/pickem_picks; these functions are security
--    definer so they don't need one, which is exactly the point.
-- =====================================================================

grant execute on function public.pickem_get_entry_progress(uuid, uuid) to authenticated;
grant execute on function public.pickem_set_pick(uuid, uuid) to authenticated;
grant execute on function public.pickem_set_tiebreaker(uuid, int, int, int, int) to authenticated;
grant execute on function public.pickem_complete_week(uuid) to authenticated;
grant execute on function public.pickem_get_week_payload(uuid) to anon, authenticated;
grant execute on function public.pickem_get_weekly_leaderboard(uuid, int) to anon, authenticated;
grant execute on function public.pickem_get_season_leaderboard(uuid, int) to anon, authenticated;

grant execute on function public.pickem_admin_create_season(int, text) to authenticated;
grant execute on function public.pickem_admin_create_week(uuid, int, text, timestamptz) to authenticated;
grant execute on function public.pickem_admin_create_game(uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.pickem_admin_set_tiebreak_games(uuid, uuid, uuid) to authenticated;
grant execute on function public.pickem_admin_set_final_score(uuid, int, int, text, text) to authenticated;
grant execute on function public.pickem_admin_void_game(uuid, text) to authenticated;

-- pickem_teams needs to be writable by admins too (there's no provider
-- sync to populate it yet) -- add the one INSERT policy this phase needs.
drop policy if exists "Admins can add pickem teams" on public.pickem_teams;
create policy "Admins can add pickem teams"
on public.pickem_teams
for insert
to authenticated
with check (public.is_pickem_admin());

grant insert on public.pickem_teams to authenticated;
