-- FrameUp custom logos: each person's own library of square (1:1) logos for the
-- Social Media, YouTube and Newsletter editors (logo picker "My logos", the
-- Custom brand logo). frameup-custom-logos.js reads and writes these with the
-- signed-in person's own session; nobody else (and no server) touches them.
--
-- One row per logo; two PNGs per logo in the private 'custom-logos' bucket:
--   custom-logos/<auth user id>/<logo id>.png        1024 x 1024 (canvas + exports)
--   custom-logos/<auth user id>/<logo id>-thumb.png  256 x 256 (picker grid)
-- The browser downloads them with the person's session (never public URLs) and
-- hands the canvas a data URL, so exports are never tainted.
--
-- Access: only ES (essentiallysports.com) accounts, and only their own rows and
-- their own folder. No admin read: these are personal uploads.
-- Size: 5 MB per file (bucket limit and the bytes check), PNG only, names up to
-- 80 characters, 16 to 4096 px, at most 500 logos per person.
--
-- The app works before this runs: the editor notices the missing table/bucket
-- and keeps uploads for the current tab only (in memory), with a note.
--
-- Safe to run more than once.
--
-- Undo:
--   drop table if exists public.frameup_custom_logos;   -- also drops its triggers and policies
--   drop function if exists public.frameup_custom_logos_touch();
--   drop function if exists public.frameup_custom_logos_limit();
--   drop policy if exists "custom logos: es users upload own" on storage.objects;
--   drop policy if exists "custom logos: es users read own" on storage.objects;
--   drop policy if exists "custom logos: es users replace own" on storage.objects;
--   drop policy if exists "custom logos: es users delete own" on storage.objects;
--   delete from storage.buckets where id = 'custom-logos';  -- after emptying it (Storage UI)

-- ─── Table ────────────────────────────────────────────────────────────────
create table if not exists public.frameup_custom_logos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', ''))
    check (char_length(owner_email) <= 320),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  path text not null check (char_length(path) <= 200 and path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$'),
  thumb_path text not null check (char_length(thumb_path) <= 200 and thumb_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-thumb\.png$'),
  width integer not null default 1024 check (width between 16 and 4096),
  height integer not null default 1024 check (height between 16 and 4096),
  bytes integer not null default 0 check (bytes between 0 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Files live in the owner's own folder.
  constraint frameup_custom_logos_own_folder check (
    split_part(path, '/', 1) = owner_id::text and split_part(thumb_path, '/', 1) = owner_id::text
  ),
  constraint frameup_custom_logos_path_key unique (path)
);

create index if not exists frameup_custom_logos_owner_used_idx
  on public.frameup_custom_logos (owner_id, last_used_at desc nulls last, created_at desc);

-- ─── RLS: ES users, own rows only ─────────────────────────────────────────
alter table public.frameup_custom_logos enable row level security;

drop policy if exists "frameup custom logos: owner reads own" on public.frameup_custom_logos;
create policy "frameup custom logos: owner reads own"
  on public.frameup_custom_logos for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.is_es_designer_domain_user());

drop policy if exists "frameup custom logos: owner inserts own" on public.frameup_custom_logos;
create policy "frameup custom logos: owner inserts own"
  on public.frameup_custom_logos for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.is_es_designer_domain_user()
    and lower(owner_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

drop policy if exists "frameup custom logos: owner updates own" on public.frameup_custom_logos;
create policy "frameup custom logos: owner updates own"
  on public.frameup_custom_logos for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.is_es_designer_domain_user())
  with check (
    owner_id = (select auth.uid())
    and public.is_es_designer_domain_user()
    and lower(owner_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

drop policy if exists "frameup custom logos: owner deletes own" on public.frameup_custom_logos;
create policy "frameup custom logos: owner deletes own"
  on public.frameup_custom_logos for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.is_es_designer_domain_user());

revoke all on table public.frameup_custom_logos from anon, authenticated;
grant select, insert, delete on table public.frameup_custom_logos to authenticated;
-- Only the name and last-used time change after upload.
grant update (name, last_used_at) on table public.frameup_custom_logos to authenticated;

-- updated_at follows renames (server clock); last_used_at alone doesn't bump it.
create or replace function public.frameup_custom_logos_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists frameup_custom_logos_touch on public.frameup_custom_logos;
create trigger frameup_custom_logos_touch
  before insert or update on public.frameup_custom_logos
  for each row execute function public.frameup_custom_logos_touch();

-- At most 500 logos per person (runs as the inserting user, so it counts only
-- the rows that person can see: their own).
create or replace function public.frameup_custom_logos_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.frameup_custom_logos where owner_id = new.owner_id) >= 500 then
    raise exception 'custom logo limit reached (500)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists frameup_custom_logos_limit on public.frameup_custom_logos;
create trigger frameup_custom_logos_limit
  before insert on public.frameup_custom_logos
  for each row execute function public.frameup_custom_logos_limit();

-- ─── Storage: custom-logos (private), one folder per person ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custom-logos', 'custom-logos', false, 5242880, array['image/png'])
on conflict (id) do nothing;

drop policy if exists "custom logos: es users upload own" on storage.objects;
create policy "custom logos: es users upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'custom-logos'
    and public.is_es_designer_domain_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "custom logos: es users read own" on storage.objects;
create policy "custom logos: es users read own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'custom-logos'
    and public.is_es_designer_domain_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "custom logos: es users replace own" on storage.objects;
create policy "custom logos: es users replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'custom-logos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'custom-logos'
    and public.is_es_designer_domain_user()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "custom logos: es users delete own" on storage.objects;
create policy "custom logos: es users delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'custom-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
