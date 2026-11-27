-- FrameUp exports: a small thumbnail on each usage event.
--
-- Dashboard -> Exports lists everything that left FrameUp, from every tool,
-- the way editor exports have always shown (with a preview). Editor exports
-- keep their full preview on es_designer_tasks; every other export
-- (Generate, Video Ads, Reel Captions, Reels Studio, Merch ads and products,
-- image links, size packs...) now sends a small preview with its usage row
-- (frameup-track.js exported()):
--   thumb  a data:image JPEG / WebP / PNG URL, about 160 px, at most 20,000
--          characters (usually 4-10 KB), or an https image URL (a product
--          photo, a hosted image link). Null when there is none. Nullable on
--          purpose: a batch mixing rows with and without a thumb is sent
--          with the missing ones as null.
--
-- Needs 20261125120000_frameup_usage_events.sql first. Until this runs, the
-- browser notices the missing column and sends rows without thumbnails, and
-- the dashboard shows a format icon instead.
--
-- RLS is unchanged and re-stated here so this file is safe on its own:
-- people insert only their own rows; dashboard admins read everything; no
-- updates or deletes (it is a log). The dashboard reads thumb only for the
-- rows on screen.
--
-- Safe to run more than once.
--
-- Undo:
--   alter table public.frameup_usage_events drop column if exists thumb;

alter table public.frameup_usage_events
  add column if not exists thumb text;

alter table public.frameup_usage_events
  drop constraint if exists frameup_usage_events_thumb_ok;
alter table public.frameup_usage_events
  add constraint frameup_usage_events_thumb_ok check (
    thumb is null
    or thumb = ''
    or (char_length(thumb) <= 20000 and thumb ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$')
    or (char_length(thumb) <= 600 and thumb ~* '^https://[^[:space:]"''<>]+$')
  );

-- Exports view: newest exports of a tool or person.
create index if not exists frameup_usage_events_out_idx
  on public.frameup_usage_events (created_at desc)
  where category in ('export', 'download') or (meta ->> 'out') = 'true';

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
