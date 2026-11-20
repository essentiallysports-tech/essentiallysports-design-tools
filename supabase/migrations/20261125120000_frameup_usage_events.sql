-- FrameUp usage: everything people take from FrameUp, in one log.
--
-- Until now only editor exports reached the dashboard (es_designer_tasks) and
-- a few tools logged export_done to frameup_events. Downloads of ES photos,
-- copied links / captions / headlines / HTML, Generate PNGs and ZIPs, Video
-- Ads MP4s, Reels Studio files, "Open in editor" hand-offs and the rest were
-- not counted anywhere. frameup-track.js now logs each one here.
--
-- One row per take:
--   category  what kind of take (fixed list below)
--   tool      where it happened (social, youtube, newsletter, generate,
--             video-ads, reels, reels-studio, image-pool, gallery, trends,
--             requests, home, design-system, other). Not a fixed list in the
--             database, so a new tool needs no migration; the browser
--             validates it against its own list.
--   action    what exactly (png, jpg, zip, mp4, srt, link, headline, html...)
--   label     a short human title (design headline, file name). No emails.
--   meta      small extras (template, size, count, format). No image data,
--             no emails, at most 2 KB.
--
-- Rows are written by the browser with the signed-in user's own session
-- (insert only, own email). Dashboard admins read everything. No updates or
-- deletes: it is a log. The client sends its own id (uuid) and time, so a
-- batch retried after a network error is not counted twice.
--
-- The app works before this runs: events wait on the person's device (up to
-- 200, 14 days) and are sent once the table exists; Dashboard -> Usage shows
-- exports from the older tables meanwhile.
--
-- Safe to run more than once.
--
-- Undo:
--   drop table if exists public.frameup_usage_events;

create table if not exists public.frameup_usage_events (
  id uuid primary key,
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  user_email text not null,
  category text not null
    check (category in ('export', 'download', 'copy', 'share', 'open', 'generate')),
  tool text not null check (tool ~ '^[a-z0-9-]{1,32}$'),
  action text not null default '' check (action ~ '^[a-z0-9_-]{0,40}$'),
  label text not null default '' check (char_length(label) <= 200),
  page text not null default '' check (char_length(page) <= 60),
  session_id text not null default '' check (char_length(session_id) <= 64),
  device text not null default '' check (device in ('', 'desktop', 'mobile')),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 2048),
  -- A device clock far in the future would skew the charts.
  constraint frameup_usage_events_time_ok check (created_at <= received_at + interval '10 minutes')
);

create index if not exists frameup_usage_events_created_idx
  on public.frameup_usage_events (created_at desc);
create index if not exists frameup_usage_events_tool_idx
  on public.frameup_usage_events (tool, created_at desc);
create index if not exists frameup_usage_events_category_idx
  on public.frameup_usage_events (category, created_at desc);
create index if not exists frameup_usage_events_user_idx
  on public.frameup_usage_events (lower(user_email), created_at desc);

alter table public.frameup_usage_events enable row level security;

drop policy if exists "frameup usage: users log own" on public.frameup_usage_events;
create policy "frameup usage: users log own"
  on public.frameup_usage_events for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup usage: admins read" on public.frameup_usage_events;
create policy "frameup usage: admins read"
  on public.frameup_usage_events for select
  to authenticated
  using (public.is_es_designer_admin());

revoke all on table public.frameup_usage_events from anon;
grant select, insert on table public.frameup_usage_events to authenticated;
