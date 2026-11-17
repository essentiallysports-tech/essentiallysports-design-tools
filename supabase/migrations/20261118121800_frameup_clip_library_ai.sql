-- Video Ads clip library: the AI verdict per clip ("is this great game
-- action?"), cached forever per clip URL.
--
-- ai jsonb, nullable: { isGameAction: bool, quality: 1-5, subject: [text],
-- label: text, by: 'ai', model: text, at: timestamptz-iso }. Written only by
-- the server (service role) from the daily prefetch (/api/clips-prefetch,
-- feature clips-classify, capped by CLIPS_CLASSIFY_MAX_USD, default $0.30/day).
-- Rows with no verdict yet are judged by the free rules in
-- netlify/functions/_clip-classify.js.
--
-- Engagement (likes / views) already has columns; the prefetch now refreshes
-- them and stamps last_checked, so no column is needed for that.
--
-- The code works before this migration is applied: writes without the column
-- are retried without `ai` and the verdict stays in memory on the instance.
-- RLS is unchanged (the existing table policies cover the new column: ES users
-- read, only the service role writes). Idempotent: safe to run twice.
--
-- Undo:
--   drop index if exists public.frameup_clip_library_unclassified_idx;
--   alter table public.frameup_clip_library drop column if exists ai;

alter table if exists public.frameup_clip_library
  add column if not exists ai jsonb;

-- The prefetch looks up fresh rows that have no verdict yet.
create index if not exists frameup_clip_library_unclassified_idx
  on public.frameup_clip_library (posted_at desc)
  where ai is null and dead = false;

comment on column public.frameup_clip_library.ai is
  'AI verdict (clips-classify): {isGameAction, quality 1-5, subject[], label, by, model, at}. Null = not classified yet (rules apply).';
