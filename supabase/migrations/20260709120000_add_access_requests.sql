-- Non-ES access request queue for ES Designer.
-- Public login can create a request; dashboard admins can approve/reject it.

create table if not exists public.es_designer_access_requests (
  email text primary key,
  name text not null default '',
  status text not null default 'Pending',
  reason text not null default '',
  source text not null default 'login',
  user_agent text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint es_designer_access_requests_status_check
    check (status in ('Pending', 'Approved', 'Rejected'))
);

alter table public.es_designer_access_requests enable row level security;

drop policy if exists "Anyone can request ES Designer access" on public.es_designer_access_requests;
create policy "Anyone can request ES Designer access"
on public.es_designer_access_requests
for insert
to anon, authenticated
with check (
  lower(email) = email
  and email <> ''
  and split_part(email, '@', 2) <> 'essentiallysports.com'
);

drop policy if exists "Dashboard admins can read access requests" on public.es_designer_access_requests;
create policy "Dashboard admins can read access requests"
on public.es_designer_access_requests
for select
to authenticated
using (public.is_es_designer_admin());

drop policy if exists "Users can read own access approval" on public.es_designer_access_requests;
create policy "Users can read own access approval"
on public.es_designer_access_requests
for select
to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "Dashboard admins can update access requests" on public.es_designer_access_requests;
create policy "Dashboard admins can update access requests"
on public.es_designer_access_requests
for update
to authenticated
using (public.is_es_designer_admin())
with check (public.is_es_designer_admin());

grant select, insert, update on public.es_designer_access_requests to authenticated;
grant insert on public.es_designer_access_requests to anon;
grant select on public.es_designer_access_requests to supabase_auth_admin;

create or replace function public.upsert_es_designer_access_request(
  request_email text,
  request_name text default '',
  request_reason text default '',
  request_source text default 'login',
  request_user_agent text default ''
)
returns public.es_designer_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  updated_request public.es_designer_access_requests;
begin
  normalized_email := lower(trim(coalesce(request_email, '')));

  if normalized_email = '' or position('@' in normalized_email) = 0 then
    raise exception 'A valid email is required.';
  end if;

  if split_part(normalized_email, '@', 2) = 'essentiallysports.com' then
    raise exception 'EssentiallySports emails do not need an access request.';
  end if;

  insert into public.es_designer_access_requests (
    email,
    name,
    status,
    reason,
    source,
    user_agent,
    requested_at,
    updated_at
  )
  values (
    normalized_email,
    trim(coalesce(request_name, '')),
    'Pending',
    trim(coalesce(request_reason, '')),
    trim(coalesce(request_source, 'login')),
    left(trim(coalesce(request_user_agent, '')), 500),
    now(),
    now()
  )
  on conflict (email) do update
  set
    name = coalesce(nullif(excluded.name, ''), public.es_designer_access_requests.name),
    status = case
      when public.es_designer_access_requests.status = 'Approved' then 'Approved'
      else 'Pending'
    end,
    reason = coalesce(nullif(excluded.reason, ''), public.es_designer_access_requests.reason),
    source = coalesce(nullif(excluded.source, ''), public.es_designer_access_requests.source),
    user_agent = coalesce(nullif(excluded.user_agent, ''), public.es_designer_access_requests.user_agent),
    requested_at = case
      when public.es_designer_access_requests.status = 'Approved' then public.es_designer_access_requests.requested_at
      else now()
    end,
    updated_at = now()
  returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.upsert_es_designer_access_request(text, text, text, text, text) to anon, authenticated;

create or replace function public.review_es_designer_access_request(
  request_email text,
  next_status text
)
returns public.es_designer_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  normalized_status text;
  reviewer_email text;
  updated_request public.es_designer_access_requests;
begin
  if not public.is_es_designer_admin() then
    raise exception 'Only dashboard admins can review access requests.';
  end if;

  normalized_email := lower(trim(coalesce(request_email, '')));
  normalized_status := trim(coalesce(next_status, ''));
  reviewer_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if normalized_status not in ('Approved', 'Rejected', 'Pending') then
    raise exception 'Invalid access request status.';
  end if;

  update public.es_designer_access_requests
  set
    status = normalized_status,
    reviewed_at = case when normalized_status in ('Approved', 'Rejected') then now() else null end,
    reviewed_by = case when normalized_status in ('Approved', 'Rejected') then reviewer_email else '' end,
    updated_at = now()
  where email = normalized_email
  returning * into updated_request;

  if not found then
    raise exception 'Access request not found.';
  end if;

  if normalized_status = 'Approved' then
    insert into public.es_designer_profiles (email, name, role, access_role, designation, last_seen_at, created_at, updated_at)
    values (normalized_email, split_part(normalized_email, '@', 1), 'Associate', 'Associate', 'Approved External User', now(), now(), now())
    on conflict (email) do update
    set
      access_role = case
        when public.es_designer_profiles.access_role in ('Admin', 'Super Admin', 'Server Owner') then public.es_designer_profiles.access_role
        else 'Associate'
      end,
      role = case
        when public.es_designer_profiles.role in ('Admin', 'Super Admin', 'Server Owner') then public.es_designer_profiles.role
        else 'Associate'
      end,
      designation = coalesce(nullif(public.es_designer_profiles.designation, ''), 'Approved External User'),
      updated_at = now();
  end if;

  return updated_request;
end;
$$;

grant execute on function public.review_es_designer_access_request(text, text) to authenticated;

create or replace function public.is_es_designer_email_approved(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(trim(coalesce(candidate_email, ''))) = 'bu8945@gmail.com'
    or split_part(lower(trim(coalesce(candidate_email, ''))), '@', 2) = 'essentiallysports.com'
    or exists (
      select 1
      from public.es_designer_access_requests
      where email = lower(trim(coalesce(candidate_email, '')))
        and status = 'Approved'
    );
$$;

grant execute on function public.is_es_designer_email_approved(text) to anon, authenticated, supabase_auth_admin;

-- Update the auth hook so approved external users and explicit exceptions can sign up.
create or replace function public.hook_restrict_es_signup_domain(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  signup_email text;
begin
  signup_email := lower(trim(coalesce(event -> 'user' ->> 'email', '')));

  if public.is_es_designer_email_approved(signup_email) then
    return event;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'This email needs ES Designer admin approval before signup.'
    )
  );
end;
$$;
