-- FrameUp Gallery: let every approved ES user browse the team's exported
-- Social Media posts, without opening the dashboard task table to them.
--
-- es_designer_tasks stays admin-readable (plus "own rows") under RLS. These two
-- SECURITY DEFINER functions expose only what a gallery needs (no emails,
-- briefs, notes or admin fields), and only for approved ES users.

create or replace function public.list_frameup_gallery(
  p_limit integer default 48,
  p_before timestamptz default null
)
returns table (
  id text,
  title text,
  workspace_variant text,
  sport text,
  team_or_league text,
  creator_name text,
  filename text,
  output_size text,
  exported_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.title,
    t.workspace_variant,
    t.sport,
    t.team_or_league,
    t.creator_name,
    t.filename,
    coalesce(t.metadata ->> 'outputSize', '') as output_size,
    coalesce(nullif(t.metadata ->> 'exportedAt', '')::timestamptz, t.created_at) as exported_at
  from public.es_designer_tasks t
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.task_type = 'exported_design'
    and t.workspace = 'Social Media'
    and (p_before is null or coalesce(nullif(t.metadata ->> 'exportedAt', '')::timestamptz, t.created_at) < p_before)
  order by exported_at desc
  limit least(greatest(coalesce(p_limit, 48), 1), 96);
$$;

create or replace function public.get_frameup_gallery_preview(p_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select t.metadata ->> 'previewDataUrl'
  from public.es_designer_tasks t
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.id = p_id
    and t.task_type = 'exported_design'
    and t.workspace = 'Social Media'
  limit 1;
$$;

revoke all on function public.list_frameup_gallery(integer, timestamptz) from public, anon;
revoke all on function public.get_frameup_gallery_preview(text) from public, anon;
grant execute on function public.list_frameup_gallery(integer, timestamptz) to authenticated;
grant execute on function public.get_frameup_gallery_preview(text) to authenticated;
