-- FrameUp stars of the week: the top 3 people by exports in the last p_days,
-- shown in the Home page ticker to every approved ES user.
--
-- es_designer_tasks stays admin-readable under RLS. Like the gallery RPCs,
-- this SECURITY DEFINER function exposes only a display name and a count
-- (never emails), and only to approved ES users. created_at is used for the
-- window, not metadata.exportedAt (see 20261025130000_fix_frameup_gallery_dates).

create or replace function public.get_frameup_star_user(p_days integer default 7)
returns table (
  star_name text,
  export_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      nullif(max(t.creator_name), ''),
      split_part(lower(t.creator_email), '@', 1)
    ) as star_name,
    count(*)::integer as export_count
  from public.es_designer_tasks t
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.task_type = 'exported_design'
    and t.creator_email <> ''
    and t.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 365))
  group by lower(t.creator_email)
  order by export_count desc, max(t.created_at) desc
  limit 3;
$$;

revoke all on function public.get_frameup_star_user(integer) from public, anon;
grant execute on function public.get_frameup_star_user(integer) to authenticated;
notify pgrst, 'reload schema';
