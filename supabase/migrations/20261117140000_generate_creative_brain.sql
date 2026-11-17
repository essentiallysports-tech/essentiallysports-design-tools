-- FrameUp Generate: the creative brain's memory of past Social Media posts.
--
-- 1. frameup_design_ratings: admin star ratings (1-5) on exported designs.
--    One row per export (the latest admin rating wins). Admins read/write;
--    nobody else reads the table directly.
-- 2. list_frameup_generate_corpus(): read-only, SECURITY DEFINER, for approved
--    ES users (Generate calls it with the user's own session). Returns only the
--    small text fields of each export's shareable design copy, the brief it was
--    generated from, admin status and stars. No emails, names or user ids.
-- 3. An index for "recent Social Media exports".
-- Safe to run more than once. Generate works before and after it: until it is
-- applied, netlify/functions/_generate-examples.js falls back to
-- list_frameup_examples (20261027120000).
-- Spec: project-docs/generate-creative-brain-research.md (section C4).
--
-- Undo:
--   drop function if exists public.list_frameup_generate_corpus(integer, timestamptz);
--   drop table if exists public.frameup_design_ratings;
--   drop index if exists public.es_designer_tasks_exports_recent_idx;

create table if not exists public.frameup_design_ratings (
  task_id text primary key references public.es_designer_tasks (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  note text check (note is null or char_length(note) <= 280),
  rated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.frameup_design_ratings enable row level security;

drop policy if exists "frameup design ratings: admins read" on public.frameup_design_ratings;
create policy "frameup design ratings: admins read"
  on public.frameup_design_ratings for select
  to authenticated
  using (public.is_es_designer_admin());

drop policy if exists "frameup design ratings: admins insert" on public.frameup_design_ratings;
create policy "frameup design ratings: admins insert"
  on public.frameup_design_ratings for insert
  to authenticated
  with check (public.is_es_designer_admin() and rated_by = (select auth.uid()));

drop policy if exists "frameup design ratings: admins update" on public.frameup_design_ratings;
create policy "frameup design ratings: admins update"
  on public.frameup_design_ratings for update
  to authenticated
  using (public.is_es_designer_admin())
  with check (public.is_es_designer_admin() and rated_by = (select auth.uid()));

revoke all on table public.frameup_design_ratings from anon;
grant select, insert, update on table public.frameup_design_ratings to authenticated;

create index if not exists es_designer_tasks_exports_recent_idx
  on public.es_designer_tasks (workspace, created_at desc)
  where task_type = 'exported_design';

create or replace function public.list_frameup_generate_corpus(
  p_limit integer default 200,
  p_before timestamptz default null
)
returns table (
  id text,
  exported_at timestamptz,
  workspace_variant text,
  post_type text,
  sport text,
  team text,
  title text,
  lines jsonb,
  listicle jsonb,
  palette_idx integer,
  photo_url text,
  brief text,
  generated jsonb,
  status text,
  stars smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.created_at as exported_at,
    t.workspace_variant,
    coalesce(d.s ->> 'postType', '') as post_type,
    coalesce(nullif(d.s ->> 'sport', ''), t.sport) as sport,
    coalesce(nullif(d.s ->> 'team', ''), t.team_or_league) as team,
    left(t.title, 200) as title,
    case when jsonb_typeof(d.s -> 'lines') = 'array' then d.s -> 'lines' else '[]'::jsonb end as lines,
    case when jsonb_typeof(d.l) = 'object' then jsonb_build_object(
      'title', left(coalesce(d.l ->> 'title', ''), 80),
      'headers', jsonb_build_array(coalesce(d.l ->> 'entityHeader', ''), coalesce(d.l ->> 'metric1Header', ''), coalesce(d.l ->> 'metric2Header', '')),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entity', left(coalesce(x.r ->> 'entity', ''), 40),
          'metric1', left(coalesce(x.r ->> 'metric1', ''), 20),
          'metric2', left(coalesce(x.r ->> 'metric2', ''), 20),
          'subtitle', left(coalesce(x.r ->> 'subtitle', ''), 40)
        ) order by x.ord)
        from jsonb_array_elements(case when jsonb_typeof(d.l -> 'rows') = 'array' then d.l -> 'rows' else '[]'::jsonb end) with ordinality as x(r, ord)
        where coalesce(x.r ->> 'hidden', 'false') <> 'true' and x.ord <= 10
      ), '[]'::jsonb)
    ) end as listicle,
    case when (d.s ->> 'pillPaletteIdx') ~ '^[0-9]{1,2}$' then (d.s ->> 'pillPaletteIdx')::integer end as palette_idx,
    nullif(left(coalesce(d.s -> 'photo' -> '__img' ->> 'url', ''), 600), '') as photo_url,
    left(coalesce(t.metadata -> 'generated' ->> 'brief', ''), 600) as brief,
    jsonb_strip_nulls(jsonb_build_object(
      'postType', t.metadata -> 'generated' ->> 'postType',
      'specId', t.metadata -> 'generated' ->> 'specId',
      'runId', t.metadata -> 'generated' ->> 'runId',
      'angle', left(t.metadata -> 'generated' ->> 'angle', 120),
      'hook', t.metadata -> 'generated' ->> 'hook',
      'aiText', case when jsonb_typeof(t.metadata -> 'generated' -> 'aiText') = 'array' then t.metadata -> 'generated' -> 'aiText' end,
      'score', t.metadata -> 'generated' -> 'score'
    )) as generated,
    t.status,
    (select r.stars from public.frameup_design_ratings r where r.task_id = t.id) as stars
  from public.es_designer_tasks t
  cross join lateral (
    select
      t.metadata -> 'design' -> 'state' as s,
      case t.metadata -> 'design' -> 'state' ->> 'postType'
        when 'listicle-type-1' then t.metadata -> 'design' -> 'state' -> 'listicleData'
        when 'listicle-type-2' then t.metadata -> 'design' -> 'state' -> 'listicleType2Data'
      end as l
  ) d
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.task_type = 'exported_design'
    and t.workspace = 'Social Media'
    and (p_before is null or t.created_at < p_before)
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 300);
$$;

revoke all on function public.list_frameup_generate_corpus(integer, timestamptz) from public, anon;
grant execute on function public.list_frameup_generate_corpus(integer, timestamptz) to authenticated;
notify pgrst, 'reload schema';
