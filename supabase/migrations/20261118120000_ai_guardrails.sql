-- AI guardrails: measurable usage rows, a team weekly cap and spend alerts.
-- See project-docs/ai-strategy-and-costs.md ("What shipped").
--
-- 1. frameup_ai_usage gets four nullable measurement columns. The server
--    (netlify/functions/_ai-gateway.js logUsage) writes them when they exist and
--    drops them automatically while this migration is not applied.
-- 2. frameup_team_ai_spend(p_since): the team's total AI cost since a time,
--    for the team cap (AI_TEAM_WEEKLY_LIMIT_USD). Callable by signed-in ES
--    users; returns ONLY the aggregate, never anyone's rows or emails.
-- 3. frameup_ai_budget_summary(p_since): the week's total and per-person
--    totals for the daily alert job. service_role only (the server uses
--    SUPABASE_SERVICE_ROLE_KEY); signed-in users can't call it.
-- 4. frameup_ai_alerts + frameup_ai_alert_claim(p_key): remembers which Slack
--    alerts were sent, so each fires once per week. service_role only for the
--    claim; dashboard admins can read the table.
--
-- Safe to run more than once.
--
-- Undo:
--   drop function if exists public.frameup_ai_alert_claim(text);
--   drop table if exists public.frameup_ai_alerts;
--   drop function if exists public.frameup_ai_budget_summary(timestamptz);
--   drop function if exists public.frameup_team_ai_spend(timestamptz);
--   drop index if exists public.frameup_ai_usage_run_idx;
--   alter table public.frameup_ai_usage
--     drop column if exists cache_read_tokens,
--     drop column if exists cache_write_tokens,
--     drop column if exists task,
--     drop column if exists run_id;

-- 1. Measurement columns (nullable: old rows and old servers stay valid).
alter table public.frameup_ai_usage
  add column if not exists cache_read_tokens integer,
  add column if not exists cache_write_tokens integer,
  add column if not exists task text,
  add column if not exists run_id text;

create index if not exists frameup_ai_usage_run_idx
  on public.frameup_ai_usage (run_id)
  where run_id is not null;

-- 2. Team spend: aggregate only. Looks back at most 35 days.
create or replace function public.frameup_team_ai_spend(p_since timestamptz)
returns table (total_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(u.cost_usd), 0)::numeric as total_usd
  from public.frameup_ai_usage u
  where public.is_es_designer_domain_user()
    and u.created_at >= greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '35 days');
$$;

revoke all on function public.frameup_team_ai_spend(timestamptz) from public, anon;
grant execute on function public.frameup_team_ai_spend(timestamptz) to authenticated;

-- 3. Budget summary for the alert job (service_role only).
create or replace function public.frameup_ai_budget_summary(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select lower(u.user_email) as email, u.cost_usd
    from public.frameup_ai_usage u
    where u.created_at >= greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '35 days')
  ),
  per_user as (
    select email, sum(cost_usd) as usd
    from recent
    group by email
  )
  select jsonb_build_object(
    'total_usd', coalesce((select sum(cost_usd) from recent), 0),
    'users', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'total_usd', round(usd, 4)) order by usd desc) from per_user), '[]'::jsonb)
  );
$$;

revoke all on function public.frameup_ai_budget_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.frameup_ai_budget_summary(timestamptz) to service_role;

-- 4. Sent alerts (one row per alert key, e.g. 'team:2026-11-16:80').
create table if not exists public.frameup_ai_alerts (
  key text primary key,
  created_at timestamptz not null default now()
);

alter table public.frameup_ai_alerts enable row level security;

drop policy if exists "frameup ai alerts: admins read" on public.frameup_ai_alerts;
create policy "frameup ai alerts: admins read"
  on public.frameup_ai_alerts for select
  to authenticated
  using (public.is_es_designer_admin());

revoke insert, update, delete on public.frameup_ai_alerts from anon, authenticated;

-- True the first time a key is claimed, false after. Prunes rows older than 60 days.
create or replace function public.frameup_ai_alert_claim(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if coalesce(trim(p_key), '') = '' then
    return false;
  end if;
  insert into public.frameup_ai_alerts (key) values (left(trim(p_key), 200))
  on conflict (key) do nothing;
  get diagnostics inserted = row_count;
  delete from public.frameup_ai_alerts where created_at < now() - interval '60 days';
  return inserted > 0;
end;
$$;

revoke all on function public.frameup_ai_alert_claim(text) from public, anon, authenticated;
grant execute on function public.frameup_ai_alert_claim(text) to service_role;
