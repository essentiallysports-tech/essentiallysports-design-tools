-- Reels Studio (reel-maker.html): cloud copies of reel projects and an
-- append-only event log (project-docs/ai-reels-research.md §6.3).
--
-- frameup_reel_projects  one row per reel: the plan, edits and settings as a
--                        JSON timeline (no audio or image bytes; <= 200 KB).
--                        The page autosaves to the browser first and to this
--                        table only once it exists, so nothing breaks before
--                        this migration runs.
-- frameup_reel_events    what happens to reels (plan, revise, voice, edit,
--                        export, lint_blocked), for the learning loop and the
--                        Dashboard. Insert and read only; never updated.
--
-- Rows are written by netlify/functions/reel-maker.js with the signed-in
-- user's own session. People read and write their own rows; dashboard admins
-- read everything. Safe to run more than once.
--
-- Undo:
--   drop table if exists public.frameup_reel_events;
--   drop table if exists public.frameup_reel_projects;

create table if not exists public.frameup_reel_projects (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  title text not null default 'Untitled reel' check (char_length(title) <= 140),
  format text not null default 'explainer' check (char_length(format) <= 40),
  sport text check (sport is null or char_length(sport) <= 20),
  status text not null default 'draft' check (status in ('draft', 'rendered', 'exported')),
  timeline jsonb not null default '{}'::jsonb check (octet_length(timeline::text) <= 204800),
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists frameup_reel_projects_user_updated_idx
  on public.frameup_reel_projects (user_id, updated_at desc);

alter table public.frameup_reel_projects enable row level security;

drop policy if exists "frameup reel projects: users insert own" on public.frameup_reel_projects;
create policy "frameup reel projects: users insert own"
  on public.frameup_reel_projects for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup reel projects: users update own" on public.frameup_reel_projects;
create policy "frameup reel projects: users update own"
  on public.frameup_reel_projects for update
  to authenticated
  using (public.is_es_designer_domain_user() and user_id = (select auth.uid()))
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup reel projects: users delete own" on public.frameup_reel_projects;
create policy "frameup reel projects: users delete own"
  on public.frameup_reel_projects for delete
  to authenticated
  using (public.is_es_designer_domain_user() and user_id = (select auth.uid()));

-- One SELECT policy (own rows, or every row for admins), so Postgres does not
-- evaluate two permissive policies per row.
drop policy if exists "frameup reel projects: read own or admin" on public.frameup_reel_projects;
create policy "frameup reel projects: read own or admin"
  on public.frameup_reel_projects for select
  to authenticated
  using (
    (public.is_es_designer_domain_user() and user_id = (select auth.uid()))
    or public.is_es_designer_admin()
  );

create table if not exists public.frameup_reel_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text not null,
  project_id uuid,
  type text not null check (char_length(type) <= 40),
  format text check (format is null or char_length(format) <= 40),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 20000)
);

create index if not exists frameup_reel_events_user_created_idx
  on public.frameup_reel_events (user_id, created_at desc);
create index if not exists frameup_reel_events_type_created_idx
  on public.frameup_reel_events (type, created_at desc);

alter table public.frameup_reel_events enable row level security;

drop policy if exists "frameup reel events: users save own" on public.frameup_reel_events;
create policy "frameup reel events: users save own"
  on public.frameup_reel_events for insert
  to authenticated
  with check (
    public.is_es_designer_domain_user()
    and user_id = (select auth.uid())
    and lower(user_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup reel events: read own or admin" on public.frameup_reel_events;
create policy "frameup reel events: read own or admin"
  on public.frameup_reel_events for select
  to authenticated
  using (
    (public.is_es_designer_domain_user() and user_id = (select auth.uid()))
    or public.is_es_designer_admin()
  );

grant select, insert, update, delete on public.frameup_reel_projects to authenticated;
grant select, insert on public.frameup_reel_events to authenticated;
