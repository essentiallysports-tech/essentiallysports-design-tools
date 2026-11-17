-- FrameUp Generate (Creative): the learning model's lessons.
-- netlify/functions/_creative-memory.js distils signals (picks, exports,
-- rejects, edits, thumbs, assistant requests, applied improvements and the
-- vision judge's critique) into lessons, one row per topic and scope:
--   scope        global | archetype | sport | brand (scope_value names which)
--   kind         avoid (a mistake not to repeat) | prefer (what editors ship)
--   evidence     decayed weight: on every bump the old value decays with a
--                half-life (21 days by default) before the new evidence is added
--   hits         times the lesson was in a run's prompts and the mistake did NOT come back
--   recurrences  times the mistake came back after the lesson existed
-- The top lessons go into the art director's and the judge's prompts.
--
-- Access: every signed-in ES user reads (team-wide learning). Nobody writes
-- the table directly: the server calls frameup_creative_lessons_bump()
-- (security definer) with DELTAS (capped per call), so parallel servers never
-- overwrite each other. Generate works before this runs: the code keeps
-- lessons in server memory when the table is missing.
-- Safe to run more than once.
--
-- Undo:
--   drop function if exists public.frameup_creative_lessons_bump(jsonb, numeric);
--   drop table if exists public.frameup_creative_lessons;

create table if not exists public.frameup_creative_lessons (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (char_length(key) between 3 and 200),
  text text not null check (char_length(text) between 3 and 240),
  topic text not null default '' check (char_length(topic) <= 60),
  kind text not null default 'avoid' check (kind in ('avoid', 'prefer')),
  scope text not null default 'global' check (scope in ('global', 'archetype', 'sport', 'brand')),
  scope_value text not null default '' check (char_length(scope_value) <= 60),
  evidence numeric not null default 0 check (evidence >= 0),
  hits integer not null default 0 check (hits >= 0),
  recurrences integer not null default 0 check (recurrences >= 0),
  sources jsonb not null default '{}'::jsonb check (octet_length(sources::text) <= 2000),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_recurred_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists frameup_creative_lessons_last_seen_idx
  on public.frameup_creative_lessons (last_seen desc);
create index if not exists frameup_creative_lessons_scope_idx
  on public.frameup_creative_lessons (scope, scope_value);

alter table public.frameup_creative_lessons enable row level security;

drop policy if exists "frameup creative lessons: team reads" on public.frameup_creative_lessons;
create policy "frameup creative lessons: team reads"
  on public.frameup_creative_lessons for select
  to authenticated
  using (public.is_es_designer_domain_user());

-- No insert / update / delete policies: writes only through the function below.
revoke all on table public.frameup_creative_lessons from anon;
revoke insert, update, delete on table public.frameup_creative_lessons from authenticated;
grant select on table public.frameup_creative_lessons to authenticated;

-- Adds deltas to lessons (creating them on first sight). At most 40 rows per
-- call, each delta capped at 5, so one call cannot flood the memory.
-- p_rows: [{ key, text, topic, kind, scope, scope_value, d_evidence, d_hits, d_recurrences, recurred }]
create or replace function public.frameup_creative_lessons_bump(
  p_rows jsonb,
  p_half_life_days numeric default 21
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
  half numeric := greatest(coalesce(p_half_life_days, 21), 1);
  d_ev numeric;
  d_hits integer;
  d_rec integer;
begin
  if not (coalesce((select auth.role()), '') = 'service_role' or public.is_es_designer_domain_user()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be an array' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_rows) limit 40 loop
    if coalesce(r ->> 'key', '') = '' or coalesce(r ->> 'text', '') = ''
       or coalesce(r ->> 'scope', 'global') not in ('global', 'archetype', 'sport', 'brand')
       or coalesce(r ->> 'kind', 'avoid') not in ('avoid', 'prefer') then
      continue;
    end if;
    d_ev := least(greatest(coalesce((r ->> 'd_evidence')::numeric, 0), 0), 5);
    d_hits := least(greatest(coalesce((r ->> 'd_hits')::integer, 0), 0), 5);
    d_rec := least(greatest(coalesce((r ->> 'd_recurrences')::integer, 0), 0), 5);
    insert into public.frameup_creative_lessons as l (key, text, topic, kind, scope, scope_value, evidence, hits, recurrences, last_recurred_at)
    values (
      left(r ->> 'key', 200), left(r ->> 'text', 240), left(coalesce(r ->> 'topic', ''), 60),
      coalesce(r ->> 'kind', 'avoid'), coalesce(r ->> 'scope', 'global'), left(coalesce(r ->> 'scope_value', ''), 60),
      d_ev, d_hits, d_rec, case when d_rec > 0 then now() end
    )
    on conflict (key) do update set
      -- Decay to now, then add (only when there is new evidence; a hit alone leaves it).
      evidence = case when excluded.evidence > 0
        then round(l.evidence * power(0.5::numeric, greatest(extract(epoch from (now() - l.last_seen)) / 86400.0, 0)::numeric / half) + excluded.evidence, 3)
        else l.evidence end,
      hits = l.hits + excluded.hits,
      recurrences = l.recurrences + excluded.recurrences,
      text = excluded.text,
      last_seen = case when excluded.evidence > 0 then now() else l.last_seen end,
      last_recurred_at = case when excluded.recurrences > 0 then now() else l.last_recurred_at end,
      updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.frameup_creative_lessons_bump(jsonb, numeric) from public, anon;
grant execute on function public.frameup_creative_lessons_bump(jsonb, numeric) to authenticated, service_role;
notify pgrst, 'reload schema';
