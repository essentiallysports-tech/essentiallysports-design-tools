-- Security hardening (2026-11-15 audit).
--
-- 1. Access requests: anyone could INSERT a row straight into
--    es_designer_access_requests with status 'Approved' (the insert policy only
--    checked the email), which made is_es_designer_email_approved() true and let
--    the signup hook accept that address. Direct inserts are removed; requests go
--    through upsert_es_designer_access_request(), which always writes 'Pending'.
-- 2. upsert_es_designer_access_request(): length caps, a Rejected request stays
--    Rejected, and the returned row no longer echoes another person's stored
--    details (name, reason, reviewer, browser) back to an anonymous caller.
-- 3. frameup_ai_usage: rows can't carry negative cost or token counts (they
--    skewed the Dashboard's AI spend panel), and a helper returns the caller's own
--    call count for the last hour (used by the per-person AI limit in
--    netlify/functions/_ai-gateway.js, which fails open until this exists).
--
-- Undo:
--   create policy "Anyone can request ES Designer access" ... (see 20260709120000)
--   grant insert on public.es_designer_access_requests to anon;
--   alter table public.frameup_ai_usage drop constraint if exists frameup_ai_usage_non_negative;
--   drop function if exists public.frameup_my_ai_calls_last_hour();

-- 1. No direct inserts into the access-request queue.
drop policy if exists "Anyone can request ES Designer access" on public.es_designer_access_requests;
revoke insert on public.es_designer_access_requests from anon, authenticated;

-- 2. The request function: Pending only, capped, Rejected stays Rejected.
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
  clean_name text;
  clean_reason text;
  clean_source text;
  updated_request public.es_designer_access_requests;
begin
  normalized_email := lower(trim(coalesce(request_email, '')));
  clean_name := left(trim(coalesce(request_name, '')), 120);
  clean_reason := left(trim(coalesce(request_reason, '')), 1000);
  clean_source := left(trim(coalesce(request_source, 'login')), 40);

  if normalized_email = '' or position('@' in normalized_email) = 0 or length(normalized_email) > 254 then
    raise exception 'A valid email is required.';
  end if;

  if split_part(normalized_email, '@', 2) = 'essentiallysports.com' then
    raise exception 'EssentiallySports emails do not need an access request.';
  end if;

  insert into public.es_designer_access_requests (
    email, name, status, reason, source, user_agent, requested_at, updated_at
  )
  values (
    normalized_email,
    clean_name,
    'Pending',
    clean_reason,
    clean_source,
    left(trim(coalesce(request_user_agent, '')), 500),
    now(),
    now()
  )
  on conflict (email) do update
  set
    name = coalesce(nullif(excluded.name, ''), public.es_designer_access_requests.name),
    -- Approved and Rejected are decisions; a repeat request doesn't undo them.
    status = case
      when public.es_designer_access_requests.status in ('Approved', 'Rejected') then public.es_designer_access_requests.status
      else 'Pending'
    end,
    reason = coalesce(nullif(excluded.reason, ''), public.es_designer_access_requests.reason),
    source = coalesce(nullif(excluded.source, ''), public.es_designer_access_requests.source),
    user_agent = coalesce(nullif(excluded.user_agent, ''), public.es_designer_access_requests.user_agent),
    requested_at = case
      when public.es_designer_access_requests.status = 'Pending' then now()
      else public.es_designer_access_requests.requested_at
    end,
    updated_at = now()
  returning * into updated_request;

  -- Echo back only what the caller sent plus the status, never stored details.
  updated_request.name := clean_name;
  updated_request.reason := clean_reason;
  updated_request.user_agent := '';
  updated_request.reviewed_by := '';
  return updated_request;
end;
$$;

grant execute on function public.upsert_es_designer_access_request(text, text, text, text, text) to anon, authenticated;

-- 3a. No negative spend rows (NOT VALID: existing rows are left as they are).
alter table public.frameup_ai_usage drop constraint if exists frameup_ai_usage_non_negative;
alter table public.frameup_ai_usage
  add constraint frameup_ai_usage_non_negative
  check (cost_usd >= 0 and input_tokens >= 0 and output_tokens >= 0 and images >= 0)
  not valid;

-- 3b. The caller's own AI calls in the last hour (for the per-person limit).
create or replace function public.frameup_my_ai_calls_last_hour()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.frameup_ai_usage
  where lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and created_at > now() - interval '1 hour';
$$;

revoke all on function public.frameup_my_ai_calls_last_hour() from public, anon;
grant execute on function public.frameup_my_ai_calls_last_hour() to authenticated;

create index if not exists frameup_ai_usage_user_recent_idx
  on public.frameup_ai_usage (lower(user_email), created_at desc);
