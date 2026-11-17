-- FrameUp impact loop: where designs were posted, how they did, and the
-- small events the admin Impact view needs.
--
-- Why new tables (not es_designer_tasks.metadata): only admins may update
-- es_designer_tasks, Generate / Video Ads / Reels exports have no task row,
-- and one design can be posted in several places. So:
--
-- 1. frameup_post_links: "Posted it? Paste the link." One row per place a
--    design was posted (Instagram, X, Facebook, Threads, YouTube, a Beehiiv
--    newsletter issue, a Meta ad id). People add and read their own rows and
--    may delete their own mistakes; admins read everything.
-- 2. list_frameup_post_status(ids): SECURITY DEFINER, for the Gallery. For
--    approved ES users it returns, per task id, the platforms and newest link.
--    No emails.
-- 3. frameup_post_results: rows imported by an admin from a Meta Ads or
--    Beehiiv CSV on the Dashboard (and later from the API pull), matched to a
--    design. Admin only. Re-importing the same file updates rows in place
--    (unique on source + row_key + period).
-- 4. frameup_events: design_started / export_done / generate_run /
--    posted_link_added, written by the browser with the user's own session,
--    read by admins only (Impact view: time to export, run to export rate,
--    exports from tools that have no task row). Kept out of
--    es_designer_activity so the dashboard activity feed stays readable.
--
-- Safe to run more than once. The app works before it is applied: the
-- posted-link panel says links can't be saved yet, and the Impact view shows
-- what it can from tasks and AI usage.
--
-- Undo:
--   drop function if exists public.list_frameup_post_status(text[]);
--   drop table if exists public.frameup_post_results;
--   drop table if exists public.frameup_post_links;
--   drop table if exists public.frameup_events;

-- ── 1. Post links ───────────────────────────────────────────────────────────
create table if not exists public.frameup_post_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_email text not null,
  -- es_designer_tasks.id for editor exports; null for Generate, Video Ads and
  -- Reels downloads (no task row). No foreign key: the task may still be
  -- waiting to sync when the link is pasted.
  task_id text,
  source text not null default 'editor'
    check (source in ('editor', 'generate', 'video-ads', 'reels', 'gallery', 'dashboard')),
  design_ref text not null default '' check (char_length(design_ref) <= 200),
  platform text not null
    check (platform in ('instagram', 'x', 'facebook', 'threads', 'youtube', 'newsletter', 'meta_ad', 'other')),
  url text not null default '' check (char_length(url) <= 2000),
  external_id text not null default '' check (char_length(external_id) <= 200),
  brand text not null default '' check (char_length(brand) <= 80),
  style text not null default '' check (char_length(style) <= 80),
  angle text not null default '' check (char_length(angle) <= 80),
  size text not null default '' check (char_length(size) <= 40),
  ad_name text not null default '' check (char_length(ad_name) <= 200),
  utm_campaign text not null default '' check (char_length(utm_campaign) <= 200),
  posted_at timestamptz not null default now()
);

create index if not exists frameup_post_links_task_idx on public.frameup_post_links (task_id) where task_id is not null;
create index if not exists frameup_post_links_created_idx on public.frameup_post_links (created_at desc);
create index if not exists frameup_post_links_user_idx on public.frameup_post_links (lower(user_email), created_at desc);

alter table public.frameup_post_links enable row level security;

drop policy if exists "frameup post links: users add own" on public.frameup_post_links;
create policy "frameup post links: users add own"
  on public.frameup_post_links for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

-- One SELECT policy (own rows or admin), so Postgres evaluates one predicate.
drop policy if exists "frameup post links: own or admin read" on public.frameup_post_links;
create policy "frameup post links: own or admin read"
  on public.frameup_post_links for select
  to authenticated
  using (
    lower(user_email) = lower((select auth.jwt()) ->> 'email')
    or public.is_es_designer_admin()
  );

drop policy if exists "frameup post links: users delete own" on public.frameup_post_links;
create policy "frameup post links: users delete own"
  on public.frameup_post_links for delete
  to authenticated
  using (lower(user_email) = lower((select auth.jwt()) ->> 'email'));

revoke all on table public.frameup_post_links from anon;
grant select, insert, delete on table public.frameup_post_links to authenticated;

-- ── 2. Gallery: posted state for a page of cards ────────────────────────────
create or replace function public.list_frameup_post_status(p_ids text[])
returns table (task_id text, platforms text[], links integer, latest_url text, latest_platform text, latest_posted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select l.task_id, l.platform, l.url, l.posted_at
    from public.frameup_post_links l
    where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
      and l.task_id = any ((coalesce(p_ids, '{}'::text[]))[1:200])
  ),
  latest as (
    select distinct on (task_id) task_id, platform, url, posted_at
    from scoped
    order by task_id, posted_at desc
  )
  select
    s.task_id,
    array_agg(distinct s.platform order by s.platform) as platforms,
    count(*)::integer as links,
    max(la.url) as latest_url,
    max(la.platform) as latest_platform,
    max(la.posted_at) as latest_posted_at
  from scoped s
  join latest la on la.task_id = s.task_id
  group by s.task_id;
$$;

revoke all on function public.list_frameup_post_status(text[]) from public, anon;
grant execute on function public.list_frameup_post_status(text[]) to authenticated;

-- ── 3. Imported results (Meta Ads, Beehiiv) ─────────────────────────────────
create table if not exists public.frameup_post_results (
  id bigint generated always as identity primary key,
  imported_at timestamptz not null default now(),
  imported_by text not null default '',
  source text not null check (source in ('meta_ads', 'beehiiv')),
  -- Meta: the ad id (or ad name when the export has no id). Beehiiv: the post
  -- id, or the normalised post URL.
  row_key text not null check (char_length(row_key) between 1 and 400),
  period_start date,
  period_end date,
  task_id text,
  post_link_id uuid references public.frameup_post_links (id) on delete set null,
  match_method text not null default 'none'
    check (match_method in ('none', 'ad_id', 'ad_name', 'ad_name_parts', 'url', 'manual')),
  title text not null default '' check (char_length(title) <= 400),
  url text not null default '' check (char_length(url) <= 2000),
  ad_name text not null default '' check (char_length(ad_name) <= 400),
  brand text not null default '' check (char_length(brand) <= 80),
  style text not null default '' check (char_length(style) <= 80),
  -- Numbers exactly as the file gave them (impressions, reach, clicks, spend,
  -- ctr, results, opens, open_rate, recipients, unsubscribes...).
  metrics jsonb not null default '{}'::jsonb,
  -- The mapped source row, so a later re-mapping never needs the file again.
  raw jsonb not null default '{}'::jsonb
);

-- Nulls count as equal for the upsert key (Postgres 15+).
create unique index if not exists frameup_post_results_key
  on public.frameup_post_results (source, row_key, period_start, period_end) nulls not distinct;
create index if not exists frameup_post_results_task_idx on public.frameup_post_results (task_id) where task_id is not null;

alter table public.frameup_post_results enable row level security;

drop policy if exists "frameup post results: admins read" on public.frameup_post_results;
create policy "frameup post results: admins read"
  on public.frameup_post_results for select
  to authenticated
  using (public.is_es_designer_admin());

drop policy if exists "frameup post results: admins insert" on public.frameup_post_results;
create policy "frameup post results: admins insert"
  on public.frameup_post_results for insert
  to authenticated
  with check (public.is_es_designer_admin());

drop policy if exists "frameup post results: admins update" on public.frameup_post_results;
create policy "frameup post results: admins update"
  on public.frameup_post_results for update
  to authenticated
  using (public.is_es_designer_admin())
  with check (public.is_es_designer_admin());

drop policy if exists "frameup post results: admins delete" on public.frameup_post_results;
create policy "frameup post results: admins delete"
  on public.frameup_post_results for delete
  to authenticated
  using (public.is_es_designer_admin());

revoke all on table public.frameup_post_results from anon;
grant select, insert, update, delete on table public.frameup_post_results to authenticated;

-- ── 4. Impact events ────────────────────────────────────────────────────────
create table if not exists public.frameup_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_email text not null,
  event text not null
    check (event in ('design_started', 'export_done', 'generate_run', 'posted_link_added')),
  source text not null default ''
    check (source in ('', 'editor', 'generate', 'video-ads', 'reels', 'gallery', 'dashboard')),
  session_id text not null default '' check (char_length(session_id) <= 64),
  task_id text,
  -- Small, no emails: template, size, brand, style, angle, elapsed_ms, count.
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 4096)
);

create index if not exists frameup_events_created_idx on public.frameup_events (created_at desc);
create index if not exists frameup_events_event_idx on public.frameup_events (event, created_at desc);

alter table public.frameup_events enable row level security;

drop policy if exists "frameup events: users log own" on public.frameup_events;
create policy "frameup events: users log own"
  on public.frameup_events for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup events: admins read" on public.frameup_events;
create policy "frameup events: admins read"
  on public.frameup_events for select
  to authenticated
  using (public.is_es_designer_admin());

revoke all on table public.frameup_events from anon;
grant select, insert on table public.frameup_events to authenticated;
