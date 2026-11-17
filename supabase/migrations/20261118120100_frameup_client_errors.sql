-- Client error reports: browser errors, unhandled promise rejections and
-- failed /api/* calls, sent by frameup-errors.js to /api/client-errors.
-- The server writes each row with the signed-in person's own session
-- (insert own only); only dashboard admins can read them (Dashboard →
-- Errors, last 7 days). Messages and stacks are scrubbed in the browser and
-- again on the server: no tokens, passwords, emails, query strings or form
-- contents.
--
-- Retention: rows older than 30 days are deleted by
-- frameup_purge_old_client_errors(). Schedule it once with pg_cron if enabled:
--   select cron.schedule('frameup-purge-client-errors', '27 3 * * *', 'select public.frameup_purge_old_client_errors()');
--
-- Undo:
--   select cron.unschedule('frameup-purge-client-errors');   -- only if scheduled
--   drop function if exists public.frameup_purge_old_client_errors();
--   drop table if exists public.frameup_client_errors;

create table if not exists public.frameup_client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_email text not null,
  kind text not null check (kind in ('error', 'rejection', 'api', 'resource')),
  message text not null default '' check (char_length(message) <= 600),
  stack text not null default '' check (char_length(stack) <= 4000),
  page text not null default '' check (char_length(page) <= 200),
  source text not null default '' check (char_length(source) <= 300),
  line integer,
  col integer,
  status integer,
  fingerprint text not null default '' check (char_length(fingerprint) <= 64),
  occurrences integer not null default 1 check (occurrences between 1 and 1000),
  release text not null default '' check (char_length(release) <= 40),
  user_agent text not null default '' check (char_length(user_agent) <= 200)
);

create index if not exists frameup_client_errors_created_at_idx
  on public.frameup_client_errors (created_at desc);
create index if not exists frameup_client_errors_fingerprint_idx
  on public.frameup_client_errors (fingerprint, created_at desc);

alter table public.frameup_client_errors enable row level security;

drop policy if exists "frameup client errors: users log own" on public.frameup_client_errors;
create policy "frameup client errors: users log own"
  on public.frameup_client_errors for insert
  to authenticated
  with check (lower(user_email) = lower((select auth.jwt()) ->> 'email'));

drop policy if exists "frameup client errors: admins read" on public.frameup_client_errors;
create policy "frameup client errors: admins read"
  on public.frameup_client_errors for select
  to authenticated
  using (public.is_es_designer_admin());

create or replace function public.frameup_purge_old_client_errors()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.frameup_client_errors
    where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.frameup_purge_old_client_errors() from public, anon, authenticated;
