-- Repair migration for dashboard role management.
-- Safe to run in Supabase SQL Editor when the original role migration was
-- partially applied or stopped on an existing-policy error.

alter table if exists public.es_designer_profiles
  add column if not exists designation text not null default 'Designer',
  add column if not exists access_role text not null default 'Associate';

alter table if exists public.es_designer_presence
  add column if not exists designation text not null default 'Designer',
  add column if not exists access_role text not null default 'Associate';

alter table public.es_designer_profiles
  drop constraint if exists es_designer_profiles_access_role_check,
  add constraint es_designer_profiles_access_role_check
  check (access_role in ('Associate', 'Admin', 'Super Admin', 'Server Owner'));

alter table public.es_designer_presence
  drop constraint if exists es_designer_presence_access_role_check,
  add constraint es_designer_presence_access_role_check
  check (access_role in ('Associate', 'Admin', 'Super Admin', 'Server Owner'));

update public.es_designer_profiles
set
  access_role = case
    when lower(email) = 'suhail.quraishi@essentiallysports.com' then 'Server Owner'
    when lower(email) = 'manish.kalsi@essentiallysports.com' then 'Super Admin'
    when role in ('Admin', 'Super Admin', 'Server Owner') then role
    else 'Associate'
  end,
  role = case
    when lower(email) = 'suhail.quraishi@essentiallysports.com' then 'Server Owner'
    when lower(email) = 'manish.kalsi@essentiallysports.com' then 'Super Admin'
    when role in ('Admin', 'Super Admin', 'Server Owner') then role
    else 'Associate'
  end,
  designation = coalesce(nullif(designation, ''), 'Designer'),
  updated_at = now();

update public.es_designer_presence
set
  access_role = case
    when lower(email) = 'suhail.quraishi@essentiallysports.com' then 'Server Owner'
    when lower(email) = 'manish.kalsi@essentiallysports.com' then 'Super Admin'
    when role in ('Admin', 'Super Admin', 'Server Owner') then role
    else 'Associate'
  end,
  role = case
    when lower(email) = 'suhail.quraishi@essentiallysports.com' then 'Server Owner'
    when lower(email) = 'manish.kalsi@essentiallysports.com' then 'Super Admin'
    when role in ('Admin', 'Super Admin', 'Server Owner') then role
    else 'Associate'
  end,
  designation = coalesce(nullif(designation, ''), 'Designer'),
  updated_at = now();

create or replace function public.is_es_designer_server_owner()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'suhail.quraishi@essentiallysports.com';
$$;

create or replace function public.is_es_designer_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'suhail.quraishi@essentiallysports.com',
    'manish.kalsi@essentiallysports.com'
  )
  or exists (
    select 1 from public.es_designer_profiles
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and access_role in ('Admin', 'Super Admin', 'Server Owner')
  );
$$;

alter table public.es_designer_profiles enable row level security;
alter table public.es_designer_presence enable row level security;

drop policy if exists "Dashboard admins can read dashboard profiles" on public.es_designer_profiles;
create policy "Dashboard admins can read dashboard profiles"
on public.es_designer_profiles
for select to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can insert own dashboard profile" on public.es_designer_profiles;
create policy "ES users can insert own dashboard profile"
on public.es_designer_profiles
for insert to authenticated
with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "ES users can update own dashboard profile" on public.es_designer_profiles;
create policy "ES users can update own dashboard profile"
on public.es_designer_profiles
for update to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin())
with check (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin());

drop policy if exists "Dashboard admins can read dashboard presence" on public.es_designer_presence;
create policy "Dashboard admins can read dashboard presence"
on public.es_designer_presence
for select to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can insert own dashboard presence" on public.es_designer_presence;
create policy "ES users can insert own dashboard presence"
on public.es_designer_presence
for insert to authenticated
with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "ES users can update own dashboard presence" on public.es_designer_presence;
create policy "ES users can update own dashboard presence"
on public.es_designer_presence
for update to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin())
with check (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin());

create or replace function public.prevent_dashboard_role_self_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) = 'suhail.quraishi@essentiallysports.com' then
    new.access_role := 'Server Owner';
    new.role := 'Server Owner';
  elsif lower(new.email) = 'manish.kalsi@essentiallysports.com' then
    new.access_role := 'Super Admin';
    new.role := 'Super Admin';
  elsif not public.is_es_designer_server_owner() then
    new.access_role := old.access_role;
    new.role := old.role;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_es_designer_profile_roles on public.es_designer_profiles;
create trigger protect_es_designer_profile_roles
before update on public.es_designer_profiles
for each row execute function public.prevent_dashboard_role_self_edit();

drop trigger if exists protect_es_designer_presence_roles on public.es_designer_presence;
create trigger protect_es_designer_presence_roles
before update on public.es_designer_presence
for each row execute function public.prevent_dashboard_role_self_edit();

create or replace function public.set_es_designer_access_role(target_email text, target_role text)
returns public.es_designer_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
  normalized_role text := trim(coalesce(target_role, ''));
  updated_profile public.es_designer_profiles;
begin
  if not public.is_es_designer_server_owner() then
    raise exception 'Only the Server Owner can assign dashboard roles.';
  end if;
  if normalized_email = '' or split_part(normalized_email, '@', 2) <> 'essentiallysports.com' then
    raise exception 'Only EssentiallySports emails can be assigned dashboard roles.';
  end if;
  if normalized_email = 'suhail.quraishi@essentiallysports.com' and normalized_role <> 'Server Owner' then
    raise exception 'The Server Owner role is protected.';
  end if;
  if normalized_role not in ('Associate', 'Admin', 'Super Admin', 'Server Owner') then
    raise exception 'Invalid dashboard role.';
  end if;

  update public.es_designer_profiles
  set access_role = normalized_role, role = normalized_role, updated_at = now()
  where lower(email) = normalized_email
  returning * into updated_profile;

  if not found then
    insert into public.es_designer_profiles (email, name, role, access_role, designation, last_seen_at, created_at, updated_at)
    values (normalized_email, split_part(normalized_email, '@', 1), normalized_role, normalized_role, 'Designer', now(), now(), now())
    returning * into updated_profile;
  end if;

  update public.es_designer_presence
  set access_role = normalized_role, role = normalized_role, updated_at = now()
  where lower(email) = normalized_email;
  return updated_profile;
end;
$$;

grant execute on function public.set_es_designer_access_role(text, text) to authenticated;
