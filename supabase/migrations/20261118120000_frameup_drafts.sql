-- Cloud drafts: the editor's autosave (and the copy kept with each export)
-- follows the signed-in person to any browser or laptop.
--
-- One row per (owner, draft_key):
--   draft_key 'editor'        the work in progress (all workspaces), the same
--                             JSON the browser autosave keeps, without
--                             uploaded files (web photo links only)
--   draft_key 'design:<id>'   the copy of an exported design (Recent designs)
-- The browser stays the source of truth until a cloud write is confirmed, and
-- the app works unchanged before this migration is applied (it notices the
-- missing table and stops trying for that page load).
--
-- Size: one exported design is ~8 KB; the whole editor (every workspace) is
-- ~75 KB with blank templates. The check below refuses anything over 512 KB
-- (the client already skips drafts over 400 KB). No thumbnails are stored,
-- so there is no storage bucket.
--
-- Retention: drafts untouched for 30 days are deleted by
-- frameup_purge_old_drafts(). Schedule it once with pg_cron if it's enabled:
--   select cron.schedule('frameup-purge-drafts', '17 3 * * *', 'select public.frameup_purge_old_drafts()');
-- (Until then nothing is purged; the editor also ignores drafts older than 30 days.)
--
-- Undo:
--   select cron.unschedule('frameup-purge-drafts');   -- only if it was scheduled
--   drop function if exists public.frameup_purge_old_drafts();
--   drop table if exists public.frameup_drafts;   -- also drops its trigger and policies
--   drop function if exists public.frameup_drafts_touch();

create table if not exists public.frameup_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  draft_key text not null check (char_length(draft_key) between 1 and 120),
  kind text not null default 'editor' check (kind in ('editor', 'design')),
  workspace text not null default '' check (char_length(workspace) <= 40),
  variant text not null default '' check (char_length(variant) <= 120),
  title text not null default '' check (char_length(title) <= 200),
  design jsonb not null,
  local_photos integer not null default 0 check (local_photos >= 0),
  device_id text not null default '' check (char_length(device_id) <= 64),
  size_bytes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint frameup_drafts_design_size check (octet_length(design::text) <= 524288),
  constraint frameup_drafts_owner_key unique (owner_id, draft_key)
);

create index if not exists frameup_drafts_owner_updated_idx
  on public.frameup_drafts (owner_id, updated_at desc);

alter table public.frameup_drafts enable row level security;

drop policy if exists "frameup drafts: owner reads own" on public.frameup_drafts;
create policy "frameup drafts: owner reads own"
  on public.frameup_drafts for select
  to authenticated
  using (owner_id = (select auth.uid()) or public.is_es_designer_admin());

drop policy if exists "frameup drafts: owner inserts own" on public.frameup_drafts;
create policy "frameup drafts: owner inserts own"
  on public.frameup_drafts for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and lower(owner_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

drop policy if exists "frameup drafts: owner updates own" on public.frameup_drafts;
create policy "frameup drafts: owner updates own"
  on public.frameup_drafts for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and lower(owner_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

drop policy if exists "frameup drafts: owner deletes own" on public.frameup_drafts;
create policy "frameup drafts: owner deletes own"
  on public.frameup_drafts for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- updated_at is the server's clock, so two laptops with different clocks
-- still agree on which save is newer (the client compares these values).
create or replace function public.frameup_drafts_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists frameup_drafts_touch on public.frameup_drafts;
create trigger frameup_drafts_touch
  before insert or update on public.frameup_drafts
  for each row execute function public.frameup_drafts_touch();

-- 30-day retention (see the header for scheduling).
create or replace function public.frameup_purge_old_drafts()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.frameup_drafts
    where updated_at < now() - interval '30 days'
       or (deleted_at is not null and deleted_at < now() - interval '7 days')
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.frameup_purge_old_drafts() from public, anon, authenticated;
