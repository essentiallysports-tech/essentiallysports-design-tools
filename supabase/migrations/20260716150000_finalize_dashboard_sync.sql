-- Final shared-dashboard integrity pass.
-- 1. Dashboard access is restricted to the two explicit admin emails.
-- 2. Existing Supabase Auth users are backfilled into the public People table.
-- 3. Future signups are inserted by an auth.users trigger.
-- 4. Activity is shared across browsers instead of remaining browser-local.

alter table if exists public.es_designer_profiles
  add column if not exists designation text not null default 'Designer',
  add column if not exists access_role text not null default 'Associate';

alter table if exists public.es_designer_presence
  add column if not exists designation text not null default 'Designer',
  add column if not exists access_role text not null default 'Associate';

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
  );
$$;

create or replace function public.handle_es_designer_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text := lower(trim(coalesce(new.email, '')));
  user_name text;
  default_access_role text := 'Associate';
begin
  if user_email = '' or split_part(user_email, '@', 2) <> 'essentiallysports.com' then
    return new;
  end if;

  user_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    split_part(user_email, '@', 1)
  );

  if user_email = 'suhail.quraishi@essentiallysports.com' then
    default_access_role := 'Server Owner';
  elsif user_email = 'manish.kalsi@essentiallysports.com' then
    default_access_role := 'Super Admin';
  end if;

  insert into public.es_designer_profiles (
    email, name, role, access_role, designation, last_seen_at, created_at, updated_at
  ) values (
    user_email,
    user_name,
    default_access_role,
    default_access_role,
    coalesce(nullif(trim(coalesce(new.raw_user_meta_data ->> 'designation', '')), ''), 'Designer'),
    now(),
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (email) do update set
    name = case
      when public.es_designer_profiles.name = '' then excluded.name
      else public.es_designer_profiles.name
    end,
    last_seen_at = coalesce(public.es_designer_profiles.last_seen_at, excluded.last_seen_at),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_es_designer_user_created on auth.users;
create trigger on_es_designer_user_created
after insert on auth.users
for each row execute function public.handle_es_designer_user_created();

-- The trigger only covers new accounts. Backfill accounts created before it.
insert into public.es_designer_profiles (
  email, name, role, access_role, designation, last_seen_at, created_at, updated_at
)
select
  lower(trim(user_record.email)),
  coalesce(
    nullif(trim(coalesce(user_record.raw_user_meta_data ->> 'name', '')), ''),
    split_part(lower(trim(user_record.email)), '@', 1)
  ),
  case
    when lower(trim(user_record.email)) = 'suhail.quraishi@essentiallysports.com' then 'Server Owner'
    when lower(trim(user_record.email)) = 'manish.kalsi@essentiallysports.com' then 'Super Admin'
    else 'Associate'
  end,
  case
    when lower(trim(user_record.email)) = 'suhail.quraishi@essentiallysports.com' then 'Server Owner'
    when lower(trim(user_record.email)) = 'manish.kalsi@essentiallysports.com' then 'Super Admin'
    else 'Associate'
  end,
  coalesce(nullif(trim(coalesce(user_record.raw_user_meta_data ->> 'designation', '')), ''), 'Designer'),
  coalesce(user_record.last_sign_in_at, user_record.created_at, now()),
  coalesce(user_record.created_at, now()),
  now()
from auth.users as user_record
where user_record.email is not null
  and split_part(lower(trim(user_record.email)), '@', 2) = 'essentiallysports.com'
on conflict (email) do nothing;

create table if not exists public.es_designer_activity (
  id text primary key,
  event_type text not null default 'activity',
  label text not null default '',
  entity_id text not null default '',
  entity_type text not null default '',
  actor_name text not null default '',
  actor_email text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists es_designer_activity_created_at_idx
on public.es_designer_activity(created_at desc);

alter table public.es_designer_activity enable row level security;

drop policy if exists "Dashboard admins can read dashboard activity" on public.es_designer_activity;
create policy "Dashboard admins can read dashboard activity"
on public.es_designer_activity
for select to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can create own dashboard activity" on public.es_designer_activity;
create policy "ES users can create own dashboard activity"
on public.es_designer_activity
for insert to authenticated
with check (
  public.is_es_designer_domain_user()
  and lower(actor_email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "Dashboard admins can update dashboard activity" on public.es_designer_activity;
create policy "Dashboard admins can update dashboard activity"
on public.es_designer_activity
for update to authenticated
using (public.is_es_designer_admin())
with check (public.is_es_designer_admin());

-- Recreate task policies against the strict two-email admin predicate.
alter table public.es_designer_tasks enable row level security;

drop policy if exists "Dashboard admins can read dashboard tasks" on public.es_designer_tasks;
create policy "Dashboard admins can read dashboard tasks"
on public.es_designer_tasks
for select to authenticated
using (public.is_es_designer_admin());

drop policy if exists "Dashboard admins can update dashboard tasks" on public.es_designer_tasks;
create policy "Dashboard admins can update dashboard tasks"
on public.es_designer_tasks
for update to authenticated
using (public.is_es_designer_admin())
with check (public.is_es_designer_admin());

drop policy if exists "ES users can create dashboard tasks" on public.es_designer_tasks;
create policy "ES users can create dashboard tasks"
on public.es_designer_tasks
for insert to authenticated
with check (
  public.is_es_designer_domain_user()
  and (
    lower(coalesce(nullif(creator_email, ''), requester_email, '')) = lower(auth.jwt() ->> 'email')
    or public.is_es_designer_admin()
  )
);

-- Rebuild People and presence policies as part of this final migration so an
-- older role-based policy cannot accidentally expose the dashboard again.
alter table public.es_designer_profiles enable row level security;

drop policy if exists "ES users can read dashboard profiles" on public.es_designer_profiles;
drop policy if exists "Dashboard admins can read dashboard profiles" on public.es_designer_profiles;
create policy "Dashboard admins can read dashboard profiles"
on public.es_designer_profiles
for select to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can insert own dashboard profile" on public.es_designer_profiles;
create policy "ES users can insert own dashboard profile"
on public.es_designer_profiles
for insert to authenticated
with check (
  public.is_es_designer_domain_user()
  and lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "ES users can update own dashboard profile" on public.es_designer_profiles;
create policy "ES users can update own dashboard profile"
on public.es_designer_profiles
for update to authenticated
using (
  lower(email) = lower(auth.jwt() ->> 'email')
  or public.is_es_designer_admin()
)
with check (
  lower(email) = lower(auth.jwt() ->> 'email')
  or public.is_es_designer_admin()
);

alter table public.es_designer_presence enable row level security;

drop policy if exists "ES users can read dashboard presence" on public.es_designer_presence;
drop policy if exists "Dashboard admins can read dashboard presence" on public.es_designer_presence;
create policy "Dashboard admins can read dashboard presence"
on public.es_designer_presence
for select to authenticated
using (public.is_es_designer_admin());

drop policy if exists "ES users can insert own dashboard presence" on public.es_designer_presence;
create policy "ES users can insert own dashboard presence"
on public.es_designer_presence
for insert to authenticated
with check (
  public.is_es_designer_domain_user()
  and lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "ES users can update own dashboard presence" on public.es_designer_presence;
create policy "ES users can update own dashboard presence"
on public.es_designer_presence
for update to authenticated
using (
  lower(email) = lower(auth.jwt() ->> 'email')
  or public.is_es_designer_admin()
)
with check (
  lower(email) = lower(auth.jwt() ->> 'email')
  or public.is_es_designer_admin()
);

grant select, insert, update on public.es_designer_activity to authenticated;
grant select, insert, update on public.es_designer_profiles to authenticated;
grant select, insert, update on public.es_designer_presence to authenticated;
grant select, insert, update on public.es_designer_tasks to authenticated;
