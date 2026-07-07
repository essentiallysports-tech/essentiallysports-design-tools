-- Shared dashboard people + presence data for ES Designer.
-- This lets dashboard admins see signed-up ES users and recent active sessions
-- without exposing Supabase Auth admin APIs to the browser.

create table if not exists public.es_designer_profiles (
  email text primary key,
  name text not null default '',
  role text not null default 'Designer',
  avatar_url text not null default '',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.es_designer_presence (
  email text primary key references public.es_designer_profiles(email) on delete cascade,
  name text not null default '',
  role text not null default 'Designer',
  avatar_url text not null default '',
  page_path text not null default '',
  workspace text not null default '',
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_es_designer_domain_user()
returns boolean
language sql
stable
as $$
  select split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = 'essentiallysports.com';
$$;

create or replace function public.is_es_designer_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'suhail.quraishi@essentiallysports.com',
    'manish.kalsi@essentiallysports.com'
  );
$$;

alter table public.es_designer_profiles enable row level security;
alter table public.es_designer_presence enable row level security;

drop policy if exists "ES users can read dashboard profiles" on public.es_designer_profiles;
create policy "Dashboard admins can read dashboard profiles"
on public.es_designer_profiles
for select
to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can insert own dashboard profile" on public.es_designer_profiles;
create policy "ES users can insert own dashboard profile"
on public.es_designer_profiles
for insert
to authenticated
with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "ES users can update own dashboard profile" on public.es_designer_profiles;
create policy "ES users can update own dashboard profile"
on public.es_designer_profiles
for update
to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin())
with check (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin());

drop policy if exists "ES users can read dashboard presence" on public.es_designer_presence;
create policy "Dashboard admins can read dashboard presence"
on public.es_designer_presence
for select
to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can insert own dashboard presence" on public.es_designer_presence;
create policy "ES users can insert own dashboard presence"
on public.es_designer_presence
for insert
to authenticated
with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "ES users can update own dashboard presence" on public.es_designer_presence;
create policy "ES users can update own dashboard presence"
on public.es_designer_presence
for update
to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin())
with check (lower(email) = lower(auth.jwt() ->> 'email') or public.is_es_designer_admin());

create or replace function public.handle_es_designer_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  user_name text;
  user_role text;
begin
  user_email := lower(trim(coalesce(new.email, '')));
  if user_email = '' or split_part(user_email, '@', 2) <> 'essentiallysports.com' then
    return new;
  end if;

  user_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), '');
  user_role := nullif(trim(coalesce(new.raw_user_meta_data ->> 'role', '')), '');

  insert into public.es_designer_profiles (
    email,
    name,
    role,
    last_seen_at,
    created_at,
    updated_at
  )
  values (
    user_email,
    coalesce(user_name, split_part(user_email, '@', 1)),
    coalesce(user_role, 'Designer'),
    now(),
    now(),
    now()
  )
  on conflict (email) do update
  set
    name = excluded.name,
    role = excluded.role,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_es_designer_user_created on auth.users;
create trigger on_es_designer_user_created
after insert on auth.users
for each row execute function public.handle_es_designer_user_created();

grant usage on schema public to authenticated;
grant select, insert, update on public.es_designer_profiles to authenticated;
grant select, insert, update on public.es_designer_presence to authenticated;
