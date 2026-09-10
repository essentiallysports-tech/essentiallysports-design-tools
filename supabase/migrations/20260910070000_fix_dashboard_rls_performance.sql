-- Fix: dashboard load-time / "Task sync timed out"
--
-- Root cause: RLS policies and the helper functions they call
-- (is_es_designer_admin, is_es_designer_domain_user) called auth.jwt()
-- directly, so Postgres re-evaluated it PER ROW instead of once per query
-- (Supabase Performance Advisor: "Auth RLS Initialization Plan"). Two tables
-- also had duplicate permissive SELECT policies doing redundant work
-- ("Multiple Permissive Policies").
--
-- This migration wraps every auth.jwt() call as (select auth.jwt()) so it's
-- evaluated once per query, and consolidates the duplicate SELECT policies
-- on es_designer_tasks and es_designer_access_requests. Also adds
-- designteam@essentiallysports.com to the admin allowlist inside
-- is_es_designer_admin() (the real database-level gate; the app-side
-- allowlist in dashboard-data.js was already updated separately).
--
-- Pure logic-preserving rewrite: no data changes, same effective
-- permissions, just evaluated efficiently. Applied directly against
-- production via the Supabase SQL editor on 2026-09-10; this migration
-- file documents that change for history/fresh-environment setup.

-- 1) Core admin-check function: cache auth.jwt(), add designteam@.
create or replace function public.is_es_designer_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select lower(coalesce((select auth.jwt()) ->> 'email', '')) in (
    'suhail.quraishi@essentiallysports.com',
    'manish.kalsi@essentiallysports.com',
    'designteam@essentiallysports.com'
  );
$function$;

-- 2) Domain-check function: cache auth.jwt().
create or replace function public.is_es_designer_domain_user()
returns boolean
language sql
stable
as $function$
  select split_part(lower(coalesce((select auth.jwt()) ->> 'email', '')), '@', 2) = 'essentiallysports.com';
$function$;

-- 3) es_designer_access_requests: consolidate the two permissive SELECT
--    policies into one, with auth.jwt() cached.
alter policy "Dashboard admins can read access requests"
  on public.es_designer_access_requests
  using (
    is_es_designer_admin()
    or lower(email) = lower(((select auth.jwt()) ->> 'email'::text))
  );

drop policy if exists "Users can read own access approval"
  on public.es_designer_access_requests;

-- 4) es_designer_activity: cache auth.jwt() in the insert-own-activity check.
alter policy "ES users can create own dashboard activity"
  on public.es_designer_activity
  with check (
    is_es_designer_domain_user()
    and (lower(actor_email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );

-- 5) es_designer_presence: cache auth.jwt() in both own-row policies.
alter policy "ES users can insert own dashboard presence"
  on public.es_designer_presence
  with check (
    is_es_designer_domain_user()
    and (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );

alter policy "ES users can update own dashboard presence"
  on public.es_designer_presence
  using (
    (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or is_es_designer_admin()
  )
  with check (
    (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or is_es_designer_admin()
  );

-- 6) es_designer_profiles: cache auth.jwt() in both own-row policies.
alter policy "ES users can insert own dashboard profile"
  on public.es_designer_profiles
  with check (
    is_es_designer_domain_user()
    and (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );

alter policy "ES users can update own dashboard profile"
  on public.es_designer_profiles
  using (
    (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or is_es_designer_admin()
  )
  with check (
    (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)))
    or is_es_designer_admin()
  );

-- 7) es_designer_tasks: consolidate the two permissive SELECT policies
--    (this was the exact table behind "Task sync timed out"), and cache
--    auth.jwt() in the insert-own-task check.
alter policy "Dashboard admins can read dashboard tasks"
  on public.es_designer_tasks
  using (
    is_es_designer_admin()
    or (
      is_es_designer_domain_user()
      and lower(coalesce(creator_email, requester_email, ''::text))
        = lower(((select auth.jwt()) ->> 'email'::text))
    )
  );

drop policy if exists "ES users can read own dashboard tasks"
  on public.es_designer_tasks;

alter policy "ES users can create dashboard tasks"
  on public.es_designer_tasks
  with check (
    is_es_designer_domain_user()
    and (
      (
        lower(coalesce(nullif(creator_email, ''::text), requester_email, ''::text))
          = lower(((select auth.jwt()) ->> 'email'::text))
      )
      or is_es_designer_admin()
    )
  );
