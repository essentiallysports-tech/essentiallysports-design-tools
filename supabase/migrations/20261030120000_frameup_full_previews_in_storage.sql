-- Full-size export previews in Storage (step 1 of moving them out of
-- es_designer_tasks.metadata.previewDataUrl).
--
-- New exports also upload their preview to frameup-previews/previews/<task id>
-- and record that path in metadata.previewPath. metadata.previewDataUrl is
-- still written, so this is additive and the database copy stays the
-- fallback until every preview is confirmed in Storage.
--
-- Read access mirrors what the database allows today:
--   * dashboard admins see every export;
--   * ES-domain users see their own exports;
--   * any approved user sees Social Media exports (the Gallery).
-- Write access mirrors who can create the task row: its ES-domain creator,
-- or an admin. Write-once: no update/delete from the browser.
--
-- Undo:
--   drop policy if exists "frameup previews: full preview read" on storage.objects;
--   drop policy if exists "frameup previews: full preview upload" on storage.objects;
--   drop function if exists public.can_read_frameup_preview(text);
--   drop function if exists public.can_write_frameup_preview(text);
--   alter policy "frameup previews: approved users read" on storage.objects
--     using (bucket_id = 'frameup-previews'
--            and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email'));
--   update storage.buckets set allowed_mime_types = array['image/webp'],
--     file_size_limit = 524288 where id = 'frameup-previews';

-- Some browsers export PNG previews; allow it, and leave headroom on size
-- (largest preview stored today is ~250 KB).
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/png'],
    file_size_limit = 2097152
where id = 'frameup-previews';

create or replace function public.can_read_frameup_preview(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.es_designer_tasks t
    where t.id = p_id
      and t.task_type = 'exported_design'
      and (
        public.is_es_designer_admin()
        or (
          public.is_es_designer_domain_user()
          and lower(coalesce(t.creator_email, t.requester_email, '')) = lower((select auth.jwt()) ->> 'email')
        )
        or (
          t.workspace = 'Social Media'
          and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
        )
      )
  );
$$;

create or replace function public.can_write_frameup_preview(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.es_designer_tasks t
    where t.id = p_id
      and t.task_type = 'exported_design'
      and (
        public.is_es_designer_admin()
        or (
          public.is_es_designer_domain_user()
          and lower(coalesce(nullif(t.creator_email, ''), t.requester_email, '')) = lower((select auth.jwt()) ->> 'email')
        )
      )
  );
$$;

revoke all on function public.can_read_frameup_preview(text) from public, anon;
revoke all on function public.can_write_frameup_preview(text) from public, anon;
grant execute on function public.can_read_frameup_preview(text) to authenticated;
grant execute on function public.can_write_frameup_preview(text) to authenticated;

-- The thumbnails read rule covered the whole bucket. Narrow it to thumbs/ so
-- it can't also expose full previews; only thumbnails exist there today, so
-- nothing anyone can see changes.
alter policy "frameup previews: approved users read"
  on storage.objects
  using (
    bucket_id = 'frameup-previews'
    and (storage.foldername(name))[1] = 'thumbs'
    and public.is_es_designer_email_approved((select auth.jwt()) ->> 'email')
  );

drop policy if exists "frameup previews: full preview read" on storage.objects;
create policy "frameup previews: full preview read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'frameup-previews'
    and (storage.foldername(name))[1] = 'previews'
    and public.can_read_frameup_preview(split_part(name, '/', 2))
  );

drop policy if exists "frameup previews: full preview upload" on storage.objects;
create policy "frameup previews: full preview upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'frameup-previews'
    and (storage.foldername(name))[1] = 'previews'
    and public.can_write_frameup_preview(split_part(name, '/', 2))
  );
