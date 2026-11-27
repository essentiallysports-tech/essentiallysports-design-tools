-- Reels Studio v4: the learning loop (reels4-contract.md "AI").
--
-- frameup_reel_feedback  one row per change an editor makes to an AI-planned
--                        reel (swap_media, edit_text, change_module,
--                        regenerate, delete_beat, export, posted), with a
--                        small before / after JSON. Written by
--                        netlify/functions/reel-maker.js (mode 'feedback')
--                        with the person's own session. Insert own rows;
--                        only dashboard admins read (the daily job reads it
--                        with the service role).
-- frameup_reel_lessons   the "house lessons" the daily job distils from the
--                        last 30 days (style, lesson, evidence). Every
--                        signed-in ES user reads them (the director and the
--                        critic put the top ones in their prompts); admins
--                        and the service role write them.
--
-- Nothing breaks before this runs: the API answers { cloud: false } and the
-- director runs without lessons. Safe to run more than once.
--
-- Undo:
--   drop table if exists public.frameup_reel_lessons;
--   drop table if exists public.frameup_reel_feedback;

create table if not exists public.frameup_reel_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  reel_id text check (reel_id is null or char_length(reel_id) <= 64),
  chapter_id text check (chapter_id is null or char_length(chapter_id) <= 16),
  beat_id text check (beat_id is null or char_length(beat_id) <= 16),
  event text not null check (event in ('swap_media', 'edit_text', 'change_module', 'regenerate', 'delete_beat', 'export', 'posted')),
  style text check (style is null or char_length(style) <= 20),
  field text check (field is null or char_length(field) <= 24),
  before jsonb check (before is null or octet_length(before::text) <= 4000),
  after jsonb check (after is null or octet_length(after::text) <= 4000)
);

create index if not exists frameup_reel_feedback_created_idx
  on public.frameup_reel_feedback (created_at desc);
create index if not exists frameup_reel_feedback_style_event_idx
  on public.frameup_reel_feedback (style, event, created_at desc);

alter table public.frameup_reel_feedback enable row level security;

drop policy if exists "frameup reel feedback: users insert own" on public.frameup_reel_feedback;
create policy "frameup reel feedback: users insert own"
  on public.frameup_reel_feedback for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup reel feedback: admins read" on public.frameup_reel_feedback;
create policy "frameup reel feedback: admins read"
  on public.frameup_reel_feedback for select
  to authenticated
  using (public.is_es_designer_admin());

create table if not exists public.frameup_reel_lessons (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  style text not null check (style in ('breakdown', 'casefile', 'outlier', 'hotseat', 'all')),
  lesson text not null check (char_length(lesson) between 1 and 200),
  evidence integer not null default 1 check (evidence >= 1),
  rank integer not null default 1 check (rank >= 1),
  source_hash text check (source_hash is null or char_length(source_hash) <= 64),
  model text check (model is null or char_length(model) <= 60)
);

create index if not exists frameup_reel_lessons_style_idx
  on public.frameup_reel_lessons (style, evidence desc);
create index if not exists frameup_reel_lessons_created_idx
  on public.frameup_reel_lessons (created_at desc);

alter table public.frameup_reel_lessons enable row level security;

drop policy if exists "frameup reel lessons: users read" on public.frameup_reel_lessons;
create policy "frameup reel lessons: users read"
  on public.frameup_reel_lessons for select
  to authenticated
  using (public.is_es_designer_domain_user());

drop policy if exists "frameup reel lessons: admins insert" on public.frameup_reel_lessons;
create policy "frameup reel lessons: admins insert"
  on public.frameup_reel_lessons for insert
  to authenticated
  with check (public.is_es_designer_admin());

drop policy if exists "frameup reel lessons: admins delete" on public.frameup_reel_lessons;
create policy "frameup reel lessons: admins delete"
  on public.frameup_reel_lessons for delete
  to authenticated
  using (public.is_es_designer_admin());

grant select, insert on public.frameup_reel_feedback to authenticated;
grant select, insert, delete on public.frameup_reel_lessons to authenticated;
