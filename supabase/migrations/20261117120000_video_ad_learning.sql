-- Video Ads learning loop: an append-only log of what happens to AI ad copy
-- (netlify/functions/_ad-learning.js). The copy writer reads recent exports as
-- "ads we shipped" examples, and turns recurring check failures and the edits
-- people make into plain extra rules. No model reads this table; the rules are
-- derived deterministically on the server.
--
-- Event types:
--   copy_generated  the AI variants, plus any issues and auto-fixes
--   copy_applied    the variant the editor picked
--   copy_edited     the AI version vs the final edited version
--   export          the final copy, style, brand, sizes and clip source
--   clip_failed     a clip that could not be downloaded (variant height, status)
--   check_failed    copy that failed the ES checks (the issues)
--
-- Rows are written with the signed-in user's own session. People read their
-- own events; dashboard admins read all. No updates or deletes (a log).
-- The copy writer reads team-wide lessons through frameup_video_ad_lessons()
-- (security definer, below), which exposes no user ids or emails.
-- Safe to run more than once.
--
-- Undo:
--   drop function if exists public.frameup_video_ad_lessons(text, text, int);
--   drop table if exists public.frameup_video_ad_events;

create table if not exists public.frameup_video_ad_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  brand_id text check (brand_id is null or char_length(brand_id) <= 40),
  sport text check (sport is null or sport in ('nfl', 'cfb', 'mlb')),
  type text not null check (type in ('copy_generated', 'copy_applied', 'copy_edited', 'export', 'clip_failed', 'check_failed')),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 20000)
);

create index if not exists frameup_video_ad_events_brand_created_idx
  on public.frameup_video_ad_events (brand_id, created_at desc);
create index if not exists frameup_video_ad_events_brand_type_created_idx
  on public.frameup_video_ad_events (brand_id, type, created_at desc);
create index if not exists frameup_video_ad_events_user_created_idx
  on public.frameup_video_ad_events (user_id, created_at desc);

alter table public.frameup_video_ad_events enable row level security;

drop policy if exists "frameup video ad events: users save own" on public.frameup_video_ad_events;
create policy "frameup video ad events: users save own"
  on public.frameup_video_ad_events for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup video ad events: users read own" on public.frameup_video_ad_events;
create policy "frameup video ad events: users read own"
  on public.frameup_video_ad_events for select
  to authenticated
  using (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
  );

drop policy if exists "frameup video ad events: admins read" on public.frameup_video_ad_events;
create policy "frameup video ad events: admins read"
  on public.frameup_video_ad_events for select
  to authenticated
  using (public.is_es_designer_admin());

-- Team-wide lessons. The table's RLS keeps rows per person, but the copy
-- writer should learn from the whole team's exports, edits and check failures.
-- This read-only function returns the latest rows (max 200) for one brand (and
-- sport, when given), only the types the learner uses, and only to signed-in
-- ES users. user_id and user_email are never returned.
-- Undo:
--   drop function if exists public.frameup_video_ad_lessons(text, text, int);
create or replace function public.frameup_video_ad_lessons(
  p_brand_id text,
  p_sport text default null,
  p_limit int default 200
)
returns table (created_at timestamptz, brand_id text, sport text, type text, payload jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select e.created_at, e.brand_id, e.sport, e.type, e.payload
  from public.frameup_video_ad_events e
  where public.is_es_designer_domain_user()
    and e.brand_id = p_brand_id
    and (p_sport is null or e.sport = p_sport)
    and e.type in ('export', 'copy_edited', 'check_failed', 'copy_generated')
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 0), 200);
$$;

revoke all on function public.frameup_video_ad_lessons(text, text, int) from public, anon;
grant execute on function public.frameup_video_ad_lessons(text, text, int) to authenticated;
