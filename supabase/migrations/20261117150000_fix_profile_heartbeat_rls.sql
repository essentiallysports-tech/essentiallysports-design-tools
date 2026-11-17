-- Fix: non-admin profile heartbeat failed under RLS every 10-20s.
-- The client upserts its own es_designer_profiles row (INSERT ... ON CONFLICT
-- (email) DO UPDATE). Postgres requires the existing row to pass a SELECT
-- policy for that path, but only admins could read profiles, so every
-- non-admin heartbeat raised "new row violates row-level security policy"
-- and the presence update after it never ran.
-- This adds the narrowest possible read: a signed-in ES user may read ONLY
-- their own profile row (the update policy already allows the same row).
-- Admin-wide read is unchanged.
-- Undo: drop policy "ES users can read own dashboard profile" on public.es_designer_profiles;

drop policy if exists "ES users can read own dashboard profile" on public.es_designer_profiles;
create policy "ES users can read own dashboard profile"
  on public.es_designer_profiles
  for select
  to authenticated
  using (
    is_es_designer_domain_user()
    and lower(email) = lower(((select auth.jwt()) ->> 'email'::text))
  );
