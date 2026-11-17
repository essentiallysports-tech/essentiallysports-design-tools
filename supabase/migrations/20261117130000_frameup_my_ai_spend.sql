-- Personal AI spend: the caller's own AI cost since a given time.
--
-- People can't read public.frameup_ai_usage directly (only dashboard admins
-- can, see 20261112120000_frameup_ai_usage.sql). This helper returns just the
-- signed-in person's own totals, for:
--   * the "AI usage" card at the bottom of the app sidebar (app-shell.js), and
--   * the per-person weekly $ cap in netlify/functions/_ai-gateway.js
--     (userOverWeeklyLimit), which fails open until this function exists.
-- The week starts Monday 00:00 UTC; callers pass that as p_since.
--
-- Rows are matched by the signed-in email (frameup_ai_usage has no user id
-- column; the insert policy already ties user_email to the JWT email), the
-- same way frameup_my_ai_calls_last_hour() counts calls.
--
-- Undo:
--   drop function if exists public.frameup_my_ai_spend(timestamptz);

create or replace function public.frameup_my_ai_spend(p_since timestamptz)
returns table (total_usd numeric, by_feature jsonb, calls integer)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select
      -- "generate-backup" counts under "generate".
      regexp_replace(feature, '-backup$', '') as feature,
      cost_usd
    from public.frameup_ai_usage
    where lower(user_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      and auth.uid() is not null
      and created_at >= coalesce(p_since, now() - interval '7 days')
  ),
  per_feature as (
    select feature, sum(cost_usd) as usd
    from mine
    group by feature
  )
  select
    coalesce((select sum(cost_usd) from mine), 0)::numeric as total_usd,
    coalesce((select jsonb_object_agg(feature, round(usd, 4)) from per_feature), '{}'::jsonb) as by_feature,
    (select count(*) from mine)::integer as calls;
$$;

revoke all on function public.frameup_my_ai_spend(timestamptz) from public, anon;
grant execute on function public.frameup_my_ai_spend(timestamptz) to authenticated;

-- Served by frameup_ai_usage_user_recent_idx (lower(user_email), created_at desc)
-- from 20261115120000_security_hardening.sql.
