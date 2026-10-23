-- FrameUp Generate learning: past Social Media designs as examples.
--
-- Read-only and additive. Like list_frameup_gallery, it exposes only safe
-- fields to approved ES users, plus the brief a design was generated from
-- (metadata.generated.brief) when it came from Generate, so confirmed
-- brief -> design pairs can guide future results.

create or replace function public.list_frameup_examples(
  p_limit integer default 96,
  p_before timestamptz default null
)
returns table (
  title text,
  workspace_variant text,
  exported_at timestamptz,
  brief text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.title,
    t.workspace_variant,
    t.created_at as exported_at,
    coalesce(t.metadata -> 'generated' ->> 'brief', '') as brief
  from public.es_designer_tasks t
  where public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
    and t.task_type = 'exported_design'
    and t.workspace = 'Social Media'
    and (p_before is null or t.created_at < p_before)
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 96), 1), 200);
$$;

revoke all on function public.list_frameup_examples(integer, timestamptz) from public, anon;
grant execute on function public.list_frameup_examples(integer, timestamptz) to authenticated;
notify pgrst, 'reload schema';
