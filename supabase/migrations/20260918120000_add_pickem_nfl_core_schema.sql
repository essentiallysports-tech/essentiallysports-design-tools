-- Frameup NFL Pick'em -- Phase 1: data foundation.
--
-- Adds the full pickem_* schema from the NFL Pick'em PRD (Appendix A,
-- adapted to this project's existing conventions -- e.g. es_designer_*
-- migrations' idempotent "drop policy if exists" + "create policy" style,
-- and the (select auth.uid())/(select auth.jwt()) RLS performance pattern
-- from 20260910070000_fix_dashboard_rls_performance.sql, applied here from
-- the start rather than retrofitted later).
--
-- Scope is intentionally schema-only ("Phase 1: Data foundation" per the
-- PRD's section 23.1 build sequence). It does NOT include:
--   - The pick-writing RPCs (pickem_set_pick, pickem_set_tiebreaker,
--     pickem_complete_week) or the BEFORE INSERT/UPDATE lock trigger --
--     that is Phase 2 ("Secure picking").
--   - Scoring/aggregation functions -- Phase 3.
--   - Any INSERT/UPDATE/DELETE policy on pickem_entries or pickem_picks
--     for the `authenticated` role. This is deliberate and load-bearing:
--     PRD section 13.2 "WRITE RULE" requires those tables to be written
--     only through narrowly-scoped RPCs, never direct client writes. RLS
--     below only ever grants SELECT to players on their own rows; write
--     access is added when the RPCs land in Phase 2.
--
-- Table names keep the PRD's own `pickem_` prefix (not this repo's usual
-- `es_designer_` prefix) since the entire 23-section PRD -- route names,
-- RPC contracts, JSON payloads, error codes -- is written assuming these
-- exact table names; renaming them would desync the spec from the schema
-- for every future phase.
--
-- Player identity: PRD 3.1 says to reuse Frameup's existing public profile
-- table for display_name/avatar if one exists. This repo's only profile
-- table today is es_designer_profiles, which is scoped to the internal
-- design-tools admin dashboard (ES staff only, email-keyed) and is not
-- the right identity store for a public NFL-fan-facing game. No public
-- consumer profile table exists yet, so leaderboard display fields are
-- left for whoever builds the leaderboard query/read RPC (Phase 5) to
-- source from auth.users metadata or a new profile table -- not decided
-- here to avoid inventing an identity system this PRD didn't ask for.

-- =====================================================================
-- 1) Core content: seasons, teams, weeks, games
-- =====================================================================

create table if not exists public.pickem_seasons (
  id uuid primary key default gen_random_uuid(),
  league text not null default 'NFL',
  year int not null,
  season_type text not null default 'REGULAR',
  status text not null default 'draft'
    check (status in ('draft', 'open', 'in_progress', 'final', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (league, year, season_type)
);

create table if not exists public.pickem_teams (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_team_id text not null,
  abbreviation text not null,
  city text,
  name text not null,
  logo_url text,
  primary_color text,
  secondary_color text,
  active boolean not null default true,
  unique (provider, provider_team_id)
);

-- primary/secondary_tiebreak_game_id intentionally have no FK yet: pickem_games
-- doesn't exist until the next block. The FK is added via ALTER TABLE below,
-- matching the PRD's own Appendix A ordering (plain uuid columns first).
create table if not exists public.pickem_weeks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.pickem_seasons(id) on delete cascade,
  week_number int not null,
  label text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'in_progress', 'provisional', 'final', 'archived')),
  opens_at timestamptz,
  primary_tiebreak_game_id uuid,
  secondary_tiebreak_game_id uuid,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (season_id, week_number)
);

create table if not exists public.pickem_games (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.pickem_weeks(id) on delete cascade,
  provider text not null,
  provider_game_id text not null,
  home_team_id uuid not null references public.pickem_teams(id),
  away_team_id uuid not null references public.pickem_teams(id),
  kickoff_at timestamptz not null,
  -- Internal statuses per PRD 6.2. "pregame"/"halftime" are provider-facing
  -- nuance on top of the same lock behavior as scheduled/in_progress.
  status text not null default 'scheduled'
    check (status in (
      'scheduled', 'pregame', 'in_progress', 'halftime',
      'delayed_before_start', 'suspended', 'postponed_before_start',
      'final', 'canceled', 'no_contest'
    )),
  home_score int,
  away_score int,
  winner_team_id uuid references public.pickem_teams(id),
  scoring_status text not null default 'pending'
    check (scoring_status in ('pending', 'awaiting_confirmation', 'confirmed', 'void')),
  result_confirmed_at timestamptz,
  needs_admin_review boolean not null default false,
  last_provider_update timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_game_id),
  check (home_team_id <> away_team_id),
  check (winner_team_id is null or winner_team_id in (home_team_id, away_team_id))
);

alter table public.pickem_weeks
  drop constraint if exists pickem_weeks_primary_tiebreak_game_id_fkey,
  drop constraint if exists pickem_weeks_secondary_tiebreak_game_id_fkey;

alter table public.pickem_weeks
  add constraint pickem_weeks_primary_tiebreak_game_id_fkey
    foreign key (primary_tiebreak_game_id) references public.pickem_games(id) on delete set null,
  add constraint pickem_weeks_secondary_tiebreak_game_id_fkey
    foreign key (secondary_tiebreak_game_id) references public.pickem_games(id) on delete set null;

-- =====================================================================
-- 2) Entries, picks, pick history
-- =====================================================================

create table if not exists public.pickem_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id uuid not null references public.pickem_weeks(id) on delete cascade,
  -- Default is 'not_started' (PRD 6.3), not the 'in_progress' shown in
  -- Appendix A's starter SQL -- an entry with zero picks hasn't started.
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'partially_locked', 'final')),
  primary_home_prediction int,
  primary_away_prediction int,
  secondary_home_prediction int,
  secondary_away_prediction int,
  first_started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, week_id),
  check (primary_home_prediction between 0 and 99 or primary_home_prediction is null),
  check (primary_away_prediction between 0 and 99 or primary_away_prediction is null),
  check (secondary_home_prediction between 0 and 99 or secondary_home_prediction is null),
  check (secondary_away_prediction between 0 and 99 or secondary_away_prediction is null)
);

create table if not exists public.pickem_picks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.pickem_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.pickem_games(id) on delete cascade,
  selected_team_id uuid not null references public.pickem_teams(id),
  -- Result values per PRD 5.1: correct/incorrect/no_pick/void, plus
  -- "pending" while the game hasn't reached Final yet.
  result text not null default 'pending'
    check (result in ('pending', 'correct', 'incorrect', 'no_pick', 'void')),
  points int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_id),
  check (points in (0, 1))
);

create table if not exists public.pickem_pick_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.pickem_games(id) on delete cascade,
  old_team_id uuid references public.pickem_teams(id),
  new_team_id uuid not null references public.pickem_teams(id),
  changed_at timestamptz not null default now(),
  request_id uuid
);

-- =====================================================================
-- 3) Aggregates (weekly / season leaderboard rows)
-- =====================================================================

create table if not exists public.pickem_weekly_stats (
  week_id uuid not null references public.pickem_weeks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  correct_count int not null default 0,
  incorrect_count int not null default 0,
  pending_count int not null default 0,
  missed_count int not null default 0,
  void_count int not null default 0,
  picks_made int not null default 0,
  rank int,
  primary_total_error int,
  primary_team_error int,
  secondary_total_error int,
  secondary_team_error int,
  updated_at timestamptz not null default now(),
  primary key (week_id, user_id)
);

create table if not exists public.pickem_season_stats (
  season_id uuid not null references public.pickem_seasons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  correct_count int not null default 0,
  picks_made int not null default 0,
  resolved_picks int not null default 0,
  weekly_wins int not null default 0,
  rank int,
  updated_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

-- =====================================================================
-- 4) Admin + operational tables
-- =====================================================================

-- Server-controlled admin list (PRD 3.3): never trust a client-provided
-- is_admin flag, verify against this table inside SECURITY DEFINER
-- functions/Edge Functions instead.
create table if not exists public.pickem_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Append-only privileged-action audit (PRD 16.4). No update/delete policy
-- is granted to anyone below, including admins, so it stays append-only
-- through the normal API surface.
create table if not exists public.pickem_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  action_type text not null,
  entity_type text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id uuid,
  created_at timestamptz not null default now()
);

-- One row per provider-sync job invocation (PRD 14.2/16.1 "Provider health").
create table if not exists public.pickem_provider_sync_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  provider text,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed')),
  games_processed int not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Optional raw/normalized provider payload snapshots for troubleshooting
-- and replay (PRD 12.1). game_id is nullable: some events are schedule- or
-- week-level, not tied to a single game.
create table if not exists public.pickem_provider_events (
  id bigint generated always as identity primary key,
  game_id uuid references public.pickem_games(id) on delete cascade,
  provider text not null,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 5) Growth: referrals, notification preferences
-- =====================================================================

create table if not exists public.pickem_referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source_user_id uuid not null references auth.users(id) on delete cascade,
  week_id uuid references public.pickem_weeks(id) on delete set null,
  visit_count int not null default 0,
  converted_user_id uuid references auth.users(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pickem_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  week_open boolean not null default true,
  incomplete_reminder boolean not null default true,
  primetime_lock boolean not null default false,
  week_final boolean not null default true,
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 6) Indexes (PRD 12.3, plus obvious FK lookup indexes not already
--    covered by a unique constraint)
-- =====================================================================

create index if not exists pickem_games_week_kickoff_idx on public.pickem_games(week_id, kickoff_at);
create index if not exists pickem_games_status_kickoff_idx on public.pickem_games(status, kickoff_at);
create index if not exists pickem_picks_game_team_idx on public.pickem_picks(game_id, selected_team_id);
create index if not exists pickem_picks_user_idx on public.pickem_picks(user_id);
create index if not exists pickem_entries_user_idx on public.pickem_entries(user_id);
create index if not exists pickem_weekly_rank_idx on public.pickem_weekly_stats(week_id, rank);
create index if not exists pickem_season_rank_idx on public.pickem_season_stats(season_id, rank);
create index if not exists pickem_provider_sync_runs_job_idx on public.pickem_provider_sync_runs(job_name, started_at desc);
create index if not exists pickem_admin_audit_log_created_idx on public.pickem_admin_audit_log(created_at desc);
create index if not exists pickem_pick_history_game_idx on public.pickem_pick_history(game_id);
create index if not exists pickem_provider_events_game_idx on public.pickem_provider_events(game_id);
create index if not exists pickem_referrals_source_user_idx on public.pickem_referrals(source_user_id);

-- =====================================================================
-- 7) Admin-check helper function
-- =====================================================================

create or replace function public.is_pickem_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.pickem_admins
    where user_id = (select auth.uid())
      and active = true
  );
$function$;

-- =====================================================================
-- 8) Row Level Security
-- =====================================================================

alter table public.pickem_seasons enable row level security;
alter table public.pickem_teams enable row level security;
alter table public.pickem_weeks enable row level security;
alter table public.pickem_games enable row level security;
alter table public.pickem_entries enable row level security;
alter table public.pickem_picks enable row level security;
alter table public.pickem_pick_history enable row level security;
alter table public.pickem_weekly_stats enable row level security;
alter table public.pickem_season_stats enable row level security;
alter table public.pickem_admins enable row level security;
alter table public.pickem_admin_audit_log enable row level security;
alter table public.pickem_provider_sync_runs enable row level security;
alter table public.pickem_provider_events enable row level security;
alter table public.pickem_referrals enable row level security;
alter table public.pickem_notification_preferences enable row level security;

-- --- Public schedule/content: anyone (including guests) can read.
-- PRD role table: "Guest | View current slate and rules" -- so these need
-- anon read too, not just authenticated.

drop policy if exists "Anyone can read pickem seasons" on public.pickem_seasons;
create policy "Anyone can read pickem seasons"
on public.pickem_seasons
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can read pickem teams" on public.pickem_teams;
create policy "Anyone can read pickem teams"
on public.pickem_teams
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can read pickem weeks" on public.pickem_weeks;
create policy "Anyone can read pickem weeks"
on public.pickem_weeks
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can read pickem games" on public.pickem_games;
create policy "Anyone can read pickem games"
on public.pickem_games
for select
to anon, authenticated
using (true);

-- --- Own-row reads only. No INSERT/UPDATE/DELETE policy on entries or
-- picks for `authenticated` -- that's the point (PRD 13.2 WRITE RULE).
-- Writes land in Phase 2 via SECURITY DEFINER RPCs that bypass RLS.

drop policy if exists "Players can read own pickem entries" on public.pickem_entries;
create policy "Players can read own pickem entries"
on public.pickem_entries
for select
to authenticated
using (user_id = (select auth.uid()) or public.is_pickem_admin());

drop policy if exists "Players can read own pickem picks" on public.pickem_picks;
create policy "Players can read own pickem picks"
on public.pickem_picks
for select
to authenticated
using (user_id = (select auth.uid()) or public.is_pickem_admin());

-- Pick history is an audit trail, not a V1 player-facing read (PRD 13.5
-- only grants clients "own entries/picks", not history) -- admin only.
drop policy if exists "Admins can read pickem pick history" on public.pickem_pick_history;
create policy "Admins can read pickem pick history"
on public.pickem_pick_history
for select
to authenticated
using (public.is_pickem_admin());

-- --- Aggregated leaderboard rows: public-safe by construction (only
-- counts/ranks, no raw picks), so PRD 13.5 allows public/authenticated read.

drop policy if exists "Anyone can read pickem weekly stats" on public.pickem_weekly_stats;
create policy "Anyone can read pickem weekly stats"
on public.pickem_weekly_stats
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can read pickem season stats" on public.pickem_season_stats;
create policy "Anyone can read pickem season stats"
on public.pickem_season_stats
for select
to anon, authenticated
using (true);

-- --- Admin / service-only tables (PRD 13.5: "provider logs/admin
-- audit/admin table | Admin/service only").

drop policy if exists "Admins can read pickem admins" on public.pickem_admins;
create policy "Admins can read pickem admins"
on public.pickem_admins
for select
to authenticated
using (public.is_pickem_admin());

drop policy if exists "Admins can read pickem admin audit log" on public.pickem_admin_audit_log;
create policy "Admins can read pickem admin audit log"
on public.pickem_admin_audit_log
for select
to authenticated
using (public.is_pickem_admin());

drop policy if exists "Admins can read pickem provider sync runs" on public.pickem_provider_sync_runs;
create policy "Admins can read pickem provider sync runs"
on public.pickem_provider_sync_runs
for select
to authenticated
using (public.is_pickem_admin());

drop policy if exists "Admins can read pickem provider events" on public.pickem_provider_events;
create policy "Admins can read pickem provider events"
on public.pickem_provider_events
for select
to authenticated
using (public.is_pickem_admin());

-- --- Referrals: the owning player can see their own referral/attribution
-- row (visit/conversion counts); not public, to avoid exposing other
-- users' referral performance.

drop policy if exists "Players can read own pickem referrals" on public.pickem_referrals;
create policy "Players can read own pickem referrals"
on public.pickem_referrals
for select
to authenticated
using (source_user_id = (select auth.uid()) or public.is_pickem_admin());

-- A player may only create a *fresh* referral code for themselves --
-- visit_count/converted_* must stay at their defaults. Without this, the
-- WITH CHECK below only validated source_user_id, so a client could INSERT
-- a row claiming an arbitrary converted_user_id and an inflated
-- visit_count for themselves. There is deliberately no UPDATE policy on
-- this table for `authenticated`: visit/conversion tracking is written
-- server-side (Edge Function/service role, bypassing RLS), matching PRD
-- 9.3's "record source user, week, created_at, visits and downstream
-- conversion" being a server-tracked concern, not a client-writable one.
drop policy if exists "Players can create own pickem referrals" on public.pickem_referrals;
create policy "Players can create own pickem referrals"
on public.pickem_referrals
for insert
to authenticated
with check (
  source_user_id = (select auth.uid())
  and visit_count = 0
  and converted_user_id is null
  and converted_at is null
);

-- --- Notification preferences: a low-stakes own-row settings table (does
-- not touch picks/scoring integrity), so direct authenticated CRUD via RLS
-- is fine here -- no RPC indirection needed, same pattern as
-- es_designer_profiles' own-row policies.

drop policy if exists "Players can read own pickem notification prefs" on public.pickem_notification_preferences;
create policy "Players can read own pickem notification prefs"
on public.pickem_notification_preferences
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Players can upsert own pickem notification prefs" on public.pickem_notification_preferences;
create policy "Players can upsert own pickem notification prefs"
on public.pickem_notification_preferences
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Players can update own pickem notification prefs" on public.pickem_notification_preferences;
create policy "Players can update own pickem notification prefs"
on public.pickem_notification_preferences
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- =====================================================================
-- 9) Grants
-- =====================================================================
-- RLS still requires a baseline table-level GRANT before policies apply.
-- Only SELECT is granted broadly; entries/picks get no INSERT/UPDATE/DELETE
-- grant for `authenticated` at all in this phase (writes come with the
-- Phase 2 RPCs, which run as SECURITY DEFINER and don't need a grant to
-- the underlying table for the calling role).

grant usage on schema public to anon, authenticated;

grant select on public.pickem_seasons to anon, authenticated;
grant select on public.pickem_teams to anon, authenticated;
grant select on public.pickem_weeks to anon, authenticated;
grant select on public.pickem_games to anon, authenticated;
grant select on public.pickem_weekly_stats to anon, authenticated;
grant select on public.pickem_season_stats to anon, authenticated;

grant select on public.pickem_entries to authenticated;
grant select on public.pickem_picks to authenticated;
grant select on public.pickem_pick_history to authenticated;
grant select on public.pickem_admins to authenticated;
grant select on public.pickem_admin_audit_log to authenticated;
grant select on public.pickem_provider_sync_runs to authenticated;
grant select on public.pickem_provider_events to authenticated;

grant select, insert on public.pickem_referrals to authenticated;
grant select, insert, update on public.pickem_notification_preferences to authenticated;

-- =====================================================================
-- 10) Bootstrap first admin
-- =====================================================================
-- Without at least one row here, is_pickem_admin() returns false for
-- everyone and every admin-gated table/policy above is unreachable from
-- any client. Seeded by email lookup against auth.users rather than a
-- hardcoded UUID, and safe to re-run (ON CONFLICT DO NOTHING).

insert into public.pickem_admins (user_id, role, active)
select id, 'owner', true
from auth.users
where lower(email) = 'suhail.quraishi@essentiallysports.com'
on conflict (user_id) do nothing;
