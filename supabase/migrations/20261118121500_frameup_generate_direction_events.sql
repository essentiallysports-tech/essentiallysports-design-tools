-- FrameUp Generate: the creative director's memory. An append-only log of
-- what editors do with the director's directions and designs
-- (netlify/functions/_direction-memory.js, written through
-- /api/generate-direction-events). No model reads this table; signals are
-- derived deterministically on the server:
--   - the director is told which hooks and angles editors pick and export,
--     and which they push back on;
--   - Generate's past-posts ranking favours exports whose run or angle was
--     chosen or exported here.
--
-- Event types:
--   directions_shown   the directions the director offered for a brief
--   direction_chosen   an editor made designs from a direction
--   direction_edited   an editor changed a direction's angle or hook first
--   direction_skipped  the editor skipped the directions (Auto)
--   more_like_this     on a direction or a design
--   less_like_this     on a direction or a design
--   fix_applied        the director's one-click fix on a design
--   design_opened      a design opened in the editor
--   design_exported    a design downloaded from Generate
--
-- Rows are written with the signed-in user's own session. People read their
-- own events; dashboard admins read all. No updates or deletes (a log).
-- Team-wide signals go through frameup_generate_direction_signals()
-- (security definer, below), which returns no user ids or emails.
-- Generate works before this runs: the code treats a missing table as "no memory".
-- Safe to run more than once.
--
-- Undo:
--   drop function if exists public.frameup_generate_direction_signals(int);
--   drop table if exists public.frameup_generate_direction_events;

create table if not exists public.frameup_generate_direction_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  type text not null check (type in (
    'directions_shown', 'direction_chosen', 'direction_edited', 'direction_skipped',
    'more_like_this', 'less_like_this', 'fix_applied', 'design_opened', 'design_exported'
  )),
  run_id text check (run_id is null or char_length(run_id) <= 64),
  direction_id text check (direction_id is null or char_length(direction_id) <= 24),
  post_type text check (post_type is null or char_length(post_type) <= 40),
  hook text check (hook is null or hook in ('question', 'claim', 'reaction', 'quote', 'numbers', 'ranking')),
  sport text check (sport is null or char_length(sport) <= 20),
  angle text check (angle is null or char_length(angle) <= 160),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 20000)
);

create index if not exists frameup_generate_direction_events_created_idx
  on public.frameup_generate_direction_events (created_at desc);
create index if not exists frameup_generate_direction_events_user_created_idx
  on public.frameup_generate_direction_events (user_id, created_at desc);
create index if not exists frameup_generate_direction_events_run_idx
  on public.frameup_generate_direction_events (run_id)
  where run_id is not null;

alter table public.frameup_generate_direction_events enable row level security;

drop policy if exists "frameup direction events: users save own" on public.frameup_generate_direction_events;
create policy "frameup direction events: users save own"
  on public.frameup_generate_direction_events for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup direction events: users read own" on public.frameup_generate_direction_events;
create policy "frameup direction events: users read own"
  on public.frameup_generate_direction_events for select
  to authenticated
  using (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
  );

drop policy if exists "frameup direction events: admins read" on public.frameup_generate_direction_events;
create policy "frameup direction events: admins read"
  on public.frameup_generate_direction_events for select
  to authenticated
  using (public.is_es_designer_admin());

revoke all on table public.frameup_generate_direction_events from anon;
grant select, insert on table public.frameup_generate_direction_events to authenticated;

-- Team-wide signals: the latest rows (max 500), only what the director uses,
-- only to signed-in ES users. user_id and user_email are never returned.
create or replace function public.frameup_generate_direction_signals(
  p_limit int default 400
)
returns table (created_at timestamptz, type text, run_id text, post_type text, hook text, angle text, payload jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select e.created_at, e.type, e.run_id, e.post_type, e.hook, e.angle, e.payload
  from public.frameup_generate_direction_events e
  where public.is_es_designer_domain_user()
    and e.created_at > now() - interval '120 days'
    and e.type in ('directions_shown', 'direction_chosen', 'direction_edited', 'more_like_this', 'less_like_this', 'design_opened', 'design_exported')
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 400), 0), 500);
$$;

revoke all on function public.frameup_generate_direction_signals(int) from public, anon;
grant execute on function public.frameup_generate_direction_signals(int) to authenticated;
notify pgrst, 'reload schema';
