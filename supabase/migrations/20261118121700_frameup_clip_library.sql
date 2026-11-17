-- Video Ads clip library: one row per verified, fresh sports clip, shared by
-- every editor. Filled by the prefetch cron (/api/clips-prefetch) and by every
-- live "Find a clip" search, read first by find-clips / moments-with-clips /
-- the Clip library tab, so most searches are instant and cost nothing.
--
-- Who can do what:
--   - signed-in ES users (@essentiallysports.com) read rows;
--   - only the server writes, with SUPABASE_SERVICE_ROLE_KEY (the service role
--     bypasses RLS). There is no insert / update / delete policy, so a browser
--     session can never write here.
--   - frameup_clip_prefetch_runs (one summary per cron run, for the admin
--     diagnostics and the daily AI cap) is readable by dashboard admins only.
--
-- Retention: the cron deletes rows whose post is older than 7 days. The
-- optional purge function below does the same if pg_cron is preferred:
--   select cron.schedule('frameup-purge-clip-library', '41 * * * *', 'select public.frameup_purge_clip_library()');
--
-- The code works before this migration is applied (in-memory library per
-- server instance). Idempotent: safe to run twice.
--
-- Undo:
--   select cron.unschedule('frameup-purge-clip-library');   -- only if scheduled
--   drop function if exists public.frameup_purge_clip_library();
--   drop table if exists public.frameup_clip_prefetch_runs;
--   drop table if exists public.frameup_clip_library;

create table if not exists public.frameup_clip_library (
  id bigint generated always as identity primary key,
  url text not null unique check (char_length(url) <= 400),
  platform text not null default 'x' check (char_length(platform) <= 24),
  handle text not null default '' check (char_length(handle) <= 80),
  sport text not null check (sport in ('nfl', 'cfb', 'mlb')),
  teams text[] not null default '{}',
  players text[] not null default '{}',
  title text not null default '' check (char_length(title) <= 400),
  posted_at timestamptz not null,
  media_url text not null default '' check (char_length(media_url) <= 1200),
  variants jsonb not null default '[]'::jsonb,
  thumb text not null default '' check (char_length(thumb) <= 1200),
  duration_ms integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  has_audio boolean,
  source_kind text not null default 'fan' check (source_kind in ('official', 'league', 'media', 'fan')),
  found_by text not null default '' check (char_length(found_by) <= 24),
  media_key text not null default '' check (char_length(media_key) <= 300),
  score real not null default 0,
  likes integer not null default 0,
  views bigint not null default 0,
  first_seen timestamptz not null default now(),
  last_checked timestamptz not null default now(),
  dead boolean not null default false
);

create index if not exists frameup_clip_library_sport_posted_idx
  on public.frameup_clip_library (sport, posted_at desc);
create index if not exists frameup_clip_library_teams_idx
  on public.frameup_clip_library using gin (teams);
create index if not exists frameup_clip_library_last_checked_idx
  on public.frameup_clip_library (last_checked);

alter table public.frameup_clip_library enable row level security;

drop policy if exists "frameup clip library: es users read" on public.frameup_clip_library;
create policy "frameup clip library: es users read"
  on public.frameup_clip_library for select
  to authenticated
  using (public.is_es_designer_domain_user());

revoke insert, update, delete on public.frameup_clip_library from anon, authenticated;

create table if not exists public.frameup_clip_prefetch_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  ms integer not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  summary jsonb not null default '{}'::jsonb
);

create index if not exists frameup_clip_prefetch_runs_started_idx
  on public.frameup_clip_prefetch_runs (started_at desc);

alter table public.frameup_clip_prefetch_runs enable row level security;

drop policy if exists "frameup clip prefetch runs: admins read" on public.frameup_clip_prefetch_runs;
create policy "frameup clip prefetch runs: admins read"
  on public.frameup_clip_prefetch_runs for select
  to authenticated
  using (public.is_es_designer_admin());

revoke insert, update, delete on public.frameup_clip_prefetch_runs from anon, authenticated;

create or replace function public.frameup_purge_clip_library()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.frameup_clip_library
    where posted_at < now() - interval '7 days'
    returning 1
  ), runs as (
    delete from public.frameup_clip_prefetch_runs
    where started_at < now() - interval '30 days'
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.frameup_purge_clip_library() from public, anon, authenticated;
