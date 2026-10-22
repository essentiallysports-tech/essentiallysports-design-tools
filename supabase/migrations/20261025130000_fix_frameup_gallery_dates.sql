-- FrameUp Gallery: order by created_at instead of casting metadata.exportedAt.
-- A single malformed exportedAt value made the timestamptz cast fail and the
-- whole gallery query error out. created_at is set at export time anyway.

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
    t.created_at as exported_at
  from public.es_designer_tasks t
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.task_type = 'exported_design'
    and t.workspace = 'Social Media'
    and (p_before is null or t.created_at < p_before)
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 48), 1), 96);
$$;

revoke all on function public.list_frameup_gallery(integer, timestamptz) from public, anon;
grant execute on function public.list_frameup_gallery(integer, timestamptz) to authenticated;
notify pgrst, 'reload schema';
